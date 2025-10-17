
import { EventEmitter } from "events";
import { USER_ID } from '../const';
import getDatabase from './database';
import { ChatMessageEvent, ChatMessageEventSchema } from '../events/types';

export type EventRow = {
  id: number;             // monotonically increasing
  type: string;           // event kind
  ts: string;             // ISO timestamp
  data: string;           // JSON string
  user_id: string;        // user identifier
};

// Global in-memory event bus
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bus: EventEmitter = ((global as any).__evbus as EventEmitter) ?? new EventEmitter();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(global as any).__evbus) (global as any).__evbus = bus;

export async function publish(type: string, payload: unknown): Promise<EventRow> {
  const ts = new Date().toISOString();
  const user_id = USER_ID; // Use the constant for now as specified
  const data = JSON.stringify(payload);
  
  const db = getDatabase();
  const stmt = db.prepare(`INSERT INTO events (type, ts, data, user_id) VALUES (?, ?, ?, ?)`);
  const result = stmt.run(type, ts, data, user_id);
  
  const id = Number(result.lastInsertRowid);
  const row: EventRow = { id, type, ts, data, user_id };
  
  // Emit immediately
  queueMicrotask(() => bus.emit(type, row));
  queueMicrotask(() => bus.emit("*", row));
  
  return row;
}

// Typed function for publishing chat messages
export async function publishChatMessage(payload: ChatMessageEvent): Promise<EventRow> {
  // Validate payload with Zod schema
  const validatedPayload = ChatMessageEventSchema.parse(payload);
  return publish("chat:message", validatedPayload);
}

export async function fetchSince(since: number, user_id: string, limit = 1000): Promise<EventRow[]> {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      SELECT id, type, ts, data, user_id
      FROM events
      WHERE id > ? AND user_id = ?
      ORDER BY id ASC
      LIMIT ?
    `);
    
    const results = stmt.all(since, user_id, limit);
    
    return (results as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id),
      type: String(row.type),
      ts: String(row.ts),
      data: String(row.data),
      user_id: String(row.user_id)
    }));
  } catch (error) {
    console.error("Error fetching events:", error);
    return [];
  }
}

export async function prune(keepLastN = 100_000): Promise<void> {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`DELETE FROM events WHERE id < (SELECT MAX(id) FROM events) - ?`);
    stmt.run(keepLastN);
  } catch (error) {
    console.error("Error pruning events:", error);
  }
}

// Helper function to emit events after transaction commit
export function emitEvent(row: EventRow): void {
  queueMicrotask(() => bus.emit(row.type, row));
  queueMicrotask(() => bus.emit("*", row));
}