import { getAllChats } from '@/lib/chat-store';
import Link from 'next/link';

function formatTime(dateString: string | null): string {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  
  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInHours < 24 * 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function truncateMessage(message: string | null): string {
  if (!message) return 'New chat';
  return message.length > 80 ? message.substring(0, 80) + '...' : message;
}

export default async function HomePage() {
  const chats = await getAllChats();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Personal AI Assistant</h1>
          <p className="text-gray-600 mb-6">Your AI assistant with memory capabilities</p>
          <Link 
            href="/chat" 
            className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            Start New Chat
          </Link>
        </div>

        {chats.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Recent Conversations</h2>
            </div>
            <div className="divide-y divide-gray-200">
              {chats.map((chatItem) => (
                <Link
                  key={chatItem.id}
                  href={`/chat/${chatItem.id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">
                        {truncateMessage(chatItem.first_message)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {formatTime(chatItem.first_message_time)}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 ml-4">
                      Updated {formatTime(chatItem.updated_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
