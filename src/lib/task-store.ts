// import "server-only";
import { generateId } from "ai";
import getDatabase from "./database";

export interface Task {
  id: string;
  user_id: string;
  timestamp: number;
  task: string;
  status: string;
  thread_id: string;
  error: string;
}

// Set a new task - fails if task for this timestamp already exists for this user
export async function setTask(
  user_id: string,
  timestamp: number,
  task: string
): Promise<void> {
  const db = getDatabase();
  const id = generateId();

  // Check if task already exists for this user and timestamp
  const existingTask = await db.execute({
    sql: "SELECT id FROM tasks WHERE user_id = ? AND timestamp = ?",
    args: [user_id, timestamp]
  });

  if (existingTask.rows.length > 0) {
    throw new Error(`Task already exists for user ${user_id} at timestamp ${timestamp}`);
  }

  // Insert new task
  await db.execute({
    sql: `INSERT INTO tasks (id, user_id, timestamp, task, status, thread_id, error)
          VALUES (?, ?, ?, ?, '', '', '')`,
    args: [id, user_id, timestamp, task]
  });
}

// List all tasks whose status is ''
export async function listTasks(): Promise<Task[]> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, status, thread_id, error
          FROM tasks
          WHERE status = ''
          ORDER BY timestamp ASC`,
    args: []
  });

  return result.rows.map(row => ({
    id: row.id as string,
    user_id: row.user_id as string,
    timestamp: row.timestamp as number,
    task: row.task as string,
    status: row.status as string,
    thread_id: row.thread_id as string,
    error: row.error as string
  }));
}

// List tasks with optional filtering - returns up to 100 most recent tasks
export async function listTasksWithOptions(
  include_finished: boolean = false,
  until?: number
): Promise<Task[]> {
  const db = getDatabase();
  
  let sql = `SELECT id, user_id, timestamp, task, status, thread_id, error
             FROM tasks`;
  const args: (string | number)[] = [];
  
  const conditions: string[] = [];
  
  // Filter by status if not including finished tasks
  if (!include_finished) {
    conditions.push("status = ''");
  }
  
  // Filter by until timestamp if provided
  if (until !== undefined) {
    conditions.push("timestamp <= ?");
    args.push(until);
  }
  
  // Add WHERE clause if we have conditions
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  
  // Order by timestamp descending (most recent first) and limit to 100
  sql += ` ORDER BY timestamp DESC LIMIT 100`;
  
  const result = await db.execute({
    sql,
    args
  });

  return result.rows.map(row => ({
    id: row.id as string,
    user_id: row.user_id as string,
    timestamp: row.timestamp as number,
    task: row.task as string,
    status: row.status as string,
    thread_id: row.thread_id as string,
    error: row.error as string
  }));
}

// Delete task - ignore error if not found
export async function deleteTask(
  user_id: string,
  timestamp: number
): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: `DELETE FROM tasks WHERE user_id = ? AND timestamp = ?`,
    args: [user_id, timestamp]
  });
}

// Delete task by ID - returns true if task was found and deleted, false if not found
export async function deleteTaskById(id: string, user_id: string): Promise<boolean> {
  const db = getDatabase();
  
  // First check if task exists for this user
  const existingTask = await db.execute({
    sql: "SELECT id FROM tasks WHERE id = ? AND user_id = ?",
    args: [id, user_id]
  });
  
  if (existingTask.rows.length === 0) {
    return false;
  }
  
  // Delete the task
  await db.execute({
    sql: `DELETE FROM tasks WHERE id = ? AND user_id = ?`,
    args: [id, user_id]
  });
  
  return true;
}

// Get task with oldest timestamp with status '' for this user that is ready to trigger (timestamp <= now)
export async function getNextTask(user_id: string): Promise<Task | null> {
  const db = getDatabase();
  const currentTimeSeconds = Math.floor(Date.now() / 1000); // Convert milliseconds to seconds
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, status, thread_id, error
          FROM tasks
          WHERE user_id = ? AND status = '' AND timestamp <= ?
          ORDER BY timestamp ASC
          LIMIT 1`,
    args: [user_id, currentTimeSeconds]
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
    error: row.error as string
  };
}

// Get task by user_id and timestamp
export async function getTask(user_id: string, timestamp: number): Promise<Task | null> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT id, user_id, timestamp, task, status, thread_id, error
          FROM tasks
          WHERE user_id = ? AND timestamp = ?`,
    args: [user_id, timestamp]
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
    error: row.error as string
  };
}

// Finish task - error if user_id+timestamp not found or already status !== '', error if input status === ''
export async function finishTask(
  user_id: string,
  timestamp: number,
  thread_id: string,
  status: string,
  error: string
): Promise<void> {
  if (status === '') {
    throw new Error("Status cannot be empty");
  }

  const db = getDatabase();

  // Check if task exists and get current status
  const existingTaskResult = await db.execute({
    sql: "SELECT status FROM tasks WHERE user_id = ? AND timestamp = ?",
    args: [user_id, timestamp]
  });

  if (existingTaskResult.rows.length === 0) {
    throw new Error(`Task not found for user ${user_id} at timestamp ${timestamp}`);
  }

  const existingTask = existingTaskResult.rows[0];
  if (existingTask.status !== '') {
    throw new Error(`Task for user ${user_id} at timestamp ${timestamp} already has status: ${existingTask.status}`);
  }

  // Update the task
  await db.execute({
    sql: `UPDATE tasks
          SET status = ?, thread_id = ?, error = ?
          WHERE user_id = ? AND timestamp = ?`,
    args: [status, thread_id, error, user_id, timestamp]
  });
}