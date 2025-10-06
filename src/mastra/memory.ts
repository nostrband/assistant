import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";

// Configure memory with LibSQL storage
export const assistantMemory = new Memory({
  embedder: fastembed,
  storage: new LibSQLStore({
    url: process.env.DATA_PATH 
      ? `file:${process.env.DATA_PATH}/memory.db`
      : "file:memory.db", // Store in DATA_PATH if set, otherwise project root
  }),
  // this is the default vector db if omitted
  vector: new LibSQLVector({
    connectionUrl: process.env.DATA_PATH
      ? `file:${process.env.DATA_PATH}/vector.db`
      : "file:vector.db", // Store in DATA_PATH if set, otherwise project root
  }),
  options: {
    semanticRecall: {
      topK: 3, // Retrieve 3 most similar messages
      messageRange: 2, // Include 2 messages before and after each match
      scope: "resource", // Search across all threads for this user
    },
    workingMemory: {
      enabled: true,
      scope: "resource", // Memory persists across all user threads
      template: `# User Profile
- **Name**:
- **Location**:
- **Preferred Tone**:
- **Schedule**:
- **Interests**:
- **Preferences**:
- **Long-term Goals**:
- **Projects**:
- **Challenges**:
- **Reminders**:
`,
    },
  },
});
