// scripts/job-runner.ts
import 'dotenv/config';
import { getNextTask, addTask, hasCronTaskOfType } from '../src/lib/server/task-store';
import { USER_ID, ROUTINE_TASKS } from '../src/lib/const';
import { generateId } from 'ai';
import { createPlannerTaskPrompt } from '@/lib/utils';
import { Cron } from 'croner';

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

async function initializeRoutineTasks() {
  try {
    console.log('[jobs] Checking routine tasks...');
    
    for (const [taskType, cronSchedule] of Object.entries(ROUTINE_TASKS)) {
      console.log(`[jobs] Checking for ${taskType} task with cron schedule: ${cronSchedule}`);
      
      try {
        // Check if a task with this type and non-empty cron already exists
        const existingTask = await hasCronTaskOfType(USER_ID, taskType);
        
        if (!existingTask) {
          console.log(`[jobs] No ${taskType} cron task found, creating one`);
          
          // Calculate next run time from cron schedule
          // const job = new Cron(cronSchedule);
          // const nextRun = job.nextRun();
          // if (!nextRun) {
          //   console.error(`[jobs] Invalid cron schedule for ${taskType}: ${cronSchedule}`);
          //   continue;
          // }
          
          // const timestamp = Math.floor(nextRun.getTime() / 1000);

          // First run immediately
          const timestamp = Math.floor(Date.now() / 1000);
          
          // Create task content based on type
          let taskContent = '';
          let title = '';
          if (taskType === 'planner') {
            taskContent = createPlannerTaskPrompt();
            title = 'Daily Planning';
          }
          
          await addTask(
            generateId(),
            USER_ID,
            timestamp,
            taskContent,
            taskType,
            '', // thread_id
            title,
            cronSchedule
          );
          
          console.log(`[jobs] Created ${taskType} cron task for next run at: ${new Date(timestamp * 1000).toISOString()}`);
        } else {
          console.log(`[jobs] ${taskType} cron task already exists`);
        }
      } catch (error) {
        console.error(`[jobs] Error processing ${taskType} routine task:`, error);
      }
    }
  } catch (error) {
    console.error('[jobs] Error initializing routine tasks:', error);
  }
}


function startPolling() {
  // Initialize routine tasks before starting polling
  initializeRoutineTasks().then(() => {
    // Start the first check
    checkTasks();
  }).catch(error => {
    console.error('[jobs] Failed to initialize routine tasks:', error);
    // Start polling anyway
    checkTasks();
  });

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