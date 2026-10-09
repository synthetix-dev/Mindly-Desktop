import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { EventType } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import {
  INTELLIGENCE_KEY_MISSING_LABEL,
  setupStatus,
  type PlatformConfig,
} from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
import { SetupTelemetry } from './setup-telemetry.js';
import { voiceReceiptMessagePrefix } from '../shared/voice-receipt.js';
import { scheduledTaskMessagePrefix } from '../shared/scheduled-message.js';
import { ConversationStore } from './conversation-store.js';
import { PersistentAgentRunner } from './persistent-runner.js';
import { TeamRoomStore } from './team-room-store.js';
import { OrchestratorStore } from './orchestrator-store.js';
import { OrchestratorWorker } from './orchestrator-worker.js';


import { LiveKitService } from './livekit-service.js';

export interface TurnResult {
  text: string;
  /** Names of the tools the employee actually invoked during this turn (evidence, not claims). */
  toolCalls: string[];
}

/**
 * Thread storage for the in-process runtime. It plays the role CopilotKit Intelligence plays in the
 * hosted deployment: conversation creation and message history for pages and voice receipts.
 */
class LocalThreads {
  constructor(
    private conversations: ConversationStore,
    private runner: PersistentAgentRunner,
  ) {}
  async createThread(input: { threadId: string; name: string }) {
    this.conversations.createConversation(input.threadId, input.name);
  }
  async getOrCreateThread(input: { threadId: string; name: string }) {
    if (!this.conversations.getConversation(input.threadId))
      this.conversations.createConversation(input.threadId, input.name);
  }
  async getThreadMessages(input: { threadId: string }) {
    return { messages: this.runner.messages(input.threadId) };
  }
}

export class Platform {
  private channelStartupFailed = false;
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly intelligence?: CopilotKitIntelligence;
  readonly handler?: CopilotHonoApp;
  /** Local-runtime services (undefined when CopilotKit Intelligence hosts conversations). */
  readonly runner?: PersistentAgentRunner;
  readonly conversations: ConversationStore;
  readonly teamRooms: TeamRoomStore;
  readonly orchestratorStore: OrchestratorStore;
  readonly orchestratorWorker: OrchestratorWorker;
  
  
  readonly livekitService: LiveKitService;
  readonly dataDir: string;
  private readonly threads?: LocalThreads;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    const memory = process.env.NODE_ENV === 'test' && !config.dataDir;
    this.dataDir = config.dataDir ?? 'data';
    if (!memory) mkdirSync(this.dataDir, { recursive: true });
    const file = (name: string) =>
      memory ? ':memory:' : join(this.dataDir, name);
    this.conversations = new ConversationStore(file('conversations.sqlite'));
    this.teamRooms = new TeamRoomStore(file('team_rooms.sqlite'));
    this.orchestratorStore = new OrchestratorStore(file('orchestrator.sqlite'));
    this.livekitService = new LiveKitService(
      config.livekitUrl,
      config.livekitApiKey,
      config.livekitApiSecret,
    );
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    
    
