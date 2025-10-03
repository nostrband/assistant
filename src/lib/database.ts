import Database from 'better-sqlite3';
import { join } from 'path';

let db: Database.Database | null = null;

function getDatabase() {
  if (!db) {
    // Create SQLite database connection - use DATA_PATH env var or current directory
    const dataPath = process.env.DATA_PATH || process.cwd();
    const dbPath = join(dataPath, 'data.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Create/update tables with proper migration
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add new columns if they don't exist (migration)
    try {
      db.exec(`ALTER TABLE chats ADD COLUMN first_message_content TEXT;`);
    } catch {
      // Column already exists
    }

    try {
      db.exec(`ALTER TABLE chats ADD COLUMN first_message_time DATETIME;`);
    } catch {
      // Column already exists
    }

    // Create indexes
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at);
        CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time);
      `);
    } catch {
      // Indexes might already exist
    }

    // Drop messages table if it exists (migration to Mastra memory)
    try {
      db.exec('DROP TABLE IF EXISTS messages;');
    } catch {
      // Ignore error if table doesn't exist
    }
  }
  return db;
}

export default getDatabase;
