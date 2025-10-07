import { Mastra } from "@mastra/core/mastra";
import { assistantAgent } from "./agents/agent";
import { ConsoleLogger } from "@mastra/core/logger";

export const mastra = new Mastra({
  agents: { assistantAgent },
  logger: new ConsoleLogger({
    level: "debug",
  }),
  // Enable AI tracing with default configuration
  // observability: {
  //   default: { enabled: true }
  // },
});