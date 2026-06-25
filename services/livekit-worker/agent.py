from __future__ import annotations

import logging
import os
import asyncio
import uuid
from dataclasses import dataclass
from typing import Any

import aiohttp
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    DEFAULT_API_CONNECT_OPTIONS,
    JobContext,
    NOT_GIVEN,
    cli,
    function_tool,
    llm,
    stt,
    tts,
)
from livekit.plugins import openai, silero

from lipivoice_client import LipiVoiceClient, parse_dispatch_metadata

load_dotenv()

logger = logging.getLogger("lipivoice-worker")
server = AgentServer()

UNSUPPORTED_LANGUAGE_CLARIFICATION = (
    "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?"
)
UNSUPPORTED_LANGUAGE_PROMPT_SENTENCES = [
    (
        "If the caller uses Newari, Hindi, or another unsupported language, say in Nepali: "
        "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?"
    ),
    (
        "Do not infer an insurance product from Newari, unclear mixed speech, or speech recognition noise. "
        "Ask the caller to repeat in Nepali or English instead of guessing."
    ),
]
UNSUPPORTED_LANGUAGE_INTAKE_INSTRUCTION = (
    "The caller is still unclear after one clarification. "
    "This instruction overrides the earlier unsupported-language clarification rule. "
    "Do not guess their insurance type or repeat the same clarification. "
    "Do not say the earlier Nepali-or-English clarification again. "
    "Naturally move to callback or policy intake in Nepali or natural Nepali-English. "
    "Ask for the caller's name, phone number, and policy number or claim number. "
    "Keep it to one or two short phone-friendly sentences."
)

UNSUPPORTED_SPEECH_FRAGMENTS = [
    "पति पार्स तो इंचरेंस गरिक्प",
    "उड़ा इन्सुर्यन्स गौन",
    "ति पार्सा",
    "गौन रुपो",
    "जिवन्ने मैले",
    "गरिक्प",
    "गौन",
]

SELF_HOSTED_TTS_VOICE_MAP: dict[str, str] = {
    "voice_lipi_ml_ne": "voice_lipi_ml_ne",
    "voice_piper_ne": "voice_piper_ne",
    "voice_piper_ne_sita": "voice_piper_ne_sita",
    "voice_piper_ne_maya": "voice_piper_ne_maya",
    "voice_coqui_ne": "voice_coqui_ne",
    "voice_coqui_ne_anju": "voice_coqui_ne_anju",
    "voice_coqui_ne_kiran": "voice_coqui_ne_kiran",
    "voice_fastpitch_ne": "voice_fastpitch_ne",
    "voice_fastpitch_ne_nabin": "voice_fastpitch_ne_nabin",
    "voice_fastpitch_ne_bikram": "voice_fastpitch_ne_bikram",
    "voice_indic_parler_ne_amrita": "voice_indic_parler_ne_amrita",
}

NATURAL_RECEPTIONIST_STYLE = """

Natural phone behavior:
- You are Sarita, a friendly Nepali insurance front-desk receptionist.
- Speak Nepali in Devanagari unless the caller clearly asks for English.
- Use natural Nepali phrasing with familiar insurance terms.
- Keep replies short enough for phone audio: one sentence by default, and never more than two short sentences.
- Never repeat the same word or phrase more than twice. If you are unsure, ask one short clarification question instead of filling space.
- For policy status, do not claim you checked the system unless a tool result says so. Without a lookup result, say the policy number is noted and staff will verify it; never say active, inactive, expired, pending, or approved.
- If you need to share several details, say the first useful detail and ask whether the caller wants more.
- Use a normal call-center pace: warm, clear, and slightly brisk.
- Ask one question at a time. Never ask for details the caller already gave.
- Silently track: caller name, phone number, reason, insurance type, policy number, claim number, and next action.
- Ask the next most useful missing detail instead of restarting the conversation.
- Use हस् or हजुर for acknowledgement. Do not say ठीक छ.
- When repeating phone numbers, policy numbers, claim numbers, account numbers, or reference numbers, say digits one by one or in short groups. Never read them as a full amount value.
- Format those numbers with spaces between digits or groups, for example ९८० १२३ ४५६७, not 9801234567.
- If recognition is unclear, ask a short clarification instead of guessing.
- Use customer lookup when the caller gives a phone number, policy number, or name and asks about their policy, claim, renewal, payment, or status.
- Use scheduling, transfer, or escalation tools when the caller asks for a callback, specialist, calendar booking, complaint, supervisor, or urgent follow-up.
- After a tool returns, explain only the useful result in one short sentence and ask the next needed question.
- Do not approve claims, quote premiums, confirm policy status, or give legal advice.
""".strip()


