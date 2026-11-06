import { app } from "./app.js";
import { env } from "./config/env.js";
import { closePool } from "./lib/db.js";

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down...`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);

  forceExit.unref();

  server.close(async (error) => {
    if (error) {
      console.error(error);
    }

    await closePool();
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
  void shutdown("uncaughtException");
});
