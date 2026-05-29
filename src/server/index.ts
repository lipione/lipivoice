import { createServer } from "node:http";
import { createApp } from "./app";
import { loadServerConfig } from "./config";

const config = loadServerConfig();
const context = createApp(config);
const server = createServer(context.app);

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
