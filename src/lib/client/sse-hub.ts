"use client";
import { create } from "zustand";
import { useEffect, useMemo } from "react";
import { ChatMessageEvent, ChatMessageEventSchema } from "../events/types";

type Msg = { id: number; type: string; data: unknown; ts?: string };
type ChatMsg = { id: number; type: "chat:message"; data: ChatMessageEvent; ts?: string };

type Store = {
  lastId: number;
  byType: Record<string, Msg[]>;
  connected: boolean;
  setConnected: (v: boolean) => void;
  add: (m: Msg) => void;
  reset: () => void;
};

type ChatStore = {
  lastId: number;
  messages: ChatMsg[];
  connected: boolean;
};

export const useEventStore = create<Store>((set, get) => ({
  lastId: 0,
  byType: {},
  connected: false,
  setConnected: (v: boolean) => {
    // Only update if the value actually changed
    if (get().connected !== v) {
      set({ connected: v });
    }
  },
  add: (m: Msg) => set((s: Store) => {
    const arr = s.byType[m.type]?.slice(-499) ?? []; // keep last 500 per type
    return {
      lastId: Math.max(s.lastId, m.id ?? s.lastId),
      byType: { ...s.byType, [m.type]: [...arr, m] },
    };
  }),
  reset: () => set({ lastId: 0, byType: {}, connected: false }),
}));

class SSEHub {
  private es: EventSource | null = null;
  private kinds = new Map<string, number>(); // refcount per kind
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds max delay
  private baseReconnectDelay = 1000; // 1 second base delay
  private localStorageTimer: NodeJS.Timeout | null = null;
  private readonly STORAGE_KEY = 'sse-hub-last-event-id';

  addKinds(kinds: string[]) {
    for (const k of kinds) {
      const c = this.kinds.get(k) ?? 0;
      this.kinds.set(k, c + 1);
    }
    
    // Always ensure connection regardless of kinds
    this.ensureConnection();
  }

  removeKinds(kinds: string[]) {
    for (const k of kinds) {
      const c = this.kinds.get(k) ?? 0;
      if (c <= 1) {
        this.kinds.delete(k);
      } else {
        this.kinds.set(k, c - 1);
      }
    }
    // Don't disconnect based on kinds - maintain persistent connection
  }

  private ensureConnection() {
    // Only connect if we don't have an active connection and no reconnect timer is running
    if ((!this.es || this.es.readyState === EventSource.CLOSED) && !this.reconnectTimer) {
      this.connect();
    }
  }

  private scheduleReconnect() {
    // Don't schedule if we already have a timer running
    if (this.reconnectTimer) {
      return;
    }
    
    // Calculate exponential backoff delay
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    
    console.log(`SSE reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private getLastEventIdFromStorage(): number {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? Number(stored) : 0;
    } catch {
      // localStorage not available or error
      return 0;
    }
  }

  private scheduleLocalStorageUpdate(eventId: number) {
    // Clear existing timer
    if (this.localStorageTimer) {
      clearTimeout(this.localStorageTimer);
    }
    
    // Set new timer to update localStorage after 100ms
    this.localStorageTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.STORAGE_KEY, String(eventId));
      } catch {
        // localStorage not available or error - ignore
      }
      this.localStorageTimer = null;
    }, 100);
  }

  private connect() {
    // Always pass since parameter - get from localStorage or use 0
    const since = this.getLastEventIdFromStorage();
    const qs = new URLSearchParams();
    qs.set("since", String(since));

    const url = `/api/events?${qs.toString()}`;

    if (this.es) { this.es.close(); this.es = null; }

    const es = new EventSource(url);
    this.es = es;

    es.addEventListener("ready", () => {
      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      useEventStore.getState().setConnected(true);
    });
    
    es.onerror = (event) => {
      console.log('SSE error:', event);
      
      // Close the connection to prevent further errors
      if (this.es === es) {
        this.es.close();
        this.es = null;
      }
      
      useEventStore.getState().setConnected(false);
      // Increment reconnect attempts on error
      this.reconnectAttempts++;
      
      // Always reconnect if no timer is already running
      if (!this.reconnectTimer) {
        this.scheduleReconnect();
      }
    };

    // Handle all event types dynamically
    const handleMessage = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        const idHeader = (evt as MessageEvent & { lastEventId?: string }).lastEventId ?? null;
        const id = idHeader ? Number(idHeader) : NaN;
        const eventType = (evt as MessageEvent & { type?: string }).type || "message";
        
        // Only add to store if we have a valid ID (actual event, not heartbeat)
        if (!isNaN(id)) {
          // Validate chat message events
          if (eventType === "chat:message") {
            try {
              ChatMessageEventSchema.parse(data);
            } catch (validationError) {
              console.warn("Invalid chat message payload received:", validationError, data);
              // Still add to store but log the warning
            }
          }
          
          useEventStore.getState().add({
            id,
            type: eventType,
            data
          });
          
          // Schedule localStorage update with debouncing
          this.scheduleLocalStorageUpdate(id);
        }
      } catch (error) {
        console.error("Error parsing SSE message:", error);
      }
    };

    // Listen for common event types
    const eventTypes = ["chat:message", "ready"];
    eventTypes.forEach(type => {
      es.addEventListener(type, handleMessage);
    });

    // Also listen for generic message events
    es.addEventListener("message", handleMessage);
  }

  disconnect() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.localStorageTimer) {
      clearTimeout(this.localStorageTimer);
      this.localStorageTimer = null;
    }
    // Reset reconnect attempts when manually disconnecting
    this.reconnectAttempts = 0;
    useEventStore.getState().setConnected(false);
  }
}

export const sseHub: SSEHub = (globalThis as typeof globalThis & { __sseHub?: SSEHub }).__sseHub ?? new SSEHub();
if (!(globalThis as typeof globalThis & { __sseHub?: SSEHub }).__sseHub) {
  (globalThis as typeof globalThis & { __sseHub?: SSEHub }).__sseHub = sseHub;
}

// Convenience hook to manage refcounts and auto-connect
export function useSubscribeEvents(kinds: string[] = []) {
  useEffect(() => {
    if (kinds.length === 0) {
      // Subscribe to all events by connecting without specific kinds
      sseHub.addKinds(["chat:message"]); // Default to chat messages
    } else {
      sseHub.addKinds(kinds);
    }
    
    return () => {
      if (kinds.length === 0) {
        sseHub.removeKinds(["chat:message"]);
      } else {
        sseHub.removeKinds(kinds);
      }
    };
  }, [kinds]);

  return useEventStore();
}

// Hook specifically for chat messages with typed data
export function useChatEvents(): ChatStore {
  const store = useSubscribeEvents(["chat:message"]);
  
  // Filter and validate chat messages with memoization
  const chatMessages = useMemo(() => {
    return (store.byType["chat:message"] || []).map(msg => {
      try {
        // Validate the payload
        const validatedData = ChatMessageEventSchema.parse(msg.data);
        validatedData.messages.forEach(m => {
          if (m.metadata?.createdAt)
            m.metadata.createdAt = new Date(m.metadata.createdAt);
        });
        return {
          ...msg,
          type: "chat:message" as const,
          data: validatedData
        };
      } catch (error) {
        console.warn("Invalid chat message in store:", error, msg);
        // Return with original data but mark as potentially invalid
        return {
          ...msg,
          type: "chat:message" as const,
          data: msg.data as ChatMessageEvent
        };
      }
    });
  }, [store.byType["chat:message"]]);
  
  return useMemo(() => ({
    lastId: store.lastId,
    messages: chatMessages,
    connected: store.connected
  }), [store.lastId, chatMessages, store.connected]);
}