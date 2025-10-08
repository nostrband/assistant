import { NextRequest, NextResponse } from "next/server";
import { generateId } from "ai";
import { mastra } from "@/mastra";
import { getTask, finishTask, addTask } from "@/lib/server/task-store";
import { USER_ID } from "@/lib/const";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { run2PC } from "@/mastra/tool2pc";

const assistantAgent = mastra.getAgent("assistantAgent");
const userId = USER_ID; // FIXME from auth info

export async function POST(req: NextRequest) {
  try {
    const { id }: { id: string } = await req.json();

    if (!id) {
      console.error("Task API error:", "ID is required");
      return new Response("ID is required", { status: 400 });
    }

    // Get task info by timestamp and USER_ID
    const task = await getTask(userId, id);

    if (!task) {
      console.error("Task API error:", `Task not found id ${id}`);
      return new Response("Task not found", { status: 404 });
    }

    if (task.status !== "") {
      console.error(
        "Task API error:",
        `Task already processed with status: ${task.status}`
      );
      return new Response("Task already processed", { status: 400 });
    }

    // Generate unique thread-id for memory
    const threadId = generateId();

    const runtimeContext = new RuntimeContext<{ mode: string }>();
    runtimeContext.set("mode", "task");

    try {
      // Use task.task as input message to the assistantAgent
      const result = await assistantAgent.generate(
        [
          {
            role: "user",
            content: task.task,
          },
        ],
        {
          runtimeContext,
          memory: {
            thread: threadId,
            resource: userId,
          },
        }
      );

      // If all ok - try to apply changes made by tools
      await run2PC(runtimeContext);

      // Take response.text and write to task's 'status' field
      const responseText = result.text || "Task completed";

      await finishTask(userId, id, threadId, responseText, "");

      return NextResponse.json({
        success: true,
        status: responseText,
        threadId: threadId,
      });
    } catch (error) {
      console.error("Task processing error:", error);

      // On exception write the error text into task using finishTask with status="error"
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Mark task as finished with error
      await finishTask(userId, id, threadId, "error", errorMessage);

      // Re-schedule the same task in 1 minute from now (outside transaction)
      const retryTimestamp = Math.floor(Date.now() / 1000) + 60; // Current time + 60 seconds
      await addTask(userId, retryTimestamp, task.task);
      console.log(
        `Re-scheduled task for user ${userId} at timestamp ${retryTimestamp}`
      );

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          threadId: threadId,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Task API error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
