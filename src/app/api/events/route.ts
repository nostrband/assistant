import { bus, fetchSince, EventRow } from "@/lib/server/events";
import { USER_ID } from "@/lib/const";

export const runtime = "nodejs"; // ensure Node runtime for EventEmitter

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15_000;

// Use global registry to track connections across all instances
declare global {
  var __sseConnections: Set<() => void> | undefined;
  var __sseHandlersRegistered: boolean | undefined;
}

// Initialize global connection registry
if (!globalThis.__sseConnections) {
  globalThis.__sseConnections = new Set<() => void>();
}

// Register signal handlers only once globally
if (!globalThis.__sseHandlersRegistered) {
  globalThis.__sseHandlersRegistered = true;
  
  const handleShutdown = (signal: string) => {
    console.log(`${signal} received, closing ${globalThis.__sseConnections?.size || 0} SSE connections...`);
    if (globalThis.__sseConnections) {
      globalThis.__sseConnections.forEach(cleanup => {
        try {
          cleanup();
        } catch (e) {
          console.error('Error during SSE cleanup:', e);
        }
      });
      globalThis.__sseConnections.clear();
    }
    // Force exit
    process.exit(0);
  };
  
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

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
      }, KEEPALIVE_MS).unref(); // Don't keep process alive

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
        console.log('SSE cleanup called');
        clearInterval(hb);
        handlers.forEach(h => h());
        globalThis.__sseConnections?.delete(cleanup); // Remove from active connections
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      // Register this connection for SIGTERM cleanup
      globalThis.__sseConnections?.add(cleanup);
      console.log(`SSE connection registered, total active: ${globalThis.__sseConnections?.size || 0}`);

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