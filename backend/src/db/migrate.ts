import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "./client";
import { closePool } from "./pool";

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "src/db/migrations" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(async () => {
      await closePool();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await closePool();
      process.exitCode = 1;
    });
}
