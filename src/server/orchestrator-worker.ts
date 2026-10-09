import { OrchestratorStore, ApprovedTask } from './orchestrator-store.js';
import { CatalogChangePack } from './catalog-change-pack.js';

export class OrchestratorWorker {
  constructor(
    private store: OrchestratorStore,
    private employees: any,
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
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey || apiKey === 'dummy_key') throw new Error("OPENAI_API_KEY missing");
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an autonomous orchestrator worker. Perform the task and produce a report of the final state.' },
            { role: 'user', content: `Task Goal: ${task.goal}\nInputs: ${task.inputs}` }
          ],
          temperature: 0.2
        })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(`OpenAI Error: ${data.error.message}`);
      
      const resultText = data.choices?.[0]?.message?.content?.trim() || 'No result generated';
      const fs = await import('node:fs/promises');
      await fs.mkdir('data/artifacts', { recursive: true });
      const artifactName = `data/artifacts/task_${task.id}.md`;
      await fs.writeFile(artifactName, resultText);
      task.artifacts = JSON.stringify({ artifactFile: artifactName, summary: resultText.substring(0, 100) + '...' });
    }
    
    // Actually update the DB so artifacts are saved
    this.store['db'].prepare('UPDATE approved_tasks SET artifacts=?, status="completed" WHERE id=?').run(task.artifacts, task.id);
  }
}
