import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { assistantMemory } from "../memory";

export const patchWorkingMemoryTool = createTool({
  id: "patch-working-memory",
  description: `Search and replace a string in the working memory. Useful to efficiently update parts of working memory without risking to overwrite the whole memory. 
Works well with multi-line strings and strings with markdown formatting - just pass the whole section to be replaced as 'search' param.
Prefer this tool over 'updateWorkingMemory' - that one is expensive, and overwrites the entire memory (risk loosing important info).
Fails if the search string is not found exactly once - to ensure correct search string is passed as input.
`,
  inputSchema: z.object({
    search: z
      .string()
      .min(1)
      .describe("The exact string to search for in the working memory"),
    replace: z
      .string()
      .describe("The string to replace the search string with"),
  }),
  execute: async ({ context }) => {
    const { search, replace } = context;

    try {
      // Get current working memory content
      const currentMemory = await assistantMemory.getWorkingMemory({
        resourceId: USER_ID,
        threadId: ""
      });

      if (!currentMemory) {
        return {
          success: false,
          error: "No working memory found for user",
        };
      }

      // Count occurrences of the search string using split method
      // This avoids regex escaping issues with special characters like **
      const parts = currentMemory.split(search);
      const occurrences = parts.length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          error: `Search string "${search}" not found in working memory`,
        };
      }

      if (occurrences > 1) {
        return {
          success: false,
          error: `Search string "${search}" found ${occurrences} times in working memory. Expected exactly 1 occurrence.`,
        };
      }

      // Replace the string
      const updatedMemory = currentMemory.replace(search, replace);

      // Update working memory
      await assistantMemory.updateWorkingMemory({
        resourceId: USER_ID,
        threadId: "",
        workingMemory: updatedMemory,
      });

      return {
        success: true,
        message: "Working memory updated successfully",
      };
    } catch (error) {
      console.error("Error patching working memory:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});
