// import "server-only";
import getDatabase from "./database";
import { TASK_TYPE_PLANNER } from "../const";

export interface Task {
  id: string;
  user_id: string;
  timestamp: number;
  task: string;
  reply: string;
  state: string;
  thread_id: string;
  error: string;
  type: string;
  title: string;
  cron: string;
}

// Set a new task - fails if task for this timestamp already exists for this user
export async function addTask(
  id: string,
  user_id: string,
  timestamp: number,
  task: string,
  type: string = '',
  thread_id: string = '',
  title: string = '',
  cron: string = ''
): Promise<string> {
  const db = getDatabase();

  // Insert new task
  await db.execute({
    sql: `INSERT INTO tasks (id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron)
          VALUES (?, ?, ?, ?, '', '', ?, '', ?, ?, ?)`,
    args: [id, user_id, timestamp, task, thread_id, type, title, cron],
  });

  return id;
}

// List tasks - returns up to 100 most recent tasks
export async function listTasks(
  user_id: string,
  include_finished: boolean = false,
  until?: number
): Promise<Task[]> {
  const db = getDatabase();

  let sql = `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
             FROM tasks`;
  const args: (string | number)[] = [];

  const conditions: string[] = [];

  // Filter by user_id
  conditions.push("user_id = ?");
  args.push(user_id);

  // Filter by state if not including finished tasks
  if (!include_finished) {
    conditions.push("state = ''");
  }

  // Always filter out deleted tasks
  conditions.push("(deleted IS NULL OR deleted = FALSE)");

  // Always filter out planner tasks (only show regular tasks to users)
  conditions.push("(type IS NULL OR type = '')");

  // Filter by until timestamp if provided
  if (until !== undefined) {
    conditions.push("timestamp <= ?");
    args.push(until);
  }

  // Add WHERE clause if we have conditions
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  // Order by timestamp descending (most recent first) and limit to 100
  sql += ` ORDER BY timestamp DESC LIMIT 100`;

  const result = await db.execute({
    sql,
    args,
  });

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    timestamp: row.timestamp as number,
    task: row.task as string,
    reply: row.reply as string,
    state: row.state as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
    title: (row.title as string) || '',
    cron: (row.cron as string) || '',
  }));
}

// Delete task by ID - returns true if task was found and deleted, false if not found
export async function deleteTask(
  user_id: string,
  id: string
): Promise<void> {
  const db = getDatabase();

  // Mark the task as deleted
  const r = await db.execute({
    sql: `UPDATE tasks SET deleted = TRUE WHERE id = ? AND user_id = ? AND (deleted IS NULL OR deleted = FALSE)`,
    args: [id, user_id],
  });

  if (r.rowsAffected <= 0) throw new Error("Failed to delete the task");
}

// Get task with oldest timestamp with reply '' for this user that is ready to trigger (timestamp <= now)
export async function getNextTask(user_id: string): Promise<Task | null> {
  const db = getDatabase();
  const currentTimeSeconds = Math.floor(Date.now() / 1000); // Convert milliseconds to seconds
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
          FROM tasks
          WHERE user_id = ? AND state = '' AND timestamp <= ? AND (deleted IS NULL OR deleted = FALSE)
          ORDER BY timestamp ASC
          LIMIT 1`,
    args: [user_id, currentTimeSeconds],
  });

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    timestamp: row.timestamp as number,
    task: row.task as string,
    reply: row.reply as string,
    state: row.state as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
    title: (row.title as string) || '',
    cron: (row.cron as string) || '',
  };
}

// Get task by user_id and id
export async function getTask(
  user_id: string,
  id: string
): Promise<Task> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, reply, state, thread_id, error, type, title, cron
          FROM tasks
          WHERE user_id = ? AND id = ? AND (deleted IS NULL OR deleted = FALSE)`,
    args: [user_id, id],
  });

  if (result.rows.length === 0) throw new Error("Task not found");

  const row = result.rows[0];
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    timestamp: row.timestamp as number,
    task: row.task as string,
    reply: row.reply as string,
    state: row.state as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
    title: (row.title as string) || '',
    cron: (row.cron as string) || '',
  };
}

// Finish task - error if user_id+timestamp not found or already reply !== '', error if input reply === ''
export async function finishTask(
  user_id: string,
  id: string,
  thread_id: string,
  reply: string,
  error: string
): Promise<void> {
  if (reply === "") throw new Error("Reply cannot be empty");

  const db = getDatabase();

  // Determine state based on reply and error
  let state = "";
  if (error !== "") {
    state = "error";
  } else if (reply !== "") {
    state = "finished";
  }

  // Update the task
  const r = await db.execute({
    sql: `UPDATE tasks
          SET reply = ?, state = ?, thread_id = ?, error = ?
          WHERE user_id = ? AND id = ? AND (deleted IS NULL OR deleted = FALSE) AND reply = ''`,
    args: [reply, state, thread_id, error, user_id, id],
  });
  if (r.rowsAffected <= 0) throw new Error("Task deleted or already finished");
}

// Update task - updates all fields of an existing task
export async function updateTask(task: Task): Promise<void> {
  const db = getDatabase();

  // Update the task with all provided values
  const r = await db.execute({
    sql: `UPDATE tasks
          SET user_id = ?, timestamp = ?, task = ?, reply = ?, state = ?, thread_id = ?, error = ?, type = ?, title = ?, cron = ?
          WHERE id = ? AND (deleted IS NULL OR deleted = FALSE)`,
    args: [
      task.user_id,
      task.timestamp,
      task.task,
      task.reply,
      task.state,
      task.thread_id,
      task.error,
      task.type,
      task.title,
      task.cron,
      task.id
    ],
  });

  if (r.rowsAffected <= 0) throw new Error("Task not found or already deleted");
}

// // Undelete task by ID - returns true if task was found and undeleted, false if not found
// export async function undeleteTask(
//   user_id: string,
//   id: string
// ): Promise<void> {
//   const db = getDatabase();

//   const r = await db.execute({
//     sql: `UPDATE tasks SET deleted = FALSE WHERE id = ? AND user_id = ? AND deleted = TRUE`,
//     args: [id, user_id],
//   });
//   if (r.rowsAffected <= 0) throw new Error("Failed to undelete the task");
// }

// Check if there's a planner task within the last 24 hours
export async function hasPlannerTaskInLast24Hours(user_id: string): Promise<boolean> {
  const db = getDatabase();
  const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
  
  const result = await db.execute({
    sql: `SELECT COUNT(*) as count
          FROM tasks
          WHERE user_id = ? AND type = ? AND timestamp >= ? AND (deleted IS NULL OR deleted = FALSE)`,
    args: [user_id, TASK_TYPE_PLANNER, twentyFourHoursAgo],
  });

  const count = result.rows[0]?.count as number;
  return count > 0;
}

// Check if there's a cron task of a specific type
export async function hasCronTaskOfType(user_id: string, taskType: string): Promise<boolean> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: `SELECT COUNT(*) as count
          FROM tasks
          WHERE user_id = ? AND type = ? AND cron != '' AND (deleted IS NULL OR deleted = FALSE)`,
    args: [user_id, taskType],
  });

  const count = result.rows[0]?.count as number;
  return count > 0;
}

// Get the next midnight timestamp in local time
// FIXME: This assumes the server's timezone is the user's local timezone.
// In a multi-user system, this should be configurable per user or use a specific timezone.
export function getNextMidnightTimestamp(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 1, 0, 0); // 00:01 to make sure "today" means today
  return Math.floor(tomorrow.getTime() / 1000);
}
