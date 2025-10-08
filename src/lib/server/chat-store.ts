// import "server-only";
import { generateId, type UIMessage } from "ai";
import getDatabase from "./database";
import { convertMessages } from "@mastra/core/agent";
import { assistantMemory } from "@/mastra/memory";

export type MyUIMessage = UIMessage<{ createdAt: Date }>;

// Create a new chat ID (but don't save to DB yet - only when first message is sent)
export async function createChatId(): Promise<string> {
  const id = generateId();
  // Don't write chats to db until first message is sent
  return id;
}

// Load all messages for a chat using Mastra memory
export async function loadChat(
  userId: string,
  id: string
): Promise<MyUIMessage[]> {
  const memory = assistantMemory;

  try {
    const result = await memory.query({
      threadId: id,
      resourceId: userId,
    });

    const messages = convertMessages(result?.uiMessages || []).to("AIV5.UI") as MyUIMessage[];
    return messages;
  } catch {
    return [];
  }
}

// Save chat info when messages are sent (creates/updates chat entry)
export async function createChat(opts: {
  userId: string;
  chatId: string;
  message: UIMessage;
}): Promise<void> {
  const { chatId, message: firstMessage } = opts;
  const db = getDatabase();

  if (!firstMessage) return;

  const firstMessageContent = firstMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  // Create new chat with first message info
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO chats (id, first_message_content, first_message_time, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [chatId, firstMessageContent, now, now, now],
  });
}

// Update chat info when new messages are sent
export async function updateChat(opts: {
  userId: string;
  chatId: string;
  updatedAt: Date;
}): Promise<void> {
  const { chatId, updatedAt } = opts;
  const db = getDatabase();

  // Update existing chat
  const r = await db.execute({
    sql: `UPDATE chats
          SET updated_at = ?
          WHERE id = ?`,
    args: [updatedAt.toISOString(), chatId],
  });
  if (r.rowsAffected <= 0) throw new Error("Failed to update chat");
}

// Delete chat
export async function deleteChat(opts: {
  userId: string;
  chatId: string;
}): Promise<void> {
  const { chatId } = opts;
  const db = getDatabase();

  // Delete existing chat
  const r = await db.execute({
    sql: `DELETE FROM chats
          WHERE id = ?`,
    args: [chatId],
  });
  if (r.rowsAffected <= 0) throw new Error("Failed to delete chat");
}

// Mark chat as read by updating read_at timestamp
export async function readChat(userId: string, chatId: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.execute({
    sql: `UPDATE chats SET read_at = ? WHERE id = ?`,
    args: [now, chatId],
  });
}

// Get all chats for sidebar - now reads directly from chats table
export async function getAllChats(): Promise<
  Array<{
    id: string;
    updated_at: string;
    first_message: string | null;
    first_message_time: string | null;
    read_at: string | null;
  }>
> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT
            id,
            updated_at,
            first_message_content as first_message,
            first_message_time,
            read_at
          FROM chats
          ORDER BY updated_at DESC
          LIMIT 100`,
    args: [],
  });

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    updated_at: row.updated_at as string,
    first_message: row.first_message as string | null,
    first_message_time: row.first_message_time as string | null,
    read_at: row.read_at as string | null,
  }));
}
