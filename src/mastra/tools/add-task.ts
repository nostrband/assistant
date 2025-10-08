import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { addTask } from "@/lib/server/task-store";
import { setTool2PC } from "../tool2pc";

export const addTaskTool = createTool({
  id: "add-task",
  description: `Add a task for yourself (the assistant) for background processing on a specific date-time.
On specified date-time, you (the assistant) will be launched again, with the task description as input.
This way you can schedule tasks for yourself to be executed in the background at an appropriate time, to call necessary
tools, do research, send messages to the user, etc. I.e. to set a task to remind user about something,
add a task on the proper date-time and set task description to be "use send-message tool to remind user to do X".
NOTE: Always check current time before adding a task, do not rely on timestamps mentioned in message history or documents.
`,
  inputSchema: z.object({
    datetime: z
      .string()
      .describe(
        "Date and time when the task should be executed (ISO 8601 format, e.g., '2025-10-06T14:30:00Z' or '2025-10-06 14:30')"
      ),
    task: z
      .string()
      .describe(
        "Description of the task, will be passed back to you (the assistant)."
      ),
  }),
  execute: async ({ context, runtimeContext }) => {
    const { datetime, task } = context;

    try {
      // Convert datetime string to timestamp
      const date = new Date(datetime);

      // Validate the date
      if (isNaN(date.getTime()))
        throw new Error(
          "Invalid datetime format. Please use ISO 8601 format (e.g., '2025-10-06T14:30:00Z' or '2025-10-06 14:30')"
        );

      const timestamp = Math.floor(date.getTime() / 1000); // Convert to Unix timestamp

      // Set 2-phase-commit protocol to apply or revert these changes
      setTool2PC({
        runtimeContext,
        tryCommit: async () => {
          console.log("try commit add task");
        },
        rollback: async () => {
          console.log("rollback add task");
        },
        commit: async () => {
          console.log("commit add task");
          // addTask always succeeds, so no need to tryCommit
          await addTask(USER_ID, timestamp, task);
        },
      });

      return {
        success: true,
        message: "Task set successfully",
        task: {
          user_id: USER_ID,
          datetime,
          timestamp,
          task,
        },
      };
    } catch (error) {
      console.error("Error setting task:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
