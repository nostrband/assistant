import { bus, fetchSince, EventRow } from "@/lib/server/events";
import { USER_ID } from "@/lib/const";

export const runtime = "nodejs"; // ensure Node runtime for EventEmitter

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15_000;

function writeSSE(row: EventRow): string {
  return (
    `id: ${row.id}\n` +              // lets browsers auto-resume
    `event: ${row.type}\n` +
    `data: ${row.data}\n\n`
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  
  // Replay anchor from either Last-Event-ID header or ?since - required parameter
  const lastIdHeader = req.headers.get("last-event-id");
  const sinceParam = url.searchParams.get("since");
  const since = Number(lastIdHeader ?? sinceParam ?? 0) || 0;
  
  // Use USER_ID constant for now as specified in the plan
  const user_id = USER_ID;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Always fetch events since the provided ID (0 if first time)
      fetchSince(since, user_id).then(backlog => {
        for (const row of backlog) {
          controller.enqueue(encoder.encode(writeSSE(row)));
        }
        // let client know we're live
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
      }).catch(error => {
        console.error("Error fetching backlog:", error);
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
      });

      // 2) heartbeat
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          // Stream might be closed
          clearInterval(hb);
        }
      }, KEEPALIVE_MS);

      // 3) live subscription - send all events to all clients as specified
      const handlers: Array<() => void> = [];
      
      const onRow = (row: EventRow) => {
        // Filter by user_id on server side
        if (row.user_id === user_id) {
          try {
            controller.enqueue(encoder.encode(writeSSE(row)));
          } catch {
            // Stream might be closed
            cleanup();
          }
        }
      };
      
      // Subscribe to all events via wildcard
      bus.on("*", onRow);
      handlers.push(() => bus.off("*", onRow));

      // 4) cleanup on close/abort
      const cleanup = () => {
        clearInterval(hb);
        handlers.forEach(h => h());
        try { 
          controller.close(); 
        } catch {
          // Stream already closed
        }
      };

      // Access abort signal from request if available
      const abort = req.signal;
      abort?.addEventListener("abort", cleanup);
      
      // Store cleanup function for potential manual cleanup
      (controller as ReadableStreamDefaultController & { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel() { 
      // Stream consumer closed
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      // CORS headers for cross-origin requests if needed
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}