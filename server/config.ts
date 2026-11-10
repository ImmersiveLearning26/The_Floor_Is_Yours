import path from 'node:path';
import type { Capabilities } from '../shared/types';

const env = (k: string) => (process.env[k] ?? '').trim();
const flag = (k: string) => /^(1|true|yes)$/i.test(env(k));

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA_DIR = env('DATA_DIR') || path.join(ROOT, 'data');

export const config = {
  port: Number(env('PORT') || 8787),
  production: env('NODE_ENV') === 'production',
  sessionSecret: env('SESSION_SECRET'),
  reasoningProvider: env('REASONING_PROVIDER') || 'claude',
  anthropic: { key: env('ANTHROPIC_API_KEY'), model: env('ANTHROPIC_MODEL'), baseUrl: env('ANTHROPIC_API_BASE') || 'https://api.anthropic.com' },
  // Lovable AI: URL of the Lovable Cloud edge function that forwards to the Lovable AI Gateway (see docs/LOVABLE_AI_SETUP.md)
  lovable: { url: env('LOVABLE_REASONING_URL'), secret: env('LOVABLE_FUNCTION_SECRET'), model: env('LOVABLE_REASONING_MODEL') },
  eleven: {
    key: env('ELEVENLABS_API_KEY'), stt: env('ELEVENLABS_STT_MODEL') || 'scribe_v1', tts: env('ELEVENLABS_TTS_MODEL') || 'eleven_multilingual_v2',
    voices: { ada: env('ELEVENLABS_ADA_VOICE_ID'), tunde: env('ELEVENLABS_TUNDE_VOICE_ID'), zainab: env('ELEVENLABS_ZAINAB_VOICE_ID') },
    narrator: env('ELEVENLABS_NARRATOR_VOICE_ID'),
  },
  delivery: { provider: env('DELIVERY_ASSESSOR_PROVIDER').toLowerCase(), model: env('DELIVERY_ASSESSOR_MODEL'), geminiKey: env('GEMINI_API_KEY') },
  retentionDays: env('RECORDING_RETENTION_DAYS') ? Number(env('RECORDING_RETENTION_DAYS')) : null,
  policyVersion: env('RECORDING_POLICY_VERSION') || null,
  supportUrl: env('SUPPORT_URL') || null,
  reviewQueue: flag('REVIEW_QUEUE_ENABLED'),
  recordingDownload: env('ALLOW_RECORDING_DOWNLOAD') ? flag('ALLOW_RECORDING_DOWNLOAD') : true,
  facilitatorToken: env('FACILITATOR_TOKEN'),
  maxUploadBytes: 15 * 1024 * 1024,
};

export const reasoningReady = () => config.reasoningProvider === 'lovable'
  ? !!config.lovable.url && !!config.lovable.secret && !!config.lovable.model
  : config.reasoningProvider === 'claude' && !!config.anthropic.key && !!config.anthropic.model;
export const transcriptionReady = () => !!config.eleven.key;
export const voicesReady = () => !!config.eleven.key && Object.values(config.eleven.voices).every(Boolean);
export const deliveryMode = (): Capabilities['delivery'] =>
  config.delivery.provider === 'gemini' && config.delivery.geminiKey && config.delivery.model ? 'automatic'
    : config.delivery.provider === 'human' && config.facilitatorToken ? 'human' : 'none';

export function capabilities(): Capabilities {
  return {
    reasoning: reasoningReady(), transcription: transcriptionReady(), delivery: deliveryMode(), voices: voicesReady(),
    reviewQueue: config.reviewQueue && !!config.facilitatorToken, supportUrl: config.supportUrl,
    recordingPolicyVersion: config.policyVersion, retentionDays: config.retentionDays,
    recordingDownload: config.recordingDownload, taskHelpAi: reasoningReady(),
  };
}
// Consent is recorded against this version; a blank institutional policy is labelled as a development policy.
export const consentVersion = () => config.policyVersion ?? 'dev-unconfigured';
