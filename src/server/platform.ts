import * as fs from 'node:fs';
import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
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
import { ConversationStore } from './conversation-store.js';
import { createLocalHonoHandler } from './copilotkit-adapter.js';

import { TeamRoomStore } from './team-room-store.js';
import { OrchestratorStore } from './orchestrator-store.js';
import { OrchestratorWorker } from './orchestrator-worker.js';
import { LiveKitService } from './livekit-service.js';

export class Platform {
  private channelStartupFailed = false;
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly conversations: ConversationStore;
  readonly teamRooms: TeamRoomStore;
  readonly orchestratorStore: OrchestratorStore;
  readonly orchestratorWorker: OrchestratorWorker;
  readonly livekitService: LiveKitService;
  readonly handler?: any;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    const isTest = process.env.NODE_ENV === 'test';
    const basePath = isTest ? ':memory:' : 'data/';
    if (!isTest) {
      try {
        fs.mkdirSync('data', { recursive: true });
      } catch (e) {
        // ignore
      }
    }
    
    this.conversations = new ConversationStore(isTest ? ':memory:' : basePath + 'conversations.sqlite');
    this.teamRooms = new TeamRoomStore(isTest ? ':memory:' : basePath + 'team_rooms.sqlite');
    this.orchestratorStore = new OrchestratorStore(isTest ? ':memory:' : basePath + 'orchestrator.sqlite');
    this.livekitService = new LiveKitService(config.livekitUrl, config.livekitApiKey, config.livekitApiSecret);
    
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    
    this.orchestratorWorker = new OrchestratorWorker(this.orchestratorStore, this.computers);
    // Automatically start the worker for MVP
    this.orchestratorWorker.start();
    
    this.connections = new ConnectionService(workspace.connections);
    this.pages = new PageService(workspace, () => {
      this.requireReady();
      return this.conversations as any;
    });
    this.handler = createLocalHonoHandler(this.conversations, this.teamRooms, this.orchestratorStore, this.livekitService);
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
        `Setup required: ${missing.join(', ')}. Conversations require CopilotKit Intelligence.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
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
    await this.setupTelemetry.stop();
    await this.handler?.channels?.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    try {
      this.conversations.createConversation(id, title);
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
    const messages = this.conversations.getMessages(threadId);
    return messages
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
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
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
  }
}
