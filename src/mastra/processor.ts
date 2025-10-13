// CleanFinalMessageProcessor.ts
// Auto-detects whether to emit immediately or wait for `<|channel|>final<|message|>`.
// Strips control markers if they appear, emits only user-visible text.

import { ChunkType, MastraMessageV2 } from "@mastra/core";
import { Processor } from "@mastra/core/processors";

export class TimestampingProcessor implements Processor {
  readonly name = "timestamp-user-message";

  async processInput({ messages }: { messages: MastraMessageV2[] }) {
    const msg = messages[messages.length - 1];
    // console.log("input msg", JSON.stringify(msg));
    const now = new Date();
    const timestamp = `
<current-time 
  utc="${now.toISOString()}"
  local="${now.toString()}"
/>
`;
    if (msg.content.content && typeof msg.content.content === "string") {
      msg.content.content += `\n${timestamp}`;
    }

    if (msg.content.parts.length > 0) {
      msg.content.parts.push({
        type: "text",
        text: timestamp,
      });
    }

    // console.log("timestamped msg", JSON.stringify(msg));
    return messages;
  }
}

// CleanFinalMessageProcessor.ts
// Strictly suppresses internal monologue. Emits only after
// the sequence:  … <|channel|>final … <|message|> …
// If no markers ever appear, it passes text through.

export class CleanFinalMessageProcessor implements Processor {
  readonly name = "clean-final-message";

  private static CHANNEL = "<|channel|>";
  private static MESSAGE = "<|message|>";
  private static START = "<|start|>";
  private static END = "<|end|>";

  private static hasAnyMarker(s: string): boolean {
    return (
      s.includes(this.CHANNEL) ||
      s.includes(this.MESSAGE) ||
      s.includes(this.START) ||
      s.includes(this.END)
    );
  }

  private static stripMarkers(s: string): string {
    s = s.replaceAll(`${this.CHANNEL}final`, "");
    s = s.replaceAll(`${this.CHANNEL}analysis`, "");
    s = s.replaceAll(this.MESSAGE, "");
    s = s.replaceAll(this.END, "");
    s = s.replace(/<\|start\|>(?:assistant|user|system)?/g, "");
    s = s.replaceAll(this.CHANNEL, "");
    return s;
  }

  async processOutputStream({
    part,
    state,
  }: {
    part: ChunkType;
    streamParts: ChunkType[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: Record<string, any>;
    abort: (reason?: string) => never;
  }): Promise<ChunkType | null | undefined> {
    if (!state.__cfm) {
      state.__cfm = {
        mode: "unknown" as "unknown" | "plain" | "strict",
        stage: "waitFinal" as "waitFinal" | "waitMessage" | "emit",
        buffer: "" as string,
        lastFinalIdx: -1 as number,
        messageIdx: -1 as number, // the message marker we will emit after
        emittedCleanLen: 0 as number, // number of cleaned chars already emitted
      };
    }
    const S = state.__cfm;

    // Pass through non-text parts
    if (part.type !== "text-delta" || !part.payload?.text) {
      return part;
    }

    // Append new text to rolling buffer (handles split markers)
    S.buffer += part.payload.text;

    // --- Decide mode on first detection ---
    if (S.mode === "unknown") {
      S.mode = CleanFinalMessageProcessor.hasAnyMarker(S.buffer)
        ? "strict"
        : "plain";
      if (S.mode === "plain") {
        // No markers -> emit everything as-is
        const toEmit = S.buffer.slice(S.emittedCleanLen);
        S.emittedCleanLen = S.buffer.length;
        if (!toEmit) return null;
        return { ...part, payload: { ...part.payload, text: toEmit } };
      }
      // strict: start in waitFinal
      S.stage = "waitFinal";
    }

    if (S.mode === "plain") {
      // Keep emitting raw text as it comes
      const toEmit = S.buffer.slice(S.emittedCleanLen);
      S.emittedCleanLen = S.buffer.length;
      if (!toEmit) return null;
      return { ...part, payload: { ...part.payload, text: toEmit } };
    }

    // --- STRICT MODE ---
    // Only emit after we see <|channel|>final then the next <|message|>

    if (S.stage === "waitFinal") {
      const idx = S.buffer.lastIndexOf(
        CleanFinalMessageProcessor.CHANNEL + "final"
      );
      if (idx === -1) {
        // Haven't seen final → suppress
        return null;
      }
      S.lastFinalIdx = idx;
      S.stage = "waitMessage";
      // fallthrough to check message in same chunk
    }

    if (S.stage === "waitMessage") {
      // Find the FIRST <|message|> that occurs AFTER the last <|channel|>final
      const searchFrom = S.lastFinalIdx >= 0 ? S.lastFinalIdx : 0;
      const msgIdx = S.buffer.indexOf(
        CleanFinalMessageProcessor.MESSAGE,
        searchFrom
      );
      if (msgIdx === -1) {
        // Not yet at visible message → suppress
        return null;
      }
      S.messageIdx = msgIdx;
      S.stage = "emit";
    }

    // EMIT: only content AFTER that message marker
    const visibleStart =
      S.messageIdx + CleanFinalMessageProcessor.MESSAGE.length;
    const rawTail = S.buffer.slice(visibleStart);
    const cleanedTail = CleanFinalMessageProcessor.stripMarkers(rawTail);

    const toEmit = cleanedTail.slice(S.emittedCleanLen);
    S.emittedCleanLen += toEmit.length;

    if (!toEmit) return null;

    return {
      ...part,
      payload: { ...part.payload, text: toEmit },
    };
  }
}
