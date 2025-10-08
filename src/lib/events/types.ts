import { z } from "zod";

// Zod schema for chat message events - very flexible to accept UIMessage structure
export const ChatMessageEventSchema = z.object({
  chatId: z.string(),
  messages: z.array(z.any()), // Accept any message structure for now
  timestamp: z.string(),
  source: z.string().optional(),
});

export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;

// Generic event payload schema
export const EventPayloadSchema = z.union([
  ChatMessageEventSchema,
  z.object({}).passthrough(), // Allow other event types
]);

export type EventPayload = z.infer<typeof EventPayloadSchema>;