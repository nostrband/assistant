import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateId } from "ai";
import { convertMessages, type MastraMessageV2 } from "@mastra/core/agent";
import { USER_ID } from "@/lib/const";
import { saveChat } from "@/lib/chat-store";
import { assistantMemory } from "../memory";

const userId = USER_ID;

export const sendMessageTool = createTool({
  id: "send-message",
  description:
    "Send a message from the assistant to a chat. If chat_id is not provided, creates a new chat.",
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
      .nullable()
      .describe(
        "Optional chat ID. If not provided (null or undefined), a new chat will be created"
      ),
  }),
  execute: async ({ context }) => {
    const { content, chat_id } = context;

    // Get or create chat ID
    const chatId = chat_id || generateId();

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
    // console.log("send message", assistantMessage);

    try {
      if (chat_id) {
        const thread = await memory.getThreadById({
          threadId: chat_id,
        });
        if (!thread || thread.resourceId !== userId)
          throw new Error("No such thread");

        await memory.saveThread({
          thread: {
            ...thread,
            updatedAt: assistantMessage.createdAt,
          },
        });
      } else {
        await memory.saveThread({
          thread: {
            id: chatId,
            createdAt: assistantMessage.createdAt,
            resourceId: userId,
            updatedAt: assistantMessage.createdAt,
            title: ""
          },
        });
      }

      // Save message to memory using the correct format
      await memory.saveMessages({
        messages: [assistantMessage],
        format: "v2",
      });

      // Convert to UIMessage format for saveChat
      const uiMessage = convertMessages([assistantMessage]).to("AIV5.UI")[0];
      console.log("send_message", uiMessage);

      // Update chat metadata in database
      await saveChat({
        chatId,
        messages: [uiMessage],
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
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
