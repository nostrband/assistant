import Database from "better-sqlite3";
import { join } from "path";
import { DB_FILE, USER_ID } from "../const";
import { AssistantUIMessage } from "@/ai/agent";
import { convertMessages } from "@mastra/core/agent";

// Types for migration (will be removed after migration is complete)
type MastraMessageContentV2 = {
  format: number;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
};

type MastraMessageV2 = {
  id: string;
  threadId?: string;
  content: MastraMessageContentV2;
  role: "user" | "assistant" | "system";
  type: string;
  createdAt: Date;
  resourceId: string;
};

let db: Database.Database | null = null;

function dbPath() {
  const dataPath = process.env.DATA_PATH || process.cwd();
  return join(dataPath, DB_FILE);
}

function getDatabase() {
  if (!db) {
    // Create better-sqlite3 database connection - use DATA_PATH env var or current directory
    db = new Database(dbPath());

    // Enable WAL mode for better performance
    db.pragma("journal_mode = WAL");

    // Initialize database schema
    initializeDatabase();
  }
  return db;
}

// Async version that waits for migration completion
async function getDatabaseWithMigrationWait() {
  const database = getDatabase();

  // Wait for migration to complete before allowing database operations
  await waitForMigrationComplete(database);

  return database;
}

// Helper function to wait for migration completion
async function waitForMigrationComplete(
  database: Database.Database
): Promise<void> {
  console.log("[migration] Waiting for migration to complete...");

  while (true) {
    try {
      const stmt = database.prepare(
        `SELECT migrated FROM mastra_migration WHERE id = 1`
      );
      const result = stmt.get();
      if (result && (result as Record<string, unknown>).migrated === 1) {
        console.log("[migration] Migration completed, proceeding...");
        return;
      }
    } catch (error) {
      // If table doesn't exist or query fails, assume migration not complete
      // This is expected during initial setup
    }

    // Wait 1 second before checking again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function initializeDatabase() {
  if (!db) return;

  // Create/update tables with proper migration
  const transaction = db.transaction(() => {
    db!.exec(`CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      read_at DATETIME
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      task TEXT NOT NULL,
      reply TEXT DEFAULT '',
      state TEXT DEFAULT '',
      thread_id TEXT DEFAULT '',
      error TEXT DEFAULT ''
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      data TEXT NOT NULL,
      user_id TEXT NOT NULL
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      priority TEXT DEFAULT 'low' CHECK (priority IN ('low', 'medium', 'high')),
      created DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
  });

  transaction();

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

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN deleted BOOLEAN DEFAULT FALSE;`);
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT '';`);
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE chats ADD COLUMN read_at DATETIME;`);
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN title TEXT NOT NULL DEFAULT '';`);
  } catch {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN cron TEXT NOT NULL DEFAULT '';`);
  } catch {
    // Column already exists
  }

  // Migration: Rename status column to reply
  try {
    // Check if the status column exists and reply column doesn't exist
    const tableInfo = db.prepare(`PRAGMA table_info(tasks)`).all();
    const hasStatusColumn = (tableInfo as Record<string, unknown>[]).some(
      (row) => row.name === "status"
    );
    const hasReplyColumn = (tableInfo as Record<string, unknown>[]).some(
      (row) => row.name === "reply"
    );

    if (hasStatusColumn && !hasReplyColumn) {
      console.log("Migrating tasks table: renaming status column to reply...");

      const migration = db.transaction(() => {
        // SQLite doesn't support RENAME COLUMN directly in older versions, so we need to recreate the table
        db!.exec(`CREATE TABLE tasks_migration (
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
        db!
          .exec(`INSERT INTO tasks_migration (id, user_id, timestamp, task, reply, state, thread_id, error, deleted, type, title, cron)
          SELECT id, user_id, timestamp, task, status,
                 CASE
                   WHEN error != '' THEN 'error'
                   WHEN status != '' THEN 'finished'
                   ELSE ''
                 END,
                 thread_id, error, deleted, type, title, cron FROM tasks`);

        // Drop old table and rename new one
        db!.exec(`DROP TABLE tasks`);
        db!.exec(`ALTER TABLE tasks_migration RENAME TO tasks`);
      });

      migration();
      console.log(
        "Tasks table migration completed: status column renamed to reply."
      );
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn("Tasks status->reply migration warning:", error);
  }

  // Create indexes
  try {
    const indexTransaction = db.transaction(() => {
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`
      );
      db!.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`);
      db!.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`);
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type, id)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_events_user_id_id ON events(user_id, id)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated)`
      );
    });

    indexTransaction();
  } catch {
    // Indexes might already exist
  }

  // Migrate chats table to use new default format for timestamps
  try {
    // Check if we need to migrate the chats table
    const tableInfo = db.prepare(`PRAGMA table_info(chats)`).all();
    const createdAtColumn = (tableInfo as Record<string, unknown>[]).find(
      (row) => row.name === "created_at"
    );

    // If the default is still CURRENT_TIMESTAMP, we need to migrate
    if (
      createdAtColumn &&
      (createdAtColumn as Record<string, unknown>).dflt_value ===
        "CURRENT_TIMESTAMP"
    ) {
      const chatsMigration = db.transaction(() => {
        // Create new table with updated defaults
        db!.exec(`CREATE TABLE chats_new (
          id TEXT PRIMARY KEY,
          created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          first_message_content TEXT,
          first_message_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )`);

        // Copy data from old table
        db!
          .exec(`INSERT INTO chats_new (id, created_at, updated_at, first_message_content, first_message_time)
          SELECT id, created_at, updated_at, first_message_content, first_message_time FROM chats`);

        // Drop old table and rename new one
        db!.exec(`DROP TABLE chats`);
        db!.exec(`ALTER TABLE chats_new RENAME TO chats`);

        // Recreate indexes
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)`
        );
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_chats_first_message_time ON chats(first_message_time)`
        );
      });

      chatsMigration();
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn("Chats table migration warning:", error);
  }

  // Migrate tasks table to remove UNIQUE(user_id, timestamp) constraint
  try {
    // Check if the tasks table has the UNIQUE constraint by examining the schema
    const tasksSchema = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`
      )
      .get();
    const schemaSQL = (tasksSchema as Record<string, unknown>)?.sql as string;

    // If the schema contains the UNIQUE constraint, we need to migrate
    if (schemaSQL && schemaSQL.includes("UNIQUE(user_id, timestamp)")) {
      console.log(
        "Migrating tasks table to remove UNIQUE(user_id, timestamp) constraint..."
      );

      const tasksMigration = db.transaction(() => {
        // Create new table without the UNIQUE constraint
        db!.exec(`CREATE TABLE tasks_new (
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
        db!
          .exec(`INSERT INTO tasks_new (id, user_id, timestamp, task, reply, state, thread_id, error, deleted)
          SELECT id, user_id, timestamp, task, status, '', thread_id, error, deleted FROM tasks`);

        // Drop old table and rename new one
        db!.exec(`DROP TABLE tasks`);
        db!.exec(`ALTER TABLE tasks_new RENAME TO tasks`);

        // Recreate indexes for tasks table
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)`
        );
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_tasks_timestamp ON tasks(timestamp)`
        );
        db!.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_reply ON tasks(reply)`);
        db!.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)`);
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_tasks_user_reply_timestamp ON tasks(user_id, reply, timestamp)`
        );
        db!.exec(
          `CREATE INDEX IF NOT EXISTS idx_tasks_user_state_timestamp ON tasks(user_id, state, timestamp)`
        );
      });

      tasksMigration();
      console.log("Tasks table migration completed successfully.");
    }
  } catch (error) {
    // Migration failed, but continue - table might already be in correct format
    console.warn("Tasks table migration warning:", error);
  }

  // Create new tables for our own memory implementation
  const memoryTransaction = db.transaction(() => {
    db!.exec(`CREATE TABLE IF NOT EXISTS threads (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT,
      resourceId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      metadata TEXT
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL PRIMARY KEY,
      threadId TEXT NOT NULL,
      resourceId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS resources (
      id TEXT NOT NULL PRIMARY KEY,
      workingMemory TEXT,
      metadata TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);

    db!.exec(`CREATE TABLE IF NOT EXISTS mastra_migration (
      id INTEGER PRIMARY KEY DEFAULT 1,
      migrated INTEGER DEFAULT 0,
      CHECK (id = 1)
    )`);
  });

  memoryTransaction();

  // Create indexes for new tables
  try {
    const memoryIndexTransaction = db.transaction(() => {
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_threads_resourceId ON threads(resourceId)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_threads_updatedAt ON threads(updatedAt)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_threadId ON messages(threadId)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_resourceId ON messages(resourceId)`
      );
      db!.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_createdAt ON messages(createdAt)`
      );
      db!.exec(`CREATE INDEX IF NOT EXISTS idx_resources_id ON resources(id)`);
    });

    memoryIndexTransaction();
  } catch {
    // Indexes might already exist
  }

  // Migrate data from mastra tables if they exist and our tables are empty
  await migrateFromMastraTables();
}

async function migrateFromMastraTables() {
  if (!db) return;

  try {
    // Check if migration has already been completed
    const migrationStatus = db
      .prepare(`SELECT migrated FROM mastra_migration WHERE id = 1`)
      .get();
    if (
      migrationStatus &&
      (migrationStatus as Record<string, unknown>).migrated === 1
    ) {
      console.log("Migration already completed, skipping...");
      return;
    }

    // TX
    const fullMigration = db.transaction(() => {
      // Initialize migration status if not exists
      db!
        .prepare(
          `INSERT OR IGNORE INTO mastra_migration (id, migrated) VALUES (1, 0)`
        )
        .run();

      // Check if mastra tables exist
      const mastraTablesExist = db!
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('mastra_threads', 'mastra_messages', 'mastra_resources')
      `
        )
        .all();

      if (mastraTablesExist.length === 0) {
        console.log("No mastra tables found, skipping migration");
        return;
      }

      // Check if our tables are empty (to avoid duplicate migration)
      const threadsCount = db!
        .prepare(`SELECT COUNT(*) as count FROM threads`)
        .get() as { count: number };
      const messagesCount = db!
        .prepare(`SELECT COUNT(*) as count FROM messages`)
        .get() as { count: number };
      const resourcesCount = db!
        .prepare(`SELECT COUNT(*) as count FROM resources`)
        .get() as { count: number };

      const threadsEmpty = threadsCount.count === 0;
      const messagesEmpty = messagesCount.count === 0;
      const resourcesEmpty = resourcesCount.count === 0;

      // Migrate threads
      if (threadsEmpty) {
        try {
          const mastraThreads = db!
            .prepare(`SELECT * FROM mastra_threads`)
            .all();
          if (mastraThreads.length > 0) {
            console.log(
              `Migrating ${mastraThreads.length} threads from mastra_threads`
            );
            const insertThread = db!
              .prepare(`INSERT INTO threads (id, title, resourceId, createdAt, updatedAt, metadata)
                  VALUES (?, ?, ?, ?, ?, ?)`);

            for (const row of mastraThreads) {
              const thread = row as Record<string, unknown>;
              insertThread.run(
                thread.id as string,
                (thread.title as string) || "",
                thread.resourceId as string,
                thread.createdAt as string,
                thread.updatedAt as string,
                thread.metadata as string
              );
            }
          }
        } catch (error) {
          console.warn("Failed to migrate threads:", error);
        }
      }

      // Migrate resources
      if (resourcesEmpty) {
        try {
          const mastraResources = db!
            .prepare(`SELECT * FROM mastra_resources`)
            .all();
          if (mastraResources.length > 0) {
            console.log(
              `Migrating ${mastraResources.length} resources from mastra_resources`
            );
            const insertResource = db!
              .prepare(`INSERT INTO resources (id, workingMemory, metadata, createdAt, updatedAt)
                  VALUES (?, ?, ?, ?, ?)`);

            for (const row of mastraResources) {
              const resource = row as Record<string, unknown>;
              insertResource.run(
                resource.id as string,
                resource.workingMemory as string,
                resource.metadata as string,
                resource.createdAt as string,
                resource.updatedAt as string
              );
            }
          }
        } catch (error) {
          console.warn("Failed to migrate resources:", error);
        }
      }

      // Migrate messages (this requires special handling for conversion)
      if (messagesEmpty) {
        migrateMessagesSync();
      }

      // Mark migration as completed
      db!
        .prepare(`UPDATE mastra_migration SET migrated = 1 WHERE id = 1`)
        .run();
      console.log("Migration completed successfully");
    });

    fullMigration();
  } catch (error) {
    console.warn("Migration from mastra tables failed:", error);
    // Ensure migration flag is not set if migration failed
    try {
      db.prepare(`UPDATE mastra_migration SET migrated = 0 WHERE id = 1`).run();
    } catch {}
  }
}

