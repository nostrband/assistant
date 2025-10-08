// import "server-only";
import { generateId } from "ai";
import getDatabase from "./database";
import { TASK_TYPE_PLANNER } from "../const";

export interface Task {
  id: string;
  user_id: string;
  timestamp: number;
  task: string;
  status: string;
  thread_id: string;
  error: string;
  type: string;
}

// Set a new task - fails if task for this timestamp already exists for this user
export async function addTask(
  user_id: string,
  timestamp: number,
  task: string,
  type: string = ''
): Promise<string> {
  const db = getDatabase();
  const id = generateId();

  // Insert new task
  await db.execute({
    sql: `INSERT INTO tasks (id, user_id, timestamp, task, status, thread_id, error, type)
          VALUES (?, ?, ?, ?, '', '', '', ?)`,
    args: [id, user_id, timestamp, task, type],
  });

  return id;
}

// List tasks - returns up to 100 most recent tasks
export async function listTasks(
  include_finished: boolean = false,
  until?: number
): Promise<Task[]> {
  const db = getDatabase();

  let sql = `SELECT id, user_id, timestamp, task, status, thread_id, error, type
             FROM tasks`;
  const args: (string | number)[] = [];

  const conditions: string[] = [];

  // Filter by status if not including finished tasks
  if (!include_finished) {
    conditions.push("status = ''");
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
    status: row.status as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
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

// Get task with oldest timestamp with status '' for this user that is ready to trigger (timestamp <= now)
export async function getNextTask(user_id: string): Promise<Task | null> {
  const db = getDatabase();
  const currentTimeSeconds = Math.floor(Date.now() / 1000); // Convert milliseconds to seconds
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, status, thread_id, error, type
          FROM tasks
          WHERE user_id = ? AND status = '' AND timestamp <= ? AND (deleted IS NULL OR deleted = FALSE)
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
    status: row.status as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
  };
}

// Get task by user_id and id
export async function getTask(
  user_id: string,
  id: string
): Promise<Task> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, status, thread_id, error, type
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
    status: row.status as string,
    thread_id: row.thread_id as string,
    error: row.error as string,
    type: (row.type as string) || '',
  };
}

// Finish task - error if user_id+timestamp not found or already status !== '', error if input status === ''
export async function finishTask(
  user_id: string,
  id: string,
  thread_id: string,
  status: string,
  error: string
): Promise<void> {
  if (status === "") throw new Error("Status cannot be empty");

  const db = getDatabase();

  // Update the task
  const r = await db.execute({
    sql: `UPDATE tasks
          SET status = ?, thread_id = ?, error = ?
          WHERE user_id = ? AND id = ? AND (deleted IS NULL OR deleted = FALSE) AND status = ''`,
    args: [status, thread_id, error, user_id, id],
  });
  if (r.rowsAffected <= 0) throw new Error("Task deleted or already finished");
}

// Undelete task by ID - returns true if task was found and undeleted, false if not found
export async function undeleteTask(
  user_id: string,
  id: string
): Promise<void> {
  const db = getDatabase();

  const r = await db.execute({
    sql: `UPDATE tasks SET deleted = FALSE WHERE id = ? AND user_id = ? AND deleted = TRUE`,
    args: [id, user_id],
  });
  if (r.rowsAffected <= 0) throw new Error("Failed to undelete the task");
}

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
