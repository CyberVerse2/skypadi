import { sql } from "drizzle-orm";

import type { DbClient } from "../../db/client";
import type { WakanowAccountCredentials } from "./wakanow.types";

const WAKANOW_SUPPLIER = "wakanow";
const ROTATION_LOCK_KEY = "skypadi:wakanow:supplier-account-assignments";

export async function assignWakanowAccountForBooking(input: {
  db: DbClient;
  bookingId: string;
  accountPool: WakanowAccountCredentials[];
}): Promise<WakanowAccountCredentials> {
  if (input.accountPool.length === 0) {
    throw new Error("Wakanow account credentials are not configured");
  }

  const accountEmails = input.accountPool.map((account) => account.email.toLowerCase());
  const accountEmailArray = sql.join(accountEmails.map((email) => sql`${email}`), sql`, `);
  const result = await input.db.execute(sql`
    with rotation_lock as (
      select pg_advisory_xact_lock(hashtext(${ROTATION_LOCK_KEY}))
    ),
    existing_assignment as (
      select account_email, pool_index
      from skypadi_whatsapp.supplier_account_assignments
      where booking_id = ${input.bookingId}
        and supplier = ${WAKANOW_SUPPLIER}
      limit 1
    ),
    account_pool as (
      select lower(account_email) as account_email, (ordinality - 1)::int as pool_index
      from unnest(array[${accountEmailArray}]::text[]) with ordinality as pool(account_email, ordinality)
    ),
    created_assignment as (
      insert into skypadi_whatsapp.supplier_account_assignments (
        booking_id,
        supplier,
        account_email,
        pool_index,
        metadata
      )
      select
        ${input.bookingId},
        ${WAKANOW_SUPPLIER},
        account_pool.account_email,
        account_pool.pool_index,
        jsonb_build_object('pool_size', ${input.accountPool.length})
      from account_pool, rotation_lock
      where account_pool.pool_index = (
        select count(*)::int % ${input.accountPool.length}
        from skypadi_whatsapp.supplier_account_assignments
        where supplier = ${WAKANOW_SUPPLIER}
      )
        and not exists (select 1 from existing_assignment)
      on conflict (booking_id, supplier) do nothing
      returning account_email, pool_index
    )
    select account_email, pool_index from existing_assignment
    union all
    select account_email, pool_index from created_assignment
    limit 1
  `);

  const row = result.rows[0] as { account_email?: string } | undefined;
  if (!row?.account_email) {
    throw new Error("Wakanow account assignment failed");
  }

  const account = input.accountPool.find((candidate) => candidate.email.toLowerCase() === row.account_email?.toLowerCase());
  if (!account) {
    throw new Error(`Assigned Wakanow account is not configured: ${row.account_email}`);
  }

  return account;
}
