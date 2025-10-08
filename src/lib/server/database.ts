import { createClient } from "@libsql/client";
import { join } from 'path';
import { DB_FILE } from '../const';

let db: ReturnType<typeof createClient> | null = null;

function getDatabase() {
  if (!db) {
    // Create LibSQL database connection - use DATA_PATH env var or current directory
    const dataPath = process.env.DATA_PATH || process.cwd();
    const dbPath = join(dataPath, DB_FILE);
    
    db = createClient({
      url: `file:${dbPath}`,
    });

    // Initialize database schema
    initializeDatabase();
  }
  return db;
}

async function initializeDatabase() {
  if (!db) return;

  // Create/update tables with proper migration
  await db.batch([
    `CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      read_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      task TEXT NOT NULL,
      status TEXT DEFAULT '',
      thread_id TEXT DEFAULT '',
      error TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      data TEXT NOT NULL,
      user_id TEXT NOT NULL
    )`
  ], "write");

  // Add new columns if they don't exist (migration)
  try {
    await db.execute(`ALTER TABLE chats ADD COLUMN first_message_content TEXT;`);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`ALTER TABLE chats ADD COLUMN first_message_time DATETIME;`);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN deleted BOOLEAN DEFAULT FALSE;`);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT '';`);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`ALTER TABLE chats ADD COLUMN read_at DATETIME;`);
  } catch {
    // Column already exists
  }

  // Create indexes
  try {
    await db.batch([
      `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_status_timestamp ON tasks(user_id, status, timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type, id)`,
      `CREATE INDEX IF NOT EXISTS idx_events_user_id_id ON events(user_id, id)`
    ], "write");
  } catch {
    // Indexes might already exist
  }

  // Migrate chats table to use new default format for timestamps
  try {
    // Check if we need to migrate the chats table
    const tableInfo = await db.execute(`PRAGMA table_info(chats)`);
    const createdAtColumn = tableInfo.rows.find((row: Record<string, unknown>) => row.name === 'created_at');
    
    // If the default is still CURRENT_TIMESTAMP, we need to migrate
    if (createdAtColumn && createdAtColumn.dflt_value === 'CURRENT_TIMESTAMP') {
      // Create new table with updated defaults
      await db.execute(`CREATE TABLE chats_new (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        first_message_content TEXT,
        first_message_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
      
      // Copy data from old table
      await db.execute(`INSERT INTO chats_new (id, created_at, updated_at, first_message_content, first_message_time)
        SELECT id, created_at, updated_at, first_message_content, first_message_time FROM chats`);
      
      // Drop old table and rename new one
      await db.execute(`DROP TABLE chats`);
      await db.execute(`ALTER TABLE chats_new RENAME TO chats`);
      
      // Recreate indexes
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`);
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn('Chats table migration warning:', error);
  }

  // Migrate tasks table to remove UNIQUE(user_id, timestamp) constraint
  try {
    // Check if the tasks table has the UNIQUE constraint by examining the schema
    const tasksSchema = await db.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`);
    const schemaSQL = tasksSchema.rows[0]?.sql as string;
    
    // If the schema contains the UNIQUE constraint, we need to migrate
    if (schemaSQL && schemaSQL.includes('UNIQUE(user_id, timestamp)')) {
      console.log('Migrating tasks table to remove UNIQUE(user_id, timestamp) constraint...');
      
      // Create new table without the UNIQUE constraint
      await db.execute(`CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        task TEXT NOT NULL,
        status TEXT DEFAULT '',
        thread_id TEXT DEFAULT '',
        error TEXT DEFAULT '',
        deleted BOOLEAN DEFAULT FALSE
      )`);
      
      // Copy data from old table
      await db.execute(`INSERT INTO tasks_new (id, user_id, timestamp, task, status, thread_id, error, deleted)
        SELECT id, user_id, timestamp, task, status, thread_id, error, deleted FROM tasks`);
      
      // Drop old table and rename new one
      await db.execute(`DROP TABLE tasks`);
      await db.execute(`ALTER TABLE tasks_new RENAME TO tasks`);
      
      // Recreate indexes for tasks table
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user_status_timestamp ON tasks(user_id, status, timestamp)`);
      
      console.log('Tasks table migration completed successfully.');
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn('Tasks table migration warning:', error);
  }

  // Drop messages table if it exists (migration to Mastra memory)
  try {
    await db.execute('DROP TABLE IF EXISTS messages;');
  } catch {
    // Ignore error if table doesn't exist
  }
}


export default getDatabase;