@dataclass
class ReceptionistData:
    call_id: str
    agent_id: str
    client: LipiVoiceClient


class LipiMlSTT(stt.STT):
    def __init__(self, *, base_url: str, language: str) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(
                streaming=False,
                interim_results=False,
                offline_recognize=True,
            ),
        )
        self._base_url = base_url.rstrip("/")
        self._language = language

    @property
    def model(self) -> str:
        return "lipi-ml-stt"

    @property
    def provider(self) -> str:
        return "lipi_ml"

    async def _recognize_impl(self, buffer, *, language=NOT_GIVEN, conn_options=None):
        audio_frame = buffer if isinstance(buffer, rtc.AudioFrame) else rtc.combine_audio_frames(buffer)
        form = aiohttp.FormData()
        form.add_field(
            "audio",
            audio_frame.to_wav_bytes(),
            filename="audio.wav",
            content_type="audio/wav",
        )
        language_hint = self._language if language is NOT_GIVEN else str(language)
        if language_hint:
            form.add_field("language_hint", language_hint)

        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self._base_url}/stt", data=form) as response:
                if response.status >= 400:
                    body = await response.text()
                    raise RuntimeError(f"lipi-ml STT failed with status {response.status}: {body[:200]}")
                body = await response.json()

        transcript = body.get("text") or body.get("selected_transcript") or ""
        selected_language = body.get("selected_language") or body.get("language") or language_hint or "ne"
        confidence = body.get("confidence")

        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            request_id=str(uuid.uuid4()),
            alternatives=[
                stt.SpeechData(
                    language=selected_language,
                    text=transcript,
                    confidence=confidence if isinstance(confidence, (int, float)) else 0.0,
                )
            ],
        )


class LipiMlTTS(tts.TTS):
    def __init__(self, *, base_url: str, voice_name: str, sample_rate: int = 24000) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._base_url = base_url.rstrip("/")
        self._voice_name = voice_name

    @property
    def model(self) -> str:
        return "lipi-ml-tts"

    @property
    def provider(self) -> str:
        return "lipi_ml"

    @property
    def language(self) -> str:
        return "ne" if "_ne" in self._voice_name or "ne-NP" in self._voice_name else "en"

    def synthesize(self, text: str, *, conn_options=DEFAULT_API_CONNECT_OPTIONS):
        return LipiMlChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class LipiMlChunkedStream(tts.ChunkedStream):
    async def _run(self, output_emitter) -> None:
        lipi_tts = self._tts
        assert isinstance(lipi_tts, LipiMlTTS)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{lipi_tts._base_url}/tts",
                json={"text": self.input_text, "language": lipi_tts.language},
            ) as response:
                if response.status >= 400:
                    body = await response.text()
                    raise RuntimeError(f"lipi-ml TTS failed with status {response.status}: {body[:200]}")
                audio = await response.read()

        output_emitter.initialize(
            request_id=str(uuid.uuid4()),
            sample_rate=lipi_tts.sample_rate,
            num_channels=lipi_tts.num_channels,
            mime_type="audio/wav",
        )
        output_emitter.push(audio)


class GreetingReceptionistAgent(Agent):
    def __init__(self, *, instructions: str, greeting: str) -> None:
        super().__init__(instructions=instructions)
        self.greeting = greeting

    async def on_enter(self) -> None:
        await self.session.say(self.greeting, allow_interruptions=False)

    def llm_node(self, chat_ctx, tools, model_settings):
        last_user_text = ""
        messages = chat_ctx.messages()
        for message in reversed(messages):
            if message.role == "user":
                last_user_text = message.text_content or ""
                break

        previous_unsupported_turns = count_unsupported_user_turns(messages[:-1])
        response = unsupported_language_response(
            last_user_text,
            previous_unsupported_turns=previous_unsupported_turns,
        )
        if response:
            return response

        apply_repeated_unsupported_policy(chat_ctx)

        return super().llm_node(chat_ctx, tools, model_settings)


