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
const voiceSocket = attachVoiceSocket(server, createVoiceSocketDeps(config));

function closeContext() {
  context.close();
}

function shutdown() {
  void shutdownGracefully().then(() => process.exit(0));
}

async function shutdownGracefully() {
  await Promise.all([voiceSocket.close(), closeServer()]);
  closeContext();
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

      // The adapters are configured, but WebSocket audio conversion and turn execution are still Task 8 work.
      return { ready: false, reason: "runtime_not_configured" };
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

function closeServer() {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
