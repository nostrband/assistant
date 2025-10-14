'use client';

import { generateId } from 'ai';
import { useRouter } from 'next/navigation';

interface NewChatButtonProps {
  className?: string;
  children: React.ReactNode;
  noChats: boolean;
}

export default function NewChatButton({ className, children, noChats }: NewChatButtonProps) {
  const router = useRouter();

  const handleNewChat = async () => {
    const id = noChats ? "main" : generateId();
    router.push(`/chat/${id}`);
  };

  return (
    <button 
      onClick={handleNewChat}
      className={className}
    >
      {children}
    </button>
  );
}