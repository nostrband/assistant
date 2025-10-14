import { NextRequest, NextResponse } from "next/server";
import { generateId } from "ai";
import { mastra } from "@/mastra";
import {
  getTask,
  finishTask,
  addTask,
  updateTask,
  getNextMidnightTimestamp,
} from "@/lib/server/task-store";
import { USER_ID, TASK_TYPE_PLANNER } from "@/lib/const";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { createPlannerTaskPrompt } from "@/lib/utils";
import { AGENT_MODE } from "@/mastra/instructions";
import { Cron } from "croner";

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

    if (task.reply !== "") {
      console.error(
        "Task API error:",
        `Task already processed with reply: ${task.reply}`
      );
      return new Response("Task already processed", { status: 400 });
    }

    // Use existing thread_id from database if available, otherwise generate new one
    const threadId = task.thread_id || generateId();

    const runtimeContext = new RuntimeContext<{ mode: string }>();
    // Set mode based on task type
    const mode: AGENT_MODE =
      task.type === TASK_TYPE_PLANNER ? "planner" : "task";
    runtimeContext.set("mode", mode);

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
          maxSteps: 50,
        }
      );

      // Take response.text and write to task's 'reply' field
      const responseText = result.text || "Task completed";

      // If this was a successful planner task, schedule the next one for midnight
      if (task.type === TASK_TYPE_PLANNER) {
        const nextMidnightTimestamp = getNextMidnightTimestamp();
        await addTask(
          generateId(),
          userId,
          nextMidnightTimestamp,
          createPlannerTaskPrompt(),
          TASK_TYPE_PLANNER
        );
        console.log(
          `[task] Scheduled next planner task for midnight: ${new Date(
            nextMidnightTimestamp * 1000
          ).toISOString()}`
        );
      }

      if (task.cron) {
        const job = new Cron(task.cron);
        const nextRun = job.nextRun();
        if (!nextRun) throw new Error("Invalid cron schedule");

        const timestamp = Math.floor(nextRun.getTime() / 1000);
        // Update the current task with the next run timestamp
        await updateTask({
          ...task,
          timestamp,
          reply: responseText, // Reset reply for next run
          state: "", // Reset state for next run
          error: "", // Clear any previous errors
        });
        console.log(
          `[task] Updated cron task ${id} for next run at: ${new Date(
            timestamp * 1000
          ).toISOString()}`
        );
      } else {
        // Single-shot task finished
        await finishTask(userId, id, threadId, responseText, "");
      }

      return NextResponse.json({
        success: true,
        reply: responseText,
        threadId: threadId,
      });
    } catch (error) {
      console.error("Task processing error:", error);

      // On exception, update the task with error and retry timestamp instead of finish+add
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Re-schedule the same task with different retry intervals based on type
      const retryDelaySeconds = task.type === TASK_TYPE_PLANNER ? 600 : 60; // 10 minutes for planner, 1 minute for others
      const retryTimestamp = Math.floor(Date.now() / 1000) + retryDelaySeconds;

      // Update the current task instead of finishing and adding a new one
      await updateTask({
        ...task,
        timestamp: retryTimestamp,
        reply: "", // Keep reply empty so it can be retried
        state: "", // Keep state empty so it can be retried
        error: errorMessage, // Set the error message
        thread_id: threadId, // Update thread_id if it was generated
      });

      console.log(
        `Updated ${
          task.type || "regular"
        } task ${id} for retry at timestamp ${retryTimestamp} (retry in ${retryDelaySeconds} seconds) with error: ${errorMessage}`
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
