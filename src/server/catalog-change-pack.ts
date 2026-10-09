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
  static async processCsvInput(fileContent: string): Promise<{ manifestId: string, qaReport: string, csvOutput: string }> {
    const lines = fileContent.trim().split('\n');
    if (lines.length === 0) throw new Error("CSV input is empty");
    const header = lines[0].replace(/\r/g, '').trim();
    if (header !== "sku,field,before,proposed,source_ref,confidence_note,review_state,validation_result") {
      throw new Error("Invalid CSV headers");
    }
    const manifestId = randomUUID();
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey || apiKey === 'dummy_key') {
      throw new Error('OPENAI_API_KEY is required for real CatalogChangePack execution.');
    }

    const systemPrompt = `You are a strict data validation agent. 
Analyze the input CSV catalog data. Output a new CSV containing proposed changes.
Columns must be EXACTLY: sku,field,before,proposed,source_ref,confidence_note,review_state,validation_result.
Rules:
1. If proposing a change, field is the column name, before is old value, proposed is new value.
2. If no source is found to verify the change, source_ref MUST be "needs_source".
3. confidence_note explains your rationale.
4. review_state is "pending".
5. validation_result is "ok" or "warning".
6. DO NOT output any markdown, ONLY valid CSV text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fileContent }
        ],
        temperature: 0.1
      })
    });
    
    const data = await response.json();
    if (data.error) {
      throw new Error(`OpenAI Error: ${data.error.message}`);
    }

    let csvOutput = data.choices?.[0]?.message?.content?.trim() || '';
    if (csvOutput.startsWith('```csv')) csvOutput = csvOutput.replace(/^```csv\n/, '').replace(/\n```$/, '');

    const qaReport = `# QA Report for Input Catalog
- Total SKUs parsed: ${Math.max(0, lines.length - 1)}
- Agent Status: Analysis Complete.
- Changes Proposed: ${Math.max(0, csvOutput.trim().split('\n').length - 1)}
`;

    try {
      await fs.writeFile(`data/qa_report_${manifestId}.md`, qaReport);
      await fs.writeFile(`data/change_pack_${manifestId}.csv`, csvOutput);
    } catch (e) {
      // Ignore if data dir not ready
    }
    
    return { manifestId, qaReport, csvOutput };
  }
}
