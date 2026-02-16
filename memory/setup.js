import Database from 'better-sqlite3';
import { config } from '../config/index.js';

let db = null;

export function getDb() {
  if (!db) {
    throw new Error('Database not initialised. Call setupDatabase() first.');
  }
  return db;
}

export function setupDatabase() {
  db = new Database(config.paths.dbPath);

  // WAL mode â prevents corruption from crashes
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ââ Conversations âââââââââââââââââââââââââââââââââ
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      message TEXT NOT NULL,
      prompt_day INTEGER,
      extracted_meaning TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ââ Identity Facts ââââââââââââââââââââââââââââââââ
  // Key-value store of factual information about DK.
  // Confidence: 0.0-1.0. Extracted facts start at 0.7.
  // Confirmed facts (via Day 14 or explicit correction) reach 1.0.
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      source TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ââ Patterns ââââââââââââââââââââââââââââââââââââââ
  // Recurring behaviours, themes, tendencies.
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      confirmed INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ââ Reflections âââââââââââââââââââââââââââââââââââ
  // Significant moments, emotional states, decisions.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL DEFAULT (date('now')),
      moment TEXT NOT NULL,
      emotion TEXT,
      topics TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ââ Onboarding Progress âââââââââââââââââââââââââââ
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding (
      day INTEGER PRIMARY KEY,
      sent_at TEXT,
      replied_at TEXT,
      reply_text TEXT
    )
  `);

  // ââ Active Context ââââââââââââââââââââââââââââââââ
  // Short-lived contextual state (current mood, active project, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_context (
      field TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log(`[Memory] Database initialised at ${config.paths.dbPath}`);
}
