const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'chat.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      thread_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent')),
      body TEXT NOT NULL,
      agent_email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      google_message_name TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS widget_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON conversations(visitor_id);
  `);

  const row = db.prepare("SELECT value FROM widget_settings WHERE key = 'initialized'").get();
  if (!row) {
    const insert = db.prepare("INSERT INTO widget_settings (key, value) VALUES (?, ?)");
    insert.run('initialized', '1');
    insert.run('delay_seconds', '3');
    insert.run('welcome_text', 'Hi! How can we help you today?');
    insert.run('primary_color', '#2563eb');
    insert.run('position', 'bottom-right');
  }
}

module.exports = { getDb, initDb };
