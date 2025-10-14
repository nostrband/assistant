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
      reply TEXT DEFAULT '',
      state TEXT DEFAULT '',
      thread_id TEXT DEFAULT '',
      error TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      data TEXT NOT NULL,
      user_id TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      priority TEXT DEFAULT 'low' CHECK (priority IN ('low', 'medium', 'high')),
      created DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN title TEXT NOT NULL DEFAULT '';`);
  } catch {
    // Column already exists
  }

  try {
    await db.execute(`ALTER TABLE tasks ADD COLUMN cron TEXT NOT NULL DEFAULT '';`);
  } catch {
    // Column already exists
  }

  // Migration: Rename status column to reply
  try {
    // Check if the status column exists and reply column doesn't exist
    const tableInfo = await db.execute(`PRAGMA table_info(tasks)`);
    const hasStatusColumn = tableInfo.rows.some((row: Record<string, unknown>) => row.name === 'status');
    const hasReplyColumn = tableInfo.rows.some((row: Record<string, unknown>) => row.name === 'reply');
    
    if (hasStatusColumn && !hasReplyColumn) {
      console.log('Migrating tasks table: renaming status column to reply...');
      
      // SQLite doesn't support RENAME COLUMN directly in older versions, so we need to recreate the table
      await db.execute(`CREATE TABLE tasks_migration (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        task TEXT NOT NULL,
        reply TEXT DEFAULT '',
        state TEXT DEFAULT '',
        thread_id TEXT DEFAULT '',
        error TEXT DEFAULT '',
        deleted BOOLEAN DEFAULT FALSE,
        type TEXT DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        cron TEXT NOT NULL DEFAULT ''
      )`);
      
      // Copy data from old table, mapping status to reply and setting state based on reply/error
      await db.execute(`INSERT INTO tasks_migration (id, user_id, timestamp, task, reply, state, thread_id, error, deleted, type, title, cron)
        SELECT id, user_id, timestamp, task, status,
               CASE
                 WHEN error != '' THEN 'error'
                 WHEN status != '' THEN 'finished'
                 ELSE ''
               END,
               thread_id, error, deleted, type, title, cron FROM tasks`);
      
      // Drop old table and rename new one
      await db.execute(`DROP TABLE tasks`);
      await db.execute(`ALTER TABLE tasks_migration RENAME TO tasks`);
      
      console.log('Tasks table migration completed: status column renamed to reply.');
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn('Tasks status->reply migration warning:', error);
  }

  // Create indexes
  try {
    await db.batch([
      `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type, id)`,
      `CREATE INDEX IF NOT EXISTS idx_events_user_id_id ON events(user_id, id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated)`
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
        reply TEXT DEFAULT '',
        state TEXT DEFAULT '',
        thread_id TEXT DEFAULT '',
        error TEXT DEFAULT '',
        deleted BOOLEAN DEFAULT FALSE
      )`);
      
      // Copy data from old table
      await db.execute(`INSERT INTO tasks_new (id, user_id, timestamp, task, reply, state, thread_id, error, deleted)
        SELECT id, user_id, timestamp, task, status, '', thread_id, error, deleted FROM tasks`);
      
      // Drop old table and rename new one
      await db.execute(`DROP TABLE tasks`);
      await db.execute(`ALTER TABLE tasks_new RENAME TO tasks`);
      
      // Recreate indexes for tasks table
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`);
      
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
