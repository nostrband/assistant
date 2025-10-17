import { z } from "zod";
import { generateId, tool } from "ai";
import { USER_ID } from "@/lib/const";
import {
  createChat,
  createChatId,
  updateChat,
} from "@/lib/server/chat-store";
import { publishChatMessage } from "@/lib/server/events";
import { getThread, saveThread, saveMessages, StorageThreadType } from "@/lib/server/memory-store";
import { AssistantUIMessage } from "@/ai/agent";

const userId = USER_ID;

export const sendMessageTool = tool({
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
  execute: async (context) => {
    const { content, chat_id } = context;

    try {
      // Get or create chat ID
      const chatId = chat_id || (await createChatId());

      // Create assistant message in UI format
      const now = new Date();
      const parts = typeof content === "string"
        ? [{ type: "text" as const, text: content }]
        : content.map(part => {
            if (part.type === "file") {
              return {
                type: "file" as const,
                mediaType: part.mimeType,
                url: part.data,
              };
            }
            return {
              type: "text" as const,
              text: part.text,
            };
          });

      const uiMessage: AssistantUIMessage = {
        id: generateId(),
        role: "assistant",
        parts,
        metadata: {
          createdAt: now.toISOString(),
          threadId: chatId,
          resourceId: userId,
        },
      };

      console.log("send_message", uiMessage);

      // Get thread we're writing to
      let thread: StorageThreadType | null = null;
      if (chat_id) {
        thread = await getThread(chat_id);
        if (!thread || thread.resourceId !== userId)
          throw new Error("No such thread");
      }

      // Save directly to database and memory
      if (thread) {
        await saveThread({
          ...thread,
          updatedAt: now,
        });

        await updateChat({
          userId: USER_ID,
          chatId,
          updatedAt: now,
        });
      } else {
        await saveThread({
          id: chatId,
          createdAt: now,
          resourceId: userId,
          updatedAt: now,
          title: "",
        });

        await createChat({
          userId: USER_ID,
          chatId,
          message: uiMessage,
        });
      }

      // Save message to memory
      await saveMessages([uiMessage]);

      // Publish event for real-time notifications
      await publishChatMessage({
        chatId,
        messages: [uiMessage],
        timestamp: now.toISOString(),
        source: "send-message-tool",
      });

      return {
        success: true,
        chat_id: chatId,
        message_id: uiMessage.id,
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
