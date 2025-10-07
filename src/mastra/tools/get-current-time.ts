import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const getCurrentTimeTool = createTool({
  id: "get-current-time",
  description: "Get the current date and time in both UTC and specified timezone",
  inputSchema: z.object({
    timezone: z.string().optional().describe("Timezone identifier (e.g., 'America/New_York', 'Europe/London', 'UTC'). Defaults to UTC if not specified.")
  }),
  execute: async ({ context }) => {
    try {
      const { timezone = "UTC" } = context;
      const now = new Date();
      
      // Helper function to format date in specified timezone
      const formatDateTime = (date: Date, tz: string) =>
        date.toLocaleString("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        });
      
      // Get current time in UTC
      const utcTime = now.toISOString();
      
      // Get current time in specified timezone
      let localTime: string;
      let timezoneDisplay: string;
      let offsetString: string;
      
      try {
        localTime = formatDateTime(now, timezone);
        
        // Get timezone offset for the specified timezone
        const tempDate = new Date(formatDateTime(now, timezone));
        const utcDate = new Date(formatDateTime(now, "UTC"));
        const offsetMs = tempDate.getTime() - utcDate.getTime();
        const offsetHours = Math.floor(Math.abs(offsetMs) / (1000 * 60 * 60));
        const offsetMinutes = Math.floor((Math.abs(offsetMs) % (1000 * 60 * 60)) / (1000 * 60));
        const offsetSign = offsetMs >= 0 ? '+' : '-';
        offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
        timezoneDisplay = timezone;
      } catch (timezoneError) {
        // Fallback to UTC if timezone is invalid
        localTime = formatDateTime(now, "UTC");
        offsetString = "UTC+00:00";
        timezoneDisplay = "UTC";
      }
      
      const reply = {
        success: true,
        current_time: {
          utc: utcTime,
          local: localTime,
          timezone: timezoneDisplay,
          offset: offsetString,
          timestamp: Math.floor(now.getTime() / 1000)
        },
        message: `Current time: ${localTime} (${offsetString})`
      };
      console.log("current time", reply);
      return reply;
    } catch (error) {
      console.error("Error getting current time:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
});