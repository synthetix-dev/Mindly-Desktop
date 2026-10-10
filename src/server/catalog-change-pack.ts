import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';

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
    if (!fileContent || !fileContent.trim()) throw new Error("CSV input is empty");
    
    const parsedInput = Papa.parse(fileContent.trim(), { header: true, skipEmptyLines: true });
    if (parsedInput.errors.length > 0) {
        throw new Error(`CSV input parsing errors: ${JSON.stringify(parsedInput.errors)}`);
    }
    
    if (parsedInput.data.length === 0) {
        throw new Error("CSV input is empty");
    }

    const headers = parsedInput.meta.fields || [];
    if (!headers.map(h => h.toLowerCase()).includes("sku")) {
      throw new Error("Invalid CSV headers: missing 'sku' column");
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

    const parsedOutput = Papa.parse<CatalogChange>(csvOutput, { header: true, skipEmptyLines: true });
    
    if (parsedOutput.errors.length > 0) {
      throw new Error(`Generated CSV parsing errors: ${JSON.stringify(parsedOutput.errors)}`);
    }
    
    const outHeaders = parsedOutput.meta.fields || [];
    const expectedHeaders = ['sku','field','before','proposed','source_ref','confidence_note','review_state','validation_result'];
    const missingHeaders = expectedHeaders.filter(eh => !outHeaders.includes(eh));
    
    if (missingHeaders.length > 0) {
      throw new Error(`Malformed CSV output: missing expected columns ${missingHeaders.join(', ')}`);
    }

    for (const [index, row] of parsedOutput.data.entries()) {
      for (const expectedHeader of expectedHeaders) {
        if (!(expectedHeader in row) || row[expectedHeader as keyof CatalogChange] === undefined) {
           throw new Error(`Malformed CSV output at row ${index + 1}: missing value for column '${expectedHeader}'`);
        }
      }
    }

    const qaReport = `# QA Report for Input Catalog
- Total SKUs parsed: ${parsedInput.data.length}
- Agent Status: Analysis Complete.
- Changes Proposed: ${parsedOutput.data.length}
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
