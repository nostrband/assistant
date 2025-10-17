// import "server-only";
import { generateId, type UIMessage } from "ai";
import getDatabase from "./database";
import { getMessages } from "./memory-store";
import { AssistantUIMessage } from "@/ai/agent";

export type MyUIMessage = UIMessage<{ createdAt: Date }>;

// Create a new chat ID (but don't save to DB yet - only when first message is sent)
export async function createChatId(): Promise<string> {
  const id = generateId();
  // Don't write chats to db until first message is sent
  return id;
}

// Load all messages for a chat using our memory store
export async function loadChat(
  userId: string,
  id: string
): Promise<AssistantUIMessage[]> {
  try {
    const messages = await getMessages({ threadId: id, resourceId: userId, limit: 50 });
    
    // Merge consecutive reasoning parts into one part by appending all 'text' fields
    const processedMessages = messages.map(message => {
      const mergedParts = [];
      
      for (const part of message.parts) {
        if (part.type === 'reasoning') {
          const lastPart = mergedParts[mergedParts.length - 1];
          if (lastPart && lastPart.type === 'reasoning') {
            // Append text to last reasoning part
            lastPart.text += part.text || '';
            continue;
          }
        }

        // Add non-reasoning part as-is
        mergedParts.push(part);
      }
      
      return {
        ...message,
        parts: mergedParts
      };
    });
    
    return processedMessages;
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
  const stmt = db.prepare(`INSERT INTO chats (id, first_message_content, first_message_time, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`);
  
  stmt.run(chatId, firstMessageContent, now, now, now);
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
  const stmt = db.prepare(`UPDATE chats
        SET updated_at = ?
        WHERE id = ?`);
  
  const result = stmt.run(updatedAt.toISOString(), chatId);
  
  if (result.changes <= 0) throw new Error("Failed to update chat");
}

// Delete chat
export async function deleteChat(opts: {
  userId: string;
  chatId: string;
}): Promise<void> {
  const { chatId } = opts;
  const db = getDatabase();

  // Delete existing chat
  const stmt = db.prepare(`DELETE FROM chats
        WHERE id = ?`);
  
  const result = stmt.run(chatId);
  
  if (result.changes <= 0) throw new Error("Failed to delete chat");
}

// Mark chat as read by updating read_at timestamp
export async function readChat(userId: string, chatId: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`UPDATE chats SET read_at = ? WHERE id = ?`);
  stmt.run(now, chatId);
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
  const stmt = db.prepare(`SELECT
          id,
          updated_at,
          first_message_content as first_message,
          first_message_time,
          read_at
        FROM chats
        ORDER BY updated_at DESC
        LIMIT 100`);
  
  const results = stmt.all();

  return (results as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    updated_at: row.updated_at as string,
    first_message: row.first_message as string | null,
    first_message_time: row.first_message_time as string | null,
    read_at: row.read_at as string | null,
  }));
}
