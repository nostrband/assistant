import "server-only";
import { generateId, type UIMessage } from "ai";
import getDatabase from "./database";
import { convertMessages } from "@mastra/core/agent";
import { USER_ID } from "./const";
import { assistantMemory } from "@/mastra/memory";

const userId = USER_ID;

// Create a new chat ID (but don't save to DB yet - only when first message is sent)
export async function createChat(): Promise<string> {
  const id = generateId();
  // Don't write chats to db until first message is sent
  return id;
}

// Load all messages for a chat using Mastra memory
export async function loadChat(id: string): Promise<UIMessage[]> {
  const memory = assistantMemory;

  try {
    const result = await memory.query({
      threadId: id,
      resourceId: userId,
    });

    const messages = convertMessages(result?.uiMessages || []).to("AIV5.UI");
    return messages;
  } catch {
    return [];
  }
}

// Save chat info when messages are sent (creates/updates chat entry)
export async function saveChat(opts: {
  chatId: string;
  messages: UIMessage[];
}): Promise<void> {
  const { chatId, messages } = opts;
  const db = getDatabase();

  if (messages.length === 0) return;

  // Find the first user message for chat title and timestamp
  const firstUserMessage = messages.find((msg) => msg.role === "user");

  if (!firstUserMessage) return;

  const firstMessageContent = firstUserMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  // Check if chat already exists
  const existingChat = db
    .prepare("SELECT id FROM chats WHERE id = ?")
    .get(chatId);

  if (existingChat) {
    // Update existing chat
    const updateStmt = db.prepare(`
      UPDATE chats 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    updateStmt.run(chatId);
  } else {
    // Create new chat with first message info
    const insertStmt = db.prepare(`
      INSERT INTO chats (id, first_message_content, first_message_time, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    insertStmt.run(chatId, firstMessageContent);
  }
}

// Get all chats for sidebar - now reads directly from chats table
export async function getAllChats(): Promise<
  Array<{
    id: string;
    updated_at: string;
    first_message: string | null;
    first_message_time: string | null;
  }>
> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT 
      id,
      updated_at,
      first_message_content as first_message,
      first_message_time
    FROM chats
    ORDER BY updated_at DESC
    LIMIT 50
  `);

  return stmt.all() as Array<{
    id: string;
    updated_at: string;
    first_message: string | null;
    first_message_time: string | null;
  }>;
}
