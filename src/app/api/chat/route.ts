import { NextRequest, NextResponse } from "next/server";
import { type UIMessage } from "ai";
import { mastra } from "@/mastra";
import { convertMessages, UIMessageWithMetadata } from "@mastra/core/agent";
import { saveChat } from "@/lib/chat-store";
import { USER_ID } from "@/lib/const";
import { CoreMessage } from "@mastra/core";

const assistantAgent = mastra.getAgent("assistantAgent");
const userId = USER_ID; // FIXME from auth info

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    console.error("Chat API error:", "Specify chat id");
    return new Response("Specify chat id", { status: 400 });
  }

  const memory = await assistantAgent.getMemory();
  if (!memory) {
    console.error("Chat API error:", "No memory");
    return new Response("Internal Server Error", { status: 500 });
  }
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
    const { message, id }: { message: UIMessage; id: string } =
      await req.json();

    const memory = await assistantAgent.getMemory();
    if (!memory) throw new Error("No memory");

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

    const messages = convertMessages(result?.uiMessages || []).to("AIV5.UI");
    messages.push(message);

    // Use streamVNext with AI SDK v5 format (experimental)
    const stream = await assistantAgent.stream(messages, {
      format: "aisdk", // Enable AI SDK v5 compatibility
      memory: {
        thread: id,
        resource: userId,
      },
    });

    // Stream is already in AI SDK v5 format
    return stream.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: ({ messages: newMessages }) => {
        saveChat({ chatId: id, messages: [...messages, ...newMessages] });
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
