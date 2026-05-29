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

If Whisper or Piper is not configured, voice and TTS surfaces intentionally report `runtime_not_configured`.

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

Open the Vite URL, usually `http://localhost:5173`.

## Verification

Run the test suite, lint, and production build:

```sh
npm run test
npm run lint
npm run build
```
