import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface TeamRoom {
  id: string;
  name: string;
  createdAt: number;
}

export interface RoomParticipant {
  id: string;
  roomId: string;
  dotId: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  createdAt: number;
}

export interface Minutes {
  id: string;
  roomId: string;
  content: string;
  version: number;
  createdAt: number;
}

export interface ProposedTask {
  id: string;
  roomId: string;
  description: string;
  ownerId: string;
  status: 'draft' | 'pending_approval' | 'approved';
  createdAt: number;
}

export class TeamRoomStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS team_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_participants (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        dotId TEXT NOT NULL,
        FOREIGN KEY (roomId) REFERENCES team_rooms (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS room_messages (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        senderId TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (roomId) REFERENCES team_rooms (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS minutes (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (roomId) REFERENCES team_rooms (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS proposed_tasks (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        description TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (roomId) REFERENCES team_rooms (id) ON DELETE CASCADE
      );
    `);
  }

  createRoom(name: string): TeamRoom {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO team_rooms (id, name, createdAt) VALUES (?, ?, ?)').run(id, name, now);
    return { id, name, createdAt: now };
  }

  addParticipant(roomId: string, dotId: string): RoomParticipant {
    const id = randomUUID();
    this.db.prepare('INSERT INTO room_participants (id, roomId, dotId) VALUES (?, ?, ?)').run(id, roomId, dotId);
    return { id, roomId, dotId };
  }

  // Phase 1 implementation blocks on full AG-UI orchestration for the frontend
}
