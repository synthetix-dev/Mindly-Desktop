import { Hono } from 'hono';
import { ConversationStore } from './conversation-store.js';
import { TeamRoomStore } from './team-room-store.js';
import { OrchestratorStore } from './orchestrator-store.js';
import { LiveKitService } from './livekit-service.js';
import crypto from 'crypto';
import { Platform } from './platform.js';

export function createLocalHonoHandler(
  conversations: ConversationStore, 
  teamRooms: TeamRoomStore,
  orchestratorStore: OrchestratorStore,
  livekitService?: LiveKitService,
  platform?: Platform
) {
  const app = new Hono().basePath('/api/copilotkit');

  // AG-UI Info Stub
  app.all('/info', (c) => {
    return c.json({
      mode: 'intelligence',
      intelligence: { wsUrl: 'ws://localhost' },
      agents: { 'dot-1': {} }
    });
  });

  // LiveKit API (Phase 5)
  app.post('/livekit/token', async (c) => {
    if (!livekitService?.isConfigured()) {
      return c.json({ error: 'LiveKit is not configured in .env' }, 500);
    }
    const { roomName, participantName, dotId } = await c.req.json();
    try {
      await livekitService.createRoom(roomName);
      const token = await livekitService.getJoinToken(roomName, participantName || 'User');
      return c.json({ token, dotId });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // REST bridge for LiveKit Agents
  app.post('/livekit/turn', async (c) => {
    if (!platform) return c.json({ error: 'Platform unavailable' }, 500);
    try {
      const { roomId, prompt, dotId } = await c.req.json();
      
      const targetDotId = dotId || platform.workspace.dots()[0].id;
      const threadId = `${roomId}-${targetDotId}`; 
      
      try {
        platform.workspace.requireThread(threadId);
      } catch {
        platform.workspace.bindThread(threadId, targetDotId, `Voice Room ${roomId}`);
        if (platform['threads']) {
           await platform['threads'].getOrCreateThread({ threadId, name: `Voice Room ${roomId}` });
        }
      }

      const controller = new AbortController();
      const res = await platform.turnDetailed(threadId, prompt, controller.signal, { opendotsSource: 'voice_receipt' });
      return c.json({ text: res.text, toolCalls: res.toolCalls });
    } catch (e: any) {
      console.error('LiveKit Turn Error:', e);
      return c.json({ error: String(e.message || e) }, 500);
    }
  });

  // --- MVP Routes ---
  
  // Tasks API
  app.get('/tasks', (c) => {
    const tasks = orchestratorStore['db'].prepare('SELECT * FROM approved_tasks').all();
    return c.json(tasks);
  });
  
  app.post('/tasks/:id/approve', (c) => {
    // Relying on ownerToken middleware in app.ts for authorization
    const { id } = c.req.param();
    orchestratorStore['db'].prepare('UPDATE approved_tasks SET status="queued" WHERE id=? AND status="pending_approval"').run(id);
    return c.json({ success: true });
  });

  // Backup API (Phase 4)
  app.post('/backup', async (c) => {
    // Relying on ownerToken middleware in app.ts for authorization
    try {
      const fs = await import('node:fs/promises');
      await fs.mkdir('data/backups', { recursive: true });
      const timestamp = Date.now();
      await fs.copyFile('data/conversations.sqlite', `data/backups/conversations_${timestamp}.sqlite`).catch(() => {});
      await fs.copyFile('data/team_rooms.sqlite', `data/backups/team_rooms_${timestamp}.sqlite`).catch(() => {});
      await fs.copyFile('data/orchestrator.sqlite', `data/backups/orchestrator_${timestamp}.sqlite`).catch(() => {});
      return c.json({ success: true, timestamp });
    } catch (e) {
      return c.json({ error: 'Backup failed' }, 500);
    }
  });

  // Team Room API
  app.get('/rooms/:id/messages', (c) => {
    const { id } = c.req.param();
    const messages = teamRooms['db'].prepare('SELECT * FROM room_messages WHERE roomId=? ORDER BY createdAt ASC').all(id);
    return c.json(messages);
  });

  app.post('/rooms/:id/messages', async (c) => {
    const { id } = c.req.param();
    const { content, activeDots } = await c.req.json();
    const msgId = crypto.randomUUID();
    teamRooms['db'].prepare('INSERT INTO room_messages (id, roomId, senderId, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(msgId, id, 'user', content, Date.now());
    
    if (content.includes('@') || content.includes('Summarize')) {
      if (platform) {
        const dotsToCall = Array.isArray(activeDots) && activeDots.length > 0 
          ? activeDots 
          : [platform.workspace.dots()[0].id];
        
        for (const dotId of dotsToCall) {
          try {
            const threadId = `${id}-${dotId}`;
            try {
              platform.workspace.requireThread(threadId);
            } catch {
              platform.workspace.bindThread(threadId, dotId, `Team Room ${id} - Agent ${dotId}`);
              if (platform['threads']) {
                 await platform['threads'].getOrCreateThread({ threadId, name: `Team Room ${id} - Agent ${dotId}` });
              }
            }

            const controller = new AbortController();
            const result = await platform.turnDetailed(threadId, content, controller.signal, { opendotsSource: 'team_room' });
            if (result.text) {
              const replyId = crypto.randomUUID();
              teamRooms['db'].prepare('INSERT INTO room_messages (id, roomId, senderId, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(replyId, id, dotId, result.text, Date.now());
            }
          } catch (e) {
            console.error(`Agent ${dotId} Team Room error`, e);
          }
        }
      }
    }

    return c.json({ success: true });
  });

  return app;
}
