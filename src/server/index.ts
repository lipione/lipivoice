import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createApp } from "./app";
import { loadServerConfig, type ServerConfig } from "./config";
import { OllamaAdapter } from "./runtimes/ollama";
import { PiperAdapter } from "./runtimes/piper";
import { WhisperCppAdapter } from "./runtimes/whisperCpp";
import { attachVoiceSocket, type VoiceSocketDeps } from "./ws/voiceSocket";

const config = loadServerConfig();
const context = createApp(config);
const server = createServer(context.app);
attachVoiceSocket(server, createVoiceSocketDeps(config));

function closeContext() {
  context.close();
}

function shutdown() {
  server.close(() => {
    closeContext();
    process.exit(0);
  });
}

server.on("close", closeContext);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(config.port, () => {
  console.log(`LipiVoice API listening on http://localhost:${config.port}`);
});

function createVoiceSocketDeps(config: ServerConfig): VoiceSocketDeps {
  const runtimes = {
    llm: new OllamaAdapter({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel }),
    stt: new WhisperCppAdapter({ binPath: config.whisperCppBin, modelPath: config.whisperModelPath }),
    tts: new PiperAdapter({ binPath: config.piperBin, voicePath: config.piperVoicePath }),
  };

  return {
    async checkReady() {
      if (!hasRequiredLocalRuntimePaths(config)) {
        return { ready: false, reason: "runtime_not_configured" };
      }

      return { ready: true };
    },
    async processAudio(_input) {
      void runtimes;
      throw new Error("runtime_not_configured");
    },
  };
}

function hasRequiredLocalRuntimePaths(config: ServerConfig): boolean {
  return (
    isExistingPath(config.whisperCppBin) &&
    isExistingPath(config.whisperModelPath) &&
    isExistingPath(config.piperBin) &&
    isExistingPath(config.piperVoicePath)
  );
}

function isExistingPath(path: string): boolean {
  return path.trim().length > 0 && existsSync(path);
}
