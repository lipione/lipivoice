# LipiVoice

LipiVoice is a local, open-source voice agent prototype in the style of Vapi or Voice.ai. It is built to run against local runtimes instead of depending on a hosted SaaS voice stack.

The MVP includes a React operator console, an Express API, SQLite-backed seed data, local runtime health checks, simulated call records, a Web Voice surface, and a Voice Lab text-to-speech surface.

## Local Runtime Setup

Install and run the local engines you want to test with:

- Ollama for LLM responses.
- whisper.cpp for speech-to-text.
- Piper for text-to-speech.

Set these environment variables before starting the API server:

```sh
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export LIPIVOICE_LLM_MODEL=llama3.2:3b
export WHISPER_CPP_BIN=/absolute/path/to/whisper-cli
export WHISPER_MODEL_PATH=/absolute/path/to/ggml-base.en.bin
export PIPER_BIN=/absolute/path/to/piper
export PIPER_VOICE_PATH=/absolute/path/to/en_US-amy-medium.onnx
```

Optional:

```sh
export PORT=8787
export LIPIVOICE_DB_PATH=data/lipivoice.sqlite
```

If Piper is not configured, Voice Lab intentionally reports `runtime_not_configured`. Web Voice checks the configured LLM, STT, and TTS runtimes before accepting audio.

## Remote Runtime Setup

Use the remote preset when running against the shared GPU server services:

```sh
export LIPIVOICE_RUNTIME_PRESET=remote
export VLLM_BASE_URL=http://127.0.0.1:8002/v1
export VLLM_MODEL=gemma-4
export LIPI_ML_BASE_URL=http://127.0.0.1:5001
export LIPIVOICE_TTS_MODEL_MANIFEST=/data/models/lipivoice/tts/manifest.json
export LIPIVOICE_DB_PATH=data/lipivoice.sqlite
```

The remote preset seeds the workspace with:

- vLLM as the OpenAI-compatible LLM runtime.
- `lipi-ml` faster-whisper large-v3 for STT.
- `lipi-ml` Piper voices for English and Nepali TTS.
- A manifest-backed model catalog for downloaded Nepali TTS candidates.

Voice Lab also exposes a Nepali TTS provider benchmark catalog:

- Indic Parler TTS as the Nepali baseline candidate.
- OmniVoice as the experimental multilingual and cloning candidate.
- Chatterbox Nepali as the gated Nepali-specific cloning candidate.
- Coqui VITS / Piper-VITS as the stable custom-training path.

On the remote server, build and run without installing host Node:

```sh
docker compose -f docker-compose.remote.yml up -d --build
```

The container uses host networking so it can reach existing services on `127.0.0.1:8002` and `127.0.0.1:5001`. The app listens on `http://127.0.0.1:8787`.

## Development

Install dependencies:

```sh
npm install
```

Start the API server:

```sh
npm run dev:server
```

Start the frontend dev server in another terminal:

```sh
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`. The Vite dev server proxies `/api` and `/api/realtime` to the API server on port `8787`.

## Verification

Run the test suite, lint, and production build:

```sh
npm run test
npm run lint
npm run build
```
