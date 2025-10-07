"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  // PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Actions, Action } from "@/components/ai-elements/actions";
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage, ToolUIPart } from "ai";
import { Response } from "@/components/ai-elements/response";
import { RefreshCcwIcon, CopyIcon } from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Loader } from "@/components/ai-elements/loader";

interface ChatInterfaceProps {
  id: string;
  initialMessages: UIMessage[];
}

export default function ChatInterface({
  id,
  initialMessages,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");

  const { messages, status, sendMessage, regenerate } = useChat({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Send ONLY the newest message; server will reload history
      prepareSendMessagesRequest({ messages, id, trigger }) {
        return {
          body: {
            message: messages[messages.length - 1],
            id,
            regenerate: trigger === "regenerate-message",
          },
        };
      },
    }),
  });

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage({
      text: message.text || "Sent with attachments",
      files: message.files,
    });
    setInput("");
  };

  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full">
        <Conversation className="h-full">
          <ConversationContent>
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "assistant" &&
                  message.parts.filter((part) => part.type === "source-url")
                    .length > 0 && (
                    <Sources>
                      <SourcesTrigger
                        count={
                          message.parts.filter(
                            (part) => part.type === "source-url"
                          ).length
                        }
                      />
                      {message.parts
                        .filter((part) => part.type === "source-url")
                        .map((part, sourceIndex) => (
                          <SourcesContent key={`${message.id}-${sourceIndex}`}>
                            <Source
                              key={`${message.id}-${sourceIndex}`}
                              href={part.url}
                              title={part.url}
                            />
                          </SourcesContent>
                        ))}
                    </Sources>
                  )}
                <Message from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, partIndex) => {
                      switch (part.type) {
                        case "text":
                          return (
                            <Response key={`${message.id}-${partIndex}`}>
                              {part.text}
                            </Response>
                          );
                        case "reasoning":
                          if (
                            status === "streaming" &&
                            message.id === messages.at(-1)?.id
                          )
                            return (
                              <Reasoning
                                key={`${message.id}-${partIndex}`}
                                className="w-full"
                                isStreaming={
                                  status === "streaming" &&
                                  partIndex === message.parts.length - 1 &&
                                  message.id === messages.at(-1)?.id
                                }
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>{part.text}</ReasoningContent>
                              </Reasoning>
                            );
                        default:
                          // Handle tool parts
                          if (part.type.startsWith("tool-")) {
                            const toolPart = part as ToolUIPart;
                            return (
                              <Tool key={`${message.id}-${partIndex}`} defaultOpen={status === "streaming"}>
                                <ToolHeader type={toolPart.type} state={toolPart.state} />
                                <ToolContent>
                                  <ToolInput input={toolPart.input} />
                                  <ToolOutput
                                    output={toolPart.output}
                                    errorText={toolPart.errorText}
                                  />
                                </ToolContent>
                              </Tool>
                            );
                          }
                          return null;
                      }
                    })}
                    {status !== "error" &&
                      !message.parts.filter((m) => m.type === "text")
                        .length && <Loader />}
                    {status === "error" && message.id === messages.at(-1)?.id && (
                      <div className="text-red-500 text-sm mt-2 px-4">
                        Error, please retry later!
                      </div>
                    )}
                  </MessageContent>
                </Message>
                {message.role === "assistant" &&
                  (status === "ready" || status === "error") && (
                    <Actions>
                      {status === "error" && (
                        <Action
                          onClick={() => regenerate({ messageId: message.id })}
                          label="Regenerate"
                        >
                          <RefreshCcwIcon className="size-3" />
                        </Action>
                      )}
                      <Action
                        onClick={() => {
                          const textParts = message.parts.filter(
                            (part) => part.type === "text"
                          );
                          const allText = textParts
                            .map((part) => part.text)
                            .join("\n");
                          navigator.clipboard.writeText(allText);
                        }}
                        label="Copy"
                      >
                        <CopyIcon className="size-3" />
                      </Action>
                    </Actions>
                  )}
              </div>
            ))}
            {status === "submitted" && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput
          onSubmit={handleSubmit}
          className="mt-4"
          globalDrop
          multiple
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit disabled={!input && !status} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
}
