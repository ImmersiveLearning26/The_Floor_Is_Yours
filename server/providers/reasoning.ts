import { config } from '../config';
import { reasonWithClaude, taskHelpWithClaude } from './claude';
import { reasonWithLovable, taskHelpWithLovable } from './lovable';

// Exactly one reasoning route is active, chosen by REASONING_PROVIDER (claude | lovable).
export type ReasonInput = { system: string; evidence: unknown; schema: Record<string, unknown>; repair?: { previous: unknown; errors: string[] } };

export async function reason(input: ReasonInput): Promise<{ output: Record<string, unknown>; model: string }> {
  if (config.reasoningProvider === 'lovable') {
    const r = await reasonWithLovable(input);
    return { output: r.output, model: `lovable:${r.model}` };
  }
  const r = await reasonWithClaude(input);
  return { output: r.output as Record<string, unknown>, model: `claude:${r.model}` };
}

export const taskHelp = (system: string, question: string) =>
  config.reasoningProvider === 'lovable' ? taskHelpWithLovable(system, question) : taskHelpWithClaude(system, question);
