/* global process, fetch, performance, console */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createApp } from "../../src/server/app.ts";
import { loadServerConfig } from "../../src/server/config.ts";

const TARGET = (process.env.BENCHMARK_TARGET || "remote_api").trim();
const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS || "10");
const AGENT_ID = process.env.BENCHMARK_AGENT_ID || "agent_reception";
const OUTPUT_PATH = process.env.BENCHMARK_OUTPUT || "/tmp/stack-benchmark.json";
const API_BASE = process.env.BENCHMARK_API_BASE || "https://ai.silverlining.com.np/voice";
const API_TOKEN = process.env.BENCHMARK_API_TOKEN || "";

const REMOTE_TTS = (process.env.BENCHMARK_TTS.split(",").map((value) => value.trim()).filter(Boolean) || ["google"]).filter(Boolean);

const INPUTS = [
  "नमस्ते, म कुन सेवाका बारेमा जानकारी चाहिन्छ?",
  "मेरा दाबीको स्थिति चेक गरिदिनुहोस्।",
  "मलाई छुट्याउने दिन कति दिन लाग्छ?",
  "मसँग policy number 98 01 23 45 67 89 छ।",
  "धन्यवाद, अहिलेका लागि त्यतिमै।",
  "कार्यालयको समय के कति हो?",
  "कृपया callback schedule गरिदिनु होला।",
];

const DEFAULT_TTS = "google";
const DEFAULT_VOICE = "voice_google_tts_ne";

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * (sorted.length - 1))),
  );

  return sorted[index];
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runLocalBenchmark(label, envOverrides) {
  const config = loadServerConfig({
    ...process.env,
    PORT: "0",
    LIPIVOICE_ADMIN_TOKEN: "",
    LIPIVOICE_ADMIN_USERNAME: "",
    LIPIVOICE_ADMIN_PASSWORD: "",
    ...envOverrides,
  });

  const { app, close } = createApp(config);
  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(0, () => {
      resolve();
    });
    server.once("error", reject);
  });

  const port = server.address()?.port;
  if (!port) {
    throw new Error(`could not bind benchmark server for ${label}`);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const createResponse = await fetch(`${baseUrl}/api/calls/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: AGENT_ID }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`simulate-call failed for ${label}: ${createResponse.status} ${body}`);
  }

  const createPayload = await createResponse.json();
  const callId = createPayload?.call?.id;
  if (!callId) {
    throw new Error(`call id missing for ${label}`);
  }

  const totalLatencies = [];
  const engineLatencies = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    const text = INPUTS[i % INPUTS.length];
    const started = performance.now();
    const turnResponse = await fetch(`${baseUrl}/api/calls/${callId}/simulate-turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        language: "ne",
        ttsProvider: DEFAULT_TTS,
        voiceId: DEFAULT_VOICE,
      }),
    });

    if (!turnResponse.ok) {
      const body = await turnResponse.text();
      throw new Error(`simulate-turn failed for ${label}: ${turnResponse.status} ${body}`);
    }

    const payload = await turnResponse.json();
    totalLatencies.push(performance.now() - started);
    if (typeof payload.latencyMs === "number") {
      engineLatencies.push(payload.latencyMs);
    }
  }

  await new Promise((resolve) => server.close(resolve));
  close();

  return {
    label,
    preset: config.runtimePreset,
    model: config.runtimePreset === "local" ? config.ollamaModel : config.vllmModel,
    iterations: ITERATIONS,
    totalLatencyMs: {
      min: Math.min(...totalLatencies),
      max: Math.max(...totalLatencies),
      p50: percentile(totalLatencies, 50),
      p95: percentile(totalLatencies, 95),
      mean: average(totalLatencies),
    },
    engineLatencyMs: {
      min: Math.min(...engineLatencies),
      max: Math.max(...engineLatencies),
      p50: percentile(engineLatencies, 50),
      p95: percentile(engineLatencies, 95),
      mean: average(engineLatencies),
    },
  };
}