class InsuranceReceptionistAgent(GreetingReceptionistAgent):
    @function_tool
    async def collect_callback(self, name: str, phone_number: str, reason: str) -> str:
        """Collect callback details for a licensed insurance staff follow-up.

        Args:
            name: Caller name.
            phone_number: Caller callback phone number.
            reason: Short reason for the callback.
        """
        return f"Callback collected for {name} at {phone_number}: {reason}"

    async def _call_tool(self, tool_name: str, payload: dict[str, str]) -> str:
        data = self.session.userdata
        result = await data.client.call_business_tool(data.call_id, tool_name, payload)
        return str(result.get("result", result))

    @function_tool
    async def lookup_customer(self, phone_number: str = "", policy_number: str = "", name: str = "") -> str:
        """Look up a demo insurance customer by phone, policy number, or caller name.

        Args:
            phone_number: Caller phone number, if available.
            policy_number: Insurance policy number, if available.
            name: Caller name, if available.
        """
        return await self._call_tool(
            "customer-lookup",
            {
                "phoneNumber": phone_number,
                "policyNumber": policy_number,
                "name": name,
            },
        )

    @function_tool
    async def schedule_callback(self, caller_name: str, phone_number: str, preferred_time: str, reason: str = "") -> str:
        """Schedule a demo callback or calendar follow-up.

        Args:
            caller_name: Caller name.
            phone_number: Caller phone number.
            preferred_time: Caller preferred callback time.
            reason: Short reason for the callback.
        """
        return await self._call_tool(
            "schedule-callback",
            {
                "callerName": caller_name,
                "phoneNumber": phone_number,
                "preferredTime": preferred_time,
                "reason": reason,
            },
        )

    @function_tool
    async def transfer_call(self, department: str, reason: str = "", caller_name: str = "", phone_number: str = "") -> str:
        """Queue a demo call transfer to a specialist department.

        Args:
            department: Department or team the caller needs.
            reason: Why the call should be transferred.
            caller_name: Caller name, if available.
            phone_number: Caller phone number, if available.
        """
        return await self._call_tool(
            "transfer-call",
            {
                "department": department,
                "reason": reason,
                "callerName": caller_name,
                "phoneNumber": phone_number,
            },
        )

    @function_tool
    async def create_escalation(self, reason: str, urgency: str = "normal", caller_name: str = "", phone_number: str = "") -> str:
        """Open a demo escalation for supervisor or urgent insurance follow-up.

        Args:
            reason: Why the escalation is needed.
            urgency: Escalation urgency such as normal, high, or urgent.
            caller_name: Caller name, if available.
            phone_number: Caller phone number, if available.
        """
        return await self._call_tool(
            "create-escalation",
            {
                "reason": reason,
                "urgency": urgency,
                "callerName": caller_name,
                "phoneNumber": phone_number,
            },
        )


class NoToolReceptionistAgent(GreetingReceptionistAgent):
    pass


def llm_backend() -> str:
    return env("LIPIVOICE_LLM_BACKEND", "vllm").lower()


def llm_supports_function_tools() -> bool:
    return llm_backend() not in {"vllm", "openai_compatible", "openai-compatible"}


def compose_agent_instructions(system_prompt: str, *, include_tools: bool = True) -> str:
    raw_prompt = system_prompt.strip()
    prompt = sanitized_unsupported_language_prompt(raw_prompt)
    style = NATURAL_RECEPTIONIST_STYLE
    if not include_tools:
        style = "\n".join(
            line
            for line in NATURAL_RECEPTIONIST_STYLE.splitlines()
            if "Use customer lookup" not in line
            and "Use scheduling, transfer, or escalation tools" not in line
            and "After a tool returns" not in line
        )

    if style in raw_prompt or style in prompt:
        return prompt

    return f"{prompt}\n\n{style}" if prompt else style


def sanitized_unsupported_language_prompt(system_prompt: str) -> str:
    prompt = system_prompt
    for sentence in UNSUPPORTED_LANGUAGE_PROMPT_SENTENCES:
        prompt = prompt.replace(sentence, "")
    cleaned = " ".join(prompt.split())
    if "Do not infer an insurance product from Newari" not in cleaned:
        cleaned = (
            f"{cleaned} Do not infer an insurance product from Newari, unclear mixed speech, or speech recognition noise; "
            "move to callback intake after repeated unclear attempts."
        ).strip()
    return cleaned


def unsupported_language_response(text: str, previous_unsupported_turns: int = 0) -> str | None:
    if not is_unsupported_speech(text) or previous_unsupported_turns > 0:
        return None

    return UNSUPPORTED_LANGUAGE_CLARIFICATION


def apply_repeated_unsupported_policy(chat_ctx: llm.ChatContext) -> bool:
    messages = chat_ctx.messages()
    last_user_text = ""
    for message in reversed(messages):
        if message.role == "user":
            last_user_text = message.text_content or ""
            break

    if not is_unsupported_speech(last_user_text):
        return False

    if count_unsupported_user_turns(messages[:-1]) == 0:
        return False

    chat_ctx.add_message(role="developer", content=UNSUPPORTED_LANGUAGE_INTAKE_INSTRUCTION)
    return True


