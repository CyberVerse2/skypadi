import { drizzle } from "drizzle-orm/node-postgres";

import { pool } from "./pool";
import * as schema from "./schema";

export const db = drizzle(pool, { schema });

export type DbClient = typeof db;
