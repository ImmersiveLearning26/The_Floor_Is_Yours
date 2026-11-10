# The Floor Is Yours

A first-year undergraduate oral academic argument simulation. One calm, chat-like column greets the learner, locks one issue, plays a briefing, opens a compact call with three AI judges (Ada, Tunde, Zainab), records **one** speech of up to 60 seconds, has it assessed against the source rubric, plays grounded spoken feedback, and shows the result.

Built from `The_Floor_Is_Yours_Claude_Kit` (design references, page specs, rubric, provider specs). The only visual addition is the agent-working glow borrowed from the FocusPro Studio ad-builder simulation (see *Design* below).

## Start here

- **Connect the judges to Lovable AI:** [docs/LOVABLE_AI_SETUP.md](docs/LOVABLE_AI_SETUP.md)
- **Generate the missing videos and audio:** [docs/MISSING_MEDIA.md](docs/MISSING_MEDIA.md)
- **What the original script requires vs. what is built:** [docs/SCRIPT_ALIGNMENT.md](docs/SCRIPT_ALIGNMENT.md)

## Run it

Requires Node 22+ and `ffmpeg`/`ffprobe` on the PATH (the server decodes, verifies and trims every recording).

```bash
npm install
```

```bash
cp .env.example .env   # then fill in server-side keys (see Configuration)
```

```bash
npm run dev            # web on http://localhost:5173, API on :8787
```

Production: `npm run build`, then `npm start` (serves `dist/` and the API from one Node process on `PORT`). Put it behind HTTPS — browsers only allow microphone capture in a secure context.

## Configuration (server only)

Secrets live in `.env` on the server; nothing is exposed through `VITE_*` and the built bundle contains no provider keys or endpoints (checked).

