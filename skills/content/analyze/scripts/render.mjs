#!/usr/bin/env node
// node render.mjs <outDir>  ->  <outDir>/report.html (self-contained: images inlined)
// Reads <outDir>/analysis.json (written by the agent, shape in ../SKILL.md) and each <outDir>/<id>/video.json (from fetch.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (typeof n !== 'number' ? (n == null ? 'n/a' : esc(n)) : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function readInside(dir, ...parts) {
  const file = fs.realpathSync(path.join(dir, ...parts));
  const rel = path.relative(dir, file);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('file outside run: ' + parts.join('/'));
  return fs.readFileSync(file);
}
function img(dir, id, name, alt) {
  if (!fs.existsSync(path.join(dir, id, name))) return '';
  return `<img src="data:image/jpeg;base64,${readInside(dir, id, name).toString('base64')}" alt="${esc(alt)}">`;
}
const date = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '');
const list = (xs) => (xs?.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

// NFC so composed and decomposed accents match; marks are kept so Devanagari vowel signs still count.
const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

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
    let prevEnd = 0;
    for (const [index, b] of (Array.isArray(a.structure) ? a.structure : []).entries()) {
      if (!object(b) || !text(b.beat) || !text(b.t)) { out.push(`${v.id}: each structure entry needs t and beat text`); continue; }
      const m = String(b?.t).match(/^(\d+):([0-5]\d)\s*[–-]\s*(\d+):([0-5]\d)$/);
      if (!m) { out.push(`${v.id}: structure time "${b?.t}" is not m:ss–m:ss`); continue; }
      const [s0, s1] = [m[1] * 60 + +m[2], m[3] * 60 + +m[4]];
      if (s0 < prevEnd || s1 < s0 || s0 >= v.duration || s1 > (index === a.structure.length - 1 ? Math.ceil(v.duration) : v.duration)) out.push(`${v.id}: structure time "${b.t}" overlaps the previous beat, runs backwards or passes the ${v.duration} s video`);
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
      if (!object(p) || !text(p.title) || !text(p.detail) || !strings(p.videos)) out.push('each pattern needs title, detail and a list of video ids');
      else for (const id of p.videos) if (!byId.has(id)) out.push(`pattern "${p.title}" cites unknown video ${id}`);
    }
  }
  return out;
}

const vsNormal = (b) => (b?.multiple != null ? `≈${esc(b.multiple)}× the creator's median (${num(b.median_views)} over ${esc(b.posts)} posts${b.from ? ` since ${esc(b.from)}` : ''})` : `no creator baseline${b?.error ? `: ${esc(b.error)}` : ''}`);

// Shots with no frame on the sheet (the 48-frame cap spreads frames evenly, so short shots can be skipped).
export const unframed = (v) => { const e = [0, ...v.shots.cuts, v.duration], t = v.frames.sheet.times;
  let n = 0; for (let i = 0; i + 1 < e.length; i++) if (!t.some((x) => x >= e[i] && x < e[i + 1])) n++; return n; };

const ext = (u, t) => URL.canParse(u) && ['https:', 'http:'].includes(new URL(u).protocol) ? `<a href="${esc(new URL(u).href)}" target="_blank" rel="noopener">${t}</a>` : t;

