import { run } from "graphile-worker";

import { taskList } from "./jobs/task-list.js";

function parseWorkerConcurrency(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer");
  }

  return Number(value);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the worker");
  }

  const concurrency = parseWorkerConcurrency(process.env.WORKER_CONCURRENCY);

  const runner = await run({
    connectionString: databaseUrl,
    concurrency,
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
