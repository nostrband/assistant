import { createClient, type InValue, type InArgs } from "@libsql/client";
import { join } from 'path';
import { DB_FILE } from './const';

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      task TEXT NOT NULL,
      status TEXT DEFAULT '',
      thread_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      UNIQUE(user_id, timestamp)
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

  // Create indexes
  try {
    await db.batch([
      `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_status_timestamp ON tasks(user_id, status, timestamp)`
    ], "write");
  } catch {
    // Indexes might already exist
  }

  // Drop messages table if it exists (migration to Mastra memory)
  try {
    await db.execute('DROP TABLE IF EXISTS messages;');
  } catch {
    // Ignore error if table doesn't exist
  }
}

// Transaction support
export interface Transaction {
  execute: (query: { sql: string; args: InArgs }) => Promise<unknown>;
  batch: (queries: string[], mode?: "write" | "read") => Promise<unknown>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

export async function beginTransaction(): Promise<Transaction> {
  const db = getDatabase();
  
  // LibSQL doesn't have explicit transaction support in the same way as other databases
  // We'll implement a simple transaction wrapper that batches operations
  const operations: Array<{ sql: string; args: InArgs }> = [];
  let committed = false;
  let rolledBack = false;
  
  const transaction: Transaction = {
    execute: async (query: { sql: string; args: InArgs }) => {
      if (committed || rolledBack) {
        throw new Error("Transaction has already been committed or rolled back");
      }
      operations.push(query);
      // For read operations, execute immediately
      if (query.sql.trim().toLowerCase().startsWith('select')) {
        return await db.execute(query);
      }
      // For write operations, just store them
      return { rows: [], columns: [] };
    },
    
    batch: async (queries: string[], _mode?: "write" | "read") => {
      if (committed || rolledBack) {
        throw new Error("Transaction has already been committed or rolled back");
      }
      for (const sql of queries) {
        operations.push({ sql, args: [] });
      }
      return { rows: [], columns: [] };
    },
    
    commit: async () => {
      if (committed || rolledBack) {
        throw new Error("Transaction has already been committed or rolled back");
      }
      
      try {
        // Execute all operations in a batch
        if (operations.length > 0) {
          const batchQueries = operations.map(op => op.sql);
          await db.batch(batchQueries, "write");
        }
        committed = true;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
    
    rollback: async () => {
      if (committed || rolledBack) {
        throw new Error("Transaction has already been committed or rolled back");
      }
      rolledBack = true;
      // Clear operations without executing them
      operations.length = 0;
    }
  };
  
  return transaction;
}

export default getDatabase;
