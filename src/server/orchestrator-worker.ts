import { OrchestratorStore, type ApprovedTask } from './orchestrator-store.js';
import { CatalogChangePack } from './catalog-change-pack.js';
import type { Platform } from './platform.js';
import type { WorkspaceStore } from './workspace.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class OrchestratorWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly store: OrchestratorStore,
    private readonly platform: Platform,
    private readonly workspace: WorkspaceStore,
    private readonly artifactsDir: string,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const task = this.store.claimNextTask();
      if (!task) return;
      try {
        await this.runTask(task);
      } catch (error) {
        this.store.markFailed(
          task.id,
          error instanceof Error ? error.message : 'Task execution failed.',
        );
      }
    } finally {
      this.running = false;
    }
  }

  async runTask(task: ApprovedTask) {
    if (task.deadline <= Date.now())
      throw new Error('Task deadline passed before execution started.');
    if (!this.workspace.dot(task.ownerDot))
      throw new Error('The assigned AI employee no longer exists.');

    if (/catalog|csv/i.test(task.goal) || /^\s*[^\n,]+,/m.test(task.inputs)) {
      const artifact = await CatalogChangePack.processCsvInput(task.inputs, {
        apiKey: this.platform.config.apiKey,
        baseUrl: this.platform.config.baseUrl,
        model: this.platform.config.model,
        outputDir: this.artifactsDir,
      });
      this.store.markCompleted(task.id, JSON.stringify(artifact));
    } else {
      const dotId = task.ownerDot;
      const title = `Task: ${task.goal.substring(0, 30)}`;
      const thread = await this.platform.createConversation(dotId, title);

      const controller = new AbortController();
      const prompt = `Execute this approved company task using the tools available to you.\n\nGoal: ${task.goal}\nInputs: ${task.inputs}\n\nReport the observed final state and include concrete tool evidence. Do not claim success without tool evidence.`;
      const result = await this.platform.turnDetailed(
        thread.id,
        prompt,
        controller.signal,
        { opendotsSource: 'orchestrator', taskId: task.id },
      );

      if (!result.toolCalls.length)
        throw new Error(
          'Task produced text but executed no tools, so the result cannot be verified.',
        );

      const resultText = result.text;
      await mkdir(this.artifactsDir, { recursive: true });
      const artifactName = join(this.artifactsDir, `task_${task.id}.md`);
      await writeFile(artifactName, resultText, { encoding: 'utf8', flag: 'wx' });
      this.store.markNeedsReview(
        task.id,
        JSON.stringify({
          artifactFile: artifactName,
          summary: resultText.slice(0, 200),
          toolCalls: [...new Set(result.toolCalls)],
          conversationId: thread.id,
        }),
      );
    }
  }
}
