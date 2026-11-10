# Media still to generate: videos and audio

The app runs without these: it shows text where narration is missing and still photos where loops are missing. The simulation is not finished until they are produced and approved. All paths are relative to the repo root; the app picks files up automatically — no code changes needed.

## 1. Judge idle videos (Higgsfield) — so the panel feels alive

| File | Status |
|---|---|
| `public/media/judges/ada-idle.mp4` | **to generate** |
| `public/media/judges/tunde-idle.mp4` | **to generate** |
| `public/media/judges/zainab-idle.mp4` | **to generate** |

A short silent loop per judge: breathing, one or two blinks, a tiny head movement that returns to the start. The app plays it in the judge's bubble on loop, with the photo as poster/fallback. Until then the photos use a gentle CSS breathing motion.

- **Model:** `kling3_0`, mode `std`, **3 s**, `sound: off`, aspect **1:1** (≈4.5 credits each, ~13.5 for all three — the account had 0.21 when this was written).
- **Media:** use the accepted portrait as **both** `start_image` and `end_image` so the loop closes seamlessly. Portrait job IDs: Ada `56fc3db0-b0e7-4509-bca7-3df54348e468`, Tunde `0c6823d4-a3e6-4e7a-82bf-3ddc64109a0a`, Zainab `108d7841-4f90-46c3-bcc3-6f8b34d77e9b` (or upload `public/media/judges/<name>.webp`).
- **Prompt:**
  > Locked-off camera, same person, same clothing and background. Subtle idle presence on a video call: natural slow breathing, one or two relaxed eye blinks, a very slight head movement of a few degrees that returns to the start position. Neutral, attentive expression throughout. Mouth stays closed and still: no talking, no lip movement, no smiling, no nodding. No camera movement, no zoom, no new objects, no text. Seamless loop: the last frame matches the first.
- **Reject** any clip where the mouth moves, the face drifts from the portrait, or the expression looks like approval/disapproval (the storyboard forbids evaluative reactions and fake lip-sync).
- **Install:**
  ```bash
  ffmpeg -i ada.mp4 -an -vf "crop=min(iw\,ih):min(iw\,ih),scale=512:512" -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart public/media/judges/ada-idle.mp4
  ```
  Repeat for `tunde` and `zainab`.

### Optional: briefing loops
The storyboard asks for a 30–45 s “cinematic” briefing; the kit accepts a still + narration (what the app does now). If you want motion, make one **5–8 s silent loop per topic** from the existing still (`public/media/briefing/t0{1,2,3}.webp`): “Locked camera, subtle breathing and one natural glance, slight ambient daylight movement, restrained realism. Preserve exact face, clothing, desk and laptop. No scene cuts, camera push, mouth speech, typography or new objects. Smooth loop.” Keep the still as poster and fallback. *(Wiring a briefing video into the media card is a small code change — not done yet.)*

## 2. Audio (ElevenLabs)

ElevenLabs could not be reached from the build machine (network timeout), so **no audio exists yet** and **no voice has been approved**.

| File | Voice | Status |
|---|---|---|
| `public/media/audio/briefing-t01.mp3` + `.json` captions | Narrator | **to generate** |
| `public/media/audio/briefing-t02.mp3` + `.json` | Narrator | **to generate** |
| `public/media/audio/briefing-t03.mp3` + `.json` | Narrator | **to generate** |
| `public/media/audio/chair-introduction.mp3` + `.json` | Ada (chair) | **to generate** |
| `public/media/audio/setup-ambience.mp3` | sound effect | **to generate** |
| Judge feedback (per evaluation, private) | Ada, Tunde, Zainab | generated **at runtime** after each validated assessment |

### Step 1 — choose and approve the four Nigerian voices (a person must listen)
```bash
npm run audio:audition
```
This writes `docs/voice-audition/candidates.md` (Nigerian-English voices from the ElevenLabs library with preview links). Listen and pick:
- **Narrator** — warm, clear Nigerian English (female, distinct from Ada)
- **Ada** — Nigerian woman ~40, composed, encouraging (also the chair)
- **Tunde** — Nigerian man ~45, measured, thoughtful
- **Zainab** — Nigerian woman ~35, clear and reassuring

A generic American/British voice is not an acceptable substitute. Add the chosen voices to your ElevenLabs library, then put their IDs in `.env`:
```
ELEVENLABS_API_KEY=...
ELEVENLABS_NARRATOR_VOICE_ID=...
ELEVENLABS_ADA_VOICE_ID=...
ELEVENLABS_TUNDE_VOICE_ID=...
ELEVENLABS_ZAINAB_VOICE_ID=...
```

### Step 2 — render the fixed audio once
```bash
npm run audio:generate
```
This renders the three briefing narrations and the chair introduction with **timed captions** (`.json` next to each `.mp3`), and the calm outdoor ambience (generated as a sound effect, crossfaded into a seamless loop and normalised quiet). Re-run a single part with `--only=briefing|chair|ambience`; add `--force` to overwrite. Scripts are the exact approved texts in `shared/content.ts`.

### Step 3 — listen before release
- Narration and chair at a natural pace (the chair runs ~20–25 s; don't speed it up).
- Ambience: soft, no sudden birds, no music; it plays only in setup screens and stops before recording.
- Judge feedback voices are generated automatically once the four voice IDs are set; captions are aligned from ElevenLabs timestamps.

## 3. Optional institution asset
`public/media/brand/miva.svg` — the approved logo, only if the opening splash is wanted. Never recreate it from text.
