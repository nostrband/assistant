import { NextRequest, NextResponse } from "next/server";
import { type UIMessage } from "ai";
import { mastra } from "@/mastra";
import { convertMessages, UIMessageWithMetadata } from "@mastra/core/agent";
import { createChat, updateChat } from "@/lib/server/chat-store";
import { USER_ID } from "@/lib/const";
import { CoreMessage } from "@mastra/core";
import { assistantMemory } from "@/mastra/memory";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { publishChatMessage } from "@/lib/server/events";
import { addCreatedAt } from "@/lib/utils";

const assistantAgent = mastra.getAgent("assistantAgent");
const userId = USER_ID; // FIXME from auth info

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    console.error("Chat API error:", "Specify chat id");
    return new Response("Specify chat id", { status: 400 });
  }

  const memory = assistantMemory;
  try {
    const result = await memory.query({
      threadId: id,
      resourceId: userId,
    });

    const messages = convertMessages(result?.uiMessages || []).to("AIV5.UI");
    return NextResponse.json(messages);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      message,
      id,
      regenerate,
    }: { message: UIMessage; id: string; regenerate?: boolean } =
      await req.json();
    console.log("process message", { regenerate, message });

    const memory = assistantMemory;

    let result:
      | {
          messages: CoreMessage[];
          uiMessages: UIMessageWithMetadata[];
        }
      | undefined;
    try {
      result = await memory.query({
        threadId: id,
        resourceId: userId,
      });
    } catch {}

    const originalMessages = convertMessages(result?.uiMessages || [])
      .to("AIV5.UI")
      .filter((m) => !regenerate || m.id !== message.id);

    const runtimeContext = new RuntimeContext<{ mode: string }>();
    runtimeContext.set("mode", "user");

    try {
      const now = new Date();

      // Make user's message visible
      if (!originalMessages.length) {
        await createChat({
          userId: USER_ID,
          chatId: id,
          // user's message
          message,
        });
      } else {
        await updateChat({
          userId: USER_ID,
          chatId: id,
          updatedAt: now,
        });
      }

      // Publish chat message event
      await publishChatMessage({
        chatId: id,
        messages: addCreatedAt([message]),
        timestamp: now.toISOString(),
      });

      // Use streamVNext with AI SDK v5 format (experimental)
      const stream = await assistantAgent.stream([message], {
        format: "aisdk", // Enable AI SDK v5 compatibility
        runtimeContext,
        memory: {
          thread: id,
          resource: userId,
        },
        maxSteps: 10,
      });

      // console.log("Message", JSON.stringify(messages, null, 2));
      // console.log("Trace ID:", stream.traceId);
      // console.log("View trace at: http://localhost:3000/traces/" + stream.traceId);

      // Stream is already in AI SDK v5 format
      return stream.toUIMessageStreamResponse({
        originalMessages,
        onFinish: async ({ messages }) => {
          try {
            // Publish agent's messages event
            await publishChatMessage({
              chatId: id,
              messages: addCreatedAt(messages),
              timestamp: new Date().toISOString(),
            });
          } catch (error) {
            console.error("Error in onFinish callback:", error);
            throw new Error("Internal Server Error");
          }
        },
      });
    } catch (error) {
      console.error("Error during agent stream:", error);
      throw error;
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