function migrateMessagesSync() {
  if (!db) return;

  try {
    const mastraMessages = db
      .prepare(`SELECT * FROM mastra_messages ORDER BY createdAt`)
      .all();
    if (mastraMessages.length === 0) {
      console.log("No mastra messages to migrate");
      return;
    }

    console.log(
      `Migrating ${mastraMessages.length} messages from mastra_messages`
    );

    // Convert mastra messages to our format
    const mastraMessageObjects: MastraMessageV2[] = (
      mastraMessages as Record<string, unknown>[]
    ).map((row) => ({
      id: row.id as string,
      threadId: (row.thread_id as string) || "",
      content: JSON.parse(row.content as string) as MastraMessageContentV2,
      role: row.role as "user" | "assistant" | "system",
      type: row.type as string,
      createdAt: new Date(row.createdAt as string),
      resourceId: row.resourceId as string,
    }));

    // Group messages by thread for conversion
    const messagesByThread = new Map<string, typeof mastraMessageObjects>();
    for (const msg of mastraMessageObjects) {
      if (!messagesByThread.has(msg.threadId!)) {
        messagesByThread.set(msg.threadId!, []);
      }
      messagesByThread.get(msg.threadId!)!.push(msg);
    }
    console.log("migration threads", messagesByThread.size);

    const insertMessage =
      db.prepare(`INSERT INTO messages (id, threadId, resourceId, role, content, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)`);

    // Convert and save messages for each thread
    for (const [threadId, threadMessages] of messagesByThread) {
      try {
        // Convert messages to UI format manually (since we removed mastra dependency)
        // @ts-expect-error no idea!
        const uiMessages: AssistantUIMessage[] = convertMessages(threadMessages)
          .to("AIV5.UI")
          .map((m) => ({
            ...m,
            metadata: {
              // @ts-expect-error it must be there
              createdAt: m.metadata!.createdAt.toISOString(),
              threadId: threadId,
              resourceId: USER_ID,
            },
          }));

        // Save each converted message
        for (const uiMessage of uiMessages) {
          insertMessage.run(
            uiMessage.id,
            threadId,
            uiMessage.metadata!.resourceId || "",
            uiMessage.role,
            JSON.stringify(uiMessage),
            uiMessage.metadata!.createdAt
          );
        }
      } catch (error) {
        console.warn(
          `Failed to migrate messages for thread ${threadId}:`,
          error
        );
      }
    }
  } catch (error) {
    console.warn("Failed to migrate messages:", error);
  }
}

export default getDatabase;
export { getDatabaseWithMigrationWait };
