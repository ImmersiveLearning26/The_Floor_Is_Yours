import { config } from '../config';
import { DELIVERY_INSTRUCTION } from '../prompt';
import { ProviderError } from './errors';
import type { Rating, Level } from '../../shared/types';

// Audio-capable delivery assessor. The model receives the ORIGINAL recording (transcoded to mp3),
// never transcript text alone. Gemini's generateContent accepts inline audio parts.
export type DeliveryResult = { rating: Rating | null; uncertain: boolean; reason: string | null; model: string };

const schema = {
  type: 'OBJECT',
  properties: {
    uncertain: { type: 'BOOLEAN' },
    level: { type: 'INTEGER' },
    justification: { type: 'STRING' },
    evidence: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { start: { type: 'NUMBER' }, end: { type: 'NUMBER' }, observation: { type: 'STRING' } }, required: ['start', 'end', 'observation'] },
    },
  },
  required: ['uncertain', 'level', 'justification', 'evidence'],
};

export async function assessDeliveryWithGemini(mp3: Buffer, duration: number): Promise<DeliveryResult> {
  const model = config.delivery.model;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': config.delivery.geminiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DELIVERY_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: 'audio/mp3', data: mp3.toString('base64') } },
        { text: `The recording is ${duration.toFixed(1)} seconds long. Return 1-4 evidence items with timestamps between 0 and ${duration.toFixed(1)}.` },
      ] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(90000),
  }).catch(e => { throw ProviderError.transport('Delivery assessment', e); });
  if (!res.ok) throw ProviderError.http('Delivery assessment', res.status);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  let parsed: { uncertain?: boolean; level?: number; justification?: string; evidence?: { start: number; end: number; observation: string }[] };
  try { parsed = JSON.parse(text); } catch { throw new ProviderError('Delivery assessment returned unreadable data.', true); }
  if (parsed.uncertain) return { rating: null, uncertain: true, reason: 'The delivery assessor could not hear the recording reliably.', model };
  const level = parsed.level;
  if (!Number.isInteger(level) || (level as number) < 0 || (level as number) > 4 || !parsed.justification || !parsed.evidence?.length) {
    return { rating: null, uncertain: true, reason: 'Delivery assessment was incomplete.', model };
  }
  return {
    uncertain: false, reason: null, model,
    rating: {
      id: 'delivery', level: level as Level, justification: parsed.justification.slice(0, 600),
      evidence: parsed.evidence.slice(0, 4).map(e => ({ start: Number(e.start), end: Number(e.end), quote: null, observation: String(e.observation).slice(0, 400), source: 'audio' as const })),
    },
  };
}
