import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { TokenLimiter } from "@mastra/memory/processors";
import getDatabase from "@/lib/server/database";

// Configure memory with LibSQL storage
export const assistantMemory = new Memory({
  storage: new LibSQLStore({
    client: getDatabase(),
  }),
  // vector search is shit
  // vector: new LibSQLVector({
  //   connectionUrl: process.env.DATA_PATH
  //     ? `file:${process.env.DATA_PATH}/vector.db`
  //     : "file:vector.db", // Store in DATA_PATH if set, otherwise project root
  // }),
  processors: [
    // Ensure the total tokens from memory don't exceed ~100k
    new TokenLimiter(100000),
  ],
  options: {
    lastMessages: 100,
    // semanticRecall: {
    //   topK: 3, // Retrieve 3 most similar messages
    //   messageRange: 2, // Include 2 messages before and after each match
    //   scope: "resource", // Search across all threads for this user
    // },
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
`,
    },
  },
});
