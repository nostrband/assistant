import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listTasksWithOptions } from "@/lib/task-store";

export const listTasksTool = createTool({
  id: "list-tasks",
  description: `List up to 100 most recent tasks. By default, returns only active tasks (status === '').
Use this tool to see what tasks are scheduled or have been completed.`,
  inputSchema: z.object({
    include_finished: z.boolean().nullable().describe("If true, include all tasks regardless of status. If false or omitted, only return active tasks (status === '')"),
    until: z.string().nullable().describe("Maximum datetime of tasks to return (ISO 8601 format, e.g., '2025-10-06T14:30:00Z'). Useful for paginating back in time through tasks"),
  }),
  execute: async ({ context }) => {
    const { include_finished = false, until } = context;
    
    try {
      // Convert ISO string to Unix timestamp if until is provided
      let untilTimestamp: number | undefined;
      if (until) {
        const date = new Date(until);
        if (isNaN(date.getTime())) {
          return {
            success: false,
            error: "Invalid datetime format for 'until' parameter. Please use ISO 8601 format (e.g., '2025-10-06T14:30:00Z')",
            tasks: [],
            total_count: 0,
          };
        }
        untilTimestamp = Math.floor(date.getTime() / 1000);
      }
      
      const tasks = await listTasksWithOptions(!!include_finished, untilTimestamp);
      
      return {
        success: true,
        tasks: tasks.map(task => ({
          id: task.id,
          user_id: task.user_id,
          timestamp: task.timestamp,
          datetime: new Date(task.timestamp * 1000).toISOString(), // Convert Unix timestamp to ISO string for readability
          task: task.task,
          status: task.status,
          thread_id: task.thread_id,
          error: task.error,
        })),
        total_count: tasks.length,
        filters: {
          include_finished,
          until,
        },
      };
    } catch (error) {
      console.error("Error listing tasks:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        tasks: [],
        total_count: 0,
      };
    }
  },
});