import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { TokenLimiter, ToolCallFilter } from "@mastra/memory/processors";
import { createClient } from "@libsql/client";
// import getDatabase from "@/lib/server/database";

// Configure memory with LibSQL storage
export const assistantMemory = new Memory({
  storage: new LibSQLStore({
    client: createClient({
      url: `file:memory.db`
    })
    // client: getDatabase(),
  }),
  // vector search is shit
  // vector: new LibSQLVector({
  //   connectionUrl: process.env.DATA_PATH
  //     ? `file:${process.env.DATA_PATH}/vector.db`
  //     : "file:vector.db", // Store in DATA_PATH if set, otherwise project root
  // }),
  processors: [
    // Don't filter anything, especially updateWorkingMemory, which
    // is dangerous and should be logged. Hopefully it will use patchWorkingMemory
    // now which is efficient, thus no need to hide tool calls.

    // new ToolCallFilter({ exclude: [
    //   "updateWorkingMemory"
    // ]}),

    // Ensure the total tokens from memory don't exceed ~20k
    new TokenLimiter(20000),
  ],
  options: {
    lastMessages: 30,
    // semanticRecall: {
    //   topK: 3, // Retrieve 3 most similar messages
    //   messageRange: 2, // Include 2 messages before and after each match
    //   scope: "resource", // Search across all threads for this user
    // },
    threads: {
      generateTitle: false,
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
`,
    },
  },
});

