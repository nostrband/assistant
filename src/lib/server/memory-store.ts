import { getDatabaseWithMigrationWait } from "./database";
import { AssistantUIMessage } from "@/ai/agent";

export type StorageThreadType = {
  id: string;
  title?: string;
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
};

export type StorageResourceType = {
  id: string;
  workingMemory?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// Thread operations
export async function saveThread(thread: StorageThreadType): Promise<void> {
  const db = await getDatabaseWithMigrationWait();

  const stmt =
    db.prepare(`INSERT OR REPLACE INTO threads (id, title, resourceId, createdAt, updatedAt, metadata)
        VALUES (?, ?, ?, ?, ?, ?)`);

  stmt.run(
    thread.id,
    thread.title || "",
    thread.resourceId,
    thread.createdAt.toISOString(),
    thread.updatedAt.toISOString(),
    JSON.stringify(thread.metadata || {})
  );
}

export async function getThread(
  threadId: string
): Promise<StorageThreadType | null> {
  const db = await getDatabaseWithMigrationWait();

  const stmt = db.prepare(`SELECT * FROM threads WHERE id = ?`);
  const result = stmt.get(threadId);

  if (!result) {
    return null;
  }

  const row = result as Record<string, unknown>;
  return {
    id: row.id as string,
    title: (row.title as string) || undefined,
    resourceId: row.resourceId as string,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

export async function listThreads(
  userId: string
): Promise<StorageThreadType[]> {
  const db = await getDatabaseWithMigrationWait();

  const stmt = db.prepare(
    `SELECT * FROM threads WHERE resourceId = ? ORDER BY updatedAt DESC`
  );
  const results = stmt.all(userId);

  return (results as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    title: (row.title as string) || undefined,
    resourceId: row.resourceId as string,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  }));
}

// Message operations
export async function saveMessages(
  messages: AssistantUIMessage[]
): Promise<void> {
  const db = await getDatabaseWithMigrationWait();

  const stmt =
    db.prepare(`INSERT OR REPLACE INTO messages (id, threadId, resourceId, role, content, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)`);

  for (const message of messages) {
    if (!message.metadata) throw new Error("Empty message metadata");
    const metadata = message.metadata;
    const threadId = metadata.threadId;
    const resourceId = metadata.resourceId;

    if (!threadId || !resourceId) {
      throw new Error("Message metadata must include threadId and resourceId");
    }

    stmt.run(
      message.id,
      threadId,
      resourceId,
      message.role,
      JSON.stringify(message),
      metadata.createdAt || new Date().toISOString()
    );
  }
}

export async function getMessages({
  threadId,
  resourceId,
  limit,
}: {
  threadId?: string;
  resourceId?: string;
  limit?: number;
}): Promise<AssistantUIMessage[]> {
  const db = await getDatabaseWithMigrationWait();

  let sql = `SELECT * FROM messages WHERE 1=1`;
  const args: (string | number)[] = [];

  if (threadId) {
    sql += ` AND threadId = ?`;
    args.push(threadId);
  }

  if (resourceId) {
    sql += ` AND resourceId = ?`;
    args.push(resourceId);
  }

  // A batch of latest messages
  sql += ` ORDER BY createdAt DESC`;

  if (limit) {
    sql += ` LIMIT ?`;
    args.push(limit);
  }

  const stmt = db.prepare(sql);
  const results = stmt.all(...args);

  return (results as Record<string, unknown>[])
    .filter((row) => !!row.content)
    .map((row) => {
      // Parse the full UIMessage from content field
      try {
        return JSON.parse(row.content as string) as AssistantUIMessage;
      } catch (e) {
        console.log("Bad message in db", row, e);
        return undefined;
      }
    })
    .filter((m) => !!m)
    .sort((a, b) =>
      // re-sort ASC
      a.metadata!.createdAt! < b.metadata!.createdAt!
        ? -1
        : a.metadata!.createdAt! > b.metadata!.createdAt!
        ? 1
        : 0
    );
}

// Resource operations
export async function saveResource(
  resource: StorageResourceType
): Promise<void> {
  const db = await getDatabaseWithMigrationWait();

  const stmt =
    db.prepare(`INSERT OR REPLACE INTO resources (id, workingMemory, metadata, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)`);

  stmt.run(
    resource.id,
    resource.workingMemory || "",
    JSON.stringify(resource.metadata || {}),
    resource.createdAt.toISOString(),
    resource.updatedAt.toISOString()
  );
}

export async function getResource(
  resourceId: string
): Promise<StorageResourceType | null> {
  const db = await getDatabaseWithMigrationWait();

  const stmt = db.prepare(`SELECT * FROM resources WHERE id = ?`);
  const result = stmt.get(resourceId);

  if (!result) {
    return null;
  }

  const row = result as Record<string, unknown>;
  return {
    id: row.id as string,
    workingMemory: (row.workingMemory as string) || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

// Set resource (full replace of working memory content)
export async function setResource(
  resourceId: string,
  workingMemory: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = await getDatabaseWithMigrationWait();

  const now = new Date();
  const stmt =
    db.prepare(`INSERT OR REPLACE INTO resources (id, workingMemory, metadata, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)`);

  stmt.run(
    resourceId,
    workingMemory,
    JSON.stringify(metadata || {}),
    now.toISOString(),
    now.toISOString()
  );
}

// Helper function to check if migration is complete
export async function isMigrationComplete(): Promise<boolean> {
  const db = await getDatabaseWithMigrationWait();

  try {
    const stmt = db.prepare(
      `SELECT migrated FROM mastra_migration WHERE id = 1`
    );
    const result = stmt.get();
    if (!result) {
      return false;
    }
    return (result as Record<string, unknown>).migrated === 1;
  } catch (error) {
    // If table doesn't exist or query fails, assume migration not complete
    return false;
  }
}

// Helper function to wait for migration completion
export async function waitForMigrationComplete(): Promise<void> {
  console.log("[migration] Waiting for migration to complete...");

  while (true) {
    if (await isMigrationComplete()) {
      console.log("[migration] Migration completed, proceeding...");
      return;
    }

    // Wait 1 second before checking again
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
