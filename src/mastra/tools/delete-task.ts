import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { deleteTask, getTask, undeleteTask } from "@/lib/server/task-store";
import { setTool2PC } from "../tool2pc";

export const deleteTaskTool = createTool({
  id: "delete-task",
  description:
    "Delete a task by its ID. Returns an error if the task doesn't exist.",
  inputSchema: z.object({
    id: z.string().describe("The ID of the task to delete"),
  }),
  execute: async ({ context, runtimeContext }) => {
    const { id } = context;

    try {
      // Check that it exists first
      await getTask(USER_ID, id);

      // Set 2-phase-commit protocol to apply or revert these changes
      setTool2PC({
        runtimeContext,
        tryCommit: async () => {
          console.log("try commit delete task");
          await deleteTask(USER_ID, id);
        },
        rollback: async () => {
          console.log("rollback delete task");
          await undeleteTask(USER_ID, id);
        },
        commit: async () => {
          console.log("commit delete task");
        },
      });

      return {
        success: true,
        message: `Task with ID '${id}' has been deleted successfully`,
        deleted_task_id: id,
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
