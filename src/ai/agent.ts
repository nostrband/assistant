import { AGENT_MODE, getInstructions } from "@/mastra/instructions";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Experimental_Agent as Agent, stepCountIs, UIMessage } from "ai";
import { z } from "zod";
import { getWeatherTool } from "./tools/get-weather";
import { getResource } from "@/lib/server/memory-store";
import { sendMessageTool } from "./tools/send-message";
import { listChatsTool } from "./tools/list-chats";
import { addTaskTool } from "./tools/add-task";
import { listTasksTool } from "./tools/list-tasks";
import { deleteTaskTool } from "./tools/delete-task";
import { createNoteTool } from "./tools/create-note";
import { updateNoteTool } from "./tools/update-note";
import { deleteNoteTool } from "./tools/delete-note";
import { getNoteTool } from "./tools/get-note";
import { searchNotesTool } from "./tools/search-notes";
import { listNotesTool } from "./tools/list-notes";
import { webSearchTool } from "./tools/web-search";
import { patchWorkingMemoryTool } from "./tools/patch-working-memory";
import { updateWorkingMemoryTool } from "./tools/update-working-memory";

const metadataSchema = z.object({
  createdAt: z.string().datetime(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});
type MessageMetadata = z.infer<typeof metadataSchema>;

export type AssistantUIMessage = UIMessage<MessageMetadata>;

// Configure OpenRouter provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
});

export async function makeAgent({
  mode,
  stepLimit,
  threadId,
  userId,
}: {
  mode: AGENT_MODE;
  stepLimit: number;
  threadId: string;
  userId: string;
}) {
  // Get working memory for system prompt
  const resource = await getResource(userId);
  const workingMemoryTemplate = `# User Profile
- **Name**:
- **Location**:
- **Preferred Tone**:
- **Schedule**:
- **Interests**:
- **Preferences**:
- **Long-term Goals**:
- **Projects**:
- **Challenges**:
`;
  const workingMemory = resource?.workingMemory || "";

  const memoryPrompt = `Working Memory:
- Below is your working memory with common facts about the user.
- Update it whenever user provides new knowledge about themselves.
- Prefer patchWorkingMemory tool for efficient updates, fall back to updateWorkingMemory if you have to overwrite it completely.
- If working memory is empty, use the template provided in <memoryTemplate> tag below.
- The current contents of the working memory are in <memory> tag below.

<memoryTemplate>
${workingMemoryTemplate}
</memoryTemplate>

<memory>
${workingMemory}
</memory>
`;

  const system = getInstructions(mode) + "\n\n" + memoryPrompt;

  return new Agent({
    model: openrouter(process.env.AGENT_MODEL || "openai/gpt-oss-120b"),
    tools: {
      sendMessageTool,
      listChatsTool,
      addTaskTool,
      listTasksTool,
      deleteTaskTool,
      createNoteTool,
      updateNoteTool,
      deleteNoteTool,
      getNoteTool,
      searchNotesTool,
      listNotesTool,
      getWeatherTool,
      webSearchTool,
      patchWorkingMemoryTool,
      updateWorkingMemoryTool,
    },
    system,
    stopWhen: stepCountIs(stepLimit),
    prepareStep: async ({
      model, // Current model configuration
      stepNumber, // Current step number (0-indexed)
      steps, // All previous steps with their results
      messages, // Messages to be sent to the model
    }) => {
      if (stepNumber === 0) {
        // Timestamper
        const msg = messages.at(-1)!;
        if (msg.role === "user") {
          const now = new Date();
          const timestamp = `
<current-time 
  utc="${now.toISOString()}"
  local="${now.toString()}"
/>
`;
          if (typeof msg.content === "string") {
            msg.content += `\n${timestamp}`;
          } else if (msg.content.length > 0) {
            msg.content.push({
              type: "text",
              text: timestamp,
            });
          }
        }

        return {
          messages
        }
      }

      // Change nothing
      return {};
    },
    onStepFinish(stepResult) {
      console.log("step result", JSON.stringify(stepResult, null, 2));
      if (stepResult.finishReason === "stop") {
        // FIXME write messages to db
        console.log("finished", JSON.stringify(stepResult, null, 2));
      }
    },
  });
}
