import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import type { PassengerProfile } from "./bot/session.js";
import type { StellarNetwork } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "skypadi.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    telegram_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    gender TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    telegram_id INTEGER PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE,
    encrypted_secret TEXT NOT NULL,
    network TEXT NOT NULL,
    funded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migration: add middle_name column if missing (existing databases)
try {
  db.exec(`ALTER TABLE profiles ADD COLUMN middle_name TEXT`);
} catch { /* column already exists */ }

const upsertStmt = db.prepare(`
  INSERT INTO profiles (telegram_id, title, first_name, middle_name, last_name, date_of_birth, gender, phone, email, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(telegram_id) DO UPDATE SET
    title = excluded.title,
    first_name = excluded.first_name,
    middle_name = excluded.middle_name,
    last_name = excluded.last_name,
    date_of_birth = excluded.date_of_birth,
    gender = excluded.gender,
    phone = excluded.phone,
    email = excluded.email,
    updated_at = datetime('now')
`);

const getStmt = db.prepare(`SELECT * FROM profiles WHERE telegram_id = ?`);

export function saveProfile(telegramId: number, profile: PassengerProfile): void {
  upsertStmt.run(
    telegramId,
    profile.title,
    profile.firstName,
    profile.middleName ?? null,
    profile.lastName,
    profile.dateOfBirth,
    profile.gender,
    profile.phone,
    profile.email
  );
}

export function getProfile(telegramId: number): PassengerProfile | undefined {
  const row = getStmt.get(telegramId) as any;
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

const insertWalletStmt = db.prepare(`
  INSERT INTO wallets (telegram_id, public_key, encrypted_secret, network, funded)
  VALUES (?, ?, ?, ?, ?)
`);

const getWalletStmt = db.prepare(`SELECT * FROM wallets WHERE telegram_id = ?`);

const markWalletFundedStmt = db.prepare(`UPDATE wallets SET funded = 1 WHERE telegram_id = ?`);

export type WalletRecord = {
  telegramId: number;
  publicKey: string;
  encryptedSecret: string;
  network: StellarNetwork;
  funded: boolean;
  createdAt: string;
};

export function getWallet(telegramId: number): WalletRecord | undefined {
  const row = getWalletStmt.get(telegramId) as any;
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

export function insertWallet(
  telegramId: number,
  publicKey: string,
  encryptedSecret: string,
  network: StellarNetwork,
  funded: boolean
): void {
  insertWalletStmt.run(telegramId, publicKey, encryptedSecret, network, funded ? 1 : 0);
}

export function markWalletFunded(telegramId: number): void {
  markWalletFundedStmt.run(telegramId);
}