function videoCard(v, a, dir) {
  const h = a.hook || {};
  const hook = img(dir, v.id, 'hook.jpg', 'first 3 seconds'), sheet = img(dir, v.id, 'sheet.jpg', 'contact sheet');
  const rows = [['Visual', h.visual], ['Type', h.type], ['Why it works', h.why_it_works]]
    .filter(([, x]) => x).map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('');
  return `<article class="video" id="v-${esc(v.id)}">
  <header><h2>${ext(v.url, '@' + esc(v.uploader))} · ${esc(date(v.upload_date))}</h2>
  <p class="cap">${esc(v.caption)}</p>
  <p class="stats"><b>${num(v.stats.views)}</b> views · ${num(v.stats.likes)} likes${v.rates?.like_pct != null ? ` (${esc(v.rates.like_pct)}%)` : ''} · ${num(v.stats.comments)} comments · ${num(v.stats.shares)} shares${typeof v.stats.saves === 'number' ? ` · ${num(v.stats.saves)} saves` : ''}<br>${mmss(v.duration)} · ${esc(v.shots.count)} shots (${esc(v.shots.avg_len_s)}s avg)${v.transcript.length ? ` · ${esc(v.wpm)} wpm` : ''}</p>
  <p class="stats"><b>${vsNormal(v.baseline)}</b>${v.baseline?.median_like_pct != null ? ` · their median like rate ${esc(v.baseline.median_like_pct)}%` : ''}</p>
  ${v.promo_signals?.length ? `<p class="flag">Caption has a link or disclosure tag (check before calling it paid): ${esc(v.promo_signals.join(', '))}</p>` : ''}</header>
  ${hook ? `<figure class="hook">${hook}<div class="ticks">${['0.0', '0.5', '1.0', '1.5', '2.0', '2.5'].map((t) => `<span>${t} s</span>`).join('')}</div><figcaption>First 3 s, one frame every 0.5 s</figcaption></figure>` : ''}
  ${h.spoken ? `<blockquote class="said">${esc(h.spoken)}</blockquote>` : ''}
  ${h.text_on_screen ? `<p class="onscreen"><span class="k">On screen</span>${esc(h.text_on_screen)}</p>` : ''}
  ${rows ? `<dl>${rows}</dl>` : ''}
  <div class="grid">
    <section><h3>Topic</h3><p>${esc(a.topic)}</p></section>
    <section><h3>Format</h3><p>${esc(a.format)}</p></section>
    <section><h3>Idea</h3><p>${esc(a.idea)}</p></section>
  </div>
  <section><h3>Layout</h3><p>${esc(a.layout)}</p></section>
  <section><h3>Storytelling structure</h3><ol class="beats">${(a.structure || []).map((b) => `<li><span>${esc(b.t)}</span>${esc(b.beat)}</li>`).join('')}</ol></section>
  ${a.steal?.length ? `<section class="steal"><h3>What to take</h3>${list(a.steal)}</section>` : ''}
  ${v.transcript.length ? `<details><summary>Full transcript (${esc(v.transcript_source)})</summary><p class="tx">${v.transcript.map((l) => `<span><i>${mmss(l.start)}</i> ${esc(l.text)}</span>`).join(' ')}</p></details>` : ''}
  ${sheet ? `<details><summary>Contact sheet: ${v.frames.sheet.times.length} frames for ${esc(v.shots.count)} shots</summary><p class="tx">Left to right at ${v.frames.sheet.times.map(mmss).join(' ')}${unframed(v) ? `. ${unframed(v)} short shots have no frame (48-frame cap).` : ''}</p><figure>${sheet}</figure></details>` : ''}
</article>`;
}

// ≈ because the creator baseline is only good to about ±10%.
const score = (v) => `<a class="score" href="#v-${esc(v.id)}"><span class="who">@${esc(v.uploader)}</span><span class="big">${v.baseline?.multiple != null ? `≈${esc(v.baseline.multiple)}× <small>their median</small>` : 'No baseline'}</span><span class="tx">${num(v.stats.views)} views · ${mmss(v.duration)} · ${esc(v.shots.avg_len_s)}s avg shot</span></a>`;

