# Personal AI Assistant

A self-hosted personal AI assistant built with Next.js, AI SDK, and Mastra.ai. Features chat interface with message persistence using SQLite and Mastra memory.

## Features

- 🤖 AI-powered chat interface with AI Elements components
- 💾 Message persistence with Mastra memory + SQLite metadata
- 🧠 Intelligent memory system that remembers user preferences and context
- 🔐 Optional password protection
- 🚀 Self-hosted deployment (Docker supported)
- 📱 Responsive design with professional chat UI
- 📎 File attachment support
- 🎤 Microphone integration ready

## Tech Stack

- **Frontend**: Next.js with AI Elements for chat UI
- **Backend**: Vercel AI SDK + Mastra.ai agents
- **Database**: SQLite for chat metadata + LibSQL for agent memory
- **LLM Provider**: OpenRouter (configurable)
- **UI Components**: AI Elements (shadcn-based)

## Quick Start (Docker) 🐳

### Option 1: Docker Compose (Recommended)

1. **Create environment file:**
   ```bash
   cp env.example .env
   # Edit .env and add your OPENROUTER_API_KEY and optionally OPENROUTER_BASE_URL
   ```

2. **Run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Access the app:**
   Visit `http://localhost:3000`

### Option 2: Docker Run

1. **Build the Docker image:**
   ```bash
   docker build -t ai-assistant .
   ```

2. **Run with Docker:**
   ```bash
   docker run -d \
     --name ai-assistant \
     -p 3000:3000 \
     -v ai-assistant-data:/app/data \
     -e OPENROUTER_API_KEY=your_openrouter_api_key_here \
     ai-assistant
   ```

3. **Access the app:**
   Visit `http://localhost:3000`

### Optional: Add password protection:
```bash
docker run -d \
  --name ai-assistant \
  -p 3000:3000 \
  -v ai-assistant-data:/app/data \
  -e OPENROUTER_API_KEY=your_openrouter_api_key_here \
  -e USER_PASSWORD=your_secure_password \
  ai-assistant
```

## Development Setup

### 1. Clone and install dependencies:
```bash
npm install
```

### 2. Set up environment variables:
```bash
cp env.example .env.local
```

Edit `.env.local` and add your OpenRouter API key:
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

Optionally add password protection:
```
USER_PASSWORD=your_password_here
```

### 3. Run in development mode:
```bash
npm run dev
```

### 4. Build for production:
```bash
npm run build
npm run start
```

## Docker Commands

### Build and run:
```bash
# Build the image
docker build -t ai-assistant .

# Run with volume for data persistence
docker run -d \
  --name ai-assistant \
  -p 3000:3000 \
  -v ai-assistant-data:/app/data \
  -e OPENROUTER_API_KEY=your_key_here \
  ai-assistant
```

### Manage the container:
```bash
# Stop the container
docker stop ai-assistant

# Start the container
docker start ai-assistant

# View logs
docker logs ai-assistant

# Access container shell
docker exec -it ai-assistant sh

# Remove container and volume (WARNING: deletes all data)
docker rm ai-assistant
docker volume rm ai-assistant-data
```

### Backup and restore data:
```bash
# Backup data volume
docker run --rm -v ai-assistant-data:/data -v $(pwd):/backup alpine tar czf /backup/ai-assistant-backup.tar.gz -C /data .

# Restore data volume
docker run --rm -v ai-assistant-data:/data -v $(pwd):/backup alpine tar xzf /backup/ai-assistant-backup.tar.gz -C /data
```

## Data Persistence

The application uses three database files stored in the configured data directory:

- **`data.db`** - Chat metadata (chat list, first messages, timestamps)
- **`memory.db`** - Mastra agent memory (conversation history, user context)
- **`vector.db`** - Mastra agent RAG (conversation history in vector embeddings)

**File Locations:**
- **Development**: Current directory (e.g., `./data.db`, `./memory.db`, `./vector.db`)
- **Docker**: `/app/data/` directory (mapped to volume for persistence)
- **Custom**: Set `DATA_PATH` environment variable to any directory

These files are automatically created and persisted based on your environment configuration.

## How it Works

- **Chat Creation**: Visiting `/chat` creates a new chat and redirects to `/chat/[id]`
- **Message Persistence**: Messages stored in Mastra memory system with thread-based organization
- **Chat Metadata**: First message and timestamps stored in SQLite for sidebar display
- **Efficient API**: Only sends the last user message to backend; Mastra rebuilds full context
- **Streaming**: Uses AI SDK's streaming response for real-time chat experience
- **Memory**: Agent remembers user preferences, context, and important information across conversations

## Configuration

- **LLM Model**: Currently uses `openai/gpt-oss-120b` via OpenRouter (configurable in `src/mastra/agents/agent.ts`)
- **System Prompt**: Comprehensive personal assistant instructions with memory capabilities
- **Database Paths**: Configurable via `DATA_PATH` environment variable
  - Development default: Current directory (e.g., `./data.db`, `./memory.db`, `./vector.db`)
  - Docker default: `/app/data/` directory (set via `DATA_PATH=/app/data`)

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts     # Chat API endpoint using Mastra
│   ├── chat/                 # Chat pages and components
│   └── page.tsx              # Home page with chat list
├── lib/
│   ├── chat-store.ts         # Chat metadata operations
│   ├── database.ts           # SQLite setup
├── mastra/
│   ├── agents/agent.ts       # Mastra agent with memory
│   └── index.ts              # Mastra configuration
├── components/
│   └── ai-elements/          # AI Elements UI components
```

## Environment Variables

- **`OPENROUTER_API_KEY`** (required) - Your OpenRouter API key
- **`OPENROUTER_BASE_URL`** (optional) - Custom OpenRouter base URL (defaults to `https://openrouter.ai/api/v1`)
- **`DATA_PATH`** (optional) - Custom directory path for database files (defaults to current directory)
- **`USER_PASSWORD`** (optional) - Password protection for the app
- **`NODE_ENV`** (auto-set) - Determines application environment

## License

MIT
