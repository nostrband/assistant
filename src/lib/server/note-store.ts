import { generateId } from 'ai';
import getDatabase from './database';

export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string; // JSON string
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
}

export interface NoteListItem {
  id: string;
  user_id: string;
  title: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  created: string;
  updated: string;
  snippet?: string; // For search results
}

function rowToNote(row: NoteRow): Note {
  return {
    ...row,
    tags: JSON.parse(row.tags),
  };
}

function rowToNoteListItem(row: NoteRow, snippet?: string): NoteListItem {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    tags: JSON.parse(row.tags),
    priority: row.priority,
    created: row.created,
    updated: row.updated,
    snippet,
  };
}

export async function validateCreateNote(
  userId: string,
  title: string,
  content: string,
  tags: string[] = []
): Promise<void> {
  const db = getDatabase();
  
  // Check if user already has 500 notes
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM notes WHERE user_id = ?',
    args: [userId]
  });
  
  const count = countResult.rows[0]?.count as number;
  if (count >= 500) {
    throw new Error('Maximum number of notes (500) reached');
  }
  
  // Check title + content + tags size (50KB limit)
  const tagsJson = JSON.stringify(tags);
  const totalSize = new TextEncoder().encode(title + content + tagsJson).length;
  if (totalSize > 50 * 1024) {
    throw new Error('Note size exceeds 50KB limit');
  }
}

