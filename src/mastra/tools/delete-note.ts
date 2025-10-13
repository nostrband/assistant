import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { USER_ID } from "@/lib/const";
import { getNote, deleteNote } from "@/lib/server/note-store";

export const deleteNoteTool = createTool({
  id: "delete-note",
  description: "Delete a note by its ID. Returns an error if the note doesn't exist.",
  inputSchema: z.object({
    noteId: z.string().describe("The ID of the note to delete"),
  }),
  execute: async ({ context }) => {
    const { noteId } = context;

    try {
      // Check if note exists in database
      const note = await getNote(USER_ID, noteId);
      if (!note) {
        return {
          success: false,
          error: "Note not found",
        };
      }

      // Delete the note directly from the database
      await deleteNote(USER_ID, noteId);

      return {
        success: true,
        message: `Note with ID '${noteId}' has been deleted successfully`,
        deleted_note_id: noteId,
      };
    } catch (error) {
      console.error("Error deleting note:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});