    this.orchestratorWorker = new OrchestratorWorker(
      this.orchestratorStore,
      {},
      workspace,
      join(this.dataDir, 'artifacts')
    );
    if (config.localRuntime) {
      this.runner = new PersistentAgentRunner(this.conversations);
      this.threads = new LocalThreads(this.conversations, this.runner);
    }
    this.pages = new PageService(workspace, () => {
      this.requireReady();
      return (this.intelligence ?? this.threads)!;
    });
    if (config.localRuntime) {
      const runtime = new CopilotRuntime({
        runner: this.runner,
        telemetryId: this.setupTelemetry.identity,
        telemetryProperties: this.setupTelemetry.metadata,
        identifyUser: async () => ({
          id: workspace.ownerId,
          name: 'OpenDots owner',
        }),
        agents: async () => this.dotAgents(),
      });
      this.handler = createCopilotHonoHandler({
        runtime,
        basePath: '/api/copilotkit',
        cors: { origin: [] },
      });
      return;
    }
    if (!config.intelligenceKey) return;
    this.intelligence = new CopilotKitIntelligence({
      apiKey: config.intelligenceKey,
      apiUrl: config.intelligenceApiUrl,
      wsUrl: config.intelligenceWsUrl,
      getLearningContainerId: learningSelector(
        workspace,
        config.slackDotId ?? workspace.dots()[0]?.id,
      ),
    });
    const channels = [];
    if (config.slackChannel && config.slackTeam && config.slackUsers.length) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () =>
          new DotAgent(
            store,
            workspace,
            config,
            dotId,
            true,
            this.setupTelemetry,
          ),
      });
      channels.push(slack);
    }
    const runtime = new CopilotRuntime({
      intelligence: this.intelligence,
      telemetryId: this.setupTelemetry.identity,
      telemetryProperties: this.setupTelemetry.metadata,
      identifyUser: async () => ({
        id: workspace.ownerId,
        name: 'OpenDots owner',
      }),
      agents: async () => this.dotAgents(),
      channels,
      generateThreadNames: true,
    });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  private dotAgents() {
    return Object.fromEntries(
      this.workspace
        .dots()
        .map((dot) => [
          dot.id,
          new DotAgent(
            this.store,
            this.workspace,
            this.config,
            dot.id,
            false,
            this.setupTelemetry,
          ),
        ]),
    );
  }
  setup() {
    return setupStatus(
      this.config,
      this.handler?.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
    );
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Setup required: ${missing.join(', ')}. Conversations require ${this.config.localRuntime ? 'a configured model' : 'CopilotKit Intelligence'}.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    if (this.config.localRuntime) this.orchestratorWorker.start();
    if (this.handler?.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        this.setupTelemetry.capture({
          kind: 'setup_failed',
          step: 'settings',
          error_class: 'channel_start_failed',
        });
        throw error;
      }
    }
  }
  async stop() {
    this.orchestratorWorker.stop();
    await this.setupTelemetry.stop();
    await this.handler?.channels?.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    try {
      if (this.threads) await this.threads.createThread({ threadId: id, name: title });
      else
        await this.intelligence!.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
    } catch {
      throw new Error(
        'Intelligence could not create this conversation. Check the runtime key and connection.',
      );
    }
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    const history = this.runner
      ? { messages: this.runner.messages(threadId) as { role: string; content?: unknown }[] }
      : await this.intelligence!.getThreadMessages({
          threadId,
          userId: this.workspace.ownerId,
        });
    return history.messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    if (!this.handler)
      return Response.json(
        { error: `Setup required: ${INTELLIGENCE_KEY_MISSING_LABEL}.` },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return (await this.turnDetailed(threadId, prompt, signal, metadata)).text;
  }
  /**
   * Runs one real turn of the thread's employee (role instructions, permitted memory, pages,
   * connections and OpenBot computer tools, exactly as in chat) and reports which tools ran.
   */
  async turnDetailed(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<TurnResult> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    if (!this.runner) {
      const text = await runThreadTurn(
        this.config.runtimeUrl,
        this.config.ownerToken
          ? { Authorization: `Bearer ${this.config.ownerToken}` }
          : {},
        thread.dotId,
        threadId,
        prompt,
        signal,
        metadata,
      );
      return { text, toolCalls: [] };
    }
    signal.throwIfAborted();
    const idPrefix =
      metadata?.opendotsSource === 'voice_receipt'
        ? voiceReceiptMessagePrefix
        : metadata?.opendotsSource === 'scheduled_task'
          ? scheduledTaskMessagePrefix
          : '';
    const agent = new DotAgent(
      this.store,
      this.workspace,
      this.config,
      thread.dotId,
      false,
      this.setupTelemetry,
    );
    const history = this.runner
      .messages(threadId)
      .map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }));
    const input = {
      threadId,
      runId: randomUUID(),
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
      messages: [
        ...history,
        {
          id: `${idPrefix}${randomUUID()}`,
          role: 'user' as const,
          content: prompt,
          ...(metadata ? { metadata } : {}),
        },
      ],
    };
    const stop = () => void this.runner!.stop({ threadId });
    signal.addEventListener('abort', stop, { once: true });
    try {
      const events = await lastValueFrom(
        this.runner.run({ threadId, agent, input } as never).pipe(toArray()),
        { defaultValue: [] },
      );
      signal.throwIfAborted();
      const error = events.find((event) => event.type === EventType.RUN_ERROR);
      if (error) throw new Error((error as { message?: string }).message ?? 'The run failed.');
      const messages = new Map<string, string>();
      let last: string | undefined;
      const toolCalls: string[] = [];
      for (const event of events as any[]) {
        if (event.type === EventType.TEXT_MESSAGE_START) {
          messages.set(event.messageId, '');
          last = event.messageId;
        } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
          messages.set(event.messageId, (messages.get(event.messageId) ?? '') + event.delta);
          last = event.messageId;
        } else if (event.type === EventType.TOOL_CALL_START)
          toolCalls.push(event.toolCallName);
      }
      const text = last ? (messages.get(last) ?? '') : '';
      if (!text.trim())
        throw new Error('The current compute turn returned no assistant response.');
      return { text, toolCalls };
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}