export async function createNote(
  userId: string,
  title: string,
  content: string,
  tags: string[] = [],
  priority: 'low' | 'medium' | 'high' = 'low',
  id?: string
): Promise<Note> {
  const db = getDatabase();
  
  const noteId = id || generateId();
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(tags);
  
  await db.execute({
    sql: `INSERT INTO notes (id, user_id, title, content, tags, priority, created, updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [noteId, userId, title, content, tagsJson, priority, now, now]
  });
  
  return {
    id: noteId,
    user_id: userId,
    title,
    content,
    tags,
    priority,
    created: now,
    updated: now,
  };
}

export async function validateUpdateNote(
  userId: string,
  noteId: string,
  updates: {
    title?: string;
    content?: string;
    tags?: string[];
    priority?: 'low' | 'medium' | 'high';
  }
): Promise<{ existing: NoteRow; newTitle: string; newContent: string; newTags: string[]; newPriority: 'low' | 'medium' | 'high' }> {
  const db = getDatabase();
  
  // First, get the existing note
  const existingResult = await db.execute({
    sql: 'SELECT * FROM notes WHERE id = ? AND user_id = ?',
    args: [noteId, userId]
  });
  
  if (existingResult.rows.length === 0) {
    throw new Error('Note not found');
  }
  
  const existing = existingResult.rows[0] as unknown as NoteRow;
  
  // Prepare updated values
  const newTitle = updates.title ?? existing.title;
  const newContent = updates.content ?? existing.content;
  const newTags = updates.tags ?? JSON.parse(existing.tags);
  const newPriority = updates.priority ?? existing.priority;
  
  // Check title + content + tags size (50KB limit)
  const tagsJson = JSON.stringify(newTags);
  const totalSize = new TextEncoder().encode(newTitle + newContent + tagsJson).length;
  if (totalSize > 50 * 1024) {
    throw new Error('Note size exceeds 50KB limit');
  }
  
  return { existing, newTitle, newContent, newTags, newPriority };
}

export async function updateNote(
  userId: string,
  noteId: string,
  newTitle: string,
  newContent: string,
  newTags: string[],
  newPriority: 'low' | 'medium' | 'high',
  existingCreated: string
): Promise<Note> {
  const db = getDatabase();
  
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(newTags);
  
  await db.execute({
    sql: `UPDATE notes
          SET title = ?, content = ?, tags = ?, priority = ?, updated = ?
          WHERE id = ? AND user_id = ?`,
    args: [newTitle, newContent, tagsJson, newPriority, now, noteId, userId]
  });
  
  return {
    id: noteId,
    user_id: userId,
    title: newTitle,
    content: newContent,
    tags: newTags,
    priority: newPriority,
    created: existingCreated,
    updated: now,
  };
}

export async function searchNotes(
  userId: string,
  query?: {
    keywords?: string[];
    tags?: string[];
    regexp?: string;
  }
): Promise<NoteListItem[]> {
  const db = getDatabase();
  
  // Get all notes for the user
  const result = await db.execute({
    sql: 'SELECT * FROM notes WHERE user_id = ? ORDER BY updated DESC',
    args: [userId]
  });
  
  const notes = result.rows as unknown as NoteRow[];
  const filteredNotes: NoteListItem[] = [];
  
  for (const note of notes) {
    let matches = true;
    let snippet: string | undefined;
    
    if (query) {
      // Check tags filter
      if (query.tags && query.tags.length > 0) {
        const noteTags = JSON.parse(note.tags);
        const hasMatchingTag = query.tags.some(tag => 
          noteTags.some((noteTag: string) => 
            noteTag.toLowerCase().includes(tag.toLowerCase())
          )
        );
        if (!hasMatchingTag) {
          matches = false;
        }
      }
      
      // Check keywords filter
      if (matches && query.keywords && query.keywords.length > 0) {
        const searchText = (note.title + ' ' + note.content).toLowerCase();
        const hasMatchingKeyword = query.keywords.some(keyword => 
          searchText.includes(keyword.toLowerCase())
        );
        if (!hasMatchingKeyword) {
          matches = false;
        } else {
          // Generate snippet for content matches
          const contentLower = note.content.toLowerCase();
          for (const keyword of query.keywords) {
            const keywordLower = keyword.toLowerCase();
            const index = contentLower.indexOf(keywordLower);
            if (index !== -1) {
              const start = Math.max(0, index - 50);
              const end = Math.min(note.content.length, index + keyword.length + 50);
              snippet = '...' + note.content.slice(start, end) + '...';
              break;
            }
          }
        }
      }
      
      // Check regexp filter
      if (matches && query.regexp) {
        try {
          const regex = new RegExp(query.regexp, 'i');
          const searchText = note.title + ' ' + note.content;
          const regexMatch = regex.exec(searchText);
          if (!regexMatch) {
            matches = false;
          } else {
            // Generate snippet for regex matches in content
            const contentMatch = regex.exec(note.content);
            if (contentMatch) {
              const index = contentMatch.index;
              const start = Math.max(0, index - 50);
              const end = Math.min(note.content.length, index + contentMatch[0].length + 50);
              snippet = '...' + note.content.slice(start, end) + '...';
            }
          }
        } catch {
          throw new Error('Invalid regular expression');
        }
      }
    }
    
    if (matches) {
      filteredNotes.push(rowToNoteListItem(note, snippet));
    }
  }
  
  return filteredNotes;
}

export async function listNotes(
  userId: string,
  options?: {
    priority?: 'low' | 'medium' | 'high';
    limit?: number;
    offset?: number;
  }
): Promise<NoteListItem[]> {
  const db = getDatabase();
  
  let sql = 'SELECT * FROM notes WHERE user_id = ?';
  const args: (string | number)[] = [userId];
  
  if (options?.priority) {
    sql += ' AND priority = ?';
    args.push(options.priority);
  }
  
  sql += ' ORDER BY updated DESC';
  
  if (options?.limit) {
    sql += ' LIMIT ?';
    args.push(options.limit);
    
    if (options?.offset) {
      sql += ' OFFSET ?';
      args.push(options.offset);
    }
  }
  
  const result = await db.execute({
    sql,
    args
  });
  
  const notes = result.rows as unknown as NoteRow[];
  return notes.map(note => rowToNoteListItem(note));
}

export async function getNote(userId: string, noteId: string): Promise<Note | null> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: 'SELECT * FROM notes WHERE id = ? AND user_id = ?',
    args: [noteId, userId]
  });
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToNote(result.rows[0] as unknown as NoteRow);
}

export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  const db = getDatabase();
  
  const result = await db.execute({
    sql: 'DELETE FROM notes WHERE id = ? AND user_id = ?',
    args: [noteId, userId]
  });
  
  return result.rowsAffected > 0;
}