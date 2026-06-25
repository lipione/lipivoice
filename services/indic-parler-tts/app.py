from __future__ import annotations

import io
import os
import threading
from dataclasses import dataclass

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from parler_tts import ParlerTTSForConditionalGeneration
from pydantic import BaseModel, Field
from transformers import AutoTokenizer


MODEL_ID = os.getenv(
    "INDIC_PARLER_MODEL_ID",
    "milanakdj/indic-parler-tts-nepali-finetuned-dgx-v9-cosine",
)
DEFAULT_DESCRIPTION = os.getenv(
    "INDIC_PARLER_DESCRIPTION",
    "Amrita speaks clearly in Nepali at a steady call-center pace. Very clear audio.",
)

app = FastAPI(title="LipiVoice Indic Parler TTS", version="0.1.0")
_lock = threading.Lock()
_runtime: "ParlerRuntime | None" = None
_load_error: str | None = None


class TtsRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str = "ne"
    voice: str = "voice_indic_parler_ne_amrita"
    description: str | None = None


@dataclass
class ParlerRuntime:
    model: ParlerTTSForConditionalGeneration
    prompt_tokenizer: AutoTokenizer
    desc_tokenizer: AutoTokenizer
    device: str
    sampling_rate: int


def load_runtime() -> ParlerRuntime:
    global _runtime, _load_error

    if _runtime is not None:
        return _runtime

    with _lock:
        if _runtime is not None:
            return _runtime

        try:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.bfloat16 if device == "cuda" else torch.float32
            model = ParlerTTSForConditionalGeneration.from_pretrained(
                MODEL_ID,
                torch_dtype=dtype,
            ).to(device)
            prompt_tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            desc_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
            _runtime = ParlerRuntime(
                model=model,
                prompt_tokenizer=prompt_tokenizer,
                desc_tokenizer=desc_tokenizer,
                device=device,
                sampling_rate=int(model.config.sampling_rate),
            )
            _load_error = None
            return _runtime
        except Exception as exc:
            _load_error = str(exc)
            raise


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_id": MODEL_ID,
        "model_loaded": _runtime is not None,
        "cuda_available": torch.cuda.is_available(),
        "load_error": _load_error,
    }


@app.post("/tts")
def tts(request: TtsRequest):
    try:
        runtime = load_runtime()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"model_load_failed: {exc}") from exc

    description = request.description or DEFAULT_DESCRIPTION
    desc_enc = runtime.desc_tokenizer(description, return_tensors="pt").to(runtime.device)
    prompt_enc = runtime.prompt_tokenizer(request.text, return_tensors="pt").to(runtime.device)

    with torch.inference_mode():
        generation = runtime.model.generate(
            input_ids=desc_enc.input_ids,
            attention_mask=desc_enc.attention_mask,
            prompt_input_ids=prompt_enc.input_ids,
            prompt_attention_mask=prompt_enc.attention_mask,
        )

    audio = generation.detach().to(torch.float32).cpu().numpy().squeeze()
    buffer = io.BytesIO()
    sf.write(buffer, audio, runtime.sampling_rate, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")
