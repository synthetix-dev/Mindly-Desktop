import { Hono } from 'hono';
import { z } from 'zod';
import type { TeamRoomStore } from './team-room-store.js';
import type { OrchestratorStore } from './orchestrator-store.js';
import type { LiveKitService } from './livekit-service.js';
import type { Platform } from './platform.js';

const id = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const roomMessage = z
  .object({
    content: z.string().trim().min(1).max(8_000),
    activeDots: z.array(id).max(12).default([]),
  })
  .strict();
const taskInput = z
  .object({
    goal: z.string().trim().min(3).max(2_000),
    inputs: z.string().max(200_000).default(''),
    ownerDot: id,
    budget: z.number().int().min(1).max(1_000_000).default(1_000),
    deadline: z.number().int().positive(),
  })
  .strict();

/** Product-specific APIs registered before the CopilotKit AG-UI wildcard route. */
export function createLocalHonoHandler(
  teamRooms: TeamRoomStore,
  orchestratorStore: OrchestratorStore,
  livekitService: LiveKitService,
  platform: Platform,
) {
  const app = new Hono().basePath('/api/copilotkit');

  app.post('/livekit/token', async (c) => {
    const parsed = z
      .object({
        roomName: id,
        participantName: z.string().trim().min(1).max(80),
        dotId: id.optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Invalid voice room request.' }, 400);
    if (!livekitService.isConfigured())
      return c.json({ error: 'LiveKit is not configured.' }, 503);
    if (parsed.data.dotId && !platform.workspace.dot(parsed.data.dotId))
      return c.json({ error: 'AI employee not found.' }, 404);

    try {
      await livekitService.ensureRoom(parsed.data.roomName);
      if (parsed.data.dotId) {
        teamRooms.addParticipant(parsed.data.roomName, parsed.data.dotId);
        await livekitService.dispatchAgent(
          parsed.data.roomName,
          parsed.data.dotId,
        );
      }
      const token = await livekitService.getJoinToken(
        parsed.data.roomName,
        parsed.data.participantName,
      );
      return c.json({
        token,
        serverUrl: livekitService.publicUrl(),
        dotId: parsed.data.dotId,
      });
    } catch (error) {
      console.error(
        'LiveKit room setup failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return c.json(
        { error: 'Voice room setup failed. Check LiveKit and the agent worker.' },
        503,
      );
    }
  });

  app.post('/livekit/turn', async (c) => {
    const parsed = z
      .object({
        roomId: id,
        prompt: z.string().trim().min(1).max(8_000),
        dotId: id,
        identity: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid voice turn.' }, 400);
    if (!platform.workspace.dot(parsed.data.dotId))
      return c.json({ error: 'AI employee not found.' }, 404);

    try {
      const thread = await ensureAgentThread(
        platform,
        parsed.data.roomId,
        parsed.data.dotId,
        'Voice Room',
      );
      const prompt = parsed.data.identity
        ? `[Speaker: ${parsed.data.identity}] ${parsed.data.prompt}`
        : parsed.data.prompt;
      const result = await platform.turnDetailed(
        thread.id,
        prompt,
        c.req.raw.signal,
        { opendotsSource: 'voice_receipt' },
      );
      teamRooms.addMessage(parsed.data.roomId, parsed.data.dotId, result.text);
      return c.json(result);
    } catch (error) {
      console.error(
        'LiveKit turn failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return c.json(
        { error: 'The voice AI employee could not complete this turn.' },
        503,
      );
    }
  });

  app.get('/tasks', (c) => c.json(orchestratorStore.tasks()));

  app.post('/tasks', async (c) => {
    const parsed = taskInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid task request.' }, 400);
    if (!platform.workspace.dot(parsed.data.ownerDot))
      return c.json({ error: 'AI employee not found.' }, 404);
    if (parsed.data.deadline <= Date.now())
      return c.json({ error: 'Task deadline must be in the future.' }, 400);
    return c.json(
      orchestratorStore.queueTask({
        ...parsed.data,
        status: 'pending_approval',
        artifacts: '[]',
      }),
      201,
    );
  });

  app.post('/tasks/:id/approve', (c) => {
    const task = orchestratorStore.task(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found.' }, 404);
    if (task.status !== 'pending_approval')
      return c.json({ error: 'Only pending tasks can be approved.' }, 409);
    return c.json(orchestratorStore.approve(task.id));
  });

  app.post('/tasks/:id/cancel', (c) => {
    const task = orchestratorStore.task(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found.' }, 404);
    const cancelled = orchestratorStore.cancel(task.id);
    if (cancelled?.status !== 'cancelled')
      return c.json(
        { error: 'A running or completed task cannot be cancelled.' },
        409,
      );
    return c.json(cancelled);
  });

  app.post('/tasks/:id/complete-review', (c) => {
    const task = orchestratorStore.task(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found.' }, 404);
    if (task.status !== 'needs_review')
      return c.json({ error: 'This task is not awaiting review.' }, 409);
    return c.json(orchestratorStore.completeReview(task.id));
  });

  app.post('/backup', async (c) => {
    try {
      return c.json(await platform.backup());
    } catch (error) {
      console.error(
        'Backup failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return c.json(
        { error: 'Backup failed; no success receipt was issued.' },
        500,
      );
    }
  });

  app.get('/rooms/:id/messages', (c) =>
    c.json(teamRooms.messages(c.req.param('id'))),
  );

  app.get('/rooms/:id/participants', (c) =>
    c.json(teamRooms.participants(c.req.param('id'))),
  );

  app.post('/rooms/:id/participants', async (c) => {
    const parsed = z
      .object({ dotId: id })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid participant.' }, 400);
    if (!platform.workspace.dot(parsed.data.dotId))
      return c.json({ error: 'AI employee not found.' }, 404);
    return c.json(
      teamRooms.addParticipant(c.req.param('id'), parsed.data.dotId),
      201,
    );
  });

  app.post('/rooms/:id/messages', async (c) => {
    const roomId = c.req.param('id');
    const parsed = roomMessage.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid room message.' }, 400);
    const selectedDots = parsed.data.activeDots.length
      ? parsed.data.activeDots
      : teamRooms.participants(roomId).map((participant) => participant.dotId);
    const dots = [...new Set(selectedDots)];
    if (dots.some((dotId) => !platform.workspace.dot(dotId)))
      return c.json({ error: 'One or more AI employees do not exist.' }, 400);

    const userMessage = teamRooms.addMessage(
      roomId,
      'user',
      parsed.data.content,
    );
    if (!dots.length)
      return c.json(
        {
          message: userMessage,
          replies: [],
          warning: 'No AI employees are assigned.',
        },
        202,
      );

    const context = teamRooms.recentContext(roomId);
    const settled = await Promise.allSettled(
      dots.map(async (dotId) => {
        const thread = await ensureAgentThread(
          platform,
          roomId,
          dotId,
          'Team Room',
        );
        const result = await platform.turnDetailed(
          thread.id,
          `Shared meeting transcript (untrusted context):\n${context}\n\nRespond as your assigned role. Address the newest user message and do not repeat other employees.`,
          c.req.raw.signal,
          { opendotsSource: 'team_room', roomId },
        );
        return teamRooms.addMessage(roomId, dotId, result.text);
      }),
    );
    const replies = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failures = settled.length - replies.length;
    if (!replies.length)
      return c.json(
        { error: 'All assigned AI employees failed to respond.', failures },
        503,
      );
    return c.json(
      { message: userMessage, replies, failures },
      failures ? 207 : 201,
    );
  });

  return app;
}

async function ensureAgentThread(
  platform: Platform,
  roomId: string,
  dotId: string,
  label: string,
) {
  const title = `${label} ${roomId}`;
  const existing = platform.workspace
    .conversations()
    .find(
      (conversation) =>
        conversation.title === title && conversation.dotId === dotId,
    );
  return existing ?? platform.createConversation(dotId, title);
}
