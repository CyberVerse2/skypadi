
import type { DbClient } from "../../src/db/client";
import { assignWakanowAccountForBooking } from "../../src/integrations/wakanow/account-assignment";
import { describe, expect, test } from "vitest";


describe("unit wakanow account assignment", () => {
  test("Wakanow account assignment persists one account per booking", async () => {
    const executedQueries: unknown[] = [];
    const db = {
      async execute(query: unknown) {
        executedQueries.push(query);
        return {
          rows: [
            {
              account_email: "bassey.etim@bookings.skypadi.com",
              pool_index: 1,
            },
          ],
        };
      },
    } as unknown as DbClient;

    const account = await assignWakanowAccountForBooking({
      db,
      bookingId: "11111111-1111-4111-8111-111111111111",
      accountPool: [
        { email: "nkiru.obi@bookings.skypadi.com", password: "password-1" },
        { email: "bassey.etim@bookings.skypadi.com", password: "password-2" },
      ],
    });

    expect(account).toEqual({
      email: "bassey.etim@bookings.skypadi.com",
      password: "password-2",
    });

    const sqlText = sqlString(executedQueries[0]);
    expect(sqlText).toMatch(/insert into skypadi_whatsapp\.supplier_account_assignments/);
    expect(sqlText).toMatch(/on conflict \(booking_id, supplier\) do nothing/);
    expect(sqlText).toMatch(/pg_advisory_xact_lock/);
    expect(sqlText).toMatch(/count\(\*\)::int %/);
  });

  test("Wakanow account assignment fails when persisted account is no longer configured", async () => {
    const db = {
      async execute() {
        return {
          rows: [
            {
              account_email: "old.account@bookings.skypadi.com",
              pool_index: 0,
            },
          ],
        };
      },
    } as unknown as DbClient;

    await expect(
      assignWakanowAccountForBooking({
        db,
        bookingId: "11111111-1111-4111-8111-111111111111",
        accountPool: [{ email: "nkiru.obi@bookings.skypadi.com", password: "password-1" }],
      }),
    ).rejects.toThrow(/Assigned Wakanow account is not configured/);
  });

  function sqlString(value: unknown): string {
    const chunks = (value as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
    return chunks
      .flatMap((chunk) => {
        const stringChunk = chunk as { value?: unknown };
        return Array.isArray(stringChunk.value) ? stringChunk.value : [];
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
});
