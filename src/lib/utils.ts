// src/lib/utils.ts
import { UIMessage } from 'ai';
import { type ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function addCreatedAt(messages: UIMessage[]) {
  return messages.map((m) => ({
    ...m,
    metadata: {
      createdAt: new Date(),
    },
  }));
}

