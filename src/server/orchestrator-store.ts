import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface ApprovedTask {
  id: string;
  goal: string;
  inputs: string;
  ownerDot: string;
  budget: number;
  deadline: number;
  status: 'pending_approval' | 'approved' | 'queued' | 'running' | 'needs_review' | 'failed' | 'completed' | 'cancelled';
  artifacts: string;
  createdAt: number;
}

export class OrchestratorStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS approved_tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        inputs TEXT NOT NULL,
        ownerDot TEXT NOT NULL,
        budget INTEGER NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL,
        artifacts TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);
  }

  queueTask(task: Omit<ApprovedTask, 'id' | 'createdAt'>): ApprovedTask {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO approved_tasks (id, goal, inputs, ownerDot, budget, deadline, status, artifacts, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, task.goal, task.inputs, task.ownerDot, task.budget, task.deadline, task.status, task.artifacts, now);
    
    return { id, ...task, createdAt: now };
  }

  claimNextTask(): ApprovedTask | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.db.prepare('SELECT * FROM approved_tasks WHERE status="approved" OR status="queued" ORDER BY createdAt ASC LIMIT 1').get() as ApprovedTask | undefined;
      if (task) {
        this.db.prepare('UPDATE approved_tasks SET status="running" WHERE id=?').run(task.id);
        task.status = 'running';
      }
      this.db.exec('COMMIT');
      return task;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  markFailed(id: string, error: string) {
    this.db.prepare('UPDATE approved_tasks SET status="failed", artifacts=? WHERE id=?').run(error, id);
  }

  markCompleted(id: string) {
    this.db.prepare('UPDATE approved_tasks SET status="completed" WHERE id=?').run(id);
  }
}