| Variable | Purpose | Without it |
|---|---|---|
| `REASONING_PROVIDER` | `claude` (default) or `lovable` — exactly one reasoning route for the judges | — |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude route: content reasoning (position, reasoning, structure, three judge turns) via a forced tool call; also AI task help | Assessment stops with a retryable “not configured” failure; task help uses the written guide |
| `LOVABLE_REASONING_URL`, `LOVABLE_FUNCTION_SECRET`, `LOVABLE_REASONING_MODEL` | Lovable AI route via a Lovable Cloud edge function ([setup](docs/LOVABLE_AI_SETUP.md)) | Same as above |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_STT_MODEL` | Transcription of the actual speech (word timings) | Assessment cannot start (retryable) |
| `ELEVENLABS_{ADA,TUNDE,ZAINAB}_VOICE_ID` | Spoken judge feedback with aligned captions, cached per evaluation | Validated written feedback is shown instead |
| `ELEVENLABS_NARRATOR_VOICE_ID` | Used by `npm run audio:generate` for static briefing audio | Briefing text and question captions |
| `DELIVERY_ASSESSOR_PROVIDER=gemini` + `DELIVERY_ASSESSOR_MODEL`, `GEMINI_API_KEY` | Audio-capable delivery assessor that receives the original recording | — |
| `DELIVERY_ASSESSOR_PROVIDER=human` + `FACILITATOR_TOKEN` | Delivery rated by a person at `/facilitator` | — |
| *(neither)* | | Run goes to **needs review**; no score is ever shown from transcript alone |
| `REVIEW_QUEUE_ENABLED=true` (+ `FACILITATOR_TOKEN`) | Learner “Request review” creates a real, receipted request | Button hidden; learner can retry, save the file, or close unscored |
| `RECORDING_RETENTION_DAYS`, `RECORDING_POLICY_VERSION`, `SUPPORT_URL` | Institution policy shown in the privacy panel; hourly retention sweep | Shown as “not yet set by the institution” |
| `FACILITATOR_TOKEN` | Enables `/facilitator`: playback, transcript, human delivery rating, reasoned overrides, audit | Route returns 404 |

Static audio: `npm run audio:audition` lists Nigerian-English voice candidates for **listening approval**; after approval set the voice IDs and run `npm run audio:generate` (narration ×3, chair intro, captions JSON, seamless ambience loop).

## How assessment works

1. Browser captures one speech (MediaRecorder, monotonic 60 s deadline from the recorder’s own start event), saves a recovery copy in IndexedDB, uploads it.
2. Server sniffs the container from magic bytes, decodes the whole file with ffmpeg, verifies duration, re-encodes to exactly 60.0 s if the client overran, hashes it and stores it privately. One valid recording per run; it cannot be replaced.
3. Job pipeline (async, persisted, resumable after restart; each successful stage is stored and never re-billed): ElevenLabs transcript → audio-capable delivery evidence (Gemini or a human) → Claude judgement → validation → score.
4. Validation: JSON schema (kit `assessment.schema.json`), exactly position/reasoning/structure from the model, transcript-sourced evidence only, quotes must exist in the transcript, timestamps inside the recording, three distinct judges in order, no numeric scores in turns. Delivery is bound to the trusted audio record — the content model cannot override it. One bounded repair request, then an actionable failure.
5. Score is computed in code: weight × level / 4, half-up rounding of the final total only, band from the rounded score (85 Strong / 70 Effective / 50 Developing).
6. Judge turns are voiced only after validation, from the exact stored text. Audio failure leaves the written feedback intact.

Recognition failure is never treated as silence or poor delivery; a confirmed-silent valid capture is passed to the assessors as such.

## Design

A centered, agentic flow: the learner only sees what they are acting on right now. Visual language (greige canvas, glass pills, blue orbit agent mark, conic working ring and warm bloom) comes from the FocusPro ad-builder studio; the layout is a single centre-stage column.

- **No chrome.** No page titles, step counters or completed-step lists. Name, voices, ambience, volume, task help, privacy and panel info are folded into one control orb (top right) that expands fluidly on click; help opens as a sheet beneath it.
- **The agent speaks in short lines** that rise in phrase by phrase and leave when they have done their job (“Here’s your issue.”, “Your panel is ready.”, “The panel has feedback for you.”).
- **Upward flow.** Each new element enters from below with a soft blur-in; finished ones leave upward and the column re-centres (shared layout animation).
- **Scenes:** name → three image cards (the chosen card morphs into the briefing media) → briefing with one control pill → the judges arrive one by one, then one microphone pill, then consent, then Begin → recording (listening halos follow real mic amplitude) → a glowing agent orb with one line that follows the real assessment stage → the speaking judge in the spotlight with subtitles → the score, then criteria, then what to keep and change.
- A slow drifting ambient backdrop is tinted per scene. Reduced motion turns every beat into an instant swap; timed beats are short and never block an action for long.

## Verification performed

- `npm test` — 14 acceptance tests: 3/2/4/3 → 73.75 → 74 Effective; 4/4/4/4 → 100 Strong; rounded-band boundaries; duplicate/missing criteria; out-of-range and non-integer levels; fabricated quote; out-of-bounds timestamp; wrong judge order; model-supplied delivery; numeric score in turns; extra schema fields; needs-review; audio-only delivery evidence; caption phrase grouping; task help refuses to write the argument.
- `npm run test:e2e -- <url> <speech.wav> <outDir> [w h] [--expect-failure]` — headless Chrome with a fake microphone fed by a synthesized speech:
  - full run at 1366×768 and 390×844 with provider responses stubbed (`scripts/e2e/stub-providers.ts`, test-only): real 60 s capture → upload → trim to 60.0 s → pipeline → validated 74/100 → spoken turns with synced captions → results → finish; one run created on double-click;
  - unconfigured server: assessment fails honestly, no score shown, retry reuses the same file, audited unscored closure unlocks topics.
- API checks: topic lock (409 on a second topic), idempotent create, consent required before upload, duplicate upload ignored, owner-only access (404 for another learner), facilitator auth (401), human delivery review → completion, override recomputed in code with append-only audit.

Not verified: real provider responses (no keys on this machine), real Nigerian voices, a spoken prompt-injection attempt against the live model, fairness across accents/stances (needs real sample speeches and institutional review).

## Integration status / remaining blockers

| Item | Status |
|---|---|
| Judge portraits + briefing stills (Higgsfield) | Installed — see `docs/PRODUCTION_ASSETS.md` |
| Static audio + ambience (ElevenLabs) | **To generate** — see [MISSING_MEDIA.md](docs/MISSING_MEDIA.md). Scripts ready. |
| Judge idle videos (Higgsfield) | **To generate** (~13.5 credits) — see [MISSING_MEDIA.md](docs/MISSING_MEDIA.md). App picks them up automatically. |
| Lovable AI for the judges | Adapter + edge function included; **needs your Lovable project** — see [LOVABLE_AI_SETUP.md](docs/LOVABLE_AI_SETUP.md) |
| Approved Nigerian voices | **Needs your listening approval** (`npm run audio:audition`) |
| Claude / ElevenLabs / delivery-assessor keys | **Needs server configuration** |
| Recording policy, retention, support URL, review route | **Institution** |
| MIVA logo for optional splash | Not supplied; splash skipped |
| Multi-instance hosting | Store is a single-process JSON file (`server/store.ts`); swap for a database before scaling out |
| Fairness and acoustic validation | Institution + real sample speeches |

The app is not production-ready until these are resolved.