def count_unsupported_user_turns(messages: list[llm.ChatMessage]) -> int:
    count = 0
    for message in messages:
        if message.role == "user" and is_unsupported_speech(message.text_content or ""):
            count += 1
    return count


def is_unsupported_speech(text: str) -> bool:
    normalized = normalize_speech(text)
    if not normalized:
        return False

    for fragment in UNSUPPORTED_SPEECH_FRAGMENTS:
        if normalize_speech(fragment) in normalized:
            return True

    return False


def normalize_speech(text: str) -> str:
    return " ".join(text.strip().replace("।", " ").replace(".", " ").replace(",", " ").split())


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_float(name: str, default: float) -> float:
    value = env(name)
    if not value:
        return default

    try:
        return float(value)
    except ValueError:
        logger.warning("invalid float env value; using default", extra={"env": name, "value": value, "default": default})
    return default


def env_int(name: str, default: int) -> int:
    value = env(name)
    if not value:
        return default

    try:
        return int(value)
    except ValueError:
        logger.warning("invalid int env value; using default", extra={"env": name, "value": value, "default": default})
        return default


def env_bool(name: str, default: bool) -> bool:
    value = env(name).lower()
    if not value:
        return default

    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False

    logger.warning("invalid boolean env value; using default", extra={"env": name, "value": value, "default": default})
    return default


def normalize_lipi_ml_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized[:-3].rstrip("/")
    return normalized


def build_llm():
    backend = llm_backend()
    if backend in {"vllm", "openai", "openai_compatible", "openai-compatible"}:
        return build_openai_llm()

    raise RuntimeError(f"unsupported self-hosted LLM backend: {backend}")


def build_openai_llm():
    base_url = env("VLLM_BASE_URL")
    if not base_url:
        raise RuntimeError("VLLM_BASE_URL is required for the self-hosted worker")

    kwargs = {
        "model": env("VLLM_MODEL", "gemma-4"),
        "base_url": base_url.rstrip("/"),
    }

    api_key = env("VLLM_API_KEY", "dummy")
    kwargs["api_key"] = api_key
    kwargs["temperature"] = env_float("LIPIVOICE_TEMPERATURE", 0.2)

    return openai.LLM(**kwargs)


def resolve_self_hosted_tts_voice(session_config: dict[str, Any]) -> str:
    voice = session_config.get("voice")
    if not isinstance(voice, dict):
        return env("SELF_HOSTED_TTS_VOICE", "voice_lipi_ml_ne")

    voice_id = voice.get("id")
    if isinstance(voice_id, str):
        mapped_voice = SELF_HOSTED_TTS_VOICE_MAP.get(voice_id)
        if mapped_voice:
            return mapped_voice

    return env("SELF_HOSTED_TTS_VOICE", "voice_lipi_ml_ne")


def build_stt():
    adapter = env("SELF_HOSTED_STT_ADAPTER", "lipi_ml").lower()
    base_url = env("SELF_HOSTED_STT_BASE_URL") or env("LIPI_ML_BASE_URL") or env("FASTER_WHISPER_BASE_URL")
    if not base_url:
        raise RuntimeError("SELF_HOSTED_STT_BASE_URL or LIPI_ML_BASE_URL is required for the self-hosted worker")

    if adapter in {"openai", "openai_compatible", "openai-compatible"}:
        return openai.STT(
            base_url=base_url.rstrip("/"),
            api_key=env("SELF_HOSTED_STT_API_KEY", "dummy"),
            model=env("SELF_HOSTED_STT_MODEL", "whisper-large-v3"),
            language=env("SELF_HOSTED_STT_LANGUAGE", "ne"),
            detect_language=env_bool("SELF_HOSTED_STT_DETECT_LANGUAGE", False),
        )

    if adapter != "lipi_ml":
        raise RuntimeError(f"unsupported self-hosted STT adapter: {adapter}")

    return LipiMlSTT(
        base_url=normalize_lipi_ml_base_url(base_url),
        language=env("SELF_HOSTED_STT_LANGUAGE", "ne"),
    )


