import { loadChat, getAllChats } from '@/lib/chat-store';
import ChatInterface from './chat-interface';
import ChatSidebar from './chat-sidebar';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params;
  const [messages, chats] = await Promise.all([
    loadChat(id),
    getAllChats()
  ]);
  
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar with chat list */}
      <ChatSidebar chats={chats} currentChatId={id} />
      
      {/* Main chat area */}
      <div className="flex-1">
        <ChatInterface id={id} initialMessages={messages} />
      </div>
    </div>
  );
}
