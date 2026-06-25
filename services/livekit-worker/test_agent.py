import pytest

import agent
from livekit.agents import llm
from agent import (
    NATURAL_RECEPTIONIST_STYLE,
    SELF_HOSTED_TTS_VOICE_MAP,
    InsuranceReceptionistAgent,
    LipiMlSTT,
    LipiMlTTS,
    build_stt,
    build_tts,
    compose_agent_instructions,
    env_bool,
    llm_supports_function_tools,
    resolve_self_hosted_tts_voice,
    unsupported_language_response,
    apply_repeated_unsupported_policy,
)


def test_compose_agent_instructions_adds_natural_phone_style():
    instructions = compose_agent_instructions("Base insurance rules.")

    assert "Base insurance rules." in instructions
    assert "friendly Nepali insurance front-desk receptionist" in instructions
    assert "Speak Nepali in Devanagari" in instructions
    assert "Ask the next most useful missing detail" in instructions
    assert "Use हस् or हजुर for acknowledgement" in instructions
    assert "Do not say ठीक छ" in instructions
    assert "Never read them as a full amount value" in instructions
    assert "Use customer lookup" in instructions
    assert "Use scheduling, transfer, or escalation tools" in instructions
    assert "Do not approve claims" in instructions
    assert "never more than two short sentences" in instructions


def test_compose_agent_instructions_does_not_duplicate_style():
    instructions = compose_agent_instructions(f"Base rules.\n\n{NATURAL_RECEPTIONIST_STYLE}")

    assert instructions.count("Natural phone behavior:") == 1


def test_compose_agent_instructions_removes_conflicting_unsupported_language_rule():
    instructions = compose_agent_instructions(
        "Only handle Nepali, English, or natural Nepali-English mixed speech. "
        "If the caller uses Newari, Hindi, or another unsupported language, say in Nepali: "
        "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ? "
        "Do not infer an insurance product from Newari, unclear mixed speech, or speech recognition noise. "
        "Ask the caller to repeat in Nepali or English instead of guessing."
    )

    assert "Only handle Nepali, English" in instructions
    assert "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु" not in instructions
    assert "move to callback intake after repeated unclear attempts" in instructions


def test_compose_agent_instructions_can_omit_tool_guidance_for_vllm():
    instructions = compose_agent_instructions("Base rules.", include_tools=False)

    assert "Base rules." in instructions
    assert "Use customer lookup" not in instructions
    assert "Use scheduling, transfer, or escalation tools" not in instructions
    assert "After a tool returns" not in instructions
    assert "Ask the next most useful missing detail" in instructions


def test_unsupported_language_response_detects_newari_like_insurance_noise():
    assert unsupported_language_response("पति पार्स तो इंचरेंस गरिक्प।") == (
        "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?"
    )


def test_unsupported_language_response_leaves_repeated_noise_for_controlled_llm_intake():
    assert unsupported_language_response("ति पार्सा, गौन रुपो।", previous_unsupported_turns=1) is None


def test_receptionist_llm_node_skips_llm_for_unsupported_language():
    receptionist = InsuranceReceptionistAgent(instructions="Base rules.", greeting="नमस्ते")
    chat_ctx = llm.ChatContext()
    chat_ctx.add_message(role="user", content="पति पार्स तो इंचरेंस गरिक्प।")

    assert receptionist.llm_node(chat_ctx, [], None) == (
        "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?"
    )


def test_repeated_unsupported_policy_adds_controlled_llm_intake_instruction():
    chat_ctx = llm.ChatContext()
    chat_ctx.add_message(role="user", content="पति पार्स तो इंचरेंस गरिक्प।")
    chat_ctx.add_message(role="assistant", content="माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?")
    chat_ctx.add_message(role="user", content="ति पार्सा, गौन रुपो।")

    assert apply_repeated_unsupported_policy(chat_ctx) is True
    assert chat_ctx.messages()[-1].role == "developer"
    assert "The caller is still unclear after one clarification" in (chat_ctx.messages()[-1].text_content or "")
    assert "Do not say the earlier Nepali-or-English clarification again" in (chat_ctx.messages()[-1].text_content or "")


def test_llm_supports_function_tools_disables_tools_for_vllm(monkeypatch):
    monkeypatch.setenv("LIPIVOICE_LLM_BACKEND", "vllm")

    assert llm_supports_function_tools() is False


