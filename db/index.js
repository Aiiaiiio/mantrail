const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', 'mantrail.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.resolve(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

try {
  db.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE session_members ADD COLUMN is_master INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE allowed_emails ADD COLUMN can_invite INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE invite_tokens ADD COLUMN can_invite INTEGER DEFAULT 0");
} catch (e) {}
// If allowlist has entries but nobody can invite yet, give the first user invite rights
const anyCanInvite = db.prepare("SELECT COUNT(*) as count FROM allowed_emails WHERE can_invite = 1").get();
if (anyCanInvite.count === 0) {
  const firstEntry = db.prepare("SELECT id FROM allowed_emails ORDER BY created_at ASC LIMIT 1").get();
  if (firstEntry) {
    db.prepare("UPDATE allowed_emails SET can_invite = 1 WHERE id = ?").run(firstEntry.id);
  }
}

module.exports = { db };
