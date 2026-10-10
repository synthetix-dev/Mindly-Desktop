import { backup, DatabaseSync } from 'node:sqlite';
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
      CREATE INDEX IF NOT EXISTS approved_tasks_status
        ON approved_tasks(status, createdAt);
    `);
    // A process crash cannot prove whether external side effects happened. Make the owner review
    // interrupted work instead of silently executing it twice.
    this.db
      .prepare(
        `UPDATE approved_tasks SET status='needs_review', artifacts=? WHERE status='running'`,
      )
      .run(JSON.stringify({ error: 'Execution was interrupted by a process restart.' }));
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
      const task = this.db.prepare(`SELECT * FROM approved_tasks WHERE status='approved' OR status='queued' ORDER BY createdAt ASC LIMIT 1`).get() as ApprovedTask | undefined;
      if (task) {
        this.db.prepare(`UPDATE approved_tasks SET status='running' WHERE id=?`).run(task.id);
        task.status = 'running';
      }
      this.db.exec('COMMIT');
      return task;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  tasks(): ApprovedTask[] {
    return this.db
      .prepare('SELECT * FROM approved_tasks ORDER BY createdAt DESC')
      .all() as unknown as ApprovedTask[];
  }

  task(id: string): ApprovedTask | undefined {
    return this.db
      .prepare('SELECT * FROM approved_tasks WHERE id=?')
      .get(id) as unknown as ApprovedTask | undefined;
  }

  approve(id: string): ApprovedTask | undefined {
    this.db
      .prepare(
        `UPDATE approved_tasks SET status='queued' WHERE id=? AND status='pending_approval'`,
      )
      .run(id);
    return this.task(id);
  }

  cancel(id: string): ApprovedTask | undefined {
    this.db
      .prepare(
        `UPDATE approved_tasks SET status='cancelled' WHERE id=? AND status IN ('pending_approval', 'queued', 'needs_review')`,
      )
      .run(id);
    return this.task(id);
  }

  markFailed(id: string, error: string) {
    this.db
      .prepare(`UPDATE approved_tasks SET status='failed', artifacts=? WHERE id=?`)
      .run(JSON.stringify({ error }), id);
  }

  markNeedsReview(id: string, artifacts: string) {
    this.db
      .prepare(
        `UPDATE approved_tasks SET artifacts=?, status='needs_review' WHERE id=? AND status='running'`,
      )
      .run(artifacts, id);
  }

  markCompleted(id: string, artifacts: string) {
    this.db
      .prepare(
        `UPDATE approved_tasks SET artifacts=?, status='completed' WHERE id=? AND status='running'`,
      )
      .run(artifacts, id);
  }

  completeReview(id: string): ApprovedTask | undefined {
    this.db
      .prepare(
        `UPDATE approved_tasks SET status='completed' WHERE id=? AND status='needs_review'`,
      )
      .run(id);
    return this.task(id);
  }

  async backupTo(path: string) {
    await backup(this.db, path);
  }

  close() {
    this.db.close();
  }
}
