import { config } from '../config';
import { ProviderError } from './errors';

// Lovable AI reasoning route. Lovable keeps its AI key (LOVABLE_API_KEY) inside the Lovable project's backend,
// so this server never holds it: it calls a small Lovable Cloud edge function (lovable/judge-reasoning.ts)
// that forwards an OpenAI-style chat-completions request to the Lovable AI Gateway.
// Same prompt, schema, validation and code-computed score as the Claude route.

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

async function call(body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(config.lovable.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fiy-secret': config.lovable.secret },
    body: JSON.stringify({ model: config.lovable.model, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(e => { throw ProviderError.transport('Reasoning (Lovable AI)', e); });
  if (!res.ok) throw ProviderError.http('Reasoning (Lovable AI)', res.status);
  return res.json() as Promise<{ model?: string; choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] }>;
}

export async function reasonWithLovable(input: { system: string; evidence: unknown; schema: Record<string, unknown>; repair?: { previous: unknown; errors: string[] } }) {
  const messages: Msg[] = [{ role: 'system', content: input.system }, { role: 'user', content: JSON.stringify(input.evidence) }];
  if (input.repair) {
    messages.push({ role: 'assistant', content: `Previous submission: ${JSON.stringify(input.repair.previous)}` });
    messages.push({ role: 'user', content: `That submission failed validation: ${input.repair.errors.join('; ')}. Submit a corrected assessment using only evidence from the supplied recording.` });
  }
  const data = await call({
    messages, max_tokens: 3200,
    tools: [{ type: 'function', function: { name: 'submit_assessment', description: 'Return only the evidence-grounded assessment.', parameters: input.schema } }],
    tool_choice: { type: 'function', function: { name: 'submit_assessment' } },
  }, 90000);
  const callArgs = data.choices?.[0]?.message?.tool_calls?.find(t => t.function?.name === 'submit_assessment')?.function?.arguments;
  if (!callArgs) throw new ProviderError('Reasoning returned no structured assessment.', true);
  let output: Record<string, unknown>;
  try { output = JSON.parse(callArgs); } catch { throw new ProviderError('Reasoning returned unreadable data.', true); }
  return { output, model: data.model ?? config.lovable.model };
}

export async function taskHelpWithLovable(system: string, question: string) {
  const data = await call({ messages: [{ role: 'system', content: system }, { role: 'user', content: question }], max_tokens: 300 }, 30000);
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
