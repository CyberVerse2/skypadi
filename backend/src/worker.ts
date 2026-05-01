import { run } from "graphile-worker";

import { env } from "./config.js";
import { taskList } from "./jobs/task-list.js";

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to start the worker");
  }

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    noHandleSignals: false,
    pollInterval: 1000,
    taskList
  });

  await runner.promise;
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
