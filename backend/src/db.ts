import { Pool, types } from "pg";
import { env } from "./config.js";
import type { PassengerProfile } from "./bot/session.js";
import type { StellarNetwork } from "./config.js";
import type {
  BookingPersistenceInput
} from "./schemas/booking-contract.js";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
});

types.setTypeParser(20, (value) => Number.parseInt(value, 10));

let initialized = false;

type ProfileRow = {
  id: number;
  title: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  email: string;
};

type WalletRow = {
  telegram_id: number;
  public_key: string;
  encrypted_secret: string;
  network: string;
  funded: boolean;
  created_at: string;
};

type UserRow = {
  id: number;
};

export type BookingRecord = {
  id: number;
};

export async function initDb(): Promise<void> {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS passenger_profiles (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      title TEXT NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS passenger_profiles_one_default_idx
    ON passenger_profiles (user_id)
    WHERE is_default = TRUE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_attempts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      passenger_profile_id BIGINT REFERENCES passenger_profiles(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      provider_booking_id TEXT NOT NULL,
      status TEXT NOT NULL,
      airline TEXT,
      origin TEXT,
      destination TEXT,
      departure_time TEXT,
      arrival_time TEXT,
      amount NUMERIC(12, 2),
      currency TEXT,
      customer_email TEXT,
      booking_contact_email TEXT,
      verification_mode TEXT,
      verification_status TEXT,
      payment_url TEXT,
      failure_reason TEXT,
      passenger_snapshot JSONB NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS booking_attempts_provider_booking_idx
    ON booking_attempts (provider, provider_booking_id)
  `);

  await pool.query(`ALTER TABLE booking_attempts ADD COLUMN IF NOT EXISTS customer_email TEXT`);
  await pool.query(`ALTER TABLE booking_attempts ADD COLUMN IF NOT EXISTS booking_contact_email TEXT`);
  await pool.query(`ALTER TABLE booking_attempts ADD COLUMN IF NOT EXISTS verification_mode TEXT`);
  await pool.query(`ALTER TABLE booking_attempts ADD COLUMN IF NOT EXISTS verification_status TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id BIGSERIAL PRIMARY KEY,
      booking_attempt_id BIGINT NOT NULL REFERENCES booking_attempts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_url TEXT,
      bank_transfers JSONB,
      expires_in TEXT,
      note TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      booking_attempt_id BIGINT REFERENCES booking_attempts(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      telegram_id BIGINT PRIMARY KEY,
      public_key TEXT NOT NULL UNIQUE,
      encrypted_secret TEXT NOT NULL,
      network TEXT NOT NULL,
      funded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  initialized = true;
}

async function getOrCreateUser(telegramId: number): Promise<number> {
  await initDb();
  const result = await pool.query<UserRow>(
    `
      INSERT INTO users (telegram_id, updated_at, last_seen_at)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (telegram_id) DO UPDATE SET
        updated_at = NOW(),
        last_seen_at = NOW()
      RETURNING id
    `,
    [telegramId]
  );
  return result.rows[0].id;
}

export async function touchUser(telegramId: number): Promise<void> {
  await getOrCreateUser(telegramId);
}

async function recordAuditEvent(params: {
  userId: number;
  eventType: string;
  payload?: Record<string, unknown>;
  bookingAttemptId?: number;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO audit_events (user_id, booking_attempt_id, event_type, payload)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [
      params.userId,
      params.bookingAttemptId ?? null,
      params.eventType,
      JSON.stringify(params.payload ?? {})
    ]
  );
}

export async function saveProfile(telegramId: number, profile: PassengerProfile): Promise<void> {
  const userId = await getOrCreateUser(telegramId);

  await pool.query(
    `
      INSERT INTO passenger_profiles (
        user_id,
        label,
        is_default,
        title,
        first_name,
        middle_name,
        last_name,
        date_of_birth,
        gender,
        phone,
        email,
        updated_at
      )
      VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (user_id) WHERE is_default = TRUE DO UPDATE SET
        label = EXCLUDED.label,
        title = EXCLUDED.title,
        first_name = EXCLUDED.first_name,
        middle_name = EXCLUDED.middle_name,
        last_name = EXCLUDED.last_name,
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        updated_at = NOW()
    `,
    [
      userId,
      "Primary traveler",
      profile.title,
      profile.firstName,
      profile.middleName ?? null,
      profile.lastName,
      profile.dateOfBirth,
      profile.gender,
      profile.phone,
      profile.email
    ]
  );

  await recordAuditEvent({
    userId,
    eventType: "profile.saved",
    payload: {
      hasMiddleName: Boolean(profile.middleName),
      email: profile.email
    }
  });
}

export async function getProfile(telegramId: number): Promise<PassengerProfile | undefined> {
  const userId = await getOrCreateUser(telegramId);
  const result = await pool.query<ProfileRow>(
    `
      SELECT id, title, first_name, middle_name, last_name, date_of_birth, gender, phone, email
      FROM passenger_profiles
      WHERE user_id = $1 AND is_default = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) return undefined;

  return {
    title: row.title,
    firstName: row.first_name,
    middleName: row.middle_name ?? undefined,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    phone: row.phone,
    email: row.email
  };
}

export type WalletRecord = {
  telegramId: number;
  publicKey: string;
  encryptedSecret: string;
  network: StellarNetwork;
  funded: boolean;
  createdAt: string;
};

export async function getWallet(telegramId: number): Promise<WalletRecord | undefined> {
  await initDb();
  const result = await pool.query<WalletRow>(
    `
      SELECT telegram_id, public_key, encrypted_secret, network, funded, created_at
      FROM wallets
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [telegramId]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    telegramId: row.telegram_id,
    publicKey: row.public_key,
    encryptedSecret: row.encrypted_secret,
    network: row.network as StellarNetwork,
    funded: !!row.funded,
    createdAt: row.created_at
  };
}

export async function insertWallet(
  telegramId: number,
  publicKey: string,
  encryptedSecret: string,
  network: StellarNetwork,
  funded: boolean
): Promise<void> {
  await initDb();
  await pool.query(
    `
      INSERT INTO wallets (telegram_id, public_key, encrypted_secret, network, funded, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (telegram_id) DO UPDATE SET
        public_key = EXCLUDED.public_key,
        encrypted_secret = EXCLUDED.encrypted_secret,
        network = EXCLUDED.network,
        funded = EXCLUDED.funded,
        updated_at = NOW()
    `,
    [telegramId, publicKey, encryptedSecret, network, funded]
  );
}

export async function markWalletFunded(telegramId: number): Promise<void> {
  await initDb();
  await pool.query(
    `
      UPDATE wallets
      SET funded = TRUE, updated_at = NOW()
      WHERE telegram_id = $1
    `,
    [telegramId]
  );
}

export async function saveBookingAttempt(input: BookingPersistenceInput): Promise<BookingRecord> {
  const userId = await getOrCreateUser(input.telegramId);

  const profileResult = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM passenger_profiles
      WHERE user_id = $1 AND is_default = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId]
  );
  const passengerProfileId = profileResult.rows[0]?.id ?? null;

  const bookingResult = await pool.query<{ id: number }>(
    `
      INSERT INTO booking_attempts (
        user_id,
        passenger_profile_id,
        provider,
        provider_booking_id,
        status,
        airline,
        origin,
        destination,
        departure_time,
        arrival_time,
        amount,
        currency,
        customer_email,
        booking_contact_email,
        verification_mode,
        verification_status,
        payment_url,
        passenger_snapshot,
        metadata,
        updated_at
      )
      VALUES (
        $1, $2, 'wakanow', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, NOW()
      )
      ON CONFLICT (provider, provider_booking_id) DO UPDATE SET
        passenger_profile_id = EXCLUDED.passenger_profile_id,
        status = EXCLUDED.status,
        airline = EXCLUDED.airline,
        origin = EXCLUDED.origin,
        destination = EXCLUDED.destination,
        departure_time = EXCLUDED.departure_time,
        arrival_time = EXCLUDED.arrival_time,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        customer_email = EXCLUDED.customer_email,
        booking_contact_email = EXCLUDED.booking_contact_email,
        verification_mode = EXCLUDED.verification_mode,
        verification_status = EXCLUDED.verification_status,
        payment_url = EXCLUDED.payment_url,
        passenger_snapshot = EXCLUDED.passenger_snapshot,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `,
    [
      userId,
      passengerProfileId,
      input.providerBookingId,
      input.status,
      input.summary?.airline ?? input.selectedFlight?.airline ?? null,
      input.summary?.departure ?? null,
      input.summary?.arrival ?? null,
      input.summary?.departureTime ?? input.selectedFlight?.departureTime ?? null,
      input.summary?.arrivalTime ?? input.selectedFlight?.arrivalTime ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.customerEmail ?? input.profile.email,
      input.bookingContactEmail ?? input.customerEmail ?? input.profile.email,
      input.verificationMode ?? null,
      input.verificationStatus ?? null,
      input.paymentUrl ?? null,
      JSON.stringify(input.profile),
      JSON.stringify({
        selectedFlight: input.selectedFlight ?? null,
        contactContext: {
          customerEmail: input.customerEmail ?? input.profile.email,
          bookingContactEmail: input.bookingContactEmail ?? input.customerEmail ?? input.profile.email,
          verificationMode: input.verificationMode ?? null,
          verificationStatus: input.verificationStatus ?? null
        }
      })
    ]
  );

  const bookingAttemptId = bookingResult.rows[0].id;

  if (input.paymentUrl || input.bankTransfers?.length) {
    await pool.query(
      `
        INSERT INTO payment_attempts (
          booking_attempt_id,
          provider,
          status,
          payment_url,
          bank_transfers,
          expires_in,
          note,
          metadata,
          updated_at
        )
        VALUES ($1, 'wakanow', $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW())
      `,
      [
        bookingAttemptId,
        input.status,
        input.paymentUrl ?? null,
        JSON.stringify(input.bankTransfers ?? []),
        input.bankTransfers?.[0]?.expiresIn ?? null,
        input.bankTransfers?.[0]?.note ?? null,
        JSON.stringify({})
      ]
    );
  }

  await recordAuditEvent({
    userId,
    bookingAttemptId,
    eventType: "booking.created",
    payload: {
      providerBookingId: input.providerBookingId,
      status: input.status,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      customerEmail: input.customerEmail ?? input.profile.email,
      bookingContactEmail: input.bookingContactEmail ?? input.customerEmail ?? input.profile.email,
      verificationMode: input.verificationMode ?? null,
      verificationStatus: input.verificationStatus ?? null
    }
  });

  return { id: bookingAttemptId };
}
