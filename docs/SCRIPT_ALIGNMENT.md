# Script alignment check — 10 Nov 2026

Source: `docs/Original_Storyboard.txt` (UCC1101 storyboard v1.0). Design and layout are excluded (owner's direction). Where the handoff kit deliberately changed the script, that is noted as a kit change, not a gap.

## Aligned

| Script requirement | Where in the build |
|---|---|
| Exactly three scenes (briefing, 60-second pitch, panel verdict); topic picker, name and results are non-scene screens; no scene numbers shown | `src/App.tsx` stages |
| Three topics with the approved questions, boundaries and narrator scripts; online-only premise, no lecture halls | `shared/content.ts`, briefing stills |
| One topic per run, locked when the briefing opens, other topics unavailable until Finish | `POST /api/runs` (409 on a second topic), idempotent create |
| One recorded speech per run, 60.0 s cap, timer and recording start together, auto stop, no pause/reset/retake | `src/lib/capture.ts`, server trims to 60.0 s |
| Begin only after mic permission + readiness (plus consent) | `P04MicCheck`, `/capture-start` |
| Invalid capture → technical re-record, not a zero | `/capture-failed`, technical recovery message |
| Four criteria, 0–4 anchors, weights 30/30/25/15, exact quarter points, round final total half-up, bands 85/70/50 | `shared/scoring.ts`, `server/prompt.ts`, 14 tests |
| Topic neutrality; no statistics required; accent not penalised; not-scored list | model instruction in `server/prompt.ts` |
| Assessment uses the real recording: transcript for content, audio for delivery | `server/assessment.ts` |
| Evaluation failure: no invented mark, recording kept, retry same file, support link | processing scene + `/evaluate` retry |
| Low-confidence → Needs review, no score shown | `needs-review` path |
| Verdict is dynamic and evidence-based, not a canned clip; text fallback if voice fails | validated turns, voice optional |
| Improvement chosen from the lowest criterion with tie-break Reasoning → Position → Structure → Delivery | model instruction |
| Results: score largest, criteria, one strength, one improvement, replay (passive) | `P08Results` |
| Finish closes the run, preserves the audit, returns to topic selection | `/finish` |
| Facilitator override with reason and audit trail; never expose another learner's audio | `/facilitator`, owner-only routes |
| Consent and disclosure before capture; retention institution-configured | consent step, privacy sheet, retention sweep |
| Captions default on (≥18px), keyboard access, timer announced without disrupting speech, no colour-only status | scenes + `role=status` lines |
| No leaderboard, no music during recording | — |

## Kit changes (intentional, not gaps)

- Three judges each speak one turn (Ada/Tunde/Zainab) instead of “chair or relevant panelist”.
- Landing and name screens merged; logo splash only if the institution supplies the logo.
- A still image + narration instead of a briefing video (the kit allows this).
- If assessment can't recover, the learner may close the run without a score (audited) — the script otherwise keeps topics locked until Finish.
- Chair introduction length allowed to run its natural ~20–25 s instead of 8–12 s.

## Gaps against the script

| # | Script says | Build today | Size |
|---|---|---|---|
| 1 | Countdown runs **01:00 → 00:00** | Shows `0:60 → 0:00` | small |
| 2 | Scene 1 “mission overlay”: issue, academic audience, **60 s, one submitted performance, any defensible stance is fine**, plus the **three speaking cues** | Removed in the minimal redesign — briefing shows only the image/question | small |
| 3 | Chair delivers the introduction (with subtitles) | If the chair audio is missing (it is, today) the chair's words are **never shown** | small |
| 4 | Verdict assembly: **band opening line** (e.g. “Your argument was clear and persuasive in several important respects.”) and **neutral closing line** | Not added; turns come only from the model | small |
| 5 | Result shows **topic** and the **three strand summaries** (Content /60, Structure /25, Delivery /15) | Topic not shown; strands only appear inside “Why this score” | small |
| 6 | Optional **transcript review** on results (subject to consent) | No transcript is shown to the learner | small |
| 7 | Low-confidence: learner can **complete the run with “Pending facilitator review”** | Learner can request review or close unscored, but a later facilitator rating **re-opens a closed run as active** (bug — could create two active runs) | small, bug |
| 8 | Running log includes **microphone test state** | Not stored on the run | small |
| 9 | **44 px** minimum touch targets | Control orb tools 32 px; pill tools 40 px (36 px on phones) | small |
| 10 | Alternative assessment for learners who **can't record**, routed via a facilitator | Only a support link (if configured) or close unscored | medium |
| 11 | Facilitator dashboard: **filter by topic/status/date**, **export anonymised rubric results** | Plain list, no filters, no export | medium |
| 12 | Narrator + three **Nigerian voices**, chair audio | Not produced — ElevenLabs unreachable; voices unapproved | blocker |
| 13 | Live assessment of real speeches (incl. “both pro and con can reach 100”) | Not run — no API keys; pipeline tested with stand-in responses only | blocker |
| 14 | Briefing “approximately 30–45 s cinematic video” | Still image + narration (kit-approved fallback) | optional |
