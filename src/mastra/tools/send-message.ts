import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateId } from "ai";
import { convertMessages, type MastraMessageV2 } from "@mastra/core/agent";
import { USER_ID } from "@/lib/const";
import {
  createChat,
  createChatId,
  updateChat,
} from "@/lib/server/chat-store";
import { assistantMemory } from "../memory";
import { publishChatMessage } from "@/lib/server/events";
import { StorageThreadType } from "@mastra/core";

const userId = USER_ID;

export const sendMessageTool = createTool({
  id: "send-message",
  description:
    "Send a message to the user. Prefer chat_id 'main' for all communications, unless you're sure a different chat_id is needed. ",
  inputSchema: z.object({
    content: z
      .union([
        z.string(),
        z.array(
          z.object({
            type: z.literal("text"),
            text: z.string().describe("Textual content, plaintext or markdown"),
          })
        ),
        z.array(
          z.object({
            type: z.literal("file"),
            data: z.string().describe("URL or data-url format"),
            mimeType: z.string().describe("MIME type of the data"),
          })
        ),
      ])
      .describe("The assistant message content to send"),
    chat_id: z
      .string()
      .describe(
        "Required chat ID"
      ),
  }),
  execute: async ({ context }) => {
    const { content, chat_id } = context;

    try {
      // Get or create chat ID
      const chatId = chat_id || (await createChatId());

      // Get memory instance
      const memory = assistantMemory;

      // Create assistant message in MastraMessageV2 format
      const assistantMessage: MastraMessageV2 = {
        id: generateId(),
        role: "assistant",
        createdAt: new Date(),
        threadId: chatId,
        resourceId: userId,
        content: {
          format: 2,
          parts:
            typeof content === "string"
              ? [{ type: "text", text: content }]
              : content,
        },
      };

      // Convert to UIMessage format for saveChat
      const uiMessage = convertMessages([assistantMessage]).to("AIV5.UI")[0];
      console.log("send_message", uiMessage);

      // Get thread we're writing to
      let thread: StorageThreadType | null = null;
      if (chat_id) {
        thread = await memory.getThreadById({
          threadId: chat_id,
        });
        if (!thread || thread.resourceId !== userId)
          throw new Error("No such thread");
      }

      // Save directly to database and memory
      if (thread) {
        await memory.saveThread({
          thread: {
            ...thread,
            updatedAt: assistantMessage.createdAt,
          },
        });

        await updateChat({
          userId: USER_ID,
          chatId,
          updatedAt: assistantMessage.createdAt,
        });
      } else {
        await memory.saveThread({
          thread: {
            id: chatId,
            createdAt: assistantMessage.createdAt,
            resourceId: userId,
            updatedAt: assistantMessage.createdAt,
            title: "",
          },
        });

        await createChat({
          userId: USER_ID,
          chatId,
          message: uiMessage,
        });
      }

      // Save message to memory using the correct format
      await memory.saveMessages({
        messages: [assistantMessage],
        format: "v2",
      });

      // Publish event for real-time notifications
      await publishChatMessage({
        chatId,
        messages: [uiMessage],
        timestamp: assistantMessage.createdAt.toISOString(),
        source: "send-message-tool",
      });

      return {
        success: true,
        chat_id: chatId,
        message_id: assistantMessage.id,
        message: "Message sent successfully",
      };
    } catch (error) {
      console.error("Error sending message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
