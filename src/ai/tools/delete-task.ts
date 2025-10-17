import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { deleteTask, getTask } from "@/lib/server/task-store";
import { tool } from "ai";

export const deleteTaskTool = tool({
  description:
    "Delete a task by its ID. Returns an error if the task doesn't exist.",
  inputSchema: z.object({
    id: z.string().describe("The ID of the task to delete"),
  }),
  execute: async (context) => {
    const { id } = context;

    try {
      // Check if task exists in database
      const task = await getTask(USER_ID, id);
      if (!task) {
        return {
          success: false,
          error: "Task not found",
        };
      }

      // Delete the task directly from the database
      await deleteTask(USER_ID, id);

      return {
        success: true,
        message: `Task with ID '${id}' has been deleted successfully`,
        deleted_task_id: id,
      };
    } catch (error) {
      console.error("Error deleting task:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