export function render(dir) {
  dir = fs.realpathSync(dir);
  const an = JSON.parse(readInside(dir, 'analysis.json'));
  const vids = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, entry.name, 'video.json'))) continue;
    if (!/^[\w-]+$/.test(entry.name)) throw new Error('invalid video directory: ' + entry.name);
    const v = JSON.parse(readInside(dir, entry.name, 'video.json'));
    if (v?.id !== entry.name) throw new Error('video id must match directory: ' + entry.name);
    vids.push(v);
  }
  const problems = check(an, vids);
  if (problems.length) throw Object.assign(new Error(`analysis.json does not match the evidence:\n- ${problems.join('\n- ')}`), { problems });
  const b = vids.length > 1 && an.batch;
  const scores = vids.length > 1 ? `<nav class="scores">${vids.map(score).join('')}</nav>` : '';
  const batch = b ? `<section class="batch"><h2>Across ${vids.length} videos</h2>${b.summary ? `<p class="lede">${esc(b.summary)}</p>` : ''}
    ${b.for_you?.length ? `<h3>For your channel</h3>${list(b.for_you)}` : ''}
    ${(b.patterns || []).map((p) => `<details class="pattern"><summary>${esc(p.title)}</summary><p>${esc(p.detail)}</p>${p.videos?.length ? `<p class="refs">${p.videos.map((id) => `<a href="#v-${esc(id)}">@${esc(vids.find((v) => v.id === id)?.uploader ?? id)}</a>`).join(' ')}</p>` : ''}</details>`).join('')}</section>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(an.title || 'Video analysis')}</title><style>
/* Use the host theme when available. */
:root{--chalk:var(--background,#F1EFE8);--ink:var(--foreground,#15171C);--mute:var(--muted-foreground,#55565B);--line:var(--border,#d9d6cc)}
@media (prefers-color-scheme:dark){:root{--chalk:var(--background,#15171C);--ink:var(--foreground,#F1EFE8);--mute:var(--muted-foreground,#b9b7af);--line:var(--border,#33363d)}}
*{box-sizing:border-box}body{margin:0;background:var(--chalk);color:var(--ink);font:16px/1.55 var(--font-sans,"Space Grotesk",ui-sans-serif,system-ui,sans-serif);overflow-wrap:anywhere}
main{max-width:720px;margin:0 auto;padding:16px 12px 32px}h1{font-size:1.9rem;line-height:1.15;margin:0 0 4px}h2{font-size:1.3rem;margin:0 0 6px}h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:18px 0 4px}
a{color:inherit}p{margin:0 0 8px}.sub{color:var(--mute);margin-bottom:20px}.lede{font-size:1.05rem}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:24px}
.score{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-radius:10px;padding:12px 14px;text-decoration:none}.score:hover{border-color:var(--ink)}
.who{color:var(--mute);font-size:.9rem}.big{font-size:1.7rem;font-weight:700;line-height:1.2}.big small{font-size:.9rem;font-weight:400;color:var(--mute)}
.batch{border:1px solid var(--line);padding:20px;border-radius:var(--radius,12px);margin-bottom:32px}.batch ul{margin:0 0 12px;padding-left:20px}
.made{margin-top:48px;padding-top:12px;border-top:1px solid var(--line);font-size:.8rem;color:var(--mute)}
.pattern{border-top:1px solid var(--line);padding:10px 0 2px;margin:0}.pattern summary{color:var(--ink);font-weight:500}.pattern p{margin-top:8px}.refs{font-size:.85rem;color:var(--mute)}
.video{border-top:2px solid var(--ink);padding-top:20px;margin-top:40px}.cap{color:var(--mute);font-size:.9rem}.flag{font-size:.85rem;border-left:3px solid var(--ink);padding-left:8px}.stats{font-size:.9rem}
img{max-width:100%;display:block;border-radius:6px}figure{margin:12px 0}figcaption{font-size:.8rem;color:var(--mute);margin-top:2px}
.ticks{display:grid;grid-template-columns:repeat(6,1fr);font-size:.72rem;color:var(--mute);font-variant-numeric:tabular-nums;margin-top:4px}.ticks span{text-align:center}
.said{font-size:1.45rem;line-height:1.3;font-weight:700;margin:16px 0 8px;padding-left:14px;border-left:3px solid var(--ink)}
.onscreen{margin:0 0 12px}.k{display:block;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 20px}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:8px 0 0;font-size:.92rem}dt{color:var(--mute)}dd{margin:0}
@media (max-width:520px){dl{grid-template-columns:1fr;gap:0}dd{margin-bottom:6px}}
.beats{padding-left:0;list-style:none;margin:0}.beats li{display:grid;grid-template-columns:96px 1fr;gap:12px;padding:5px 0;border-bottom:1px solid var(--line)}.beats span{font-variant-numeric:tabular-nums;color:var(--mute);font-size:.9rem}
.steal ul{margin:0;padding-left:20px}details{margin-top:14px}summary{cursor:pointer;color:var(--mute)}.tx{font-size:.92rem}.tx i{color:var(--mute);font-style:normal;font-size:.75rem}
</style></head><body><main>
<h1>${esc(an.title || 'Video analysis')}</h1><p class="sub">${esc(an.date || '')} · ${vids.length} video${vids.length > 1 ? 's' : ''}</p>
${scores}${batch}${vids.map((v) => videoCard(v, an.videos[v.id], dir)).join('\n')}
<footer class="made">Made with <a href="https://github.com/moultonpoint/skills" target="_blank" rel="noopener">moultonpoint/skills</a> · free and MIT licensed</footer>
</main></body></html>`;
}

// realpath: the skill is usually run through the .agents/skills symlink, and paths may contain spaces
const isMain = () => { try { return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } };
if (isMain()) {
  const [dir, flag, ...extra] = process.argv.slice(2);
  if (!dir || dir.startsWith('-') || (flag !== undefined && flag !== '--force') || extra.length) {
    console.error('usage: render.mjs <outDir> [--force]'); process.exit(2);
  }
  const out = path.join(dir, 'report.html');
  try {
    const html = render(dir);
    if (flag === '--force') {
      const tmp = fs.mkdtempSync(path.join(dir, '.render-'));
      try {
        fs.writeFileSync(path.join(tmp, 'report'), html);
        fs.renameSync(path.join(tmp, 'report'), out);
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    } else {
      try { fs.writeFileSync(out, html, { flag: 'wx' }); }
      catch (e) { if (e.code === 'EEXIST') throw new Error('report.html exists; use --force to replace it'); throw e; }
    }
  } catch (e) { console.error(e.message); process.exit(1); }
  console.log(out);
}
