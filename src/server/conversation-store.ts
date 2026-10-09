import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolCalls?: string;
  createdAt: number;
}

export interface Turn {
  id: string;
  conversationId: string;
  status: string;
  createdAt: number;
}

export interface AgentState {
  id: string;
  conversationId: string;
  state: string;
  updatedAt: number;
}

export interface ToolApproval {
  id: string;
  conversationId: string;
  toolCallId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export class ConversationStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL; 
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        toolCalls TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS agent_state (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        state TEXT NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tool_approvals (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        toolCallId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS thread_runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        threadId TEXT NOT NULL,
        runId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        events TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS thread_runs_thread ON thread_runs(threadId, seq);
      CREATE INDEX IF NOT EXISTS msgs_conv ON messages(conversationId, createdAt);
      CREATE INDEX IF NOT EXISTS turns_conv ON turns(conversationId, createdAt);
    `);
  }

  createConversation(id: string, title: string): Conversation {
    const now = Date.now();
    this.db.prepare('INSERT INTO conversations (id, title, createdAt) VALUES (?, ?, ?)').run(id, title, now);
    return { id, title, createdAt: now };
  }

  getConversation(id: string): Conversation | undefined {
    return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as Conversation | undefined;
  }

  addMessage(conversationId: string, role: string, content: string, toolCalls?: string): Message {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO messages (id, conversationId, role, content, toolCalls, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, conversationId, role, content, toolCalls || null, now);
    return { id, conversationId, role, content, toolCalls, createdAt: now };
  }

  getMessages(conversationId: string): Message[] {
    return this.db.prepare('SELECT * FROM messages WHERE conversationId=? ORDER BY createdAt ASC').all(conversationId) as unknown as Message[];
  }

  /** Event-sourced AG-UI history: one row per completed run (compacted events). */
  saveRun(threadId: string, runId: string, agentId: string, events: unknown[]) {
    if (!events.length) return;
    this.db
      .prepare(
        'INSERT INTO thread_runs (threadId, runId, agentId, events, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(threadId, runId, agentId, JSON.stringify(events), Date.now());
  }

  loadRuns(
    threadId: string,
  ): { runId: string; agentId: string; events: any[]; createdAt: number }[] {
    return (
      this.db
        .prepare(
          'SELECT runId, agentId, events, createdAt FROM thread_runs WHERE threadId=? ORDER BY seq ASC',
        )
        .all(threadId) as unknown as {
        runId: string;
        agentId: string;
        events: string;
        createdAt: number;
      }[]
    ).map((row) => ({ ...row, events: JSON.parse(row.events) }));
  }

  close() {
    this.db.close();
  }
}