async function runRemoteBenchmark(label) {
  if (!API_TOKEN) {
    throw new Error("BENCHMARK_API_TOKEN is required for remote_api target");
  }

  const baseHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${API_TOKEN}`,
  };

  const postHeaders = {
    method: "POST",
    headers: baseHeaders,
  };

  const callResponse = await fetch(`${API_BASE}/api/calls/simulate`, {
    ...postHeaders,
    body: JSON.stringify({ agentId: AGENT_ID }),
  });

  if (!callResponse.ok) {
    const body = await callResponse.text();
    throw new Error(`simulate-call failed for ${label}: ${callResponse.status} ${body}`);
  }

  const createPayload = await callResponse.json();
  const callId = createPayload?.call?.id;
  if (!callId) {
    throw new Error(`call id missing for ${label}`);
  }

  const resultsByVoice = [];

  for (const tts of REMOTE_TTS) {
    const turnText = [];
    const engine = [];

    for (let i = 0; i < ITERATIONS; i += 1) {
      const prompt = INPUTS[i % INPUTS.length];
      const started = performance.now();

      const response = await fetch(`${API_BASE}/api/calls/${callId}/simulate-turn`, {
        ...postHeaders,
        body: JSON.stringify({
          text: prompt,
          language: "ne",
          ttsProvider: tts === "google" ? "google" : tts,
          voiceId: tts === "google" ? "voice_google_tts_ne" : "voice_lipi_ml_ne",
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`simulate-turn failed for ${label}/${tts}: ${response.status} ${body}`);
      }

      const payload = await response.json();
      turnText.push(performance.now() - started);
      if (typeof payload.latencyMs === "number") {
        engine.push(payload.latencyMs);
      }
    }

    resultsByVoice.push({
      tts,
      turns: {
        min: Math.min(...turnText),
        max: Math.max(...turnText),
        mean: average(turnText),
        p50: percentile(turnText, 50),
        p95: percentile(turnText, 95),
      },
      engineLatencyMs: {
        min: Math.min(...engine),
        max: Math.max(...engine),
        mean: average(engine),
        p50: percentile(engine, 50),
        p95: percentile(engine, 95),
      },
    });
  }

  return {
    label,
    target: "remote_api",
    callId,
    base: API_BASE,
    iterations: ITERATIONS,
    ttsProfiles: resultsByVoice,
  };
}

async function run() {
  const targets = TARGET.split(",").map((value) => value.trim()).filter(Boolean);
  const benchmarks = [];

  for (const target of targets) {
    if (target === "local") {
      benchmarks.push(
        await runLocalBenchmark("self_hosted_local_llm", {
          LIPIVOICE_RUNTIME_PRESET: "local",
          OLLAMA_BASE_URL: process.env.BENCHMARK_OLLAMA_BASE_URL || "http://127.0.0.1:11434",
          LIPIVOICE_LLM_MODEL: process.env.BENCHMARK_OLLAMA_MODEL || "llama3.2:3b",
        }),
      );
    } else if (target === "remote") {
      benchmarks.push(
        await runLocalBenchmark("remote_lipisense_like", {
          LIPIVOICE_RUNTIME_PRESET: "remote",
          VLLM_BASE_URL: process.env.BENCHMARK_VLLM_BASE_URL || "http://127.0.0.1:8002/v1",
          VLLM_MODEL: process.env.BENCHMARK_VLLM_MODEL || "gemma-4",
          LIPI_ML_BASE_URL: process.env.BENCHMARK_LIPIML_BASE_URL || "http://127.0.0.1:5001",
          LIPIVOICE_TTS_MODEL_MANIFEST: process.env.BENCHMARK_TTS_MANIFEST || "",
          GOOGLE_TTS_CREDENTIALS_PATH: process.env.BENCHMARK_GOOGLE_TTS_CREDENTIALS_PATH || "",
          GOOGLE_TTS_LANGUAGE_CODE: process.env.BENCHMARK_GOOGLE_TTS_LANGUAGE_CODE || "ne-NP",
          GOOGLE_TTS_MODEL: process.env.BENCHMARK_GOOGLE_TTS_MODEL || "gemini-2.5-flash-tts",
          GOOGLE_TTS_VOICE_NE: process.env.BENCHMARK_GOOGLE_TTS_VOICE || "Kore",
          GOOGLE_TTS_VOICE_NAME: process.env.BENCHMARK_GOOGLE_TTS_VOICE_NAME || "",
        }),
      );
    } else if (target === "google_worker") {
      throw new Error(
        "google_worker is not benchmarked via /api/calls/simulate-turn because that path uses the Node LLM stack, not the LiveKit worker path.",
      );
    } else if (target === "remote_api") {
      benchmarks.push(
        await runRemoteBenchmark("remote_lipivoice_api"),
      );
    } else {
      throw new Error(`Unknown BENCHMARK_TARGET '${target}'. Use local|remote`);
    }
  }

  const report = {
    date: new Date().toISOString(),
    iterations: ITERATIONS,
    presets: targets,
    results: benchmarks,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