def build_tts(voice_name: str | None = None):
    adapter = env("SELF_HOSTED_TTS_ADAPTER", "lipi_ml").lower()
    base_url = env("SELF_HOSTED_TTS_BASE_URL") or env("LIPI_ML_BASE_URL") or env("PIPER_OPENAI_BASE_URL")
    if not base_url:
        raise RuntimeError("SELF_HOSTED_TTS_BASE_URL or LIPI_ML_BASE_URL is required for the self-hosted worker")

    selected_voice = voice_name or env("SELF_HOSTED_TTS_VOICE", "voice_lipi_ml_ne")

    if adapter in {"openai", "openai_compatible", "openai-compatible"}:
        return openai.TTS(
            base_url=base_url.rstrip("/"),
            api_key=env("SELF_HOSTED_TTS_API_KEY", "dummy"),
            model=env("SELF_HOSTED_TTS_MODEL", "piper-nepali"),
            voice=selected_voice,
            speed=env_float("SELF_HOSTED_TTS_SPEED", 1.08),
            instructions=env(
                "SELF_HOSTED_TTS_PROMPT",
                "Speak in a clear, natural Nepali call-center tone. Use a slightly brisk normal phone pace, not a slow robotic pace.",
            ),
            response_format=env("SELF_HOSTED_TTS_RESPONSE_FORMAT", "wav"),
        )

    if adapter != "lipi_ml":
        raise RuntimeError(f"unsupported self-hosted TTS adapter: {adapter}")

    if selected_voice.startswith("voice_indic_parler"):
        base_url = env("INDIC_PARLER_ENDPOINT", base_url)

    return LipiMlTTS(
        base_url=normalize_lipi_ml_base_url(base_url),
        voice_name=selected_voice,
        sample_rate=env_int("SELF_HOSTED_TTS_SAMPLE_RATE", 24000),
    )


@server.rtc_session(agent_name=env("LIVEKIT_AGENT_NAME", "lipivoice-receptionist"))
async def entrypoint(ctx: JobContext):
    metadata = parse_dispatch_metadata(ctx.job.metadata)
    client = LipiVoiceClient(
        base_url=env("LIPIVOICE_API_BASE_URL", "http://127.0.0.1:8787"),
        worker_api_key=env("LIPIVOICE_WORKER_API_KEY"),
    )

    config = await client.get_session_config(metadata["call_id"])
    agent_config = config["agent"]
    tts_voice_name = resolve_self_hosted_tts_voice(config)

    await client.post_events(metadata["call_id"], [
        {
            "type": "runtime",
            "actor": "system",
            "payload": {
                "stage": "worker_started",
                "agentId": metadata["agent_id"],
                "room": ctx.room.name,
            },
        }
    ])

    await ctx.connect()

    session = AgentSession[ReceptionistData](
        userdata=ReceptionistData(
            call_id=metadata["call_id"],
            agent_id=metadata["agent_id"],
            client=client,
        ),
        vad=silero.VAD.load(),
        stt=build_stt(),
        llm=build_llm(),
        tts=build_tts(tts_voice_name),
        min_endpointing_delay=env_float("LIPIVOICE_MIN_ENDPOINTING_DELAY", 0.2),
        max_endpointing_delay=env_float("LIPIVOICE_MAX_ENDPOINTING_DELAY", 0.8),
        allow_interruptions=env_bool("LIPIVOICE_ALLOW_INTERRUPTION", False),
        resume_false_interruption=env_bool("LIPIVOICE_RESUME_FALSE_INTERRUPTION", True),
    )

    @session.on("user_input_transcribed")
    def on_user_transcript(event):
        if event.is_final:
            asyncio.create_task(client.post_events(metadata["call_id"], [
                {
                    "type": "transcript",
                    "actor": "user",
                    "payload": {"text": event.transcript},
                }
            ]))

    @session.on("conversation_item_added")
    def on_conversation_item(event):
        item = event.item
        if getattr(item, "type", "") == "message" and getattr(item, "role", "") == "assistant":
            text = getattr(item, "text_content", "")
            if text:
                asyncio.create_task(client.post_events(metadata["call_id"], [
                    {
                        "type": "transcript",
                        "actor": "assistant",
                        "payload": {"text": text},
                    }
                ]))

    @session.on("agent_state_changed")
    def on_agent_state(event):
        asyncio.create_task(client.post_events(metadata["call_id"], [
            {
                "type": "status",
                "actor": "system",
                "payload": {"status": event.new_state},
            }
        ]))

    agent_class = InsuranceReceptionistAgent if llm_supports_function_tools() else NoToolReceptionistAgent

    await session.start(
        agent=agent_class(
            instructions=compose_agent_instructions(agent_config["systemPrompt"], include_tools=llm_supports_function_tools()),
            greeting=agent_config["greeting"],
        ),
        room=ctx.room,
    )


if __name__ == "__main__":
    cli.run_app(server)
