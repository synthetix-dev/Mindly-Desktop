import { OrchestratorStore, ApprovedTask } from './orchestrator-store.js';
import { ComputerService } from './computer-service.js';

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
    // Isolated environment for the task
    try {
      await this.computers.start(task.id);
      // Simulate or run actual logic with AI
      // For MVP we just transition state
      if (task.goal.includes('Catalog')) {
        // Run CatalogChangePack logic here
      }
      this.store.markCompleted(task.id);
    } finally {
      await this.computers.stop(task.id);
    }
  }
}
