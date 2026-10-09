import {
  AgentRunner,
  InMemoryAgentRunner,
  ɵGLOBAL_STORE,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from '@copilotkit/runtime/v2';
import { compactEvents, EventType, type BaseEvent } from '@ag-ui/client';
import { Observable, ReplaySubject } from 'rxjs';
import type { ConversationStore } from './conversation-store.js';

/**
 * AG-UI runner backed by SQLite.
 *
 * Execution, concurrency control, stop semantics and live fan-out are delegated to the SDK's own
 * `InMemoryAgentRunner`, so the wire protocol (`/agent/:id/run|connect|stop`) is exactly what the
 * CopilotKit client expects. Every completed run is additionally event-sourced into
 * `ConversationStore.thread_runs`, and a thread's history is hydrated back into the SDK store the
 * first time it is touched after a restart. Nothing is lost when the process restarts.
 */
export class PersistentAgentRunner extends AgentRunner {
  private readonly inner = new InMemoryAgentRunner({
    onConcurrentRun: 'throw',
  });
  private readonly hydrated = new Set<string>();
  constructor(private readonly store: ConversationStore) {
    super();
  }

  private hydrate(threadId: string) {
    if (this.hydrated.has(threadId)) return;
    this.hydrated.add(threadId);
    if (ɵGLOBAL_STORE.peek(threadId)?.historicRuns.length) return;
    let parentRunId: string | null = null;
    for (const run of this.store.loadRuns(threadId)) {
      ɵGLOBAL_STORE.appendRun(threadId, {
        threadId,
        runId: run.runId,
        agentId: run.agentId,
        parentRunId,
        events: run.events as BaseEvent[],
        messages: [],
        createdAt: run.createdAt,
      } as never);
      parentRunId = run.runId;
    }
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    this.hydrate(request.threadId);
    const live = this.inner.run(request);
    // Subscribe eagerly: the run must be recorded even if the HTTP client disconnects mid-stream.
    const out = new ReplaySubject<BaseEvent>(Infinity);
    const events: BaseEvent[] = [];
    const persist = () => {
      const finished = events.some(
        (event) =>
          event.type === EventType.RUN_FINISHED ||
          event.type === EventType.RUN_ERROR,
      );
      if (!finished) return;
      this.store.saveRun(
        request.threadId,
        request.input.runId,
        request.agent.agentId ?? 'default',
        compactEvents(events),
      );
    };
    live.subscribe({
      next: (event) => {
        events.push(event);
        out.next(event);
      },
      error: (error) => {
        persist();
        out.error(error);
      },
      complete: () => {
        persist();
        out.complete();
      },
    });
    return out.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    this.hydrate(request.threadId);
    return this.inner.connect(request);
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.inner.isRunning(request);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return this.inner.stop(request);
  }

  /** Assistant/user/tool messages reconstructed from the persisted AG-UI events. */
  messages(threadId: string): { id: string; role: string; content: string }[] {
    this.hydrate(threadId);
    const out: { id: string; role: string; content: string }[] = [];
    const text = new Map<string, { id: string; role: string; content: string }>();
    const seen = new Set<string>();
    for (const run of this.store.loadRuns(threadId)) {
      for (const event of run.events as any[]) {
        if (event.type === EventType.RUN_STARTED) {
          for (const message of event.input?.messages ?? []) {
            if (
              seen.has(message.id) ||
              !['user', 'assistant'].includes(message.role) ||
              typeof message.content !== 'string'
            )
              continue;
            seen.add(message.id);
            out.push({
              id: message.id,
              role: message.role,
              content: message.content,
            });
          }
        } else if (event.type === EventType.TEXT_MESSAGE_START) {
          const entry = { id: event.messageId, role: event.role ?? 'assistant', content: '' };
          text.set(event.messageId, entry);
          if (!seen.has(entry.id)) {
            seen.add(entry.id);
            out.push(entry);
          }
        } else if (
          event.type === EventType.TEXT_MESSAGE_CONTENT &&
          text.has(event.messageId)
        )
          text.get(event.messageId)!.content += event.delta;
        else if (event.type === EventType.MESSAGES_SNAPSHOT) {
          for (const message of event.messages ?? []) {
            if (
              seen.has(message.id) ||
              !['user', 'assistant'].includes(message.role) ||
              typeof message.content !== 'string'
            )
              continue;
            seen.add(message.id);
            out.push({
              id: message.id,
              role: message.role,
              content: message.content,
            });
          }
        }
      }
    }
    return out;
  }
}
