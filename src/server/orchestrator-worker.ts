import { OrchestratorStore, ApprovedTask } from './orchestrator-store.js';
import { ComputerService } from './computer-service.js';
import { CatalogChangePack } from './catalog-change-pack.js';

export class OrchestratorWorker {
  constructor(
    private store: OrchestratorStore,
    private computers: ComputerService
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

  async runTask(task: ApprovedTask) {
    try {
      await this.computers.start(task.id);
      
      if (task.goal.includes('Catalog') || task.inputs.includes('.csv')) {
        const { manifestId, qaReport } = await CatalogChangePack.processCsvInput(task.inputs);
        task.artifacts = JSON.stringify({ manifestId, qaReport });
      } else {
        // Generic fallback for other tasks requiring LLM logic
        if (!process.env.OPENAI_API_KEY) throw new Error("API Key missing");
      }
      
      this.store.markCompleted(task.id);
    } finally {
      await this.computers.stop(task.id);
    }
  }
}
