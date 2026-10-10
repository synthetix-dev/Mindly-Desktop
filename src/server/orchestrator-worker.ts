import { OrchestratorStore, ApprovedTask } from './orchestrator-store.js';
import { CatalogChangePack } from './catalog-change-pack.js';
import { Platform } from './platform.js';
import { randomUUID } from 'node:crypto';

export class OrchestratorWorker {
  constructor(
    private store: OrchestratorStore,
    private platform: Platform,
    private workspace: any,
    private artifactsDir: string
  ) {}

  start() {
    const timer = setInterval(async () => {
      const task = this.store.claimNextTask();
      if (!task) return;

      try {
        await this.runTask(task);
      } catch (error) {
        this.store.markFailed(task.id, String(error));
      }
    }, 5000);
    timer.unref();
  }

  stop() {}

  async runTask(task: ApprovedTask) {
    if (task.goal.includes('Catalog') || task.inputs.includes('.csv')) {
      const { manifestId, qaReport } = await CatalogChangePack.processCsvInput(task.inputs);
      task.artifacts = JSON.stringify({ manifestId, qaReport });
    } else {
      const threadId = randomUUID();
      const dotId = task.ownerDot || this.workspace.dots()[0]?.id || 'dot_default';
      const title = `Task: ${task.goal.substring(0, 30)}`;
      this.workspace.bindThread(threadId, dotId, title);

      const controller = new AbortController();
      const prompt = `Task Goal: ${task.goal}\nInputs: ${task.inputs}\nProduce a report of the final state.`;
      
      const result = await this.platform.turnDetailed(threadId, prompt, controller.signal, {
        taskDetails: task
      });
      
      if (!result.toolCalls || result.toolCalls.length === 0) {
        throw new Error("Task failed: No tools were executed to verify the state.");
      }

      const verificationPrompt = `You are a Verification Agent. 
Review the original task goal and the final state from the execution.
Goal: ${task.goal}
Inputs: ${task.inputs}
Execution result: ${result.text}

Did the execution successfully achieve the goal? You must answer exactly "VERIFIED: YES" if it succeeded, or "VERIFIED: NO" followed by the reason if it failed.`;

      const verificationResult = await this.platform.turnDetailed(threadId, verificationPrompt, controller.signal);
      
      if (!verificationResult.text.includes("VERIFIED: YES")) {
        throw new Error(`Task verification failed: ${verificationResult.text}`);
      }

      const resultText = result.text;
      const fs = await import('node:fs/promises');
      await fs.mkdir(this.artifactsDir, { recursive: true });
      const artifactName = `${this.artifactsDir}/task_${task.id}.md`;
      await fs.writeFile(artifactName, resultText);
      task.artifacts = JSON.stringify({ 
        artifactFile: artifactName, 
        summary: resultText.substring(0, 100) + '...',
        toolCalls: result.toolCalls
      });
    }
    
    // Actually update the DB so artifacts are saved
    this.store['db'].prepare('UPDATE approved_tasks SET artifacts=?, status="completed" WHERE id=?').run(task.artifacts, task.id);
  }
}
