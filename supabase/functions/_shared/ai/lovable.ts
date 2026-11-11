// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  LOVABLE AI — THE ONLY FILE THE AI CONNECTION NEEDS TO CHANGE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Everything else in the simulation (runs, consent, the one 60-second recording, storage, the
// assessment job, evidence checks, the score, facilitator review) is already built and does not
// depend on which model answers. Connect Lovable's built-in AI by implementing the five methods
// below and switching each `connected` flag to true. Until then the app is honest about it:
// learners get the "can't assess this right now" recovery path and no score is ever invented.
//
// Rules for whoever implements this (person or Lovable agent):
//  • Run only here, server-side. Never call AI from the browser; never expose LOVABLE_API_KEY.
//  • Do not change the prompts, schema, validation or scoring. The core passes the full system
//    instruction, rubric and JSON schema in; return the model's answer as-is and let the core check it.
//  • Throw ProviderError (./../errors.ts) on failures — use ProviderError.http(what, status) for HTTP
//    errors (402 = out of credits, 429 = rate limited) so the learner sees the right recovery message.
//  • The audio is always a 16 kHz mono 16-bit PCM WAV of at most 60.0 s (≈ 1.9 MB).
//
// Suggested Lovable AI models (check Connectors → AI → Available models; ids change over time):
//  transcribe      → the speech-to-text model (e.g. GPT Transcribe), word timestamps if offered
//  assessDelivery  → a Gemini chat model (Gemini chat models accept audio input)
//  judge           → a strong chat model that supports tool / function calling (forced tool call)
//  speak           → a text-to-speech model (e.g. Gemini Flash TTS); three different voices
//  taskHelp        → any fast chat model
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { ProviderError } from '../errors.ts';
import type { Ai, AiStatus, AudioInput, DeliveryAnswer, JudgeInput } from '../ports.ts';
import type { Cue, JudgeId } from '../types.ts';
import type { Transcript } from '../ports.ts';

const notConnected = (what: string) =>
  new ProviderError(`${what} is not connected yet. The Lovable AI connection is still to be added (supabase/functions/_shared/ai/lovable.ts).`, true);

export function lovableAi(env: (k: string) => string | undefined): Ai {
  // Lovable provisions LOVABLE_API_KEY for the project's backend functions when AI is enabled.
  const hasKey = !!env('LOVABLE_API_KEY');

  // Flip each to true once its method below is implemented.
  const connected = { transcription: false, delivery: false, reasoning: false, voices: false, taskHelp: false };

  return {
    status(): AiStatus {
      return {
        provider: 'lovable-ai',
        transcription: hasKey && connected.transcription,
        delivery: hasKey && connected.delivery,
        reasoning: hasKey && connected.reasoning,
        voices: hasKey && connected.voices,
        taskHelp: hasKey && connected.taskHelp,
      };
    },

    /**
     * Speech-to-text of input.audio (audio/wav).
     * Return { text, words: [{ text, start, end }] (seconds; [] if the model has no timestamps),
     *          languageCode (or null), provider: 'lovable-ai:<model id>' }.
     * Hint the model that speakers are Nigerian university students speaking English.
     */
    async transcribe(_input: AudioInput): Promise<Transcript> {
      throw notConnected('Speech transcription');
    },

    /**
     * Send input.audio to an audio-capable model with input.instruction as the system message and
     * input.userText as the user text. Ask for JSON only:
     *   { "uncertain": boolean, "level": 0-4, "justification": string,
     *     "evidence": [{ "start": seconds, "end": seconds, "observation": string }] }
     * Return that object plus model: '<model id>'. If the model cannot hear the audio, uncertain: true.
     */
    async assessDelivery(_input: AudioInput & { instruction: string; userText: string }): Promise<DeliveryAnswer> {
      throw notConnected('Delivery assessment');
    },

    /**
     * Chat call: system = input.system, user = JSON.stringify(input.evidence).
     * Force one tool call named input.toolName whose parameters are input.schema; return the parsed tool
     * arguments as `output` and the model id as `model`.
     * If input.repair is set, add an assistant message with JSON.stringify(input.repair.previous) and a
     * user message: "That submission failed validation: <errors joined by '; '>. Submit a corrected
     * assessment using only evidence from the supplied recording."
     */
    async judge(_input: JudgeInput): Promise<{ output: unknown; model: string }> {
      throw notConnected('The judges’ reasoning');
    },

    /**
     * Text-to-speech of input.text in the judge's own voice (ada, tunde, zainab — three distinct,
     * natural Nigerian-English academic voices). Return { audio bytes, mimeType (e.g. 'audio/mpeg' or
     * 'audio/wav'), cues: timed caption phrases or null } — with null the core shows the text instead.
     */
    async speak(_input: { text: string; judgeId: JudgeId }): Promise<{ audio: Uint8Array; mimeType: string; cues: Cue[] | null }> {
      throw notConnected('Judge voices');
    },

    /** Chat call: system = input.system, user = input.question; return the plain-text answer (≤ 300 tokens). */
    async taskHelp(_input: { system: string; question: string }): Promise<string> {
      throw notConnected('Task help');
    },
  };
}
