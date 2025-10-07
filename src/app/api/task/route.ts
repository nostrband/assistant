import { NextRequest, NextResponse } from "next/server";
import { generateId } from "ai";
import { mastra } from "@/mastra";
import { getTask, finishTask, setTask } from "@/lib/task-store";
import { USER_ID } from "@/lib/const";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { beginTransaction } from "@/lib/database";

const assistantAgent = mastra.getAgent("assistantAgent");
const userId = USER_ID; // FIXME from auth info

export async function POST(req: NextRequest) {
  try {
    const { timestamp }: { timestamp: number } = await req.json();

    if (!timestamp) {
      console.error("Task API error:", "Timestamp is required");
      return new Response("Timestamp is required", { status: 400 });
    }

    // Get task info by timestamp and USER_ID
    const task = await getTask(userId, timestamp);

    if (!task) {
      console.error(
        "Task API error:",
        `Task not found for user ${userId} at timestamp ${timestamp}`
      );
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

    // Begin transaction before calling agent
    const transaction = await beginTransaction();

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

      // Take response.text and write to task's 'status' field
      const responseText = result.text || "Task completed";

      await finishTask(userId, timestamp, threadId, responseText, "");

      // Commit transaction after successful completion
      await transaction.commit();

      return NextResponse.json({
        success: true,
        status: responseText,
        threadId: threadId,
      });
    } catch (error) {
      console.error("Task processing error:", error);

      // Rollback transaction
      await transaction.rollback();

      // On exception write the error text into task using finishTask with status="error"
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Mark task as finished with error
      await finishTask(userId, timestamp, threadId, "error", errorMessage);

      // Re-schedule the same task in 1 minute from now
      const retryTimestamp = Math.floor(Date.now() / 1000) + 60; // Current time + 60 seconds
      await setTask(userId, retryTimestamp, task.task);
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
