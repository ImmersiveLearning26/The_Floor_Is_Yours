import { config } from '../config';
import { ProviderError } from './errors';

type ToolInput = Record<string, unknown>;

async function messages(body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(`${config.anthropic.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': config.anthropic.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.anthropic.model, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(e => { throw ProviderError.transport('Reasoning', e); });
  if (!res.ok) throw ProviderError.http('Reasoning', res.status);
  return res.json() as Promise<{ content?: { type: string; name?: string; input?: ToolInput; text?: string }[]; model?: string }>;
}

/** Structured judgement through a forced tool call. Output is untrusted until validated. */
export async function reasonWithClaude(input: { system: string; evidence: unknown; schema: Record<string, unknown>; repair?: { previous: unknown; errors: string[] } }) {
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: JSON.stringify(input.evidence) }];
  if (input.repair) {
    msgs.push({ role: 'assistant', content: `Previous submission: ${JSON.stringify(input.repair.previous)}` });
    msgs.push({ role: 'user', content: `That submission failed validation: ${input.repair.errors.join('; ')}. Submit a corrected assessment using only evidence from the supplied recording.` });
  }
  const data = await messages({
    max_tokens: 3200, system: input.system,
    tools: [{ name: 'submit_assessment', description: 'Return only the evidence-grounded assessment.', input_schema: input.schema }],
    tool_choice: { type: 'tool', name: 'submit_assessment' }, messages: msgs,
  }, 90000);
  const block = data.content?.find(b => b.type === 'tool_use' && b.name === 'submit_assessment');
  if (!block?.input) throw new ProviderError('Reasoning returned no structured assessment.', true);
  return { output: block.input, model: data.model ?? config.anthropic.model };
}

export async function taskHelpWithClaude(system: string, question: string) {
  const data = await messages({ max_tokens: 300, system, messages: [{ role: 'user', content: question }] }, 30000);
  return (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
}
