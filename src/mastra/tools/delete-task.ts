import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { deleteTaskById } from "@/lib/task-store";

export const deleteTaskTool = createTool({
  id: "delete-task",
  description: "Delete a task by its ID. Returns an error if the task doesn't exist.",
  inputSchema: z.object({
    id: z.string().describe("The ID of the task to delete"),
  }),
  execute: async ({ context }) => {
    const { id } = context;
    
    try {
      const wasDeleted = await deleteTaskById(id, USER_ID);
      
      if (!wasDeleted) {
        return {
          success: false,
          error: `Task with ID '${id}' not found`,
        };
      }
      
      return {
        success: true,
        message: `Task with ID '${id}' has been deleted successfully`,
        deleted_task_id: id,
      };
    } catch (error) {
      console.error("Error deleting task:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred while deleting task",
      };
    }
  },
});