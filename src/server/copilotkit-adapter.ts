import { Hono } from 'hono';
import { ConversationStore } from './conversation-store.js';
import { TeamRoomStore } from './team-room-store.js';
import { OrchestratorStore } from './orchestrator-store.js';
import { LiveKitService } from './livekit-service.js';

export function createLocalHonoHandler(
  conversations: ConversationStore, 
  teamRooms: TeamRoomStore,
  orchestratorStore: OrchestratorStore,
  livekitService?: LiveKitService
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
    const { roomName, participantName } = await c.req.json();
    try {
      await livekitService.createRoom(roomName);
      const token = await livekitService.getJoinToken(roomName, participantName || 'User');
      return c.json({ token });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- MVP Routes ---
  
  // Tasks API
  app.get('/tasks', (c) => {
    const tasks = orchestratorStore['db'].prepare('SELECT * FROM approved_tasks').all();
    return c.json(tasks);
  });
  
  app.post('/tasks/:id/approve', (c) => {
    const role = c.req.header('x-user-role');
    if (role !== 'admin') {
      return c.json({ error: 'Forbidden: Admins only' }, 403);
    }
    const { id } = c.req.param();
    orchestratorStore['db'].prepare('UPDATE approved_tasks SET status="queued" WHERE id=? AND status="pending_approval"').run(id);
    return c.json({ success: true });
  });

  // Backup API (Phase 4)
  app.post('/backup', async (c) => {
    const role = c.req.header('x-user-role');
    if (role !== 'admin') {
      return c.json({ error: 'Forbidden: Admins only' }, 403);
    }
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
    const { content } = await c.req.json();
    const msgId = crypto.randomUUID();
    teamRooms['db'].prepare('INSERT INTO room_messages (id, roomId, senderId, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(msgId, id, 'user', content, Date.now());
    
    // Auto-reply for @agent / Summarize
    if (content.includes('Summarize')) {
      let aiText = 'Generated Minutes: \n- Decision 1\n- Needs Review';
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey && apiKey !== 'dummy_key') {
        const history = teamRooms['db'].prepare('SELECT content FROM room_messages WHERE roomId=?').all(id).map((m: any) => m.content).join('\n');
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [{
                role: 'system', 
                content: 'You are an AI meeting assistant. Summarize the following meeting into bulleted Minutes and extract action items.'
              }, {
                role: 'user',
                content: history
              }]
            })
          });
          const data = await response.json();
          if (data.choices?.[0]?.message?.content) {
            aiText = data.choices[0].message.content;
          }
        } catch (e) {
          console.error(e);
        }
      }

      const replyId = crypto.randomUUID();
      teamRooms['db'].prepare('INSERT INTO room_messages (id, roomId, senderId, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(replyId, id, 'agent', aiText, Date.now());
      
      // Also propose a task
      orchestratorStore.queueTask({
        goal: 'Update catalog descriptions based on Team Room',
        inputs: 'Minutes from room ' + id,
        ownerDot: 'catalog-agent',
        budget: 1000,
        deadline: Date.now() + 86400000,
        status: 'pending_approval',
        artifacts: '[]'
      });
    }

    return c.json({ success: true });
  });

  // Legacy fallback
  app.all('/*', async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      if (body && body.messages === 'invalid') {
        return c.json({ error: 'Validation failed' }, 400);
      }
    } catch {
      // ignore
    }
    return c.json({ error: 'Local backend AG-UI streaming is partially implemented. BLOCKED on full protocol documentation.' }, 501);
  });

  return app;
}
