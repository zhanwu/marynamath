'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Open (and migrate) the SQLite database. Stores sessions and per-question
 * answers so progress survives a server restart and a child can resume.
 */
function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id           TEXT NOT NULL,
      student          TEXT,
      started_at       TEXT NOT NULL,
      submitted_at     TEXT,
      created_ms       INTEGER NOT NULL,
      client_id        TEXT,              -- which browser owns this session (issue 003)
      last_activity_ms INTEGER            -- last save/claim; stale sessions are reclaimable
    );
    CREATE TABLE IF NOT EXISTS answers (
      session_id          INTEGER NOT NULL,
      question_id         TEXT NOT NULL,
      student_answer      TEXT,            -- JSON-encoded value
      time_spent_seconds  INTEGER NOT NULL DEFAULT 0,
      attempts            INTEGER NOT NULL DEFAULT 0,
      updated_ms          INTEGER NOT NULL,
      PRIMARY KEY (session_id, question_id)
    );
  `);
  // Migrate pre-003 databases: add the session-ownership columns if missing.
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all().map((c) => c.name);
  if (!cols.includes('client_id')) db.exec(`ALTER TABLE sessions ADD COLUMN client_id TEXT`);
  if (!cols.includes('last_activity_ms')) db.exec(`ALTER TABLE sessions ADD COLUMN last_activity_ms INTEGER`);
  return db;
}

module.exports = { openDb };
