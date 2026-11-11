# The Floor Is Yours

A first-year undergraduate oral academic argument simulation. One calm, chat-like column:

1. greets the learner;
2. locks one issue;
3. plays a briefing;
4. opens a compact call with three AI judges (Ada, Tunde, Zainab);
5. records **one** speech of up to 60 seconds;
6. has the speech assessed against the source rubric;
7. plays grounded spoken feedback and shows the result.

Built from `The_Floor_Is_Yours_Claude_Kit` (design references, page specs, rubric, provider specs). The only visual addition is the agent-working glow borrowed from the FocusPro Studio ad-builder simulation (see *Design* below).

## Start here

- **Deploy on Lovable (the real app):** [docs/LOVABLE_SETUP.md](docs/LOVABLE_SETUP.md). Import this repo, turn on Lovable Cloud, paste two prompts, and add one secret. **AI is connected in Lovable**, in one file: [`supabase/functions/_shared/ai/lovable.ts`](supabase/functions/_shared/ai/lovable.ts).
- **Generate the missing videos and audio:** [docs/MISSING_MEDIA.md](docs/MISSING_MEDIA.md).
- **What the original script requires vs. what is built:** [docs/SCRIPT_ALIGNMENT.md](docs/SCRIPT_ALIGNMENT.md).

## How it is built

```
src/                      React + Vite learner app (and src/facilitator for /facilitator.html)
supabase/
  migrations/             Postgres tables + RLS + private Storage bucket (Lovable Cloud)
  functions/api/          the one edge function (Deno) — entry point
  functions/_shared/      the simulation's server logic, runtime-neutral TypeScript:
    app.ts                  API routes (runs, consent, recording, assessment, facilitator)
    pipeline.ts             assessment job, one short step per invocation
    prompt.ts schema.ts validate.ts scoring.ts content.ts   rubric, contract, evidence checks, score
    ai/lovable.ts           ← the AI connection (to be implemented in Lovable)
server/                   local dev server: same _shared code on a JSON file + local folder
tests/                    unit, API and database-migration tests
```

The same `_shared` code runs in Lovable Cloud and in the local dev server. Only the storage ports differ:

| | Lovable Cloud | Local dev server |
|---|---|---|
| Data | Postgres | JSON file |
| Files | Storage | local folder |
| Learner identity | anonymous sign-in | signed cookie |

## Run it locally (no AI)

Requires Node 22+.

```bash
npm install
```

```bash
cp .env.server.example .env.server
```

```bash
npm run dev
```

The web app runs on http://localhost:5173 and the API on :8787. You can walk the whole flow. After the recording, assessment ends on the honest "not connected yet" screen, because the AI is connected only in Lovable. The facilitator page is at http://localhost:5173/facilitator.html and uses the `FACILITATOR_TOKEN` from `.env.server`.

Don't put secrets in `.env`. That file holds Lovable's public `VITE_SUPABASE_*` values and is committed.

## How assessment works

1. **Capture.** The browser records one speech with MediaRecorder. A monotonic 60 s deadline starts from the recorder's own start event. It keeps a recovery copy in IndexedDB, converts the speech to a 16 kHz mono WAV, and uploads it.
2. **Checks on upload.** The server reads the WAV itself, verifies the duration, trims anything over 60.0 s, measures peak level (to detect confirmed silence), hashes the file and stores it privately. Each run has one valid recording, and it can't be replaced.
3. **Assessment job.** The job is persisted and resumable, and each step saves its output, so nothing is re-billed on retry. The steps:
   1. transcript of the actual audio;
   2. delivery rated from the audio (Lovable AI, or a facilitator listening);
   3. the judges' content assessment;
   4. validation;
   5. score;
   6. voices.
4. **Validation.** The judges' answer must pass all of these checks:
   - it matches the JSON schema;
   - the model supplies exactly position, reasoning and structure;
   - evidence comes only from the transcript;
   - quotes exist in the transcript;
   - timestamps fall inside the recording;
   - there are three distinct judges, in order;
   - no turn mentions a numeric score.

   Delivery is bound to the trusted audio record. If the answer fails, the app sends one bounded repair request, then shows an actionable failure.
