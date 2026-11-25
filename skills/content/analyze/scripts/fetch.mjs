#!/usr/bin/env node
// node fetch.mjs <outDir> <url> [url...] [options]; see ../SKILL.md
// Per video, writes <outDir>/<id>/: video.json (stats, transcript, shot cuts), hook.jpg (first 3 s), sheet.jpg (whole video).
// The mp4 is only needed for frames and is deleted afterwards unless --keep.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function run(cmd, args, { stderr = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.error?.code === 'ENOENT') throw new Error(`${cmd} not found; install it`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd}: ${result.stderr.trim() || 'process failed'}`);
  return stderr ? result.stderr : result.stdout;
}

export function parseVtt(text) {
  const cues = [], said = [];
  let prevEnd = 0;
  const ts = (s) => s.replace(',', '.').split(':').reduce((a, p) => a * 60 + Number(p), 0);
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->').map((s) => ts(s.trim().split(' ')[0]));
    let w = lines.slice(i + 1).map(clean).join(' ').split(' ').filter(Boolean);
    if (!w.length || !Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const prev = cues.at(-1);
    // Rolling captions (YouTube) repeat the words already shown, a whole line or a word-by-word build.
    // For a cue that starts where the last one ended, drop its longest prefix that repeats the words said since the
    // last pause (a gap over 0.5 s starts a new run, so speech after a silence is never matched against older words).
    // shortcut: a genuine repeat right at a cue boundary ("no / no way") loses one copy; rare, accept it.
    if (!prev || a - prevEnd > 0.5) said.length = 0;
    else {
      let k = Math.min(w.length, said.length);
      while (k > 0 && said.slice(-k).join(' ') !== w.slice(0, k).join(' ')) k--;
      w = w.slice(k);
      if (!w.length) { prev.end = Math.max(prev.end, +b.toFixed(2)); prevEnd = Math.max(prevEnd, b); continue; }
    }
    said.push(...w);
    prevEnd = b; // unrounded, so the 0.5 s gap test isn't skewed by display rounding
    cues.push({ start: +a.toFixed(2), end: +b.toFixed(2), text: w.join(' ') });
  }
  return cues;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '', hellip: '…', mdash: '\u2014', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const clean = (l) => l.replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);|&#(\d+);/gi, (m, h, d) => { const c = h ? parseInt(h, 16) : +d; return c <= 0x10ffff ? String.fromCodePoint(c) : m; })
  .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m).replace(/\s+/g, ' ').trim();

// Timestamped words -> caption-like lines, broken at pauses or every ~8 words.
export function wordsToLines(words) {
  const out = [];
  for (const w of words) {
    const cur = out.at(-1);
    if (cur && w.start - cur.end < 0.5 && cur.n < 8) { cur.text += ' ' + w.w.trim(); cur.end = w.end; cur.n++; }
    else out.push({ start: w.start, end: w.end, text: w.w.trim(), n: 1 });
  }
  return out.map(({ n, ...l }) => l);
}

function shotCuts(mp4) {
  // A 0.2 threshold catches cuts that change only one pane of a split layout.
  const log = run('ffmpeg', ['-hide_banner', '-i', mp4, '-vf', "select='gt(scene,0.2)',showinfo", '-an', '-f', 'null', '-'], { stderr: true });
  return [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => +(+m[1]).toFixed(2));
}

// Sheet times: the middle of every shot, plus one every 4 s inside long shots; at most 48, spread evenly
// (past 48, some short shots get no frame; the report says so).
export function sheetTimes(cuts, dur, max = 48) {
  const edges = [0, ...cuts, dur], t = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [a, b] = [edges[i], edges[i + 1]], n = Math.max(1, Math.round((b - a) / 4));
    for (let k = 0; k < n; k++) t.push(+(a + ((k + 0.5) * (b - a)) / n).toFixed(2));
  }
  return t.length <= max ? t : Array.from({ length: max }, (_, i) => t[Math.round((i * (t.length - 1)) / (max - 1))]);
}

