import { buildApp } from "./app.js";
import { warmUpOllama } from "./services/ai/ollama.js";

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`API listening on ${HOST}:${PORT}`);

    // Fire-and-forget Ollama warm-up after server is listening
    warmUpOllama().then((result) => {
      app.log.info(result, "ai.ollama.warmup");
    }).catch(() => {
      // warmUpOllama logs internally; no action needed here
    });
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

main();
