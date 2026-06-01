# LipiVoice

LipiVoice is a local, open-source voice agent prototype in the style of Vapi or Voice.ai. It is built to run against local runtimes instead of depending on a hosted SaaS voice stack.

The MVP includes a React operator console, an Express API, SQLite-backed seed data, local runtime health checks, simulated call records, a Web Voice surface, and a Voice Lab text-to-speech surface. The current remote deployment also includes a Nepali TTS provider catalog for testing open-source and cloud fallback options side by side.

## What Works Now

- Dashboard shell with agents, runtime status, Web Voice, calls, Voice Lab, and usage surfaces.
- Express API with SQLite persistence and seeded local or remote runtime configuration.
- Web Voice session setup over WebSocket with explicit runtime health checks before audio processing.
- Local runtime adapters for Ollama, whisper.cpp, Piper, and energy-based VAD.
- Remote runtime adapters for vLLM, `lipi-ml` faster-whisper STT, and `lipi-ml` Piper TTS.
- Voice Lab speech generation through configured Piper or `lipi-ml` TTS.
- Nepali TTS provider catalog and benchmark API for Google Cloud TTS, Indic Parler TTS, OmniVoice, Chatterbox Nepali, and Coqui/Piper-VITS.
- Optional Google Cloud TTS adapter using server-side service-account credentials. Google STT credentials can be mounted for future work, but there is no Google STT adapter yet.

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

Use the remote preset when running against the shared GPU server services. For a bare host process, the environment looks like:

```sh
export LIPIVOICE_RUNTIME_PRESET=remote
export VLLM_BASE_URL=http://127.0.0.1:8002/v1
export VLLM_MODEL=gemma-4
export LIPI_ML_BASE_URL=http://127.0.0.1:5001
export LIPIVOICE_TTS_MODEL_MANIFEST=/data/models/lipivoice/tts/manifest.json
export GOOGLE_TTS_CREDENTIALS_PATH=/data/secrets/lipivoice/google/lipikosh-a6477dd41434.json
export GOOGLE_STT_CREDENTIALS_PATH=/data/secrets/lipivoice/google/lipikosh-a5a135de8c87.json
export GOOGLE_TTS_LANGUAGE_CODE=ne-NP
export GOOGLE_TTS_VOICE_NAME=
export LIPIVOICE_DB_PATH=data/lipivoice.sqlite
```

The remote preset seeds the workspace with:

- vLLM as the OpenAI-compatible LLM runtime.
- `lipi-ml` faster-whisper large-v3 for STT.
- `lipi-ml` Piper voices for English and Nepali TTS.
- A manifest-backed model catalog for downloaded Nepali TTS candidates.
- Optional Google Cloud credentials mounted as deploy-time secrets for cloud TTS/STT fallback experiments.

The Docker remote deployment uses container paths instead:

- Host model root: `/data/models/lipivoice/tts`
- Container model mount: `/models/tts:ro`
- Host manifest: `/data/models/lipivoice/tts/manifest.json`
- Container manifest: `/models/tts/manifest.json`
- Host Google secret root: `/data/secrets/lipivoice/google`
- Container Google secret mount: `/run/secrets/lipivoice/google:ro`

Set up Google service-account files on the remote server without committing them:

```sh
install -d -m 700 /data/secrets/lipivoice/google
cp /path/to/lipikosh-a6477dd41434.json /data/secrets/lipivoice/google/
cp /path/to/lipikosh-a5a135de8c87.json /data/secrets/lipivoice/google/
chmod 600 /data/secrets/lipivoice/google/*.json
```

The JSON files must stay out of Git. The compose file mounts that directory read-only and sets:

- `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/lipivoice/google/lipikosh-a6477dd41434.json`
- `GOOGLE_TTS_CREDENTIALS_PATH=/run/secrets/lipivoice/google/lipikosh-a6477dd41434.json`
- `GOOGLE_STT_CREDENTIALS_PATH=/run/secrets/lipivoice/google/lipikosh-a5a135de8c87.json`

Voice Lab exposes this Nepali TTS provider benchmark catalog:

| Provider | Role | Current remote state |
| --- | --- | --- |
| Google Cloud TTS | Cloud fallback for Nepali TTS experiments | Credentials are mounted and readable, but `ne-NP` currently reports `missing_model` / `voice_not_available`, so benchmark does not generate audio yet. Try an explicit `GOOGLE_TTS_VOICE_NAME` only after confirming Google lists a supported Nepali voice. |
| Indic Parler TTS | Best proven Nepali baseline candidate | Catalog entry is gated by Hugging Face access or token acceptance and reports `license_required` until that is resolved. |
| OmniVoice | Experimental multilingual and cloning candidate | Model files are downloaded and catalog health is `healthy`, but benchmark returns `provider_adapter_not_connected` until an inference runner is wired. |
| Chatterbox Nepali | Nepali-specific cloning candidate | Hugging Face gated model access is still required, so it reports `license_required`. |
| Coqui VITS / Piper-VITS | Stable custom Nepali voice path | Healthy through the current `lipi-ml` / Piper path; benchmark generates WAV audio. |

On the remote server, build and run without installing host Node:

```sh
docker compose -f docker-compose.remote.yml up -d --build
```

The container uses host networking so it can reach existing services on `127.0.0.1:8002` and `127.0.0.1:5001`. The app listens on `http://127.0.0.1:8787`.

Useful remote checks:

```sh
curl -s http://127.0.0.1:8787/api/health
curl -s http://127.0.0.1:8787/api/model-runtimes
curl -s http://127.0.0.1:8787/api/tts/providers
curl -s -X POST http://127.0.0.1:8787/api/tts/benchmark \
  -H 'content-type: application/json' \
  -d '{"providerId":"coqui_piper_vits","text":"नमस्ते, लिपिभ्वाइस परीक्षण हो।"}'
```

Expected provider behavior on the current remote server:

- `coqui_piper_vits` can generate audio through `lipi-ml` / Piper.
- `google_cloud_tts` is configured but unavailable for the configured `ne-NP` voice.
- `omnivoice` is downloaded but does not synthesize until its adapter is implemented.
- `indic_parler_tts` and `chatterbox_nepali` require gated model access or accepted license terms.

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