function frames(mp4, cuts, dur, dir) {
  // shortcut: drawtext needs ffmpeg built with freetype; frame times are listed in video.json instead.
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', mp4, '-t', '3', '-vf', 'fps=2,scale=240:-2,tile=6x1', '-frames:v', '1', path.join(dir, 'hook.jpg')]);
  const times = sheetTimes(cuts, dur), fd = fs.mkdtempSync(path.join(dir, '.f-'));
  // A seek within the last ~0.3 s can land past the final frame and write nothing; clamp it.
  times.forEach((t, i) => run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(Math.min(t, Math.max(0, dur - 0.3))), '-i', mp4, '-frames:v', '1', '-vf', 'scale=240:-2', path.join(fd, `${String(i).padStart(3, '0')}.jpg`)]));
  const cols = 8, rows = Math.ceil(times.length / cols);
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(fd, '%03d.jpg'), '-vf', `tile=${cols}x${rows}`, '-frames:v', '1', path.join(dir, 'sheet.jpg')]);
  fs.rmSync(fd, { recursive: true });
  return { hook: { every_s: 0.5, frames: 6 }, sheet: { cols, times } };
}

// The creator's normal: median views of their other recent posts. Zeros are missing data (TikTok's list
// sometimes returns 0 for a real video) and posts under 3 days old are still collecting views.
export function baselineStats(entries, targetId, nowSec, views) {
  // YouTube Shorts list entries have no timestamp: keep them, the under-3-days filter just can't apply.
  const ok = entries.filter((e) => String(e.id) !== String(targetId) && e.view_count > 0 && !(e.timestamp && nowSec - e.timestamp < 3 * 86400));
  if (ok.length < 5) return null;
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mv = med(ok.map((e) => e.view_count));
  // A rate needs at least 5 posts that report the count; missing counts stay missing, not 0%.
  const rate = (k, dp) => { const xs = ok.filter((e) => typeof e[k] === 'number'); return xs.length >= 5 ? +med(xs.map((e) => (100 * e[k]) / e.view_count)).toFixed(dp) : null; };
  const dated = ok.filter((e) => e.timestamp), durs = ok.filter((e) => e.duration > 0).map((e) => e.duration);
  const times = entries.map((e) => e.timestamp).filter(Number.isFinite), span = (Math.max(...times) - Math.min(...times)) / (7 * 86400);
  const url = (e) => [e.webpage_url, e.url].find((u) => /^https:\/\//.test(String(u))) ?? null;
  return { posts: ok.length, median_views: mv, median_like_pct: rate('like_count', 2),
    multiple: views ? +(views / mv).toFixed(2) : null, from: dated.length ? new Date(Math.min(...dated.map((e) => e.timestamp)) * 1000).toISOString().slice(0, 10) : null,
    median_comment_pct: rate('comment_count', 3), median_share_pct: rate('repost_count', 3), median_save_pct: rate('save_count', 3),
    median_duration_s: durs.length >= 5 ? med(durs) : null,
    posts_per_week: times.length >= 5 && span > 0 ? +((times.length - 1) / span).toFixed(1) : null,
    // The creator's other recent hits (2x their median or more): a free outlier list for ideas.
    outliers: ok.filter((e) => e.view_count >= 2 * mv).sort((a, b) => b.view_count - a.view_count).slice(0, 5)
      .map((e) => ({ id: String(e.id), title: String(e.title || e.description || '').slice(0, 160), url: url(e), views: e.view_count, multiple: +(e.view_count / mv).toFixed(2),
        date: e.timestamp ? new Date(e.timestamp * 1000).toISOString().slice(0, 10) : null })) };
}

const supportedHost = /^(?:(?:www|m|vm|vt)\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)$/;
export function platform(url) {
  const u = URL.canParse(url) && new URL(url);
  if (!u || /[\\\s]/.test(url) || !url.startsWith('https://') || u.protocol !== 'https:' || u.username || u.password || u.port || !supportedHost.test(u.hostname))
    throw new Error(`expected a supported HTTPS video URL: ${url}`);
  return u.hostname.match(supportedHost)[1];
}

export function downloaderArgs(options, url, cookies) {
  const host = platform(url);
  const youtube = host === 'youtube.com' || host === 'youtu.be';
  return ['--ignore-config', ...(youtube ? ['--js-runtimes', 'node', '--remote-components', 'ejs:github'] : []),
    ...options, ...(cookies ? ['--cookies-from-browser', cookies] : []), '--', new URL(url).href];
}

// The creator's 30 most recent posts from the flat channel list (no downloads). null when there is no list for this platform.
export function channelUrl(info) {
  return info.extractor_key === 'TikTok' && info.uploader ? `https://www.tiktok.com/@${info.uploader}`
    : info.extractor_key === 'Youtube' && info.channel_url ? `${info.channel_url}/shorts` : null;
}

export function channelEntries(list, cookies) {
  let best = [];
  for (let i = 0; i < 2; i++) { // TikTok's list intermittently zeroes many counts; retry once and keep the fuller answer
    try {
      const e = JSON.parse(run('yt-dlp', downloaderArgs(['--flat-playlist', '--playlist-items', '1:30', '-J'], list, cookies))).entries || [];
      const good = (xs) => xs.filter((x) => x.view_count > 0).length;
      if (good(e) > good(best)) best = e;
      if (best.length && good(best) >= 0.8 * best.length) break;
    } catch { /* retry */ }
  }
  return best;
}

function baseline(info, cookies) {
  const list = channelUrl(info);
  if (!list) return { error: `no channel list for ${info.extractor_key}` };
  const best = channelEntries(list, cookies);
  if (!best.length) return { error: 'channel list fetch failed' };
  return baselineStats(best, info.id, Date.now() / 1000, info.view_count) ?? { error: 'fewer than 5 usable posts' };
}

// Caption hints worth a look: disclosure tags or an outbound link. A link alone proves nothing about payment.
export const promoSignals = (cap) => [...new Set((String(cap ?? '').match(/#(ad|ads|paid\w*|sponsor\w*|\w*partner\w*|\w*ambassador\w*|affiliate\w*|gifted|collab\w*)\b|https?:\/\/\S*[^\s.,;:!?)\]"'>]|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*[^\s.,;:!?)\]"'>]/gi) || []).map((m) => (m[0] === '#' ? m.toLowerCase() : m)))]; // URLs keep their case

// Move only completed results into view. A failed build leaves prior evidence intact.
export function commitVideo(tmp, dir, replace) {
  const existing = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!existing) return fs.renameSync(tmp, dir);
  if (!replace) throw new Error(`${dir} already exists; use a new folder or --replace`);
  const meta = path.join(dir, 'video.json');
  if (!existing.isDirectory() || !fs.lstatSync(meta, { throwIfNoEntry: false })?.isFile()
      || JSON.parse(fs.readFileSync(meta, 'utf8')).id !== path.basename(dir))
    throw new Error(`refusing to replace unrelated path: ${dir}`);
  const backup = fs.mkdtempSync(path.join(path.dirname(dir), '.old-'));
  const old = path.join(backup, 'video');
  fs.renameSync(dir, old);
  try { fs.renameSync(tmp, dir); }
  catch (e) { fs.renameSync(old, dir); fs.rmdirSync(backup); throw e; }
  fs.rmSync(backup, { recursive: true });
}

function one(url, outDir, opts) {
  const tmp = fs.mkdtempSync(path.join(outDir, '.dl-'));
  try {
    const video = build(url, tmp, opts);
    commitVideo(tmp, path.join(outDir, video.id), opts.replace);
    return video;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function readTranscript(dir, media, transcribe) {
  const tracks = fs.readdirSync(dir).filter(f => /\.(en(?:g)?(?:[-.][\w-]+)*)\.(vtt|srt)$/i.test(f));
  // Prefer VTT, then the alphabetically first usable English track.
  tracks.sort().sort((a, b) => Number(/\.srt$/i.test(a)) - Number(/\.srt$/i.test(b)));
  for (const f of tracks) {
    const transcript = parseVtt(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (transcript.length) return { transcript, transcript_source: 'platform captions' };
  }
  // No captions (every Instagram Reel, music-only or non-English videos): keep the frames and stats, describe the hook from the screen.
  if (!transcribe) return { transcript: [], transcript_source: 'none: no English platform captions' };
  const output = path.join(dir, 'transcript-words.json');
  run(process.execPath, [transcribe, media, output]);
  const { words } = JSON.parse(fs.readFileSync(output, 'utf8'));
  if (!Array.isArray(words) || !words.every(x => typeof x?.w === 'string' && x.w.trim() && Number.isFinite(x.start) && Number.isFinite(x.end) && x.end >= x.start))
    throw new Error('invalid transcriber output: expected timestamped words');
  fs.unlinkSync(output);
  return { transcript: wordsToLines(words), transcript_source: 'local transcriber' };
}

const pctOf = (n, of, dp) => (typeof n === 'number' ? +(100 * n / of).toFixed(dp) : null);

function build(url, dir, { keep, cookies, transcribe }) {
  const args = ['--no-playlist', '--playlist-items', '1', '--write-info-json', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'en.*,eng.*', '--sub-format', 'vtt/srt', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
    '-o', path.join(dir, '%(id)s.%(ext)s')];
  run('yt-dlp', downloaderArgs(args, url, cookies));
  const files = fs.readdirSync(dir);
  if (files.filter((f) => f.endsWith('.info.json')).length > 1) throw new Error('this is a profile or playlist link; paste a link to one video');
  const infoFile = files.find((f) => f.endsWith('.info.json')), media = files.find((f) => /\.(mp4|webm|mov|mkv)$/.test(f));
  if (!infoFile || !media) throw new Error(`yt-dlp gave no ${infoFile ? 'video file' : 'metadata'}`);
  const info = JSON.parse(fs.readFileSync(path.join(dir, infoFile), 'utf8'));
  if (info.playlist_id || info.playlist) throw new Error('this is a profile or playlist link; paste a link to one video');
  if (typeof info.id !== 'string' || !/^[\w-]+$/.test(info.id)) throw new Error(`unexpected video id ${JSON.stringify(info.id)}`); // it becomes a folder name
  const mp4 = path.join(dir, media);
  const { transcript, transcript_source } = readTranscript(dir, mp4, transcribe);

  const dur = info.duration || Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]));
  const cuts = shotCuts(mp4);
  const fr = frames(mp4, cuts, dur, dir);
  const v = info.view_count || 0;
  const video = {
    // yt-dlp's canonical link drops share-tracking parameters (?igsh=, ?_t=) that identify whoever shared it.
    url: info.webpage_url || url, id: String(info.id), platform: info.extractor_key, uploader: info.uploader || info.channel, uploader_url: info.uploader_url || info.channel_url,
    upload_date: info.upload_date, duration: dur, caption: info.description || info.title,
    stats: { views: info.view_count, likes: info.like_count, comments: info.comment_count, shares: info.repost_count, saves: info.save_count ?? null },
    // TikTok rounds big counts (1.1M, 91.1K), so rates and multiples on large videos are approximate.
    rates: v ? { like_pct: pctOf(info.like_count, v, 2), comment_pct: pctOf(info.comment_count, v, 3), share_pct: pctOf(info.repost_count, v, 3), save_pct: pctOf(info.save_count, v, 3) } : null,
    followers: info.channel_follower_count ?? null, fetched_at: new Date().toISOString().slice(0, 10),
    sound: info.track ? { track: info.track, artist: [].concat(info.artists ?? info.artist ?? []).join(', ') || null } : null,
    baseline: baseline(info, cookies), promo_signals: promoSignals(info.description || info.title),
    shots: { count: cuts.length + 1, avg_len_s: +(dur / (cuts.length + 1)).toFixed(2), cuts },
    frames: fr, transcript_source, transcript,
    words: transcript.reduce((n, l) => n + l.text.split(/\s+/).length, 0),
  };
  video.wpm = Math.round(video.words / (dur / 60));
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(video, null, 2));
  for (const f of fs.readdirSync(dir)) if (/\.(vtt|srt|info\.json)$/.test(f) || (!keep && path.join(dir, f) === mp4)) fs.rmSync(path.join(dir, f));
  return video;
}

export function parseArgs(args) {
  const positional = [], opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) positional.push(arg);
    else if (arg === '--keep' || arg === '--replace') opts[arg.slice(2)] = true;
    else if (arg === '--cookies-from-browser' || arg === '--transcribe') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      if (arg === '--transcribe') {
        if (!fs.statSync(value, { throwIfNoEntry: false })?.isFile()) throw new Error('--transcribe requires an existing script file');
        opts.transcribe = path.resolve(value);
      } else {
        if (!['chrome', 'firefox', 'safari', 'edge', 'brave'].includes(value)) throw new Error('expected browser chrome, firefox, safari, edge or brave');
        opts.cookies = value;
      }
    } else throw new Error(`unknown option: ${arg}`);
  }
  const [outDir, ...urls] = positional;
  if (outDir?.includes('%')) throw new Error('the output folder name cannot contain % (yt-dlp and ffmpeg read it as a pattern)');
  if (!outDir || !urls.length) throw new Error('usage: fetch.mjs <outDir> <url...> [--keep] [--replace] [--cookies-from-browser browser] [--transcribe script]');
  urls.forEach(platform);
  return { outDir, urls, opts };
}

export const batchStatus = (failed, total) => failed === 0 ? 0 : failed === total ? 1 : 3;

const isMain = () => { try { return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } };
if (isMain()) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const { outDir, urls, opts } = args;
  fs.mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const u of urls) {
    try { const v = one(u, outDir, opts); console.log(`${v.id}\t${v.uploader}\t${v.stats.views} views\t${v.baseline.multiple ?? '?'}x usual\t${v.transcript_source}\t${v.shots.count} shots`); }
    catch (e) { failed++; console.error(`FAILED ${u}: ${e.message}`); }
  }
  process.exitCode = batchStatus(failed, urls.length);
}
