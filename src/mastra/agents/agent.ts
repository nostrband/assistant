import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { sendMessageTool } from "../tools/send-message";
import { listChatsTool } from "../tools/list-chats";
import { addTaskTool } from "../tools/add-task";
import { listTasksTool } from "../tools/list-tasks";
import { deleteTaskTool } from "../tools/delete-task";
import { createNoteTool } from "../tools/create-note";
import { updateNoteTool } from "../tools/update-note";
import { deleteNoteTool } from "../tools/delete-note";
import { getNoteTool } from "../tools/get-note";
import { searchNotesTool } from "../tools/search-notes";
import { listNotesTool } from "../tools/list-notes";
import { getWeatherTool } from "../tools/get-weather";
import { webSearchTool } from "../tools/web-search";
import { patchWorkingMemoryTool } from "../tools/patch-working-memory";
import { assistantMemory } from "../memory";
import { InputProcessor, UnicodeNormalizer } from "@mastra/core/processors";
import { ContextInjectingProcessor, TimestampingProcessor } from "../processor";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { AGENT_MODE, getInstructions } from "../instructions";

// Configure OpenRouter provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
});

// Create the AI assistant agent with memory
export const assistantAgent = new Agent({
  name: "Personal Assistant",
  model: openrouter(process.env.AGENT_MODEL || "openai/gpt-oss-120b"),
  memory: assistantMemory,
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
  },
  // FIXME does it interfere with tool call results?
  // outputProcessors: [new CleanFinalMessageProcessor()],
  inputProcessors: ({ runtimeContext }: { runtimeContext: RuntimeContext }) => {
    const procs: InputProcessor[] = [
      new UnicodeNormalizer({
        stripControlChars: true,
        collapseWhitespace: true,
        trim: true,
      }),
    ];
    procs.push(new TimestampingProcessor());

    return procs;
  },
  instructions: async ({ runtimeContext }) => {
    const mode = runtimeContext.get("mode") as AGENT_MODE;
    return getInstructions(mode);
  },
});

// // Agents:
// /**
//  * Memory updater agent - tools to update memory, memory
//  * Task updater agent - tools to update tasks, memory, active task list
//  * Note updater agent - tools to update notes, memory, active notes
//  * Reply builder agent - read-only tool calls, replies from other agents, unanswered messages, some more previous context
//  */

// export const memoryAgent = new Agent({
//   name: "Personal Assistant's Memory Agent",
//   model: openrouter(process.env.AGENT_MODEL || "openai/gpt-oss-120b"),
//   memory: assistantMemory,
//   tools: {
//     // only updateWorkingMemory from memory
//   },
//   inputProcessors: [
//     new UnicodeNormalizer({
//       stripControlChars: true,
//       collapseWhitespace: true,
//       trim: true,
//     }),
//     new TimestampingProcessor(),
//   ],
//   instructions: async ({}) => {
//     return `You are a part of proactive personal AI assistant for the user. Your job is to keep working memory about user updated with latest user input: 
// - Working memory is used to keep the most commonly used, short facts and knowledge about user, and is provided for all agents within assistant.
// - The assistant also stores Notes (less commonly used topical knowledge about user) and Tasks (specific jobs tracked and executed over time).
// - You will see the list of Notes and Tasks that are already stored, if user input is better suited for Notes or Tasks - don't write to working memory.
// - Current time is always passed with user messages, use it to reason about the dates and schedule of the user.
// - Your job is to decide if working memory should be updated and call the updateWorkingMemoryTool in that case.
// - If user input better fits to Notes or Tasks, reply with a comment - it will be passed to Notes/Tasks handling agents.
// - If user input is ambiguous, reply with a message asking for clarification - it will be passed to ReplyBuilder agent. 
// `;
//   },
// });


// // Create the AI assistant agent with memory
// export const notesAgent = new Agent({
//   name: "Personal Assistant's Notes Agent",
//   model: openrouter(process.env.AGENT_MODEL || "openai/gpt-oss-120b"),
//   memory: assistantMemory,
//   tools: {
//     createNoteTool,
//     updateNoteTool,
//     deleteNoteTool,
//     getNoteTool,
//     searchNotesTool,
//   },
//   inputProcessors: ({ runtimeContext }: { runtimeContext: RuntimeContext }) => {
//     return [
//       new UnicodeNormalizer({
//         stripControlChars: true,
//         collapseWhitespace: true,
//         trim: true,
//       }),
//       new TimestampingProcessor(),
//     ];
//   },
//   instructions: async ({}) => {
//     return `You are a part of proactive personal AI assistant for the user. Your job is to keep Notes about user updated with latest user input: 
// - Notes are used to keep long, deep, topical, rarely accessed knowledge and facts about user. 
// - The assistant also stores working Memory (most commonly used broad knowledge about user) and Tasks (specific jobs tracked and executed over time).
// - You will see the contents of working Memory, if user input is already reflected there - don't update Notes.
// - You will see Tasks that are already stored, if user input is better suited for Tasks - don't update Notes.
// - Current time is always passed with user messages, use it to reason about the dates and schedule of the user.
// - Your job is to decide if any Notes should be created/updated and call the corresponding tools in that case.
// - If user input is ambiguous, reply with a message asking for clarification - it will be passed to ReplyBuilder agent. 
// `;
//   },
// });
