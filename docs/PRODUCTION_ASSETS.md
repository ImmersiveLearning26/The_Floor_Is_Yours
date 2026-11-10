# Production assets — record

Generated 10 November 2026 for The Floor Is Yours, following `production/HIGGSFIELD_ASSETS.md` and `production/ELEVENLABS_AUDIO.md` from the handoff kit.

## Images (Higgsfield) — installed

| Asset | Runtime file | Model | Job ID | Notes |
|---|---|---|---|---|
| Ada portrait | `public/media/judges/ada.webp` (512², 21 KB) | `gpt_image_2_6` (quality low, 1:1) with an identity reference cropped from `docs/references/04_Microphone_Check.png` | `56fc3db0-b0e7-4509-bca7-3df54348e468` | Prompt H01 + “match the identity of the reference exactly” |
| Tunde portrait | `public/media/judges/tunde.webp` (20 KB) | same | `0c6823d4-a3e6-4e7a-82bf-3ddc64109a0a` | Prompt H02 |
| Zainab portrait | `public/media/judges/zainab.webp` (18 KB) | same | `108d7841-4f90-46c3-bcc3-6f8b34d77e9b` | Prompt H03 |
| T01 social media briefing | `public/media/briefing/t01.webp` (1600×900, 77 KB) | `soul_2` (1.5k, 16:9) | `a493f398-b74a-400f-a19e-574de025245d` | Prompt H04 |
| T02 AI in assignments briefing | `public/media/briefing/t02.webp` (50 KB) | `soul_2` | `f1b3a739-b89c-4565-8101-3431c370ba59` | Prompt H05 |
| T03 live attendance briefing | `public/media/briefing/t03.webp` (54 KB) | `soul_2` | `f266a057-65c0-420d-875c-a40aba27f6ca` | Prompt H06 |

Masters (1024² portraits, 1696×960 stills) are kept outside the runtime bundle. The Higgsfield account had 1.32 credits; portraits cost 0.25 each and stills 0.12 each (1.11 total), which is why the stills use Soul 2 rather than GPT Image. Re-generate at higher quality if credits allow; keep the same identities.

Review notes: portraits match the reference identities (hair, beard, hijab, outfits). Screens in the stills are indistinct; T01’s laptop shows a blurred class. No text, logos or watermarks were observed.

## Audio (ElevenLabs) — NOT generated (blocked)

Every connection to `api.elevenlabs.io` from this machine timed out at the TCP level on 10 Nov 2026 (DNS resolved; other hosts reachable), through both the ElevenLabs MCP tools and direct HTTPS. No audio was produced and no voice was approved.

| Asset | Path | Status |
|---|---|---|
| Briefing narration T01–T03 + captions | `public/media/audio/briefing-t0{1,2,3}.mp3/.json` | to generate |
| Chair introduction + captions | `public/media/audio/chair-introduction.mp3/.json` | to generate |
| Setup ambience loop | `public/media/audio/setup-ambience.mp3` | to generate |
| Dynamic judge feedback | private, per evaluation (server `data/voice/`) | generated at runtime after validation |

To finish: `npm run audio:audition` (lists Nigerian-English candidates for listening/approval) → put the four approved voice IDs in `.env` → `npm run audio:generate`. Until then the app shows the full briefing and chair text, captions fall back to the question, and the ambience stays silent — as specified in `handoff/REMAINING_INPUTS.md`.

## Institution assets

`public/media/brand/miva.svg` (optional opening splash) was not supplied. The splash is skipped automatically; no logo is recreated from text.

## Judge idle loops — ready to generate (needs ~13.5 Higgsfield credits)

The app already looks for `public/media/judges/{ada,tunde,zainab}-idle.mp4` and plays them silently on loop in place of the still (still image = poster and fallback; reduced-motion users keep the still). Until they exist, the stills breathe and drift slightly in CSS. Idle motion is constant and never reacts to the learner's speech (storyboard: slight head/eye movement allowed; no fake lip-sync).

- Model: `kling3_0`, mode `std`, duration 3 s, `sound: off`, aspect 1:1 — quoted at 4.5 credits each (10 Nov 2026).
- Media: `start_image` **and** `end_image` = the same accepted portrait job (Ada `56fc3db0-…`, Tunde `0c6823d4-…`, Zainab `108d7841-…`) so the loop closes seamlessly.
- Prompt: “Locked-off camera, same person, same clothing and background. Subtle idle presence on a video call: natural slow breathing, one or two relaxed eye blinks, a very slight head movement of a few degrees that returns to the start position. Neutral, attentive expression throughout. Mouth stays closed and still: no talking, no lip movement, no smiling, no nodding. No camera movement, no zoom, no new objects, no text. Seamless loop: the last frame matches the first.”
- Install: `ffmpeg -i in.mp4 -an -vf "crop=min(iw\,ih):min(iw\,ih),scale=512:512" -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart public/media/judges/ada-idle.mp4` (repeat per judge). Reject any clip where the mouth moves or the identity drifts.
