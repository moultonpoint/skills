#!/usr/bin/env node
// node render.mjs <outDir>  ->  <outDir>/report.html (self-contained: images inlined)
// Reads <outDir>/analysis.json (written by the agent, shape in ../SKILL.md) and each <outDir>/<id>/video.json (from fetch.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 999,950 rounds to 1.0M, not 1000.0K.
const num = (n) => (typeof n !== 'number' ? (n == null ? '–' : esc(n)) : n >= 999950 ? (n / 1e6).toFixed(1) + 'M' : n >= 999.95 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function readInside(dir, ...parts) {
  const file = fs.realpathSync(path.join(dir, ...parts));
  const rel = path.relative(dir, file);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('file outside run: ' + parts.join('/'));
  return fs.readFileSync(file);
}
function img(dir, id, name, alt) {
  if (!fs.existsSync(path.join(dir, id, name))) return '';
  const b = readInside(dir, id, name);
  return `<img src="data:image/jpeg;base64,${b.toString('base64')}" alt="${esc(alt)}">`;
}
const date = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '');
// A date as a reader says it, from YYYYMMDD or YYYY-MM-DD; anything else is shown as given.
const day = (d) => { const m = String(d ?? '').match(/^(\d{4})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])$/); return m ? `${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr(3 * (m[2] - 1), 3)} ${+m[3]}, ${m[1]}` : esc(d ?? ''); };
// Metric figures in prose (7.36×, 2.1x, 12.8K, 1.2M, 0.28%) set in bold so the eye can hop between numbers.
// Runs on escaped text: entities like &#39; are never followed by a unit, so they are left alone.
export const figures = (h) => h.replace(/(?<![\w.#])(\d[\d,.]*(?:[–-]\d[\d,.]*)?(?:\s?(?:×|%|K(?![\w])|M(?![\w]))|x(?![\w])))/g, (m) => `<b class="fig">${m.replace(/x$/, '×')}</b>`);
// Headings keep their weight, so they get only the x-to-× swap, not the bold figures.
const times = (t) => String(t ?? '').replace(/(\d)x(?![\w])/g, '$1×');
// Straight quotes from the agent as typographic ones (before escaping).
const curly = (t) => String(t ?? '').replace(/(^|[\s(\[—–-])"/g, '$1“').replace(/"/g, '”').replace(/(^|[\s(\[—–-])'/g, '$1‘').replace(/'/g, '’');
// Sentence breaks: after . ! ? (and a closing quote or bracket), before something that starts a sentence.
const SENT = /(?<=[.!?…]["”’)]?)\s+(?=[A-Z0-9“"‘(@#])/u;
// Agent prose as short paragraphs: blank lines split it, and a paragraph over 50 words breaks every 2 sentences.
export function prose(text, cls = '') {
  return String(text ?? '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).flatMap((para) => {
    const ss = para.split(SENT);
    if (para.split(/\s+/).length <= 50 || ss.length < 2) return [para];
    const out = [], k = ss.length < 3 ? 1 : 2;
    for (let i = 0; i < ss.length; i += k) out.push(ss.slice(i, i + k).join(' '));
    return out;
  }).map((t) => `<p${cls ? ` class="${cls}"` : ''}>${figures(esc(curly(t)))}</p>`).join('');
}
const list = (xs, tag = 'ul') => (xs?.length ? `<${tag}>${xs.map((x) => `<li>${figures(esc(curly(x)))}</li>`).join('')}</${tag}>` : '');

// NFC so composed and decomposed accents match; marks are kept so Devanagari vowel signs still count.
const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

const HEADS = ['board', 'patterns', 'numbers', 'winners'];
// A section heading: the agent's conclusion when given, with the section's plain name as a label above it.
const hd = (hl, key, name) => (hl?.[key] ? `<p class="kicker">${name}</p><h2>${esc(curly(times(hl[key])))}</h2>` : `<h2>${name}</h2>`);

// Checks the agent's analysis against the fetched evidence; returns a list of problems.
// fetched: ids of every fetched video folder, so one left out of analysis.json is caught.
export function check(an, vids, fetched = vids.map((v) => v.id)) {
  const out = [], byId = new Set(fetched);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const text = x => typeof x === 'string' && x.trim().length > 0;
  const strings = xs => Array.isArray(xs) && xs.every(text);
  if (!vids.length) out.push('no fetched videos');
  if (!object(an?.videos)) return [...out, 'videos must be an object keyed by video id'];
  for (const k of ['title', 'date']) if (k in an && !text(an[k])) out.push(`${k} must be a nonempty string`);
  if ('tldr' in an && !strings(an.tldr)) out.push('tldr must be a list of strings');
  if ('headlines' in an) {
    if (!object(an.headlines)) out.push('headlines must be an object');
    else for (const [k, x] of Object.entries(an.headlines)) if (!HEADS.includes(k) || !text(x)) out.push(`headlines.${k}: keys are ${HEADS.join(', ')}, each nonempty text`);
  }
  for (const id of Object.keys(an.videos)) if (!byId.has(id)) out.push(`unknown analysis video: ${id}`);
  for (const id of fetched) if (!Object.hasOwn(an.videos, id)) out.push(`${id}: fetched but missing from analysis.json`);
  for (const v of vids) {
    if (!Object.hasOwn(an.videos, v.id)) continue;
    const a = an.videos[v.id];
    if (!object(a)) { out.push(`${v.id}: analysis entry is not an object`); continue; }
    for (const k of ['topic', 'format', 'idea', 'layout']) if (!text(a[k])) out.push(`${v.id}: ${k} needs nonempty text`);
    if ('steal' in a && !strings(a.steal)) out.push(`${v.id}: steal must be a list of strings`);
    if (!object(a.hook) || ['spoken', 'visual', 'type', 'why_it_works', 'text_on_screen'].some(k => k in a.hook && typeof a.hook[k] !== 'string'))
      out.push(`${v.id}: hook must be an object with text fields`);
    if (!Array.isArray(a.structure) || !a.structure.length) out.push(`${v.id}: structure is empty`);
    // The hook is the opening: whole words from the first 10 s of the transcript (or its first 3 lines if speech starts later),
    // at least 3 words unless the opening itself is shorter.
    const early = v.transcript.filter((l) => l.start < 10), open = norm((early.length ? early : v.transcript.slice(0, 3)).map((l) => l.text).join(' '));
    const hook = norm(typeof a.hook?.spoken === 'string' ? a.hook.spoken : ''), need = Math.min(3, open.split(' ').filter(Boolean).length);
    // No speech (music or text-only video): nothing to quote, so the hook must be described on screen instead.
    if (!open) { if (hook) out.push(`${v.id}: the video has no transcript, leave hook.spoken empty`); if (!String(a.hook?.text_on_screen || a.hook?.visual || '').trim()) out.push(`${v.id}: no speech, so hook.text_on_screen or hook.visual is required`); }
    else if (!hook) out.push(`${v.id}: hook.spoken is empty`);
    else if (!` ${open} `.includes(` ${hook} `) || hook.split(' ').length < need) out.push(`${v.id}: hook.spoken is not an exact quote of at least ${need} words from the transcript's opening`);
    // Platforms report whole seconds and captions can run past them, so the last beat may end at the later of the two, rounded up.
    const end = Math.ceil(Math.max(v.duration, ...v.transcript.map((l) => +l.end || 0))); let prevEnd = 0;
    for (const [index, b] of (Array.isArray(a.structure) ? a.structure : []).entries()) {
      if (!object(b) || !text(b.beat) || !text(b.t)) { out.push(`${v.id}: each structure entry needs t and beat text`); continue; }
      const m = String(b?.t).match(/^(\d+):([0-5]\d)\s*[–-]\s*(\d+):([0-5]\d)$/);
      if (!m) { out.push(`${v.id}: structure time "${b?.t}" is not m:ss–m:ss`); continue; }
      const [s0, s1] = [m[1] * 60 + +m[2], m[3] * 60 + +m[4]];
      if (s0 < prevEnd || s1 < s0 || s0 >= v.duration || s1 > (index === a.structure.length - 1 ? end : v.duration)) out.push(`${v.id}: structure time "${b.t}" overlaps the previous beat, runs backwards or passes the ${v.duration} s video`);
      prevEnd = s1;
    }
  }
  if ('batch' in an) {
    const b = an.batch;
    if (!object(b)) return [...out, 'batch must be an object'];
    if ('summary' in b && !text(b.summary)) out.push('batch.summary must be nonempty text');
    if ('for_you' in b && !strings(b.for_you)) out.push('batch.for_you must be a list of strings');
    if ('patterns' in b && !Array.isArray(b.patterns)) out.push('batch.patterns must be a list');
    else for (const p of b.patterns || []) {
      if (!object(p) || !text(p.title) || !text(p.detail) || !strings(p.videos) || ('test' in p && !text(p.test))) out.push('each pattern needs title, detail and a list of video ids (and test, when given, as text)');
      else for (const id of p.videos) if (!byId.has(id)) out.push(`pattern "${p.title}" cites unknown video ${id}`);
    }
  }
  return out;
}

const vsNormal = (b) => (Number.isFinite(Number(b?.multiple)) && b?.multiple != null ? `Their usual is the middle of ${esc(b.posts)} other recent posts${b.from ? ` since ${day(b.from)}` : ''}` : `No usual to compare${b?.error ? `: ${esc(b.error)}` : ''}`);

// Shots with no frame on the sheet (the 48-frame cap spreads frames evenly, so short shots can be skipped).
export const unframed = (v) => { const e = [0, ...v.shots.cuts, v.duration], t = v.frames.sheet.times;
  let n = 0; for (let i = 0; i + 1 < e.length; i++) if (!t.some((x) => x >= e[i] && x < e[i + 1])) n++; return n; };

const ext = (u, t) => URL.canParse(u) && ['https:', 'http:'].includes(new URL(u).protocol) ? `<a href="${esc(new URL(u).href)}" target="_blank" rel="noopener">${t}<span class="sr"> (new tab)</span></a>` : t;

// The GitHub M (brand/source/m-outline.svg), drawn in the current text color.
const M = '<svg class="m" viewBox="256.65 36.82 189.86 115.28" aria-hidden="true"><path fill="currentColor" d="M297.79 152.1H256.65V39.02h38.5v17.16h1.98q4.62-9.24 13.75-14.3 9.13-5.06 21.01-5.06 25.96 0 35.42 19.36h1.98q11.66-19.36 36.96-19.36 20.68 0 30.47 11.88 9.79 11.88 9.79 31.02v72.38h-41.36V88.3q0-9.46-3.08-12.76-3.08-3.3-12.98-3.3-9.9 0-13.42 3.19-3.52 3.19-3.52 12.21v64.46h-41.36V88.3q0-9.46-3.08-12.76-3.08-3.3-12.98-3.3-9.9 0-13.42 3.19-3.52 3.19-3.52 12.21z"/></svg>';
// In the report the mast's M path carries an id; the section bar and the footer draw it again with <use>, in the same viewBox.
const MDEF = M.replace('<path ', '<path id="m" '), MU = M.replace(/<path[^>]*\/>/, '<use href="#m"/>');
const REPO = 'https://github.com/moultonpoint/skills';
const PLATFORM = { TikTok: 'TikTok', Youtube: 'YouTube', Instagram: 'Instagram' };
const out = (href, t) => `<a href="${href}" target="_blank" rel="noopener">${t}<span class="sr"> (new tab)</span></a>`;
// Brand face, subset to Latin (assets/space-grotesk.woff2, SIL OFL). Missing file: the system sans takes over.
const font = (() => { try { return `@font-face{font-family:"Space Grotesk";src:url(data:font/woff2;base64,${fs.readFileSync(new URL('../assets/space-grotesk.woff2', import.meta.url)).toString('base64')}) format("woff2");font-weight:300 700;font-display:swap}`; } catch { return ''; } })();

// Two digits under 1×, two decimals up to 1.1×, then one; a rounded figure never crosses the 1×, 1.1× or 1.5× lines the report draws.
export const fx = (m) => { let s = m > 0 && m < 0.01 ? '<0.01' : m < 1 ? String(+m.toPrecision(2)) : m < 1.1 ? m.toFixed(2) : m < 9.95 ? m.toFixed(1) : String(Math.round(m));
  if ([1, BEAT, 1.5].some((t) => m < t && +s >= t)) s = (Math.floor(m * 100) / 100).toFixed(2);
  else if (m > BEAT && +s === BEAT) s = m.toFixed(2);
  return s + '×'; };
// Baselines are good to about ±10%, so a video beats its usual only past 1.1×.
const BEAT = 1.1;
const mx = (v) => (mult(v) != null ? esc(fx(mult(v))) : '');
const mult = (v) => { const m = Number(v.baseline?.multiple); return v.baseline?.multiple != null && Number.isFinite(m) ? m : null; };
// Best against its own creator's usual first, videos without one last; ties by views, then folder name (load() reads in name order).
const order = (x, y) => (mult(y) ?? -1) - (mult(x) ?? -1) || (n(y.stats?.views) ?? -1) - (n(x.stats?.views) ?? -1);
// A video's anchor: the tail of its platform id, long enough to be unique here (render() sets it). Short, and a saved link survives a refetch that reorders the videos.
const at = (v) => v.anchor;
const span = (t) => { const m = String(t).match(/^(\d+):([0-5]\d)\s*[–-]\s*(\d+):([0-5]\d)$/); return m && [m[1] * 60 + +m[2], m[3] * 60 + +m[4]]; };
const pct = (x) => `${+Math.max(0, Math.min(100, x * 100)).toFixed(1)}%`;
const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ymd = (d) => (/^\d{8}$/.test(d || '') ? Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6)) : null);
const secs = (x) => (x == null ? '–' : x < 60 ? `${x.toFixed(1)}\u00a0s` : mmss(x));
const plural = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`;
const ago = (d) => (d == null ? '' : `${d < 60 ? plural(d, 'day') : plural(Math.round(d / 30.4), 'month')} old`);
// Cut by grapheme, so an emoji or an accented letter is never split.
const GR = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const cut = (t, max = Infinity) => { const c = [...GR.segment(t)].map((g) => g.segment); if (c.length <= max) return t; const s = c.slice(0, max - 1).join(''), w = s.replace(/\s+\S*$/, ''); return (w.length > s.length * 0.6 ? w : s).trimEnd() + '…'; };
// Engagement as shown: a * when the platform reported fewer than the four counts it adds up.
const eng = (x) => (x.engagement_pct == null ? null : `${x.engagement_pct}%${x.engagement_counts < 4 ? '*' : ''}`);

// Everything a poster compares, computed from video.json alone (older runs without the newer fields just show less).
// asOf: the day the counts were read, for views per day.
export function metrics(v, asOf) {
  const s = v.stats || {}, views = n(s.views), up = ymd(v.upload_date), now = Date.parse(v.fetched_at || asOf || '');
  const rate = (x, dp) => (n(x) != null && views ? +((100 * x) / views).toFixed(dp) : null);
  const counts = [s.likes, s.comments, s.shares, s.saves].map(n).filter((x) => x != null);
  const age = up != null && Number.isFinite(now) ? Math.max(1, Math.round((now - up) / 864e5)) : null;
  const tx = Array.isArray(v.transcript) ? v.transcript : [];
  // Words spoken in the first 3 s, splitting a caption line that runs past 3 s by time.
  const first3 = tx.reduce((k, l) => (l.start >= 3 ? k : k + l.text.split(/\s+/).filter(Boolean).length * Math.min(1, (3 - l.start) / Math.max(l.end - l.start, 0.01))), 0);
  return {
    multiple: mult(v), views, age_days: age, views_per_day: views != null && age ? Math.round(views / age) : null,
    followers: n(v.followers), views_per_follower: views != null && n(v.followers) > 0 ? +(views / v.followers).toFixed(2) : null,
    engagement_pct: counts.length && views ? +((100 * counts.reduce((a, b) => a + b, 0)) / views).toFixed(2) : null, engagement_counts: counts.length,
    like_pct: rate(s.likes, 2), comment_pct: rate(s.comments, 3), share_pct: rate(s.shares, 3), save_pct: rate(s.saves, 3),
    duration_s: n(v.duration), shots: n(v.shots?.count), avg_shot_s: n(v.shots?.avg_len_s), wpm: tx.length ? n(v.wpm) : null,
    first_cut_s: n(v.shots?.cuts?.[0]), first_word_s: tx.length ? n(tx[0].start) : null, words_first_3s: tx.length ? Math.round(first3) : null,
    hashtags: [...new Set(String(v.caption || '').match(/#[\p{L}\p{N}_]+/gu) || [])], sound: v.sound?.track ? [v.sound.track, v.sound.artist].filter(Boolean).join(' by ') : null,
  };
}

// A video's name in this report: its opening line, quoted when spoken, else the on-screen text or topic; cut to max characters.
const opener = (a, max) => {
  const c = cut(curly(a.hook?.spoken || a.hook?.text_on_screen || a.topic), max);
  return a.hook?.spoken ? `“${esc(c)}”` : esc(c);
};
// An opening as a line of text: the spoken words quoted, else the on-screen words or the visual, labelled.
// Cut at 100 characters, about what two lines of the board show.
const named = (a) => (a.hook?.spoken || a.hook?.text_on_screen || a.hook?.visual ? say(a.hook, 100) : esc(curly(a.topic)));
const say = (h = {}, max) => (h.spoken ? `“${esc(cut(curly(h.spoken), max))}”` : `${h.text_on_screen ? 'On screen' : 'Visual'}: ${esc(cut(curly(h.text_on_screen || h.visual || ''), max))}`);

// Story beats as blocks and detected shot cuts as ticks, on one track scaled to the video's length.
function timeline(v, beats) {
  const d = v.duration;
  if (!(d > 0)) return '';
  const segs = beats.map((b, i) => { const s = span(b.t); return s ? `<span class="seg" style="left:${pct(s[0] / d)};width:${pct((Math.min(s[1], d) - s[0]) / d)}"><b>${i + 1}</b></span>` : ''; }).join('');
  const cuts = (v.shots.cuts || []).map((c) => `<i style="left:${pct(c / d)}"></i>`).join('');
  return `<div class="track" aria-hidden="true">${segs}${cuts}</div><p class="note">Blocks are story beats. Ticks are shot cuts. ${mmss(d)} total.</p>`;
}

// The short entry for a middle video: opening line, the numbers that matter, what to take, link out.
function brief(v, a, frame, asOf, pos) {
  const h = a.hook || {}, x = metrics(v, asOf);
  const head = opener(a);
  const facts = [v.stats.views != null && `${num(v.stats.views)} views`, eng(x) && `${eng(x)} engagement`, `first cut ${x.first_cut_s != null ? secs(x.first_cut_s) : 'none'}`, mmss(v.duration), ext(v.url, `Watch on ${esc(PLATFORM[v.platform] || 'the original post')}`)].filter(Boolean).join(' · ');
  return `<article class="brief" id="${at(v)}"><i class="thumb${frame ? ` ${frame}` : ''}"></i><div><p class="crumb"><span class="num">${pos.i + 1}<small>/${pos.n}</small></span>${day(v.upload_date)}</p><h3>${head}</h3><p class="facts">${facts}</p>${a.steal?.length ? list(a.steal.slice(0, 2)) : prose(a.idea)}</div><p class="x${mult(v) == null ? ' none' : ''}">${mult(v) != null ? mx(v) : 'No usual'}</p></article>`;
}

function videoCard(v, a, dir, frame, board, asOf, pos) {
  const h = a.hook || {}, m = mult(v), s = v.stats, x = metrics(v, asOf), b = v.baseline || {};
  const vs = (mine, theirs, unit = '%') => (mine == null ? '' : ` <small>${esc(mine)}${unit}${n(theirs) != null ? ` · usual ${esc(theirs)}${unit}` : ''}</small>`);
  const sheet = img(dir, v.id, 'sheet.jpg', `Contact sheet, ${v.frames?.sheet?.times?.length ?? 0} frames from @${v.uploader}`);
  const head = opener(a);
  const rows = [['Visual', h.visual !== a.layout && h.visual], ['Type', h.type], ['Why it may work', h.why_it_works]]
    .filter(([, x]) => x).map(([k, x]) => `<div><dt>${k}</dt><dd>${prose(x)}</dd></div>`).join('');
  const rows2 = [['Views', s.views], ['Avg per day', x.views_per_day, x.age_days != null ? ` <small>${x.age_days} d old</small>` : ''], ['Followers', x.followers],
    ['Views/follower', x.views_per_follower, '', true], ['Engagement', eng(x), '', true],
    ['Likes', s.likes, vs(x.like_pct, b.median_like_pct)], ['Comments', s.comments, vs(x.comment_pct, b.median_comment_pct)],
    ['Shares', s.shares, vs(x.share_pct, b.median_share_pct)], ['Saves', s.saves, vs(x.save_pct, b.median_save_pct)]];
  // Counts the platform didn't report are left out rather than listed as n/a.
  const stats = [...rows2.filter(([, val]) => val != null).map(([k, val, extra = '', raw, unit = '']) => [k, `${raw ? esc(val) + unit : num(val)}${extra}`]),
    ['Length', `${mmss(v.duration)}${n(b.median_duration_s) != null ? ` <small>usual ${mmss(b.median_duration_s)}</small>` : ''}`],
    ['Shots', `${esc(v.shots.count)} <small>${esc(v.shots.avg_len_s)}\u00a0s avg</small>`], ...(v.transcript.length ? [['Pace', `${esc(v.wpm)}\u00a0<small>wpm</small>`]] : [])]
    .map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('');
  const beats = a.structure || [];
  // Strip frames sit at 0, 0.5 … 2.5 s: mark the first frame after each cut inside that window.
  const cut = new Set((v.shots?.cuts || []).filter((c) => c > 0 && c <= 2.5).map((c) => Math.ceil(c / 0.5)));
  return `<article class="video" id="${at(v)}">
<header class="vhead"><div>${pos ? `<p class="crumb"><span class="num">${pos.i + 1}<small>/${pos.n}</small></span><a href="#overview">All videos</a></p>` : ''}<h2>${head}</h2><p class="date">${['@' + esc(v.uploader), day(v.upload_date), ext(v.url, `Watch on ${esc(PLATFORM[v.platform] || 'the original post')}`)].filter(Boolean).join(' · ')}</p>${v.caption ? `<p class="cap">${esc(v.caption)}</p>` : ''}</div>
<p class="verdict">${m != null ? `<b>${mx(v)}</b><span>their usual views (${num(b.median_views)})</span>` : '<b class="none">No usual to compare</b>'}</p></header>
${frame ? `<figure class="hook"><div class="strip" role="img" aria-label="Video ${pos ? pos.i + 1 : 1}, first 3 s${cut.size ? `, cut by ${[...cut].map((k) => k / 2).join(', ')} s` : ''}">${['0', '0.5', '1', '1.5', '2', '2.5\u00a0s'].map((t, k) => `<span${cut.has(k) ? ' class="cut"' : ''}><i class="${frame}"></i>${t}</span>`).join('')}</div>${cut.size ? `<figcaption class="note">Marked: first frame after a cut.</figcaption>` : ''}</figure>` : ''}
<div class="cols">
<div class="side"><dl class="stats">${stats}</dl><p class="base">${vsNormal(v.baseline)}${mult(v) != null ? '.' : ''}${x.engagement_counts && x.engagement_counts < 4 ? ' * Some counts not reported.' : ''}</p>
${n(b.posts_per_week) != null ? `<p class="base">They post about ${b.posts_per_week === 1 ? 'once' : `${esc(b.posts_per_week)} times`} a week.</p>` : ''}${x.sound ? `<p class="meta2"><span class="k">Sound</span>${esc(x.sound)}</p>` : ''}${x.hashtags.length ? `<p class="meta2"><span class="k">Hashtags</span>${esc(x.hashtags.join(' '))}</p>` : ''}
${v.promo_signals?.length ? `<p class="flag">Caption has a link or disclosure tag (check before calling it paid): ${esc(v.promo_signals.join(', '))}</p>` : ''}</div>
<div class="read">
<p class="speed"><span>First cut <b>${x.first_cut_s != null ? secs(x.first_cut_s) : 'none'}</b></span>${x.first_word_s != null ? `<span>First word <b>${secs(x.first_word_s)}</b></span><span>Words in first 3 s <b>${x.words_first_3s}</b></span>` : '<span>No transcript</span>'}</p>
${h.text_on_screen ? `<p class="onscreen"><span class="k">On screen</span>${esc(h.text_on_screen)}</p>` : ''}
${a.steal?.length && board ? `<section class="steal"><h3>What to take</h3>${list(a.steal, 'ol')}</section>` : ''}
${rows ? `<h3>The opening</h3><dl class="hookrows">${rows}</dl>` : ''}
<section><h3>Storytelling structure</h3>${timeline(v, beats)}<ol class="beats">${beats.map((b, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(b.t)}</span><span>${figures(esc(curly(b.beat)))}</span></li>`).join('')}</ol></section>
<div class="tfi"><section><h3>Topic</h3>${prose(a.topic)}</section><section><h3>Format</h3>${prose(a.format)}</section><section><h3>Idea</h3>${prose(a.idea)}</section></div>
<section><h3>Layout</h3>${prose(a.layout)}</section>
${b.outliers?.length ? `<section><h3>Their other hits lately</h3><ol class="hits">${b.outliers.map((o) => `<li><b>${esc(Number.isFinite(Number(o.multiple)) ? fx(Number(o.multiple)) : o.multiple)}</b><span>${ext(o.url, esc(o.title || 'Untitled post'))}<small>${num(o.views)} views${o.date ? ` · ${day(o.date)}` : ''}</small></span></li>`).join('')}</ol></section>` : ''}
${v.transcript.length ? `<details><summary>Full transcript (${esc(v.transcript_source)})</summary><p class="tx">${v.transcript.map((l) => `<i>${mmss(l.start)}</i> ${esc(l.text)}`).join(' ')}</p></details>` : ''}
${sheet ? `<details><summary>Contact sheet: ${v.frames.sheet.times.length} frames for ${esc(v.shots.count)} shots</summary><p class="tx">Left to right at ${v.frames.sheet.times.map(mmss).join(' ')}${unframed(v) ? `. ${plural(unframed(v), 'short shot has', 'short shots have')} no frame (48-frame cap).` : ''}</p><figure>${sheet}</figure></details>` : ''}
</div></div>
${pos ? `<nav class="pn" aria-label="Next and previous video">${pos.prev ? `<a href="#${at(pos.prev)}"><small>Previous</small>${pos.label(pos.prev)}</a>` : '<span></span>'}${pos.next ? `<a class="next" href="#${at(pos.next)}"><small>Next</small>${pos.label(pos.next)}${mult(pos.next) != null ? ` · ${mx(pos.next)}` : ''}</a>` : '<a class="next" href="#overview"><small>Done</small>Back to all videos</a>'}</nav>` : ''}
</article>`;
}

// Log scale for multiples: 1× sits where the bars start, so a bar's direction says beat or fell short.
// The range opens to the next 1-2-5 step around the data, so the axis ends on a labelled tick.
export function scale(ms) {
  const steps = [-2, -1, 0, 1, 2, 3, 4, 5, 6].flatMap((e) => [1, 2, 5].map((k) => +(k * 10 ** e).toPrecision(1)));
  const lo = [...steps].reverse().find((t) => t <= Math.min(0.5, ...ms) / 1.05) ?? steps[0], hi = steps.find((t) => t >= Math.max(2, ...ms) * 1.05) ?? steps.at(-1);
  const x = (m) => (Math.log10(Math.min(hi, Math.max(lo, m))) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return { x, ticks: steps.filter((t) => t >= lo && t <= hi) };
}

// One row per video: views against the creator's own median, with 1× (a typical post) marked.
function board(vids, an, hooks, label, asOf) {
  // No video has a usual (an Instagram-only batch): no scale to draw, and the order is the fetch order.
  if (!vids.some((v) => mult(v) != null)) return `<section class="board flat" id="overview"><h2>The videos</h2><p class="note">None of these videos has a usual to compare with, so they are not ranked.</p><ol>${vids.map((v) => `<li><a href="#${at(v)}"><i class="thumb${hooks.has(v.id) ? ` ${hooks.get(v.id)}` : ''}"></i><span class="who"><span class="line">${named(an.videos[v.id])}</span></span></a></li>`).join('')}</ol>${LIMITS}${HOWTO}</section>`;
  // Log scale: one 50× outlier would otherwise flatten every other bar to a sliver.
  const { x: X, ticks: all } = scale(vids.map(mult).filter((m) => m != null)), one = X(1);
  const rows = vids.map((v) => { const m = mult(v), a = an.videos[v.id], x = metrics(v, asOf);
    const bar = m != null && m !== 1 ? `<i${m < 1 ? ' class="below"' : ''} style="left:${pct(Math.min(one, X(m)))};width:${pct(Math.abs(X(m) - one))}"></i>` : '';
    return `<li><a href="#${at(v)}"><i class="thumb${hooks.has(v.id) ? ` ${hooks.get(v.id)}` : ''}"></i><span class="who"><b>${label(v)}</b><span class="line">${named(a)}</span></span><span class="bar">${bar}</span><span class="x${m == null ? ' none' : ''}">${m != null ? mx(v) : 'No usual'}</span><span class="sub">${[v.stats.views != null && `${num(v.stats.views)} views`, ago(x.age_days), eng(x) && `${eng(x)} engagement`, mmss(v.duration)].filter(Boolean).join(' · ')}</span></a></li>`; });
  // Column header with a scale over the bars; it stays pinned under the nav while the board scrolls past.
  const whose = new Set(vids.map((v) => v.uploader)).size > 1 ? 'each creator’s' : 'the creator’s';
  // Label 1× always, then the outermost ticks, then whatever fits 8% apart.
  const shown = [1, all[0], all.at(-1), ...all].filter((t, i, a) => a.indexOf(t) === i).reduce((k, t) => (k.every((s) => Math.abs(X(s) - X(t)) > 0.08) ? [...k, t] : k), []);
  // Phones keep 1×, the ends and the powers of ten; the 2 and 5 steps between are "minor".
  const minor = (t, i, a) => i && i < a.length - 1 && !Number.isInteger(Math.log10(t));
  const ticks = shown.sort((p, q) => p - q).map((t, i, a) => `<i${t === 1 ? ' class="one"' : minor(t, i, a) ? ' class="minor"' : ''} style="left:${pct(X(t))}">${t}×</i>`).join('');
  const head = `<div class="bhead" aria-hidden="true"><span>Video</span><span>Opening line</span><span class="axis">${ticks}</span><span>vs usual</span></div>`;
  // Past 15 videos, the top 10 and bottom 5 stay in view and the middle folds away.
  const list = vids.length > 17 ? `<ol>${rows.slice(0, 10).join('')}</ol><details class="more"><summary>Show the middle ${vids.length - 15}</summary><ol start="11">${rows.slice(10, -5).join('')}</ol></details><ol start="${vids.length - 4}">${rows.slice(-5).join('')}</ol>` : `<ol>${rows.join('')}</ol>`;
  return `<section class="board" id="overview">${hd(an.headlines, 'board', 'Views against each creator’s usual')}<p class="note">1× is ${whose} usual views: the middle of their recent posts. Bars right of it got more, grey bars left of it fewer; the shaded band (±10%) is too close to call. Log scale.${vids.some((v) => vids.some((w) => w.uploader === v.uploader && n(w.baseline?.median_views) != null && n(v.baseline?.median_views) != null && w.baseline.median_views !== v.baseline.median_views)) ? ' Each video’s usual leaves that video out, so it can differ a little between videos.' : ''}${vids.some((v) => metrics(v, asOf).engagement_counts % 4) ? ' * Some counts not reported.' : ''}</p><div class="rows" style="--b0:${pct(X(0.9))};--b1:${pct(X(BEAT))};--one:${pct(one)}">${head}${list}</div>${LIMITS}${HOWTO}</section>`;
}

// One stylesheet serves every report shape; each report keeps only the rules whose classes it uses.
// A selector stays when all its classes (outside :not()) appear in the page. @media blocks are pruned inside; other @-rules are kept whole.
const classes = (html) => new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
export function shake(css, used) {
  const ok = (sel) => [...sel.replace(/:not\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].every((m) => used.has(m[1]));
  const block = (j) => { for (let d = 1; d; j++) d += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0; return j; };
  let out = '', i = 0;
  for (let open; (open = css.indexOf('{', i)) >= 0;) {
    const head = css.slice(i, open).trim();
    if (head.startsWith('@')) { const end = block(open + 1), inner = css.slice(open + 1, end - 1), kept = head.startsWith('@media') ? shake(inner, used) : inner; if (kept) out += `${head}{${kept}}`; i = end; continue; }
    const close = css.indexOf('}', open), keep = head.split(',').filter(ok);
    if (keep.length) out += `${keep.join(',')}${css.slice(open, close + 1)}`;
    i = close + 1;
  }
  return out;
}

// Ink & Chalk by default; inside a host that defines theme variables (such as T3 Code), the host's surfaces win.
const CSS = `${font}
:root{color-scheme:light dark;--chalk:var(--background,#F1EFE8);--ink:var(--foreground,#15171C);--mute:var(--muted-foreground,#55565B);--line:var(--border,#D9D6CC);--panel:var(--card,#E9E6DC);--band:#15171C;--band-ink:#F1EFE8;--band-mute:#ABA9A1;--r:var(--radius,12px);--hr:1px solid var(--line);--tint:color-mix(in srgb,var(--ink) 14%,transparent);--cols:44px minmax(0,1.3fr) minmax(140px,1fr) 6.5rem}
@media screen and (prefers-color-scheme:dark){:root{--chalk:var(--background,#15171C);--ink:var(--foreground,#F1EFE8);--mute:var(--muted-foreground,#ABA9A1);--line:var(--border,#30333A);--panel:var(--card,#1D2027);--band:#23262E}.steal{border:var(--hr)}}
*{box-sizing:border-box}html,body{overflow-x:clip}html{scroll-behavior:smooth;scroll-padding-top:92px;scrollbar-color:var(--mute) transparent;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--chalk);color:var(--ink);font:17px/1.6 "Space Grotesk",var(--font-sans,ui-sans-serif),system-ui,sans-serif;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
::selection{background:var(--ink);color:var(--chalk)}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:.2em}a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px}a:not([class]):focus-visible{border-radius:4px}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(16px,4vw,40px)}
h1,h2,h3,h4{text-wrap:balance;letter-spacing:-.02em;line-height:1.15}p{margin:0 0 10px}p,li,dd{text-wrap:pretty}small{font-size:.8em;color:var(--mute)}
h3{font-size:1.4375rem;font-weight:700;color:var(--ink);margin:36px 0 10px;letter-spacing:-.01em}.tfi h3{font-size:.9375rem;font-weight:600;color:var(--mute);letter-spacing:0;margin-top:28px}
.note{font-size:.85rem;color:var(--mute);max-width:68ch}
.bhead,.sub,.refs,.strip,.k,.tx i,.kicker,.brief .crumb,.facts,thead th,.ol{font-size:.8125rem;color:var(--mute)}
.mast{background:var(--band);color:var(--band-ink);border-bottom:var(--hr)}.mast .wrap{padding-top:18px;padding-bottom:clamp(36px,6vw,64px)}
.bar-top{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:.9rem;margin-bottom:clamp(40px,7vw,80px)}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem;text-decoration:none;letter-spacing:-.01em}.m{width:30px}
.bar-top .tool{color:var(--band-mute)}.bar-top .tool a{color:var(--band-ink)}
.mast h1{font-size:clamp(2rem,3.4vw,2.75rem);font-weight:700;margin:0;max-width:24ch;letter-spacing:-.03em;line-height:1.05}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);column-gap:clamp(28px,5vw,64px);align-items:start}.lead{grid-column:2;grid-row:1/4}
.lead a{text-decoration:none}.lead a:hover .lq,.low:hover{text-decoration:underline}.lt{display:grid;grid-template-columns:clamp(112px,12vw,150px) minmax(0,1fr);gap:20px}.low{display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid #3A3C43}.low b{font-size:1.5rem;margin-right:6px;color:var(--band-ink)}
.lead .thumb{width:100%;grid-row:auto;border-radius:10px}.nf{display:block}.line,.lq,.ol,h2,.lines span{unicode-bidi:plaintext}.board.flat a{grid-template-columns:44px 1fr}.lt>span:last-child{display:flex;flex-direction:column;gap:6px;min-width:0}.lead .k,.low{color:var(--band-mute);font-size:.8125rem;line-height:1.35}
.lx{font-size:clamp(2.8rem,5vw,4rem);line-height:.9;letter-spacing:-.04em;margin-top:4px}.line,.lq{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;font-weight:500;line-height:1.35}.line{-webkit-line-clamp:2}.lq{margin-top:6px;-webkit-line-clamp:4}
.mast .meta{margin:18px 0 0;color:var(--band-mute)}.mast ::selection,.foryou ::selection,.sign ::selection{background:var(--band-ink);color:var(--band)}.mast :focus-visible,.sign :focus-visible,.skip:focus-visible{outline-color:var(--band-ink)}
main.wrap{padding-top:clamp(36px,5vw,64px);padding-bottom:80px}
.board h2,.batch>h2,.briefs>h2,.numbers h2,.winners h2,.openers h2{font-size:clamp(1.4rem,2.6vw,1.9rem);margin:0 0 6px}
.bhead,.board a{display:grid;grid-template-columns:var(--cols);column-gap:16px;border-bottom:var(--hr)}.bhead{position:sticky;top:44px;z-index:4;align-items:end;margin-top:20px;padding:10px 8px 8px;background:var(--chalk);font-weight:600}.bhead>span:last-child{text-align:right}
.axis{position:relative;height:1.2em}.axis i{position:absolute;bottom:0;transform:translateX(-50%);font-style:normal;font-weight:500;white-space:nowrap}.axis i.one{color:var(--ink);font-weight:700}
.rows{margin-bottom:20px}.bhead+ol{border-top:0!important}.board ol{list-style:none;margin:0;padding:0;border-top:var(--hr)}
.board a{grid-template-rows:auto auto;align-items:center;padding:7px 8px;text-decoration:none;border-radius:6px;transition:background-color .15s ease-out}
@media (hover:hover){.board a:hover{background:var(--panel)}tbody tr:hover,tbody tr:hover th{background:var(--panel)}summary:hover{color:var(--ink)}}
.thumb,.refs i,.pn i{grid-row:1/3;width:44px;aspect-ratio:9/16;border-radius:5px;background:var(--panel) 0 0/600% 100% no-repeat}
.who{min-width:0}.who b{display:block;font-size:.85rem;font-weight:500;color:var(--mute)}
.bar{position:relative;height:12px;background:linear-gradient(var(--line),var(--line)) 0 50%/100% 1px no-repeat,linear-gradient(90deg,transparent var(--b0),var(--tint) var(--b0) var(--b1),transparent var(--b1))}.bar i{position:absolute;top:0;bottom:0;min-width:2px;background:var(--ink);border-radius:0 3px 3px 0}.bar i.below{background:var(--mute);border-radius:3px 0 0 3px}
.bar::after{content:"";position:absolute;top:-6px;bottom:-6px;left:var(--one);width:2px;margin-left:-1px;background:var(--ink)}
.x:not(.none)::after{content:" of usual";font-size:0}.x{text-align:right;white-space:nowrap;font-size:1.35rem;font-weight:700;letter-spacing:-.02em;line-height:1}.sub{grid-column:2/-1}
.batch{margin:clamp(48px,7vw,80px) 0 0}
.foryou{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:8px clamp(28px,4vw,56px);background:var(--band);color:var(--band-ink);border-radius:var(--r);padding:28px;margin:0 0 clamp(48px,7vw,80px)}.foryou h2,.foryou h3{font-size:.9375rem;font-weight:600;letter-spacing:0;color:var(--band-mute);margin:0 0 10px}.foryou h3+*{margin-bottom:18px}.foryou .lines li,.foryou .tests p{border-color:#3A3C43}.tests :first-child{display:block}.age{color:var(--band-mute)}
.moves{margin:0;padding-left:1.4em;font-size:clamp(1.05rem,1.8vw,1.3rem);font-weight:500;line-height:1.4}.moves li{padding:6px 0 6px 4px;max-width:68ch}.moves li::marker{font-weight:700}
.patterns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:0 40px}
.pattern{border-top:var(--hr);padding:16px 0 8px}.pattern h4{font-size:1.125rem;line-height:1.3;margin:0 0 6px;text-wrap:pretty}.pattern p{font-size:.95rem}
.refs i,.pn i{display:inline-block;width:14px;margin-right:5px;vertical-align:-5px;border-radius:2px}.refs a{color:var(--ink);margin-right:10px;white-space:nowrap}.test{font-size:.95rem;padding-top:8px;border-top:1px dashed var(--line)}.test b{font-weight:600}
.video{margin-top:clamp(64px,9vw,104px);padding-top:24px;border-top:3px solid var(--ink)}
main>#videos:first-child>.video:first-of-type{margin-top:0}
.vhead{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}.vhead h2{font-size:clamp(1.4rem,2.8vw,2rem);line-height:1.2;max-width:32ch;margin:0}.crumb{display:flex;align-items:baseline;gap:14px;margin:0 0 10px;font-size:.9rem}.date{color:var(--mute);margin:2px 0 6px}.cap{color:var(--mute);font-size:.92rem;max-width:68ch}
.verdict{text-align:right;margin:0;flex:none}.verdict b{display:block;font-size:clamp(2rem,5vw,3.2rem);line-height:1;letter-spacing:-.035em}.verdict b.none{font-size:1.1rem;color:var(--mute)}.verdict span{font-size:.85rem;color:var(--mute)}
.hook{margin:20px 0 0}.strip{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center}.strip span{padding-bottom:2px;border-bottom:3px solid transparent}.strip .cut{border-color:var(--ink);color:var(--ink);font-weight:600}
.strip i{display:block;aspect-ratio:240/426;margin-bottom:4px;border-radius:4px;background-color:var(--panel);background-size:600% 100%;background-repeat:no-repeat}.strip :nth-child(2) i{background-position:20%}.strip :nth-child(3) i{background-position:40%}.strip :nth-child(4) i{background-position:60%}.strip :nth-child(5) i{background-position:80%}.strip :nth-child(6) i{background-position:100%}
.cols{display:grid;grid-template-columns:240px minmax(0,1fr);gap:clamp(24px,4vw,56px);margin-top:28px;align-items:start}
@media (min-height:700px){.side{position:sticky;top:16px}}.stats{margin:0;display:grid;gap:0}.stats div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:var(--hr)}
.stats dt{color:var(--mute);font-size:.9rem;flex:none}.stats dd{margin:0;font-weight:600;text-align:right}.stats dd small{display:block;font-weight:400;line-height:1.3}.base{font-size:.85rem;color:var(--mute);margin-top:12px}
.flag{font-size:.85rem;background:var(--panel);border-radius:8px;padding:10px 12px}
.read{max-width:72ch}.read>section>p{max-width:68ch}
.onscreen{margin:0 0 16px}.k{display:block;font-weight:600}
.hookrows{margin:0;font-size:.95rem}.hookrows div{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:8px 0;border-top:var(--hr)}.hookrows dt{color:var(--mute)}.hookrows dd{margin:0}
.tfi{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0 28px}
.track{position:relative;height:30px;margin:4px 0 6px;background:var(--panel);border-radius:6px;overflow:hidden}
.seg{position:absolute;top:0;bottom:0;border-right:2px solid var(--chalk);display:flex;align-items:center;padding-left:8px}.seg b{font-size:.8125rem}
.seg:nth-child(odd){background:var(--tint)}
.track i{position:absolute;bottom:0;height:9px;width:1.5px;background:var(--ink)}
.beats{list-style:none;margin:10px 0 0;padding:0}.beats li{display:grid;grid-template-columns:1.6rem 6.2rem 1fr;gap:10px;padding:8px 0;border-bottom:var(--hr)}
.beats .n{font-weight:700}.beats .t{color:var(--mute);font-size:.9rem;padding-top:.1em}
.steal{background:var(--panel);border-radius:var(--r);padding:4px 22px 16px;margin:0 0 8px}.steal h3{margin-top:16px}.steal ol{margin:0;padding-left:1.3em}.steal li{padding:5px 0 5px 4px}.steal li::marker{font-weight:700}
.fig{font-weight:600;white-space:nowrap}.summary p{max-width:62ch;margin-bottom:14px}.summary p:first-child{font-size:1.15rem;line-height:1.55}.pattern p+p,.read section p+p{margin-top:6px}.hookrows dd p{margin:0}.hookrows dd p+p{margin-top:6px}
details{margin-top:20px;border-top:var(--hr);padding-top:12px}summary{cursor:pointer;color:var(--mute);font-weight:500}.summary .rest{margin-top:4px}.summary .rest[open]>summary{margin-bottom:12px}
.tx{font-size:.92rem;margin-top:10px}.tx i{font-style:normal}
details img{max-width:100%;display:block;border-radius:6px}figure{margin:12px 0}
.sign{background:var(--band);color:var(--band-ink);font-size:.95rem}.sign .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:16px 28px;padding-top:36px;padding-bottom:40px}
.sign .m{width:40px}.sign p{margin:0;flex:1 1 320px;color:var(--band-mute)}.sign p b{color:var(--band-ink);font-weight:600}.sign nav{display:flex;flex-wrap:wrap;gap:6px 18px}
.howto{margin:0 0 clamp(28px,4vw,40px);border:var(--hr);border-radius:var(--r);padding:12px 18px}.howto summary{color:var(--ink);font-weight:600}.howto ul{margin:10px 0 4px;padding-left:1.2em;max-width:72ch}.howto li{padding:4px 0}
.tldr{margin:22px 0 0;padding:0;list-style:none;max-width:62ch;font-size:clamp(1rem,1.6vw,1.15rem)}.tldr li{padding:6px 0 6px 1.1em;position:relative;line-height:1.45}.tldr li::before{content:"";position:absolute;left:0;top:.95em;width:.45em;height:2px;background:var(--band-ink)}
.kicker{font-weight:600;margin:0 0 4px;letter-spacing:.01em}
.briefs{margin-top:clamp(64px,9vw,104px);padding-top:24px;border-top:3px solid var(--ink)}
.brief{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:18px;padding:18px 0;border-bottom:var(--hr);align-items:start}.brief .thumb{grid-row:auto;width:52px}
.brief h3{font-size:1.125rem;line-height:1.3;margin:2px 0 4px;color:var(--ink)}.brief .crumb{margin:0}.facts{margin:0 0 6px}.brief ul{margin:0;padding-left:1.1em;font-size:.95rem}.brief p{font-size:.95rem}.brief .x{margin:0}
.lines{list-style:none;margin:0;padding:0}.lines li,.tests p{display:grid;grid-template-columns:4rem 1fr;gap:12px;margin:0;padding:8px 0;border-top:var(--hr)}.lines .solo,.tests p{grid-template-columns:1fr;gap:0}
.numbers,.winners,.openers{margin-top:clamp(48px,7vw,80px)}
.scroll{overflow-x:auto;margin-top:16px}.scroll,.jump .wrap{background:linear-gradient(90deg,transparent,var(--chalk) 60%) 100% 0/40px 100% no-repeat local,linear-gradient(270deg,var(--tint),transparent) 100% 0/14px 100% no-repeat scroll}
table{border-collapse:collapse;width:100%;font-size:.88rem;white-space:nowrap;overflow-wrap:normal}th,td{padding:9px 8px;text-align:right;border-bottom:var(--hr)}tr:last-child>*{border-bottom:0}
thead th{font-weight:600;background:var(--panel);border-top:var(--hr);white-space:normal}tbody th{text-align:left;font-weight:600}tbody th,thead th:first-child{position:sticky;left:0;z-index:1}thead th:first-child{text-align:left}tbody th{background:var(--chalk)}tbody th a{display:block;text-decoration:none}tbody th b{font-weight:700}.ol{display:block;max-width:11rem;overflow:hidden;text-overflow:ellipsis;font-weight:400}
.winners table{width:auto;min-width:min(100%,520px)}.winners td{font-weight:600}
.openers ol{list-style:none;margin:16px 0 0;padding:0}.openers li{display:grid;grid-template-columns:5.5rem 1fr;gap:12px;padding:10px 0;border-bottom:var(--hr)}.openers li b{font-size:1.1rem}.openers li a{color:var(--mute);font-size:.85rem;margin-left:6px}
.speed{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:.88rem;color:var(--mute);margin:-8px 0 18px}.speed b{color:var(--ink);font-weight:600}
.meta2{font-size:.85rem;margin-top:12px}
.hits{list-style:none;margin:0;padding:0}.hits li{display:grid;grid-template-columns:4.5rem 1fr;gap:12px;padding:8px 0;border-bottom:var(--hr)}.hits small{display:block}
.jump{position:sticky;top:0;z-index:5;background:var(--chalk);border-bottom:var(--hr)}.jump .wrap{display:flex;align-items:stretch;gap:4px 22px;overflow-x:auto;scrollbar-width:none;height:44px;white-space:nowrap}
.jump a{display:flex;align-items:center;text-decoration:none;font-size:.9rem;font-weight:500;color:var(--mute)}.jump a:hover{color:var(--ink)}.jump .jm{color:var(--ink);display:flex;align-items:center}.jump .m{width:24px}
.num{font-weight:700}.num small{font-size:.85em;font-weight:400}
.video:target .vhead h2{animation:land 1.6s cubic-bezier(.16,1,.3,1)}@keyframes land{from{background:var(--tint)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.video:target .vhead h2{animation:none}}
.pn{display:flex;justify-content:space-between;gap:16px;margin-top:40px;padding-top:16px;border-top:var(--hr)}.pn a{text-decoration:none;font-weight:600;padding:6px 0;max-width:48%}.pn a:hover{text-decoration:underline}.pn .next{text-align:right;margin-left:auto}.pn small{display:block;font-weight:400;font-size:.8125rem}
.jump~main .side{top:64px}
.skip{position:absolute;left:12px;top:-60px;z-index:9;background:var(--band-ink);color:var(--band);padding:10px 14px;border-radius:8px;font-weight:600}.skip:focus{top:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.x.none{font-size:.9375rem;color:var(--mute);font-weight:500}.board .more{border-top:0;margin:0;padding:0}.board .more summary{padding:10px 8px;border-bottom:var(--hr)}.board ol+.more,.board .more+ol{margin-top:0;border-top:0}
.winners .scroll{display:inline-block;max-width:100%}
a,summary{touch-action:manipulation}
@media (pointer:coarse){.refs a,.openers li a,.sign nav a,.crumb a{display:inline-block;padding:10px 0}}
@media (max-width:760px){.hero,.foryou{grid-template-columns:1fr}.lead{grid-column:auto;grid-row:auto;margin-top:24px}.bhead{grid-template-columns:40px minmax(0,1fr);padding-top:6px;padding-bottom:6px}.bhead>span:not(.axis),.axis .minor{display:none}.bhead .axis{grid-column:2}.cols{grid-template-columns:1fr}.side{position:static;order:2}.stats{grid-template-columns:1fr 1fr;column-gap:20px}.tfi{grid-template-columns:1fr}.vhead{flex-direction:column;gap:8px}.verdict{text-align:left}
.board a{grid-template-columns:40px minmax(0,1fr) auto;row-gap:6px}.thumb{grid-row:1/4;width:40px}.bar{grid-column:2/-1;grid-row:2}.sub{grid-row:3}.x{font-size:1.15rem}
.hookrows div{grid-template-columns:1fr;gap:0}.beats li{grid-template-columns:1.2rem 4.4rem 1fr;gap:8px}}
@media (max-width:600px){.strip{grid-template-columns:repeat(3,1fr);row-gap:10px}.ol{font-size:0}.jump .jm{display:none}.brief{grid-template-columns:36px minmax(0,1fr) auto;gap:12px}.brief .thumb{width:36px}.brief .x{font-size:1.1rem}.line{display:block;-webkit-line-clamp:none}}
@media print{:root{--chalk:#fff;--ink:#15171C;--mute:#55565B;--line:#D9D6CC;--panel:#E9E6DC}body:has(#sheet:target)>:not(main),body:has(#sheet:target) main>:not(#take){display:none}body:has(#sheet:target) .foryou{--band-ink:#15171C;--band-mute:#55565B;background:none;padding:0;margin:0;font-size:.9rem}.moves{font-size:1rem}.tests{font-size:.8rem;line-height:1.4}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.jump,.skip,.pn,.howto,.crumb a{display:none}.side{position:static}h2,h3,.vhead{break-after:avoid}.board li,tr,.stats div,.beats li,.pattern,.lead,.brief{break-inside:avoid}.scroll{overflow:visible;background:none}table{white-space:normal;font-size:.72rem}th,td{padding:5px 6px}tbody th{position:static}.ol{display:none}}`;

// Side by side: one row per video, the numbers a poster compares.
function numbers(vids, label, asOf, hl, an, hooks) {
  const pc = (y) => (y != null ? y.toFixed(3) : '');
  const cols = [...(vids.some((v) => mult(v) != null) ? [['vs usual', (x) => (x.multiple != null ? fx(x.multiple) : '')], ['Usual views', (x, v) => num(v.baseline?.median_views ?? null)]] : []), ['Views', (x) => num(x.views)], ['Avg per day', (x) => (x.views_per_day != null ? num(x.views_per_day) : '')],
    ['Engagement (%)', (x) => (x.engagement_pct == null ? '' : x.engagement_pct.toFixed(2) + (x.engagement_counts < 4 ? '*' : ''))], ['Shares (%)', (x) => pc(x.share_pct)], ['Saves (%)', (x) => pc(x.save_pct)],
    ['Length', (x) => (x.duration_s != null ? mmss(x.duration_s) : '')], ['Avg shot (s)', (x) => x.avg_shot_s?.toFixed(1) ?? ''],
    ['First cut (s)', (x) => (x.first_cut_s != null ? x.first_cut_s.toFixed(1) : 'none')], ['Words 0–\u20603\u00a0s', (x) => x.words_first_3s ?? ''], ['wpm', (x) => x.wpm ?? '']];
  return `<section class="numbers" id="numbers">${hd(hl, 'numbers', 'By the numbers')}<p class="note">Rates are a share of views. Engagement adds likes, comments, shares and saves (* when some were not reported). First cut is the first detected camera change. – means not reported, or no transcript.</p><div class="scroll" tabindex="0" role="region" aria-label="By the numbers table"><table><caption class="sr">Every video’s numbers</caption><thead><tr><th>Video</th>${cols.map(([k]) => `<th>${k}</th>`).join('')}</tr></thead><tbody>${vids.map((v) => { const x = metrics(v, asOf);
    // The rank alone means nothing three columns later, so each row carries its thumbnail and opening line.
    return `<tr><th scope="row"><a href="#${at(v)}"><b>${label(v)}</b><span class="ol">${opener(an.videos[v.id], 40)}</span></a></th>${cols.map(([, f]) => `<td>${esc(f(x, v)) || '–'}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div></section>`;
}

// Medians for videos at 1.5x their creator's median or more against the rest. Needs 2+ in each group.
function winners(vids, asOf, hl) {
  const xs = vids.map((v) => metrics(v, asOf)).filter((x) => x.multiple != null), hi = xs.filter((x) => x.multiple >= 1.5), lo = xs.filter((x) => x.multiple < 1.5);
  if (hi.length < 2 || lo.length < 2) return '';
  const rows = [['Length', 'duration_s', mmss], ['Average shot', 'avg_shot_s', (y) => `${y.toFixed(1)}\u00a0s`], ['First cut', 'first_cut_s', secs], ['Words in first 3 s', 'words_first_3s', (y) => String(Math.round(y))],
    ['Words per minute', 'wpm', (y) => String(Math.round(y))], ['Engagement', 'engagement_pct', (y) => `${y.toFixed(2)}%`], ['Share rate', 'share_pct', (y) => `${y.toFixed(2)}%`], ['Save rate', 'save_pct', (y) => `${y.toFixed(2)}%`]]
    .map(([k, key, f]) => { const g = (xs) => xs.filter((x) => key !== 'engagement_pct' || x.engagement_counts === 4).map((x) => x[key]).filter((y) => y != null), A = g(hi), B = g(lo), a = med(A), b = med(B);
      // Engagement uses only videos with all four counts; its group sizes are shown when that leaves fewer.
      return A.length < 2 || B.length < 2 || f(a) === f(b) || Math.abs(a - b) < 0.1 * Math.max(Math.abs(a), Math.abs(b)) ? '' : `<tr><th scope="row">${k}${A.length < hi.length || B.length < lo.length ? ` <small>${A.length} vs ${B.length}</small>` : ''}</th><td>${esc(f(a))}</td><td>${esc(f(b))}</td></tr>`; }).join('');
  return `<section class="winners" id="winners">${hd(hl, 'winners', 'What the winners do differently')}<p class="note">The middle value for the ${hi.length} videos at 1.5× their usual or more, against the other ${lo.length}. Measures that differ by under 10% are left out. Seen in these videos only: something to test, not proof.</p>${rows ? `<div class="scroll" tabindex="0" role="region" aria-label="Winners table"><table><caption class="sr">Winners against the rest</caption><thead><tr><th><span class="sr">Measure</span></th><th>Winners</th><th>The rest</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>No measure differs by 10% or more with at least 2 videos reporting it on each side.</p>'}</section>`;
}

const LIMITS = '<p class="note">Public counts only: it can’t see how long people watched or where they came from, and paid promotion can inflate views.</p>';
const HOWTO = `<details class="howto"><summary>New here? How to read this report</summary><ul>
<li><b>Shares and saves</b> are the best sign people passed a video on or kept it.</li>
<li><b>First cut</b> and <b>words in the first 3 s</b> show how fast the opening moves.</li></ul></details>`;

export function load(dir) {
  dir = fs.realpathSync(dir);
  const an = JSON.parse(readInside(dir, 'analysis.json'));
  const vids = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((p, q) => (p.name < q.name ? -1 : 1))) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, entry.name, 'video.json'))) continue;
    if (!/^[\w-]+$/.test(entry.name)) throw new Error('invalid video directory: ' + entry.name);
    const v = JSON.parse(readInside(dir, entry.name, 'video.json'));
    if (v?.id !== entry.name) throw new Error('video id must match directory: ' + entry.name);
    vids.push(v);
  }
  const problems = check(an, vids);
  if (problems.length) throw Object.assign(new Error(`analysis.json does not match the evidence:\n- ${problems.join('\n- ')}`), { problems });
  return { dir, an, vids };
}

const CSV_COLS = ['id', 'rank', 'creator', 'url', 'upload_date', 'multiple', 'views', 'age_days', 'views_per_day', 'followers', 'views_per_follower', 'engagement_pct', 'engagement_counts', 'like_pct', 'comment_pct', 'share_pct', 'save_pct',
  'duration_s', 'shots', 'avg_shot_s', 'first_cut_s', 'first_word_s', 'words_first_3s', 'wpm', 'sound', 'hashtags', 'opening_line', 'opening_source'];
// Text from the platform could start with = + - @ and run as a spreadsheet formula; a leading ' keeps it text.
const cell = (x) => { let t = x == null ? '' : String(x); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function csv(dir, { an, vids } = load(dir)) {
  const ranked = vids.some((v) => mult(v) != null), rows = [...vids].sort(order).map((v, i) => { const x = metrics(v, an.date), h = an.videos[v.id]?.hook || {};
    return { ...x, id: v.id, rank: ranked ? i + 1 : '', creator: v.uploader, url: v.url, upload_date: date(v.upload_date), hashtags: x.hashtags.join(' '), opening_line: h.spoken || h.text_on_screen || h.visual || '', opening_source: h.spoken ? 'spoken' : h.text_on_screen ? 'on screen' : h.visual ? 'visual' : '' }; });
  return '\uFEFF' + [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((k) => cell(r[k])).join(','))].join('\n') + '\n';
}

// The one-page sheet's parts: what to do, the best openings, what to test. vids sorted best first.
// The report's take box shows them at the top; cheatsheet.html prints them on their own.
function sheetParts(an, vids, asOf, h = 'h2') {
  const b = vids.length > 1 ? an.batch || {} : {};
  // No batch advice (or one video): the first takeaway from each of the best videos stands in.
  const moves = (b.for_you?.length ? b.for_you : [...new Set(vids.slice(0, 3).flatMap((v) => an.videos[v.id].steal?.slice(0, vids.length > 1 ? 1 : 3) || []))]).slice(0, 3);
  // An opening that won months ago won against an older usual, so its age is shown.
  const old = (v) => { const d = metrics(v, asOf).age_days; return d >= 60 ? ` <small class="age">${ago(d).replaceAll(' ', '\u00a0')}</small>` : ''; };
  const lines = vids.filter((v) => vids.length < 2 || mult(v) != null).map((v) => [v, an.videos[v.id].hook || {}]).filter(([, h]) => h.spoken || h.text_on_screen || (vids.length < 2 && h.visual)).slice(0, 3);
  // Patterns with a test the agent wrote, seen in the most videos first: a title alone is nothing to film.
  const tests = (b.patterns || []).filter((p) => p.test).sort((p, q) => (q.videos?.length || 0) - (p.videos?.length || 0)).slice(0, 3);
  return {
    tested: new Set(tests),
    moves: moves.length ? `<ol class="moves">${moves.map((t) => `<li>${figures(esc(curly(t)))}</li>`).join('')}</ol>` : '',
    rest: `${lines.length ? `<${h}>${vids.length > 1 ? 'Best openings' : 'Opening line'}</${h}><ol class="lines">${lines.map(([v, h]) => `<li${mult(v) == null ? ' class="solo"' : ''}>${mult(v) != null ? `<b>${mx(v)}</b>` : ''}<span>${say(h, vids.length > 1 ? 100 : undefined)}${old(v)}</span></li>`).join('')}</ol>` : ''}${tests.length ? `<${h}>Patterns to test</${h}><div class="tests">${tests.map((p) => `<p><b>${esc(curly(p.title))}</b>${figures(esc(curly(p.test)))}</p>`).join('')}</div>` : ''}`,
  };
}

// One printable page to keep beside the camera: what to do, the openings that worked, what to test.
export function cheatsheet(dir, { an, vids } = load(dir)) {
  vids.sort(order);
  const title = esc(curly(times(an.title || 'Video analysis')));
  const css = `${font}
:root{--b:var(--background,#F1EFE8);--f:var(--foreground,#15171C);--m:var(--muted-foreground,#55565B);--l:var(--border,#D9D6CC);--c:var(--card,#fff)}
@media screen and (prefers-color-scheme:dark){:root{--b:var(--background,#15171C);--f:var(--foreground,#F1EFE8);--m:var(--muted-foreground,#ABA9A1);--l:var(--border,#30333A);--c:var(--card,#1D2027)}}
*{box-sizing:border-box}body{margin:0;background:var(--b);color:var(--f);font:15px/1.5 "Space Grotesk",ui-sans-serif,system-ui,sans-serif}
.page{max-width:780px;margin:32px auto;padding:44px 52px;background:var(--c);border:1px solid var(--l);border-radius:var(--radius,12px)}
.top{display:flex;align-items:center;justify-content:space-between;font-size:.8125rem;margin-bottom:28px}.top span,.date,h2,.foot{color:var(--m)}.top b{display:inline-flex;align-items:center;gap:8px;font-size:.95rem}.m{width:24px}
h1{font-size:1.9rem;line-height:1.1;letter-spacing:-.03em;margin:0 0 6px;text-wrap:balance}.date{margin:0 0 28px}
h2{font-size:.8125rem;font-weight:600;margin:26px 0 8px}
.moves{margin:0;padding-left:1.3em;font-size:1.35rem;font-weight:600;line-height:1.35;letter-spacing:-.01em}.moves li{padding:6px}
.lines{list-style:none;margin:0;padding:0}.lines li.solo{grid-template-columns:1fr}.lines li,.tests p{margin:0;padding:8px 0;border-top:1px solid var(--l)}.lines li{display:grid;grid-template-columns:4rem 1fr;gap:12px;font-size:1.05rem}.lines span{unicode-bidi:plaintext}.tests :first-child{display:block}.age{color:var(--m)}
.foot{margin-top:30px;font-size:.75rem}
@page{margin:12mm}@media print{:root{--b:#fff;--f:#15171C;--m:#55565B;--c:#fff}.page{margin:0;border:0;padding:0;max-width:none}.tests{font-size:.85rem;line-height:1.4}.top,.date{margin-bottom:12px}h2{margin:14px 0 4px}.moves{font-size:1.05rem}.moves li,.lines li,.tests p{padding:4px 0}}
@media (max-width:640px){.page{margin:0;border:0;border-radius:0;padding:28px 20px}}`;
  const body = `<main class="page">
<div class="top"><b>${M}moultonpoint</b><span>One-page sheet · print or screenshot it</span></div>
<h1>${title}</h1><p class="date">${[day(an.date), plural(vids.length, 'video')].filter(Boolean).join(' · ')}</p>
${(({ moves, rest }) => `${moves ? `<h2>Do this next</h2>${moves}` : ''}${rest}`)(sheetParts(an, vids, an.date))}
<p class="foot">Made with ${REPO.replace('https://', '')}</p>
</main>`, used = classes(body);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}: one-page sheet</title><style>${shake(css, used)}</style></head><body>${body}</body></html>`;
}

export function render(dir, loaded = load(dir)) {
  const an = loaded.an, vids = loaded.vids, asOf = an.date;
  dir = loaded.dir;
  // Best against its own creator's median first; videos without a baseline last.
  vids.sort(order);
  // Card anchors: v and the id's last 4 or more characters, as few as stay unique and clear of #videos; past the longest id, v- and the whole id.
  const most = Math.max(4, ...vids.map((v) => v.id.length));
  for (let k = 4; ; k++) { const ids = vids.map((v) => (k > most ? 'v-' + v.id : 'v' + v.id.slice(-k))); if (new Set(ids).size === ids.length && !ids.some((x) => /^videos(-h)?$/.test(x))) { vids.forEach((v, i) => { v.anchor = ids[i]; }); break; } }
  // Each hook strip is inlined once as a CSS class, shared by the overview thumbnail and the full strip.
  // Short class names (f1, f2…) because each is repeated on the board, the table and the cards.
  const hooks = new Map(vids.filter((v) => fs.existsSync(path.join(dir, v.id, 'hook.jpg'))).map((v, i) => [v.id, 'f' + (i + 1)]));
  const frames = [...hooks].map(([id, c]) => `i.${c}{background-image:url(data:image/jpeg;base64,${readInside(dir, id, 'hook.jpg').toString('base64')})}`).join('\n');
  const many = vids.length > 1, b = many && an.batch;
  const creators = [...new Set(vids.map((v) => '@' + v.uploader))];
  const sp = sheetParts(an, vids, asOf, 'h3');
  // A video's label: its rank, plus the handle when several creators share the report. Unranked, its upload date, or "Video n" when the date is missing or shared.
  const rankOf = new Map(vids.map((v, i) => [v.id, i + 1])), ranked = vids.some((v) => mult(v) != null), who = (v) => (creators.length > 1 ? ` @${esc(v.uploader)}` : '');
  const dated = vids.map((v) => v.upload_date && day(v.upload_date) + who(v));
  const label = (v, i = rankOf.get(v.id) - 1) => (ranked ? `#${i + 1}` : dated[i] && dated.indexOf(dated[i]) === dated.lastIndexOf(dated[i]) ? day(v.upload_date) : `Video ${i + 1}`) + who(v);
  // A reference away from the board: the video's first frame beside its rank, so it stays recognisable.
  const tag = (v) => `${hooks.has(v.id) ? `<i class="${hooks.get(v.id)}"></i>` : ''}${label(v)}`;
  // What to do comes before the reasoning. The take box is also the one-page sheet: its link at the top prints it alone.
  const take = sp.moves || sp.rest ? `<section class="foryou" id="take" aria-labelledby="sheet"><div><h2 id="sheet">What to take for your channel</h2>${sp.moves}</div>${sp.rest ? `<div>${sp.rest}</div>` : ''}</section>` : '';
  const paras = b?.summary ? prose(b.summary).split('</p>').filter(Boolean).map((p) => p + '</p>') : [];
  const batch = b ? `<section class="batch" id="batch">${hd(an.headlines, 'patterns', `Across ${vids.length} videos`)}
${paras.length ? `<div class="summary">${paras.slice(0, 2).join('')}${paras.length > 2 ? `<details class="rest"><summary>The full reasoning (${paras.length - 2} more paragraph${paras.length > 3 ? 's' : ''})</summary>${paras.slice(2).join('')}</details>` : ''}</div>` : ''}
${b.patterns?.length ? `<h3>Patterns</h3><div class="patterns">${[...b.patterns].sort((p, q) => (q.videos?.length || 0) - (p.videos?.length || 0)).map((p) => `<article class="pattern"><h4>${esc(curly(p.title))}</h4>${prose(p.detail)}${p.test && !sp.tested.has(p) ? `<p class="test"><b>To test:</b> ${figures(esc(curly(p.test)))}</p>` : ''}${p.videos?.length ? `<p class="refs">${p.videos.map((id) => { const v = vids.find((x) => x.id === id); return `<a href="#${v ? at(v) : ''}">${v ? tag(v) : esc(id)}${v && mult(v) != null ? ` · ${mx(v)}` : ''}</a>`; }).join(' ')}</p>` : ''}</article>`).join('')}</div>` : ''}</section>` : '';
  // First lines only: a described visual is not a line to set against the others (the board and the take box still show it).
  const lines = vids.filter((v) => mult(v) != null).map((v) => [v, an.videos[v.id].hook || {}]).filter(([, h]) => h.spoken || h.text_on_screen);
  // The board shows every opening until it folds its middle; from then on, set the best openings against the worst.
  const ends = vids.length > 17 && lines.length > 8 ? [...lines.slice(0, 5), ...lines.slice(-3)] : [];
  const opening = ends.length ? `<section class="openers" id="openers"><h2>Best and worst openings</h2><p class="note">The first lines of the 5 best and 3 worst performers that have one. Spoken words are quoted; on-screen words are labelled.</p><ol>${ends.map(([v, h]) => `<li><b>${mx(v)}</b><span>${say(h)} <a href="#${at(v)}">${label(v)}</a></span></li>`).join('')}</ol></section>` : '';
  const title = esc(curly(times(an.title || 'Video analysis')));
  // The answer before the reasoning: the best video against its creator's usual, computed from video.json, never written by the agent.
  const top = vids[0], rated = vids.filter((v) => mult(v) != null), beat = rated.filter((v) => mult(v) > BEAT).length, unrated = vids.length - rated.length;
  const low = rated.length > 1 && rated.at(-1), pic = (v) => (hooks.has(v.id) ? `<i class="thumb ${hooks.get(v.id)}"></i>` : '');
  // "Best" only when one beat its usual by over 10%; with one measured video there is nothing to rank it against, so the kicker says that.
  const kick = !many ? '' : rated.length > 1 ? `${beat ? 'Best' : 'Highest'} of ${plural(rated.length, 'video')}` : `The only one of ${vids.length} with a usual to compare`;
  const lead = mult(top) != null ? `<div class="lead"><a class="lt${hooks.has(top.id) ? '' : ' nf'}" href="#${at(top)}">${pic(top)}<span>${kick ? `<span class="k">${kick}</span>` : ''}<b class="lx">${mx(top)}</b><span class="k">${esc('@' + top.uploader)}’s usual views</span><span class="lq">${opener(an.videos[top.id])}</span><span class="k">${[`${num(top.stats.views)} views`, ago(metrics(top, asOf).age_days)].filter(Boolean).join(', ')}. Usual: ${num(top.baseline.median_views)}.</span></span></a>${low ? `<a class="low${hooks.has(low.id) ? '' : ' nf'}" href="#${at(low)}">${pic(low)}<span><span class="k">Lowest of the ${rated.length} ${unrated ? 'with a usual' : 'picked'}; ${beat || 'none'} beat their usual by over\u00a010%${unrated ? `, ${unrated} had no usual to compare` : ''}</span><b>${mx(low)}</b>${who(low)} ${opener(an.videos[low.id], 48)}</span></a>` : ''}</div>` : '';
  const pos = (i) => many && { i, n: vids.length, prev: vids[i - 1], next: vids[i + 1], label: tag };
  // Nobody reads 38 deep dives: past 15, the 5 best and 3 lowest measured videos get full cards, the rest a short entry, in page order.
  const pool = rated.length ? rated : vids, full = new Set(vids.length > 15 ? [...pool.slice(0, 5), ...pool.slice(-3)] : vids), parts = [];
  vids.forEach((v, i) => { if (full.has(v)) parts.push(videoCard(v, an.videos[v.id], dir, hooks.get(v.id), many, asOf, pos(i))); else if (Array.isArray(parts.at(-1))) parts.at(-1).push(i); else parts.push([i]); });
  const cards = parts.map((g) => (typeof g === 'string' ? g : `<section class="briefs" aria-labelledby="b${g[0]}"><p class="kicker">${g.length > 1 ? `Videos ${g[0] + 1} to ${g.at(-1) + 1}` : `Video ${g[0] + 1}`}</p><h2 id="b${g[0]}">${g.length} more, in brief</h2>${g.map((i) => brief(vids[i], an.videos[vids[i].id], hooks.get(vids[i].id), asOf, pos(i))).join('')}</section>`)).join('\n');
  const body = `<a class="skip" href="#main">Skip to the report</a>
<header class="mast"><div class="wrap"><div class="bar-top">${out(REPO, `${MDEF}<span>moultonpoint</span>`).replace('<a ', '<a class="brand" ')}<span class="tool">${out(REPO, 'analyze')}, a free skill</span></div>
<div${lead ? ' class="hero"' : ''}><h1>${title}</h1>${lead}${an.tldr?.length ? `<ul class="tldr">${an.tldr.map((t) => `<li>${figures(esc(curly(t)))}</li>`).join('')}</ul>` : ''}<p class="meta">${[day(an.date), take && '<a href="#sheet">What to take (prints alone)</a>', `${vids.length} video${many ? 's' : ''}`, creators.length <= 3 ? esc(creators.join(', ')) : `${creators.length} creators`].filter(Boolean).join(' · ')}</p></div></div></header>
${many ? `<nav class="jump" aria-label="Report sections"><div class="wrap">${out(REPO, MU).replace('<a ', '<a class="jm" aria-label="moultonpoint/skills" ')}${[take && ['take', 'Take'], ['overview', 'Board'], b && ['batch', 'Patterns'], winners(vids, asOf) && ['winners', 'Winners'], ['numbers', 'Numbers'], opening && ['openers', 'Openings'], ['videos', `Videos (${vids.length})`]].filter(Boolean).map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</div></nav>` : ''}
<main class="wrap" id="main">${take}${many ? board(vids, an, hooks, label, asOf) : ''}${batch}${many ? winners(vids, asOf, an.headlines) + numbers(vids, label, asOf, an.headlines, an, hooks) : ''}${opening}<section id="videos" aria-labelledby="videos-h"><h2 id="videos-h" class="sr">Videos</h2>${cards}</section>${many ? '' : LIMITS + HOWTO}</main>
<footer class="sign"><div class="wrap">${MU}<p><b>Made with moultonpoint/skills.</b> Free, local, MIT licensed: run ${out(REPO, 'analyze')} on your own links.</p>
<nav>${out('https://www.youtube.com/@moultonpoint', 'YouTube')}${out('https://www.tiktok.com/@moultonpoint', 'TikTok')}${out('https://x.com/moultonpoint', 'X')}${out(REPO, 'GitHub')}</nav></div></footer>`;
  const used = classes(body);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="theme-color" content="#15171C"><style>${shake(CSS, used)}
${frames}</style></head><body>
${body}
</body></html>`;
}

// Writes the three files. Without force an existing report.html (even a dangling link) is kept; the CSV and the sheet are always
// rewritten. Each file goes to a temp file beside it, then is renamed over its name. No hard links: exFAT and FAT have none.
// shortcut: a render killed mid-way, or two at once on one folder, can leave a mixed set until the next render; fine for one user.
function publish(dir, files, force) {
  const at = (f) => fs.lstatSync(f, { throwIfNoEntry: false });
  for (const [f] of files) { const st = at(f); if (st?.isDirectory()) throw new Error(`${path.basename(f)} exists and is a folder`); }
  if (!force && at(files[0][0])) throw new Error('report.html exists; use --force to replace it');
  for (const [f, text] of files) { const tmp = path.join(dir, `.${path.basename(f)}.${process.pid}.tmp`);
    try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; } }
}

// realpath: the skill is usually run through the .agents/skills symlink, and paths may contain spaces
const isMain = () => { try { return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } };
if (isMain()) {
  const [dir, flag, ...extra] = process.argv.slice(2);
  if (!dir || dir.startsWith('-') || (flag !== undefined && flag !== '--force') || extra.length) {
    console.error('usage: render.mjs <outDir> [--force]'); process.exit(2);
  }
  const out = path.join(dir, 'report.html'), sheet = path.join(dir, 'metrics.csv'), page = path.join(dir, 'cheatsheet.html');
  let html, table, one;
  // One read of the run feeds all three files, and all three are built before any is written.
  try { const run = load(dir); html = render(dir, run); table = csv(dir, run); one = cheatsheet(dir, run); } catch (e) { console.error(e.message); process.exit(1); }
  try { publish(dir, [[out, html], [sheet, table], [page, one]], flag === '--force'); } catch (e) { console.error(e.message); process.exit(1); }
  console.log(out);
  console.log(sheet);
  console.log(page);
}