5. **Score.** Computed in code as weight × level / 4. Only the final total is rounded, half-up. The band comes from the rounded score: 85 Strong, 70 Effective, 50 Developing.
6. **Voices.** Judge turns are voiced only after validation, from the exact stored text. If audio fails, the written feedback stays.

Recognition failure is never treated as silence or poor delivery. When the AI isn't connected, the learner is told so, the recording is kept, and no score is ever shown.

## Design

A centered, agentic flow where the learner only sees what they are acting on right now. The visual language comes from the FocusPro ad-builder studio: greige canvas, glass pills, a blue orbit agent mark, a conic working ring and a warm bloom. A Photon Knot backdrop is present during setup and fades out for the serious parts.

- **No chrome.** Name, voices, ambience, volume, task help, privacy and panel info are folded into one control orb at the top right.
- **The agent speaks in short lines.** Each line rises in phrase by phrase and leaves once it has done its job.
- **Scenes:**
  1. name;
  2. three topic cards;
  3. briefing with one control pill;
  4. the judges arrive one by one, then the microphone, consent and Begin;
  5. recording;
  6. a glowing agent orb that follows the real assessment stage;
  7. the speaking judge, with subtitles;
  8. the score, then the criteria.
- **Reduced motion** turns every beat into an instant swap.

## Verification

- `npm test` runs 25 tests:
  - **Unit:**
    - scoring 3/2/4/3 → 73.75 → 74 Effective;
    - band boundaries;
    - schema and evidence checks;
    - WAV parse, trim and peak;
    - captions;
    - task help refuses to write the argument.
  - **API, real routes and pipeline with a test AI:**
    - a full run to 74, voiced, then finished;
    - the 62 s upload is trimmed to 60.0 s;
    - immutable recording;
    - owner-only access;
    - one active run;
    - non-WAV and too-short uploads rejected;
    - AI not connected → honest failure, retry and unscored close;
    - a facilitator rates delivery, then the score appears;
    - an override is recomputed in code;
    - the internal step route needs its secret.
  - **Database (migration on Postgres via PGlite):**
    - the migration runs and can be re-run;
    - one unfinished run per learner and one recording per run;
    - the job lease;
    - browser roles are blocked from every table.
- `npm run test:e2e -- <url> <speech.wav> <outDir> [w h] [--expect-failure]` drives headless Chrome with a fake microphone. To run it, build first and start the dev server with `SERVE_DIST=1` and `FIY_AI=stub` (test only).
  - **Full run, verified:** capture, then WAV conversion, upload, assessment, feedback, 74/100, replay of the saved minute, and finish.
  - **Failure run, verified with the real not-connected Lovable AI file:** "Speech transcription is not connected yet." No score is shown, and retry, save, review and close are all offered.

Not verified yet:

- the live Lovable Cloud deployment and Lovable AI responses (they need your Lovable project);
- real Nigerian voices;
- a spoken prompt-injection attempt against the live model;
- fairness across accents and stances.

See the checklist in [docs/LOVABLE_SETUP.md](docs/LOVABLE_SETUP.md).

## Remaining items

| Item | Status |
|---|---|
| Lovable project, Cloud migration, anonymous sign-ins | **You:** follow docs/LOVABLE_SETUP.md, Part 1 |
| Lovable AI connection (5 methods in one file) | **In Lovable:** Part 2 |
| Static briefing/chair audio and ambience | **To generate**: [MISSING_MEDIA.md](docs/MISSING_MEDIA.md) |
| Judge idle videos (Higgsfield) | **To generate** (~13.5 credits). The app picks them up automatically. |
| Recording policy, retention, support URL | **Institution** |
| MIVA logo for the optional splash | Not supplied, so the splash is skipped |
| Fairness and acoustic validation | Institution, with real sample speeches |