def test_llm_supports_function_tools_disables_tools_for_openai_compatible(monkeypatch):
    monkeypatch.setenv("LIPIVOICE_LLM_BACKEND", "openai_compatible")

    assert llm_supports_function_tools() is False


def test_build_stt_defaults_to_lipi_ml_native(monkeypatch):
    monkeypatch.setenv("SELF_HOSTED_STT_BASE_URL", "http://lipi-ml:5001/v1")
    monkeypatch.delenv("SELF_HOSTED_STT_ADAPTER", raising=False)

    built = build_stt()

    assert isinstance(built, LipiMlSTT)
    assert built._base_url == "http://lipi-ml:5001"
    assert built._language == "ne"


def test_build_tts_defaults_to_lipi_ml_native(monkeypatch):
    monkeypatch.setenv("SELF_HOSTED_TTS_BASE_URL", "http://lipi-ml:5001/v1")
    monkeypatch.delenv("SELF_HOSTED_TTS_ADAPTER", raising=False)

    built = build_tts()

    assert isinstance(built, LipiMlTTS)
    assert built._base_url == "http://lipi-ml:5001"
    assert built._voice_name == "voice_lipi_ml_ne"


def test_build_tts_routes_indic_parler_voice_to_indic_endpoint(monkeypatch):
    monkeypatch.setenv("SELF_HOSTED_TTS_BASE_URL", "http://lipi-ml:5001")
    monkeypatch.setenv("INDIC_PARLER_ENDPOINT", "http://lipi-tts-parler:5010")
    monkeypatch.delenv("SELF_HOSTED_TTS_ADAPTER", raising=False)

    built = build_tts("voice_indic_parler_ne_amrita")

    assert isinstance(built, LipiMlTTS)
    assert built._base_url == "http://lipi-tts-parler:5010"
    assert built._voice_name == "voice_indic_parler_ne_amrita"


def test_build_tts_supports_explicit_openai_compatible_delivery(monkeypatch):
    captured = {}

    class FakeTTS:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(agent.openai, "TTS", FakeTTS)
    monkeypatch.setenv("SELF_HOSTED_TTS_ADAPTER", "openai_compatible")
    monkeypatch.setenv("SELF_HOSTED_TTS_BASE_URL", "http://tts.local/v1")
    monkeypatch.delenv("SELF_HOSTED_TTS_SPEED", raising=False)
    monkeypatch.delenv("SELF_HOSTED_TTS_PROMPT", raising=False)

    build_tts()

    assert captured["base_url"] == "http://tts.local/v1"
    assert captured["model"] == "piper-nepali"
    assert captured["voice"] == "voice_lipi_ml_ne"
    assert captured["speed"] == 1.08
    assert "call-center tone" in captured["instructions"]
    assert captured["response_format"] == "wav"


def test_resolve_self_hosted_tts_voice_uses_voice_id_map(monkeypatch):
    first_voice = next(iter(SELF_HOSTED_TTS_VOICE_MAP))
    fake_config = {"voice": {"id": first_voice}}

    assert resolve_self_hosted_tts_voice(fake_config) == SELF_HOSTED_TTS_VOICE_MAP[first_voice]


def test_resolve_self_hosted_tts_voice_defaults_to_env(monkeypatch):
    monkeypatch.setenv("SELF_HOSTED_TTS_VOICE", "fallback_voice")

    assert resolve_self_hosted_tts_voice({}) == "fallback_voice"


def test_env_bool_defaults_interruption_control_off(monkeypatch):
    monkeypatch.delenv("LIPIVOICE_ALLOW_INTERRUPTION", raising=False)

    assert env_bool("LIPIVOICE_ALLOW_INTERRUPTION", False) is False


def test_env_bool_accepts_enabled_interruption_control(monkeypatch):
    monkeypatch.setenv("LIPIVOICE_ALLOW_INTERRUPTION", "true")

    assert env_bool("LIPIVOICE_ALLOW_INTERRUPTION", False) is True


@pytest.mark.asyncio
async def test_agent_greeting_is_not_interruptible(monkeypatch):
    calls = []

    class FakeSession:
        async def say(self, text, *, allow_interruptions):
            calls.append({"text": text, "allow_interruptions": allow_interruptions})

    fake_session = FakeSession()
    receptionist = InsuranceReceptionistAgent(instructions="Base rules.", greeting="नमस्ते")
    monkeypatch.setattr(InsuranceReceptionistAgent, "session", property(lambda _self: fake_session))

    await receptionist.on_enter()

    assert calls == [{"text": "नमस्ते", "allow_interruptions": False}]
