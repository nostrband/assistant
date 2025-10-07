'use client';

import { generateId } from 'ai';
import { useRouter } from 'next/navigation';

interface NewChatButtonProps {
  className?: string;
  children: React.ReactNode;
}

export default function NewChatButton({ className, children }: NewChatButtonProps) {
  const router = useRouter();

  const handleNewChat = () => {
    const id = generateId();
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