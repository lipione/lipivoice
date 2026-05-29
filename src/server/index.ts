import { createServer } from "node:http";
import { createApp } from "./app";
import { loadServerConfig } from "./config";

const config = loadServerConfig();
const app = createApp(config);
const server = createServer(app);

server.listen(config.port, () => {
  console.log(`LipiVoice API listening on http://localhost:${config.port}`);
});
