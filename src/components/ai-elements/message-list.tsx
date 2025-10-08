"use client";

import React from "react";
import { MessageItem } from "@/components/ai-elements/message-item";
import { Loader } from "@/components/ai-elements/loader";
import { MyUIMessage } from "@/lib/server/chat-store";

interface MessageListProps {
  messages: MyUIMessage[];
  status: "ready" | "streaming" | "submitted" | "error";
  onRegenerate: (messageId: string) => void;
}

export const MessageList = React.memo(function MessageList({
  messages,
  status,
  onRegenerate,
}: MessageListProps) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          status={status}
          isLastMessage={index === messages.length - 1}
          onRegenerate={onRegenerate}
        />
      ))}
      {status === "submitted" && <Loader />}
    </>
  );
});