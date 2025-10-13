import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { getNote } from "@/lib/server/note-store";

export const getNoteTool = createTool({
  id: "get-note",
  description: "Get a specific note by its ID, including full content. Returns the complete note data.",
  inputSchema: z.object({
    noteId: z.string().describe("The ID of the note to retrieve"),
  }),
  execute: async ({ context }) => {
    const { noteId } = context;

    try {
      // Get note from database
      const note = await getNote(USER_ID, noteId);
      if (!note) {
        return {
          success: false,
          error: "Note not found",
        };
      }

      return {
        success: true,
        note: note,
      };
    } catch (error) {
      console.error("Error getting note:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});