import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { sendMessageTool } from "../tools/send-message";
import { listChatsTool } from "../tools/list-chats";
import { addTaskTool } from "../tools/add-task";
import { listTasksTool } from "../tools/list-tasks";
import { deleteTaskTool } from "../tools/delete-task";
import { getCurrentTimeTool } from "../tools/get-current-time";
import { assistantMemory } from "../memory";
import { UnicodeNormalizer } from "@mastra/core/processors";
import { CleanFinalMessageProcessor, TimestampingProcessor } from "../processor";

// Configure OpenRouter provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
});

// class InputLogger implements Processor {
//   readonly name = 'input-logger';

//   processInput({ messages, abort }: {
//     messages: MastraMessageV2[];
//     abort: (reason?: string) => never
//   }): MastraMessageV2[] {
//     console.log("input", JSON.stringify(messages, null, 2));
//     return messages;
//   }
// }

// Create the AI assistant agent with memory
export const assistantAgent = new Agent({
  name: "Personal Assistant",
  model: openrouter("openai/gpt-oss-120b"),
  memory: assistantMemory,
  tools: {
    sendMessageTool,
    listChatsTool,
    addTaskTool,
    listTasksTool,
    deleteTaskTool,
    // getCurrentTimeTool,
  },
  // FIXME does it interfere with tool call results?
  // outputProcessors: [new CleanFinalMessageProcessor()],
  inputProcessors: [
    new UnicodeNormalizer({
      stripControlChars: true,
      collapseWhitespace: true,
      trim: true,
    }),
    new TimestampingProcessor()
  ],
  instructions: async ({ runtimeContext }) => {
    const mode = runtimeContext.get("mode");
    return `You are a proactive personal assistant for the user: 
${mode === "user"
    ? `- You are talking to the user and can receive new input from them or ask questions.
- Your core job is to listen, make notes, confirm, and act later, unless explicitly asked for a comprehensive reply to a query.
- Save your user's time, do not ask questions if you can infer the answer, do not print big replies unless asked.`
    : mode === "task"
    ? `- You are running a background task, user is not available and can't answer.
- Execute the task and reply with a short summary for audit logs.`
    : `- You are running a regular planning/cleanup job, user is not available and can't answer.
- Revisit your notes and schedule, make necessary adjustments and clean-up your notes and short-term plans.`
}
- Proactively nudge user (with send-message tool) when a trigger (deadline, conflict, opportunity) is detected.  
- To act proactively, use tools to schedule tasks for yourself (i.e. "send 'wake up' to user in 2 hours").
- Keep your messages short, end with ONE clear next step suggestion (not a command, you're not the boss).  
- Explain reasoning only if asked.  
- State any assumptions and ask for confirmation.
- Never ask to confirm tool usage - all tools are always allowed.
- Current time is always passed with user messages, use it to schedule tasks.
- When printing time to the user always convert to their local timezone.
- Use the update memory tool to store the most important context that must be always available.
`;
    //- Use the memory block to keep notes, deadlines, tags, and links.
  },
});
