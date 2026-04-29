import { sql } from "drizzle-orm";

import type { DbClient } from "../../db/client.js";

export async function findRankedOptionsForSearch(db: DbClient, flightSearchId: string) {
  return db.execute(sql`
    select *
    from skypadi_whatsapp.flight_options
    where flight_search_id = ${flightSearchId}
    order by amount asc, departure_at asc
  `);
}
