import { createServer } from "node:http";
import { createApp } from "./app";
import { loadServerConfig } from "./config";
import { createVoiceSocketDeps } from "./voice/socketDeps";
import { attachVoiceSocket } from "./ws/voiceSocket";

const config = loadServerConfig();
const context = createApp(config);
const server = createServer(context.app);
const voiceSocket = attachVoiceSocket(
  server,
  createVoiceSocketDeps({ config, repositories: context.repositories }),
);

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
