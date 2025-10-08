// scripts/job-runner.ts
import 'dotenv/config';
import { getNextTask } from '../src/lib/server/task-store';
import { USER_ID } from '../src/lib/const';

let isShuttingDown = false;
let timeoutId: NodeJS.Timeout | null = null;

// Check for triggered tasks every 5 seconds using setTimeout
async function checkTasks() {
  if (isShuttingDown) return;

  try {
    console.log(`[jobs] checking @ ${new Date().toISOString()}`);
    
    // Get the next task for the user (only returns tasks ready to trigger)
    const task = await getNextTask(USER_ID);
    
    if (task) {
      console.log(`[jobs] triggering task at ${new Date(task.timestamp * 1000).toISOString()}: ${task.task}`);
      
      // Make POST request to /api/task route with task timestamp as param
      try {
        const response = await fetch('http://localhost:3000/api/task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: task.id,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`[jobs] task processed successfully:`, result);
        } else {
          const errorText = await response.text();
          console.error(`[jobs] task processing failed:`, response.status, errorText);
        }
      } catch (fetchError) {
        console.error(`[jobs] failed to call task API:`, fetchError);
      }
    }
  } catch (err) {
    console.error('[jobs] error:', err);
  }

  // Re-arm the timer for the next check (only if not shutting down)
  if (!isShuttingDown) {
    timeoutId = setTimeout(checkTasks, 5_000);
  }
}

function startPolling() {
  // Start the first check
  checkTasks();

  // Graceful shutdown
  const stop = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    console.log('[jobs] stopped');
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('beforeExit', stop);
}

console.log('[jobs] starting task checker...');
startPolling();