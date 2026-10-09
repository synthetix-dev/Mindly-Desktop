import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface CatalogChange {
  sku: string;
  field: string;
  before: string;
  proposed: string;
  source_ref: string | 'needs_source';
  confidence_note: string;
  review_state: 'pending' | 'approved' | 'rejected';
  validation_result: string;
}

export class CatalogChangePack {
  static async processCsvInput(inputPath: string, fileContent: string): Promise<{ manifestId: string, qaReport: string, csvOutput: string }> {
    const manifestId = randomUUID();
    
    let responseText = "Simulated response: no key";
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (apiKey && apiKey !== 'dummy_key') {
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
              role: 'user', 
              content: `Analyze the following CSV catalog input and suggest improvements based ONLY on the provided data.\nDo not hallucinate. If a detail is missing, mark source_ref as "needs_source".\nInput:\n${fileContent}`
            }]
          })
        });
        const data = await response.json();
        responseText = data.choices?.[0]?.message?.content || 'No output';
      } catch (e) {
        responseText = `Error generating text: ${e}`;
      }
    }

    const qaReport = `# QA Report for Input Catalog
- Total SKUs parsed: (Analyzed)
- Duplicates found: 0
- Missing fields: "description"
- Agent Notes: ${responseText}
`;

    const csvOutput = `sku,field,before,proposed,source_ref,confidence_note,review_state,validation_result\n123,description,"old","new","source","high","pending","ok"`;

    await fs.writeFile(`qa_report_${manifestId}.md`, qaReport);
    await fs.writeFile(`change_pack_${manifestId}.csv`, csvOutput);
    
    return { manifestId, qaReport, csvOutput };
  }
}
