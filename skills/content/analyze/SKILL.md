---
name: analyze
description: Break down short-form videos from links (TikTok, Instagram Reels, YouTube Shorts) into transcript, topic, format, idea, hook breakdown, layout and storytelling structure, plus a batch analysis across several links, rendered as one HTML report. Use when the user pastes video links and says "analyze", "/analyze", "break these down", or asks what a set of videos have in common.
---

# analyze

Stats and captions come from `yt-dlp`, frames from `ffmpeg`. You write the analysis, and `render.mjs` turns it into a self-contained HTML report. The skill itself requires no account. Instagram may need your signed-in browser session.

`$S` = the `scripts` folder next to this SKILL.md. Write its full absolute path in each command.

## Before the first run

Check `node --version` (20+), `yt-dlp --ignore-config --version`, `ffmpeg -version` and `ffprobe -version`. For YouTube, check for Node 22+ or `deno --version` (2.3+), and confirm `yt-dlp --ignore-config --help` lists `--js-runtimes` and `--remote-components`. Fetch enables Node alongside the default Deno runtime. It allows yt-dlp to retrieve the EJS solver from GitHub when the installed package lacks it. If a requirement is missing, report it before fetching. [YouTube runtime and solver setup](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

Run `node "$S/selfcheck.mjs"` to check the parsers and renderer offline.

## Steps

1. **Pick the folder.** Use `./analyze/<YYYY-MM-DD>-<short-slug>/` in the current directory unless the user names one. New run = new folder. If the name exists, append a suffix such as `-2`. Reuse a folder only to retry that run.
2. **Fetch.** `node "$S/fetch.mjs" "<folder>" "<url>"` (quote each additional URL separately). Videos are fetched one at a time. Each gets `<folder>/<id>/video.json` (stats, like/comment rates, the creator `baseline`, `promo_signals`, transcript with times, shot cuts, wpm), `hook.jpg` (first 3 s, every 0.5 s) and `sheet.jpg` (a frame for every detected shot, plus one every 4 s in long shots, capped at 48, read left to right, with times in `frames.sheet.times`). Fetch deletes the media afterwards; pass `--keep` only if the user wants the file. Use HTTPS links on TikTok, Instagram or YouTube (including youtu.be). The downloader ignores saved yt-dlp configuration. Exit 0 means all links succeeded, 1 means all failed, 2 means invalid arguments, and 3 means partial success. Report each `FAILED` link. On 3, analyse the completed video folders; on 1, stop. Pass `--replace` only for an intentional refetch: it replaces the entire existing video ID folder, including any extra files in it.
   - Instagram usually needs a signed-in session. Rerun that link with `--cookies-from-browser chrome` (or `firefox`, `safari`) **only after the user says to use their browser session**. The flag applies to both that video and its creator baseline lookup. Keep the retry scoped to the approved link.
   - Fetch reads nonempty English VTT or SRT tracks, preferring VTT. If none is usable, report that limit.
   - Advanced: bring your own transcriber with `--transcribe "<path-to-script>"`. Supply a trusted Node script taking `<media> <out.json>` and writing `{"words":[{"w":"hello","start":0,"end":0.4}]}`. Fetch runs it only if usable captions are missing.
   - `baseline` is the median views of the creator's other recent posts (up to 30; zero counts and posts under 3 days old are excluded), and `multiple` is this video's views against it. TikTok's channel list varies between calls, so treat the multiple as ±10%. Instagram has no baseline (`error` says why). YouTube Shorts lists carry no dates, so their baseline can include posts still collecting views. TikTok rounds big counts (1.1M), so rates on large videos are approximate.
3. **Look and read.** For every video, read `video.json` and look at both images. Layout and the visual hook only show in the frames, so never analyse from the transcript alone. Describe layout from the sheet shot by shot (how many shots are split screen, full face, full-height footage). Check the transcript's hook against the burned-in captions in `hook.jpg`: where they differ, the on-screen text is the creator's own correction.
4. **Write `<folder>/analysis.json`** in this shape (every string is plain text):
   ```json
   {
     "title": "…", "date": "YYYY-MM-DD",
     "batch": {
       "summary": "…",
       "patterns": [{ "title": "…", "detail": "…", "videos": ["<id>"] }],
       "for_you": ["…"]
     },
     "videos": {
       "<id>": {
         "topic": "…", "format": "…", "idea": "…",
         "hook": { "spoken": "…", "text_on_screen": "…", "visual": "…", "type": "…", "why_it_works": "…" },
         "layout": "…",
         "structure": [{ "t": "0:00–0:06", "beat": "…" }],
         "steal": ["…"]
       }
     }
   }
   ```
   - Include `batch` only when there are 2+ videos. `for_you` turns the patterns into concrete changes for the user's own videos; ask about their niche if you don't know it.
   - `spoken` is the exact opening line from the transcript: at least 3 whole words from the first 10 s (or from the first 3 lines if speech starts later). A video with no speech leaves `spoken` empty and describes the hook in `text_on_screen` or `visual`. `structure` times come from transcript timestamps, in order, without overlaps, inside the video. The final beat may end at the duration rounded up to the next whole second. Each beat needs nonempty `t` and `beat` strings.
   - Every number you cite (views, rates, shot length, wpm, dates) comes from `video.json`. Judge performance only against `baseline.multiple` ("did well" means well for that account), never by comparing raw views across creators. Check `upload_date` before calling a video new or old.
   - Report `promo_signals` as what they are: a link or a disclosure tag. A link alone doesn't show a post is paid or affiliate; say so only with evidence.
   - Keep observations and hypotheses apart. A few videos show a difference, not its cause: write "observed" for what the evidence shows and "hypothesis to test" for any causal reading.
5. **Render.** `node "$S/render.mjs" "<folder>"` writes `<folder>/report.html` (images inlined, works offline). It requires at least one fetched video. To intentionally replace an existing report in this run, append `--force`. It refuses (exit 1, problems listed) when a fetched video is missing from `analysis.json`, a required field is empty, `hook.spoken` isn't an exact opening quote, a `structure` time is malformed, overlaps or passes the end, or a pattern cites an unknown video. It doesn't check numbers written in prose; that's on you. Fix the analysis, don't loosen the check.
6. **Show it.** Give the report's absolute path and offer to open it (`open` on macOS, `start` on Windows, `xdg-open` on Linux).

## Limits

- Public stats only: no retention or watch time. A paid boost inflates views; treat a lopsided like/comment ratio as a warning.
- Shot cuts are ffmpeg scene changes (score > 0.2). A swap of an on-screen graphic counts as a cut; slow crossfades are missed. Use the count as pace, not an exact edit count.
- It analyses the links you give it. It doesn't search a whole platform.
- Respect each platform's terms and the creator's rights: analyse, don't re-upload.
