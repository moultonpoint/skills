#!/usr/bin/env node
// node selfcheck.mjs: offline checks for fetch.mjs parsers and render.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVtt, wordsToLines, sheetTimes, baselineStats, promoSignals, parseArgs, downloaderArgs, commitVideo, readTranscript, run, batchStatus } from './fetch.mjs';
import { render, esc, check, unframed, metrics, csv, prose, figures, cheatsheet, scale, shake, fx, cut } from './render.mjs';
import { profileList, rank } from './scout.mjs';

const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nhello <c>there</c>\n\n00:00:01.500 --> 00:00:03.000\nhello there\n\n00:01:02.250 --> 00:01:04.000\nlater line\n';
assert.deepEqual(parseVtt(vtt), [
  { start: 0, end: 3, text: 'hello there' }, // tags stripped, repeat collapsed into the cue it repeats
  { start: 62.25, end: 64, text: 'later line' },
]);

// YouTube rolling auto-captions: each cue repeats the previous line; a line can also build word by word
const roll = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nwe build\n\n00:00:01.000 --> 00:00:02.000\nwe build\nthings fast\n\n00:00:02.000 --> 00:00:03.000\nthings fast\nand ship\n\n00:00:03.000 --> 00:00:04.000\nand ship it\n\n00:00:04.000 --> 00:00:05.000\nrock &amp; roll\n';
assert.deepEqual(parseVtt(roll).map((c) => c.text), ['we build', 'things fast', 'and ship', 'it', 'rock & roll']);
const cue = (a, b, t) => `\n\n00:00:0${a}.000 --> 00:00:0${b}.000\n${t}`;
// an unchanged two-line cue repeated, and a growing second line: no words counted twice
assert.deepEqual(parseVtt('WEBVTT' + cue(0, 1, 'A') + cue(1, 2, 'A\nB c') + cue(2, 3, 'A\nB c') + cue(3, 4, 'B c\nd') + cue(4, 5, 'B c\nd e')).map((c) => c.text), ['A', 'B c', 'd', 'e']);
// cues with a gap are separate speech, never merged; numeric and named entities decode
assert.deepEqual(parseVtt('WEBVTT' + cue(0, 1, 'So') + cue(5, 6, 'So what now') + cue(6, 7, 'it&#x27;s &#8217;ok&lrm; &hellip;')).map((c) => [c.start, c.text]), [[0, 'So'], [5, 'So what now'], [6, "it's ’ok …"]]);

const lines = wordsToLines([{ w: ' a', start: 0, end: 0.2 }, { w: ' b', start: 0.3, end: 0.5 }, { w: ' c', start: 2, end: 2.2 }]);
assert.deepEqual(lines, [{ start: 0, end: 0.5, text: 'a b' }, { start: 2, end: 2.2, text: 'c' }]); // pause splits

// one frame mid-shot; a 10 s shot gets ~3 frames; capped and spread evenly
assert.deepEqual(sheetTimes([2], 4), [1, 3]);
assert.deepEqual(sheetTimes([], 10), [1.67, 5, 8.33]);
const many = sheetTimes(Array.from({ length: 99 }, (_, i) => i + 1), 100);
assert.equal(many.length, 48); assert.equal(many[0], 0.5); assert.equal(many.at(-1), 99.5);

// baseline ignores the target, zero counts and posts under 3 days old
const now = 100 * 86400, old = (id, v) => ({ id, view_count: v, like_count: v / 10, timestamp: 10 * 86400 });
const b = baselineStats([old('t', 9e9), old(1, 100), old(2, 200), old(3, 300), old(4, 400), old(5, 0), old(6, 500), { ...old(7, 9e9), timestamp: now - 3600 }], 't', now, 600);
assert.deepEqual([b.posts, b.median_views, b.multiple, b.median_like_pct], [5, 300, 2, 10]);
assert.equal(baselineStats([old(1, 1)], 't', now, 5), null);
// missing likes stay missing (not 0%); undated entries (YouTube Shorts lists) still count
const nolike = [1, 2, 3, 4, 5].map((i) => ({ id: i, view_count: i * 100 }));
const nl = baselineStats(nolike, 't', now, 300);
assert.deepEqual([nl.posts, nl.median_views, nl.median_like_pct, nl.multiple, nl.from, nl.median_share_pct, nl.posts_per_week], [5, 300, null, 1, null, null, null]);
// rich TikTok lists: median rates, length, posting pace and the creator's other outliers (2x+ their median)
const rich = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, view_count: i === 6 ? 5000 : 100 * i, repost_count: i, save_count: 2 * i, duration: 20 + i, timestamp: now - (10 + i) * 86400, title: 't' + i, url: `https://www.tiktok.com/@u/video/${i}` }));
const rs = baselineStats(rich, 't', now, 700);
assert.deepEqual([rs.median_views, rs.median_share_pct, rs.median_duration_s, rs.posts_per_week, rs.outliers.length, rs.outliers[0].multiple, rs.outliers[0].url], [350, 1, 23.5, 7, 1, 14.29, 'https://www.tiktok.com/@u/video/6']);

assert.deepEqual(promoSignals('Gemini 4 #googlepartner see https://x.y/z #AI'), ['#googlepartner', 'https://x.y/z']);
assert.deepEqual(promoSignals('no promo #adventure'), []);
assert.deepEqual(promoSignals('thanks #Gifted #sponsoredby #paid see https://a.b/c.'), ['#gifted', '#sponsoredby', '#paid', 'https://a.b/c']);
assert.deepEqual(promoSignals(null), []);
assert.deepEqual(promoSignals('arc. Kallaway.co/launch, or https://kallaway.co/x e.g. 3.5 @kallaway.marketing'), ['Kallaway.co/launch', 'https://kallaway.co/x']); // a link without https still counts; handles and decimals don't
assert.deepEqual(promoSignals('code at "https://x.co/aBc" and [https://y.co/Q].'), ['https://x.co/aBc', 'https://y.co/Q']); // case kept, quote and bracket off

// a bad numeric entity is left as text, not a crash; speech after a pause is never deduped against older words
assert.equal(parseVtt('WEBVTT' + cue(0, 1, 'x &#99999999; y'))[0].text, 'x &#99999999; y');
assert.deepEqual(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nstop now\n\n00:00:05.000 --> 00:00:06.000\nok\n\n00:00:06.000 --> 00:00:07.000\nstop now please').map((c) => c.text), ['stop now', 'ok', 'stop now please']);
assert.deepEqual(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.497\nstop\n\n00:00:02.000 --> 00:00:03.000\nstop now').map((c) => c.text), ['stop', 'stop now'], '503 ms is a pause');

assert.equal(esc('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');

const GOOD = { topic: 'tp', format: 'f', idea: 'i', layout: 'l', hook: { spoken: 'Hi there!' }, structure: [{ t: '0:00–0:10', beat: 'a' }, { t: '0:10–0:30', beat: 'b' }] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-check-'));
fs.mkdirSync(path.join(dir, '1'));
fs.writeFileSync(path.join(dir, '1', 'video.json'), JSON.stringify({
  id: '1', url: 'https://x/1', uploader: 'u', upload_date: '20261101', caption: '<script>x</script>', duration: 30,
  stats: { views: 1000, likes: 50, comments: 5, shares: 1 }, rates: { like_pct: 5, comment_pct: 0.5 },
  shots: { count: 3, avg_len_s: 10, cuts: [10, 20] }, frames: { sheet: { cols: 8, times: [0.5] } }, baseline: { error: 'test' }, promo_signals: [], wpm: 200,
  transcript_source: 'platform captions', transcript: [{ start: 0, end: 1, text: 'hi there' }, { start: 20, end: 21, text: 'later words' }],
}));
fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify({ title: 'T', videos: { 1: GOOD } }));
const html = render(dir);
assert.ok(html.startsWith('<!DOCTYPE html>'));
const vid = JSON.parse(fs.readFileSync(path.join(dir, '1', 'video.json'), 'utf8'));
const probs = (a, fetched) => check({ videos: { 1: { ...GOOD, ...a } } }, [vid], fetched);
assert.deepEqual(probs({}), []);
assert.equal(probs({ hook: { spoken: 'later words' } }).length, 1, 'closing line is not the hook');
assert.equal(probs({ hook: { spoken: 'never said' } }).length, 1, 'unquoted hook');
assert.equal(probs({ structure: [{ t: '0:00–0:20', beat: 'a' }, { t: '0:05–0:10', beat: 'b' }] }).length, 1, 'overlap');
assert.equal(probs({ structure: [{ t: '0:00–0:70', beat: 'a' }] }).length, 1, 'seconds over 59');
assert.equal(probs({ structure: [{ t: '0:20–0:45', beat: 'a' }] }).length, 1, 'past the end');
assert.equal(probs({ structure: [{ t: '0:00–0:31', beat: 'a' }] }).length, 1, 'one second past a 30 s video');
assert.equal(probs({ structure: 'x' }).length, 1, 'structure not a list');
{ const over = { ...vid, duration: 30, transcript: [...vid.transcript, { start: 29.5, end: 30.93, text: 'last' }] }; // TikTok says 30 s, its captions run to 30.93 s
  assert.equal(check({ videos: { 1: { ...GOOD, structure: [{ t: '0:00–0:31', beat: 'a' }] } } }, [over]).length, 0, 'the last beat may end where the captions end, rounded up');
  assert.equal(check({ videos: { 1: { ...GOOD, structure: [{ t: '0:00–0:32', beat: 'a' }] } } }, [over]).length, 1, 'but no later'); }
assert.equal(probs({ hook: { spoken: 's' } }).length, 1, 'fragment, not a quote');
assert.equal(probs({ hook: { spoken: 'hi' } }).length, 1, 'too short when the opening has more words');
const late = { ...vid, transcript: [{ start: 12, end: 13, text: 'first words here' }, { start: 14, end: 15, text: 'more' }] };
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: 'invented hook line' } } } }, [late]).length, 1, 'speech after 10 s still checked');
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: 'first words here' } } } }, [late]).length, 0);
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: '日本語 の フック' } } } }, [{ ...vid, transcript: [{ start: 0, end: 1, text: '日本語のフック' }] }]).length, 1, 'non-Latin is compared, not treated as empty');
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: '日本語のフック' } } } }, [{ ...vid, transcript: [{ start: 0, end: 1, text: '日本語のフック' }] }]).length, 0);
const tx1 = (text) => [{ ...vid, transcript: [{ start: 0, end: 1, text }] }];
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: 'cafe\u0301 au lait' } } } }, tx1('café au lait')).length, 0, 'NFC');
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: 'क म ज' } } } }, tx1('की मी जी')).length, 1, 'vowel signs count');
// no speech: no quote possible, the on-screen hook is required instead
const silent = [{ ...vid, transcript: [] }];
assert.equal(check({ videos: { 1: { ...GOOD, hook: { text_on_screen: 'WAIT FOR IT' } } } }, silent).length, 0);
assert.equal(check({ videos: { 1: { ...GOOD, hook: { spoken: 'made up' } } } }, silent).length, 2);
assert.equal(check({ videos: { 1: null } }, [vid]).length, 1, 'null entry listed, not thrown');
assert.equal(probs({ structure: [null] }).length, 1, 'null beat listed');
// frames vs shots: report shots the 48-frame cap left without a frame
assert.equal(unframed({ duration: 30, shots: { cuts: [10, 20] }, frames: { sheet: { times: [5, 15, 25] } } }), 0);
assert.equal(unframed({ duration: 30, shots: { cuts: [10, 11, 20] }, frames: { sheet: { times: [5, 15, 25] } } }), 1);
assert.equal(probs({ topic: '', structure: [] }).length, 2, 'empty fields');
assert.equal(probs({}, ['1', '2']).length, 1, 'fetched video left out');
assert.equal(check({ videos: { 1: GOOD }, batch: { patterns: [{ title: 'p', detail: 'd', videos: ['9'] }] } }, [vid]).length, 1, 'unknown id');
fs.mkdirSync(path.join(dir, '2')); fs.writeFileSync(path.join(dir, '2', 'video.json'), JSON.stringify({ ...vid, id: '2' }));
assert.throws(() => render(dir), /2: fetched but missing/);
assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;') && !html.includes('<script>x'), 'caption escaped');
assert.ok(html.includes('1.0K') && html.includes('tp') && !html.includes('Across'), 'single video: stats, no batch');

// two videos: overview board (one with a baseline, one without), patterns linking to rank anchors (#v1), comparison table
const two = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-two-'));
for (const [id, base] of [['1', { multiple: 7.62, median_views: 144400, posts: 29 }], ['2', { error: 'test' }]]) {
  fs.mkdirSync(path.join(two, id)); fs.writeFileSync(path.join(two, id, 'video.json'), JSON.stringify({ ...vid, id, uploader: 'u' + id, baseline: base, stats: { ...vid.stats, saves: 7 } }));
}
fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify({ title: 'T2', videos: { 1: GOOD, 2: GOOD }, batch: { summary: 's', patterns: [{ title: 'Shared pattern', detail: 'd', videos: ['1', '2'] }], for_you: ['do x'] } }));
const h2 = render(two);
assert.ok(h2.includes('class="board"') && h2.includes('>7.6×<') && h2.includes('No usual') && h2.indexOf('id="v1"') < h2.indexOf('id="v2"'), 'overview board, best multiple first');
assert.ok(/<article class="pattern"><h4>Shared pattern<\/h4>/.test(h2) && h2.includes('href="#v1">#1 @u1 · 7.6×') && h2.includes('href="#v2">#2 @u2') && h2.includes('do x') && h2.includes('<dt>Saves</dt><dd>7 <small>'), 'batch');
assert.ok(h2.includes('moultonpoint/skills') && h2.includes('font/woff2'), 'branding and embedded font');
assert.ok(h2.includes('class="bhead"') && h2.includes('class="one"') && h2.includes('>1×</i>'), 'board header with a scale, 1× marked');
assert.ok(!h2.includes('<p class="kicker">Views against') && h2.includes('<a href="#sheet">What to take (prints alone)</a>') && h2.includes('<a href="#take">Take</a>') && /<section class="foryou" id="take" aria-labelledby="sheet"><div><h2 id="sheet">[^]*class="moves"[^]*do x[^]*Best openings[^]*<\/section>/.test(h2) && (h2.match(/do x/g) || []).length === 1, 'the take box is the one-page sheet: moves, best openings and tests once, linked from the top, so the link survives sharing report.html alone');
assert.ok(h2.includes('body:has(#sheet:target)>:not(main),body:has(#sheet:target) main>:not(#take){display:none}') && h2.includes('.foryou{'), 'printing after the sheet link prints the take box alone; the nav link (#take) leaves a full print alone');
assert.ok(h2.includes('@media screen and (prefers-color-scheme:dark)') && h2.includes('@media print{:root{--chalk:#fff;--ink:#15171C;') && cheatsheet(two).includes('@media print{:root{--b:#fff;--f:#15171C;') && h2.includes('overflow-wrap:normal}'), 'dark colours stay on screen and print resets a host theme, so a print is ink on paper; table headings wrap only at spaces');
assert.ok(/<div class="lead"><a class="lt nf" href="#v1"><span><span class="k">The only one of 2 with a usual to compare<\/span>[^]*7\.6×[^]*@u1’s usual views[^]*“Hi there!”[^]*Usual: 144\.4K\./.test(h2) && !h2.includes('class="low"'), 'first screen: the best video against its usual, computed; no lowest without a second measured video');
assert.ok(/<th scope="row"><a href="#v1"><b>#1 @u1<\/b><span class="ol">“Hi there!”/.test(h2), 'table rows name the video by its opening line');
const noVh = (h) => !/[\d.](?:d|s|l)?vh\b/i.test(h.replace(/url\(data:[^)]*\)/g, ''));
assert.ok(noVh(h2) && noVh(cheatsheet(two)), 'no viewport units in the report or the sheet: hosts that size the frame to the page (T3 Code preview) refuse them');
{ const cs = cheatsheet(two); assert.ok(cs.includes('Do this next') && cs.includes('do x') && cs.includes('Best openings') && cs.includes('7.6×') && !cs.includes('class="solo"') && !cs.includes('<script'), 'one-page sheet: openings from measured videos only'); }
{ const v1 = path.join(two, '1', 'video.json'), keep = fs.readFileSync(v1); fs.writeFileSync(v1, JSON.stringify({ ...JSON.parse(keep), baseline: { error: 'x' } }));
  const hf = render(two); assert.ok(hf.includes('class="board flat"') && !hf.includes('class="bar"') && !hf.includes('class="lead"') && hf.includes('so they are not ranked') && !hf.includes('<th>vs usual</th>') && !/class="board flat"[^]*?<b>#1<\/b>[^]*?<\/section>/.test(hf), 'no usual for any video: no scale, no lead, no ranking claimed or shown, no empty multiple column');
  assert.ok(/<section class="foryou" id="take"[^]*do x/.test(hf) && !hf.includes('Best openings') && hf.includes('<b>Nov 1, 2026 @u1</b>'), 'unrated: the take box keeps its moves; videos are named by date, not by a rank they do not have'); fs.writeFileSync(v1, keep); }
assert.match(check({ videos: { 1: GOOD }, headlines: { board: 'x', nope: 'y' } }, [vid]).join(), /headlines\.nope/);
{ const an2 = JSON.parse(fs.readFileSync(path.join(two, 'analysis.json'))); fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify({ ...an2, headlines: { board: 'One video beat its usual by 7×' } }));
  const hh = render(two); assert.ok(hh.includes('<p class="kicker">Views against each creator’s usual</p><h2>One video beat its usual by 7×</h2>'), 'headline over the section label');
  fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify(an2)); }
{ const v1 = path.join(two, '1', 'video.json'), v2 = path.join(two, '2', 'video.json'), k1 = fs.readFileSync(v1), k2 = fs.readFileSync(v2), even = { multiple: 1, median_views: 100, posts: 9 };
  fs.writeFileSync(v1, JSON.stringify({ ...JSON.parse(k1), baseline: even })); fs.writeFileSync(v2, JSON.stringify({ ...JSON.parse(k2), baseline: even, stats: { ...vid.stats, views: 5000 } }));
  const ht = render(two);
  assert.ok(ht.includes('<span class="k">Highest of 2 videos</span>') && ht.includes('; none beat their usual by over\u00a010%') && ht.indexOf('id="v2"') < ht.indexOf('id="v1"'), 'a tie is not a "best": the lead says none beat their usual, and ties rank by views');
  fs.writeFileSync(v1, JSON.stringify({ ...JSON.parse(k1), baseline: { ...even, multiple: 0.004 } }));
  { const hz = render(two); assert.ok(hz.includes('&lt;0.01×') && !hz.includes('<0.01'), 'a tiny multiple is escaped'); }
  for (const f of [v1, v2]) fs.writeFileSync(f, JSON.stringify({ ...vid, id: path.basename(path.dirname(f)), baseline: { error: 'x' } }));
  const hd = render(two);
  assert.ok(hd.includes('<b>Video 1</b>') && hd.includes('<b>Video 2</b>') && csv(two).split('\n')[1].startsWith('1,,u,'), 'unranked videos sharing a date go by "Video n", and the CSV leaves rank empty');
  fs.writeFileSync(v1, k1); fs.writeFileSync(v2, k2);
  const an2 = JSON.parse(fs.readFileSync(path.join(two, 'analysis.json'))); fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify({ ...an2, date: '2027-03-01', batch: { ...an2.batch, patterns: [{ ...an2.batch.patterns[0], test: 'Film 2x as many' }] } }));
  for (const h of [render(two), cheatsheet(two)]) assert.ok(h.includes('<b>Shared pattern</b>Film <b class="fig">2×</b> as many') && h.includes('.tests :first-child{display:block}'), 'a test sets its title on its own line and keeps its bold figures inline');
  assert.ok(/<small class="age">4\u00a0months\u00a0old<\/small>[^]*\.age\{color:var\(--band-mute\)\}|\.age\{color:var\(--band-mute\)\}[^]*<small class="age">4\u00a0months\u00a0old<\/small>/.test(render(two)) && cheatsheet(two).includes('<small class="age">4\u00a0months\u00a0old</small>'), 'an opening 60 days old or more shows its age on the sheet');
  fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify({ ...an2, date: '2026-00-10' }));
  assert.ok(render(two).includes('<p class="meta">2026-00-10 · '), 'an impossible date is shown as given, never as a guessed month');
  fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify(an2)); }
// Card anchors: an id tail that spells a section's id (#videos) grows until it doesn't.
{ const d = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-ids-')), ids = ['abcXYZideos', 'fghXYZxdeos'];
  for (const id of ids) { fs.mkdirSync(path.join(d, id)); fs.writeFileSync(path.join(d, id, 'video.json'), JSON.stringify({ ...vid, id, baseline: { multiple: id[0] === 'a' ? 2 : 1, median_views: 100, posts: 9 } })); }
  fs.writeFileSync(path.join(d, 'analysis.json'), JSON.stringify({ title: 'A', videos: Object.fromEntries(ids.map((id) => [id, GOOD])) }));
  const h = render(d), all = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(new Set(all).size === all.length && h.includes('<article class="video" id="vZideos">') && h.includes('href="#vZideos"'), 'card anchors stay unique and clear of the page ids'); }
// 16 videos: full cards for the 5 best and 3 worst, a short entry for the middle 8
{ const many = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-many-')), ids = Array.from({ length: 16 }, (_, i) => String(i + 1));
  for (const id of ids) { fs.mkdirSync(path.join(many, id)); fs.writeFileSync(path.join(many, id, 'video.json'), JSON.stringify({ ...vid, id, baseline: id === '9' ? { error: 'test' } : { multiple: id === '16' ? 0.15 : id === '15' ? 1.03 : 20 - +id, median_views: 100, posts: 9 } }));
    fs.writeFileSync(path.join(many, id, 'sheet.jpg'), 'x'.repeat(1000)); } // fetch always writes a contact sheet
  fs.writeFileSync(path.join(many, 'analysis.json'), JSON.stringify({ title: 'M', videos: Object.fromEntries(ids.map((id) => [id, GOOD])) }));
  const hm = render(many);
  assert.equal((hm.match(/<article class="video"/g) || []).length, 8); assert.equal((hm.match(/<article class="brief" id="v\d/g) || []).length, 8);
  assert.ok(/<a class="low nf" href="#v16">[^]*Lowest of the 15 with a usual; 13 beat their usual by over\u00a010%, 1 had no usual to compare<\/span><b>0\.15×<\/b>/.test(hm), 'the lead names the lowest measured video in its own row; 1.03× is inside the ±10% band, not a beat');
  assert.ok(/<article class="video" id="v16">/.test(hm) && /<article class="brief" id="v9">/.test(hm), 'full cards go to the lowest measured videos; the unrated one gets a brief');
  assert.deepEqual((hm.match(/<li><a href="#v(\d+)">/g) || []).map((m) => m.match(/\d+/)[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '10', '11', '12', '13', '14', '15', '16', '9'], 'board rows in rank order, each linking to its own card by its id'); assert.ok(!hm.includes('class="more"'), '16 videos fold nothing');
  { const sc = scale([19, 18, 17, 16, 15, 14, 13, 12, 11, 9, 8, 7, 6, 1.03, 0.15]), at = (m) => `${+(sc.x(m) * 100).toFixed(1)}%`;
    assert.ok(hm.includes(`style="--b0:${at(0.9)};--b1:${at(1.1)};--one:${at(1)}"`) && !hm.includes('<u ') && hm.includes('.bar::after{content:"";'), 'the ±10% band runs from 0.90× to 1.10×; the 1× line is drawn once for every row');
    assert.ok(hm.includes(`<i style="left:${at(1)};width:`) && hm.includes(`<i class="below" style="left:${at(0.15)};width:`), 'bars start at 1×: right for a beat, left for a miss'); }
  assert.ok(hm.includes('* Some counts not reported.') && hm.includes('<dd>5.6%*'), 'the * is explained on the board and in the card');
  assert.ok(hm.includes('No measure differs by 10% or more'), 'winners: identical groups say so instead of vanishing');
  assert.ok(noVh(hm), 'no viewport units in the largest report shape either');
  { const cs16 = cheatsheet(many); assert.ok(cs16.indexOf('>19×<') > 0 && cs16.indexOf('>19×<') < cs16.indexOf('>18×<'), 'sheet openings best first'); }
  // 18 videos: the board folds its middle and the openings list compares measured extremes only
  for (const id of ['17', '18']) { fs.mkdirSync(path.join(many, id)); fs.writeFileSync(path.join(many, id, 'video.json'), JSON.stringify({ ...vid, id, baseline: { multiple: 2 + +id / 100, median_views: 100, posts: 9 } })); }
  fs.writeFileSync(path.join(many, 'analysis.json'), JSON.stringify({ title: 'M', videos: Object.fromEntries([...ids, '17', '18'].map((id) => [id, GOOD])) }));
  { const h18 = render(many), op = h18.match(/<section class="openers"[^]*?<\/section>/)?.[0] || '';
    assert.ok(h18.includes('class="more"') && op && !op.includes('href="#v9"') && op.includes('href="#v16"'), 'openings list: measured videos only (#18 has no usual)'); }
  assert.ok(hm.includes('>1.03×<'), 'near 1× keeps two decimals');
  assert.ok(hm.includes('5.6%* engagement') && hm.includes('<td>5.60*</td>') && hm.includes('<th>Usual views</th>'), 'engagement from 3 of the 4 counts is marked');
  assert.ok(hm.includes('7 more, in brief') && hm.includes('1 more, in brief') && hm.indexOf('id="v5"') < hm.indexOf('id="v6"') && hm.indexOf('id="v12"') < hm.indexOf('id="v13"'), 'middle folded into briefs, in rank order');
  fs.rmSync(many, { recursive: true }); }
assert.ok(h2.indexOf('id="take"') < h2.indexOf('id="overview"') && h2.indexOf('id="overview"') < h2.indexOf('id="batch"'), 'what to take opens the page, before the board');
assert.ok(h2.includes('href="#overview">All videos</a>') && /<h2>“[^<]+”<\/h2>/.test(h2), 'cards lead with the opening line and link back to the board');
assert.ok(h2.includes('class="numbers"') && !h2.includes('class="openers"') && h2.includes('How to read') && h2.includes('href="#main"') && !h2.includes('<script'), 'numbers table and guide; short batches skip the openings list; no script');
assert.ok(!html.includes('class="numbers"') && !html.includes('class="winners"'), 'single video: no comparison tables');
assert.ok(!html.includes('class="board"') && !html.includes('<dt>Saves</dt>') && !html.includes('class="lead"') && html.includes('id="take"') && html.includes('>Opening line<') && (html.match(/>The opening</g) || []).length <= 1, 'single video: no board, unreported saves left out, no lead without a baseline, the sheet at the top with its opening line, no second "The opening" heading');
fs.rmSync(two, { recursive: true });

// CSS pruning: a rule stays when one of its selectors uses only classes on the page; :not() and tag rules don't count; @media pruned inside
assert.equal(shake('a{x:1}.a,.b .c{y:2}.d:not(.e){z:3}@media (w){.a{q:1}.f{r:1}}@media (v){.f{s:1}}@font-face{f:1}', new Set(['a', 'd'])), 'a{x:1}.a{y:2}.d:not(.e){z:3}@media (w){.a{q:1}}@font-face{f:1}');
{ const css = (h) => h.slice(h.indexOf('<style>'), h.indexOf('</style>')); assert.ok(!css(html).includes('.bhead') && css(h2).includes('.bhead') && css(h2).includes('.lead'), 'each report ships only the CSS it uses');
  assert.ok((h2.match(/<path /g) || []).length === 1 && h2.includes('<path id="m" ') && (h2.match(/<use href="#m"\/>/g) || []).length === 2, 'the logo path is drawn once and reused in the same viewBox'); }
// multiples never round across the lines the report draws; cuts never split an emoji; "5 x 4" is not a multiple
assert.deepEqual([1.49, 1.5, 0.999, 9.96, 0.15, 1.03, 57.37, 1.1, 1.11, 1.2e-7, 0.014].map(fx), ['1.49×', '1.5×', '0.99×', '10×', '0.15×', '1.03×', '57×', '1.1×', '1.11×', '<0.01×', '0.014×']);
assert.equal(cut('First, Microsoft has a huge outage. Then the FAA.', 44), 'First, Microsoft has a huge outage. Then…', 'cuts end on a word');
{ const s2 = scale([0.1, 10]); assert.ok(Math.abs(s2.x(10) - s2.x(1) - (s2.x(1) - s2.x(0.1))) < 1e-9 && s2.x(2) - s2.x(1) > s2.x(4) - s2.x(2) - 1e-9 && Math.abs(s2.x(2) - s2.x(1) - (s2.x(4) - s2.x(2))) < 1e-9, 'log scale: equal ratios sit equal distances apart'); }
assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut('Best setup ever 😀 for real', 17)) && cut('ab', 5) === 'ab');
assert.equal(cut('a\u0301'.repeat(6), 4), 'a\u0301'.repeat(3) + '…', 'a cut keeps each accent with its letter');
assert.equal(figures('a 5 x 4 grid'), 'a 5 x 4 grid');
// board scale: 1× between the ends, ends on 1-2-5 steps around the data, values clamped inside
{ const s = scale([0.15, 7.36]); assert.deepEqual([s.ticks[0], s.ticks.at(-1)], [0.1, 10]); assert.ok(s.x(1) > 0.4 && s.x(1) < 0.6 && s.x(0.15) < s.x(1) && s.x(0) === 0 && s.x(1e9) === 1);
  const up = scale([1.2, 57]); assert.deepEqual([up.ticks[0], up.ticks.at(-1)], [0.2, 100]); assert.deepEqual(scale([]).ticks, [0.2, 0.5, 1, 2, 5]); }

// one silent video, no images, a leftover batch block and a non-number stat: no batch, no empty image or transcript UI, escaped
const one = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-one-'));
fs.mkdirSync(path.join(one, '1')); fs.writeFileSync(path.join(one, '1', 'video.json'), JSON.stringify({ ...vid, transcript: [], wpm: 0, shots: { ...vid.shots, avg_len_s: '<b>x' }, baseline: { multiple: 2, median_views: 5, posts: 5, from: 'Q&A' } }));
fs.writeFileSync(path.join(one, 'analysis.json'), JSON.stringify({ title: 'T1', videos: { 1: { ...GOOD, hook: { text_on_screen: 'WAIT' } } }, batch: { summary: 's' } }));
const h1 = render(one);
assert.ok(!h1.includes('Across') && !h1.includes('0.5 s') && !h1.includes('Contact sheet') && !h1.includes('Full transcript') && !h1.includes('wpm'), 'silent, imageless single video');
assert.ok(h1.includes('&lt;b&gt;x') && !h1.includes('<b>x'), 'non-number stat escaped');
assert.ok(h1.includes('since Q&amp;A') && !h1.includes('&amp;amp;'), 'baseline escaped once');
fs.rmSync(one, { recursive: true });

// CLI entry must work through a symlink and a path with a space (how the skill is normally run)
const link = path.join(dir, 'link dir');
fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link, process.platform === 'win32' ? 'junction' : 'dir');
for (const f of ['render.mjs', 'fetch.mjs']) assert.equal(spawnSync(process.execPath, [path.join(link, f)]).status, 2, `${f} usage via symlink`);
const url = 'https://www.youtube.com/shorts/example';
const script = path.join(dir, 'custom transcriber.mjs');
fs.writeFileSync(script, `import fs from 'node:fs';
fs.writeFileSync(process.argv[3], JSON.stringify({ words: [{ w: process.argv[2], start: 0, end: 1 }] }));`);
assert.deepEqual(parseArgs([dir, url, '--keep', '--cookies-from-browser', 'chrome', '--transcribe', script, '--replace']),
  { outDir: dir, urls: [url], opts: { keep: true, cookies: 'chrome', transcribe: script, replace: true } });
for (const args of [['--other'], ['--cookies-from-browser'], ['--transcribe', '--keep'], ['--cookies-from-browser', 'invalid'],
  ['--transcribe', dir], ['--transcribe', script + '.missing']]) assert.throws(() => parseArgs([dir, url, ...args]));
assert.throws(() => parseArgs(['out%d', url]), /cannot contain %/);
for (const bad of ['ftp://youtube.com/a', 'http://tiktok.com/a', 'https://youtube.com.example.com/a', 'https://user@youtube.com/a',
  'https://youtube.com:99/a', 'https://example.com/a', 'https://tiktok.com\\video', '--config-location'])
  assert.throws(() => parseArgs([dir, bad]));
for (const host of ['vm.tiktok.com', 'vt.tiktok.com', 'm.youtube.com', 'youtu.be', 'instagram.com'])
  assert.deepEqual(parseArgs([dir, `https://${host}/v`]).opts, {});
assert.throws(() => downloaderArgs(['-J'], 'https://example.org/channel/shorts'), /supported HTTPS/);
for (const options of [['--no-playlist'], ['--flat-playlist']]) {
  const youtube = downloaderArgs(options, url);
  assert.deepEqual(youtube, ['--ignore-config', '--js-runtimes', 'node', '--remote-components', 'ejs:github', ...options, '--', url]);
  const short = 'https://vm.tiktok.com/test';
  assert.deepEqual(downloaderArgs(options, short, 'chrome'), ['--ignore-config', ...options, '--cookies-from-browser', 'chrome', '--', short]);
}
assert.deepEqual([0, 1, 2].map(n => batchStatus(n, 2)), [0, 3, 1]);
assert.throws(() => run('analyze-missing-command', []), /analyze-missing-command not found; install it/);
assert.throws(() => run(process.execPath, ['-e', 'console.error("first diagnostic");process.exit(1)']), /first diagnostic/);

const tracks = fs.mkdtempSync(path.join(dir, '.captions-'));
const track = (name, data) => fs.writeFileSync(path.join(tracks, name), data);
track('id.fr.vtt', vtt);
track('id.en.vtt', 'WEBVTT' + cue(0, 1, '<c></c>'));
assert.deepEqual(readTranscript(tracks, 'media'), { transcript: [], transcript_source: 'none: no English platform captions' }, 'no captions: continue without a transcript');
assert.deepEqual(readTranscript(tracks, 'media with spaces', script).transcript, [{ start: 0, end: 1, text: 'media with spaces' }]);
fs.writeFileSync(script, `import fs from 'node:fs'; fs.writeFileSync(process.argv[3], '{"words":[{}]}');`);
assert.throws(() => readTranscript(tracks, 'media', script), /invalid transcriber output/);
track('id.en.srt', '1\r\n00:00:00,125 --> 00:00:01,500\r\nSRT text\r\n');
assert.deepEqual(readTranscript(tracks).transcript, [{ start: 0.13, end: 1.5, text: 'SRT text' }]);
track('id.en-US.vtt', vtt);
track('id.en-GB.vtt', 'WEBVTT' + cue(0, 1, 'first'));
assert.equal(readTranscript(tracks, 'media', script).transcript[0].text, 'first');
assert.deepEqual(parseVtt('WEBVTT\n\nbad --> 0\ntext\n\n00:04.000 --> 00:01.000\ntext'), []);

const target = path.join(dir, 'saved');
const stage = () => {
  const tmp = fs.mkdtempSync(path.join(dir, '.stage-'));
  fs.writeFileSync(path.join(tmp, 'video.json'), '{"id":"saved"}');
  return tmp;
};
commitVideo(stage(), target, false);
fs.writeFileSync(path.join(target, 'note'), 'original');
const retry = stage();
assert.throws(() => commitVideo(retry, target, false), /--replace/);
assert.throws(() => commitVideo(retry + '.missing', target, true), /ENOENT/);
assert.equal(fs.readFileSync(path.join(target, 'note'), 'utf8'), 'original');
commitVideo(retry, target, true);
assert.ok(!fs.existsSync(path.join(target, 'note')));
assert.throws(() => commitVideo(stage(), tracks, true), /unrelated/);

const checkBatch = batch => check({ videos: { 1: GOOD }, batch }, [vid]);
for (const batch of [[], { patterns: 'x' }, { for_you: [1] }, { summary: [] }, { patterns: [null] },
  { patterns: [{ title: 'p', detail: 'd', videos: '1' }] }]) assert.ok(checkBatch(batch).length);
assert.match(checkBatch({ patterns: [{ title: 'p', detail: 'd', videos: ['constructor'] }] }).join(), /unknown video/);
for (const a of [{ topic: 4 }, { hook: [] }, { hook: { spoken: 'hi there', visual: [] } }, { steal: 'x' },
  { structure: [{ t: '0:00-0:01', beat: ' ' }] }]) assert.ok(probs(a).length);
assert.ok(check({ title: 1, videos: { 1: GOOD } }, [vid]).length);
assert.ok(check({ videos: [] }, [vid]).length);
assert.match(check({ videos: {} }, [{ ...vid, id: 'constructor' }]).join(), /missing/);
const beats = (...times) => ({ videos: { 1: { ...GOOD, structure: times.map(t => ({ t, beat: 'x' })) } } });
assert.deepEqual(check(beats('0:00-0:05'), [{ ...vid, duration: 4.2 }]), []);
assert.ok(check(beats('0:00-0:05', '0:05-0:05'), [{ ...vid, duration: 4.2 }]).length);
assert.ok(check(beats('0:05-0:05'), [{ ...vid, duration: 4.2 }]).length, 'a beat may not start after the video ends');
{ const bad = beats('0:00-0:04'); bad.videos[1].hook = { ...GOOD.hook, spoken: { toString: 1 } }; assert.ok(check(bad, [{ ...vid, duration: 4.2 }]).some((p) => p.includes('hook')), 'a non-string hook is reported, not thrown'); }

const reportDir = fs.mkdtempSync(path.join(dir, '.report-'));
const writeAnalysis = videos => fs.writeFileSync(path.join(reportDir, 'analysis.json'), JSON.stringify({ videos }));
writeAnalysis({});
assert.throws(() => render(reportDir), /no fetched videos/);
const evidenceDir = path.join(reportDir, '1');
fs.mkdirSync(evidenceDir);
const meta = value => fs.writeFileSync(path.join(evidenceDir, 'video.json'), JSON.stringify(value));
meta({ ...vid, id: '../outside' });
writeAnalysis({ 1: GOOD });
assert.throws(() => render(reportDir), /match directory/);
meta({ ...vid, url: 'javascript:void(0)' });
assert.ok(!render(reportDir).includes('javascript:'));
writeAnalysis({ 1: GOOD, '../outside': GOOD });
assert.throws(() => render(reportDir), /unknown analysis video/);
writeAnalysis({ 1: GOOD });
fs.renameSync(evidenceDir, path.join(reportDir, 'unsafe id'));
assert.throws(() => render(reportDir), /invalid video directory/);
fs.renameSync(path.join(reportDir, 'unsafe id'), evidenceDir);
const frame = path.join(evidenceDir, 'hook.jpg');
if (process.platform !== 'win32') {
  fs.symlinkSync(script, frame);
  assert.throws(() => render(reportDir), /outside run/);
  fs.unlinkSync(frame);
}
fs.writeFileSync(frame, 'test frame');
const renderCli = (...args) => spawnSync(process.execPath, [path.join(link, 'render.mjs'), reportDir, ...args], { encoding: 'utf8' });
assert.equal(renderCli().status, 0);
assert.match(fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8'), /data:image\/jpeg;base64/);
fs.writeFileSync(path.join(reportDir, 'report.html'), 'original');
assert.match(renderCli().stderr, /--force/);
assert.equal(fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8'), 'original');
for (const f of ['metrics.csv', 'cheatsheet.html']) fs.rmSync(path.join(reportDir, f));
assert.equal(renderCli('--force').status, 0);
assert.ok(fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8').includes('.strip :nth-child(6) i{background-position:100%}'), 'the six strip cells each show their own frame');
assert.ok(fs.readFileSync(path.join(reportDir, 'metrics.csv'), 'utf8').startsWith('\uFEFFid,rank,') && fs.readFileSync(path.join(reportDir, 'cheatsheet.html'), 'utf8').includes('One-page sheet'), 'the CLI writes all three files');
{ const r = path.join(reportDir, 'report.html'), keep = fs.readFileSync(r, 'utf8'); fs.rmSync(path.join(reportDir, 'metrics.csv')); fs.mkdirSync(path.join(reportDir, 'metrics.csv'));
  assert.equal(renderCli('--force').status, 1); assert.equal(fs.readFileSync(r, 'utf8'), keep, 'a blocked destination stops the run before any file changes'); fs.rmSync(path.join(reportDir, 'metrics.csv'), { recursive: true }); }
if (process.platform !== 'win32') { const r = path.join(reportDir, 'report.html'); fs.renameSync(r, r + '.keep'); fs.symlinkSync(path.join(reportDir, 'nowhere.html'), r);
  assert.match(renderCli().stderr, /--force/, 'a first render never replaces an existing name, not even a dangling link'); assert.ok(fs.lstatSync(r).isSymbolicLink()); fs.unlinkSync(r); fs.renameSync(r + '.keep', r); }
assert.equal(renderCli('--other').status, 2);
assert.ok(!fs.readdirSync(reportDir).some((f) => f.endsWith('.tmp')), 'no temp files are left behind, even after a refused render');

// CI supplies the repository checker explicitly. Installed skills can run standalone.
const inventoryChecker = process.argv[2];
if (inventoryChecker) {
  const fixture = fs.mkdtempSync(path.join(dir, '.inventory-'));
  const shipped = './skills/content/example';
  const skill = path.join(fixture, shipped);
  fs.mkdirSync(path.join(fixture, '.claude-plugin'));
  fs.mkdirSync(path.join(fixture, 'skills/in-progress/beta'), { recursive: true });
  const inventory = (skills, status) => {
    fs.writeFileSync(path.join(fixture, '.claude-plugin/plugin.json'), JSON.stringify({ skills }));
    const result = spawnSync(process.execPath, [path.resolve(inventoryChecker)], { cwd: fixture, encoding: 'utf8' });
    assert.equal(result.status, status, result.stderr);
  };
  inventory([], 1);
  fs.mkdirSync(skill, { recursive: true });
  inventory([shipped], 1); // missing SKILL.md
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: example\ndescription: example skill\n---\n');
  inventory([], 1);
  inventory(null, 1);
  inventory([shipped, shipped], 1);
  inventory(['./skills/in-progress/beta'], 1);
  inventory([shipped], 0);
}
// poster metrics from video.json alone: rates, views per day, hook speed (words in the first 3 s split by time)
const mx = metrics({ ...vid, upload_date: '20261101', followers: 500, stats: { views: 1000, likes: 50, comments: 5, shares: 10, saves: 20 }, caption: 'go #a #b #a' }, '2026-11-11');
assert.deepEqual([mx.age_days, mx.views_per_day, mx.views_per_follower, mx.engagement_pct, mx.share_pct, mx.first_cut_s, mx.first_word_s, mx.words_first_3s, mx.hashtags],
  [10, 100, 2, 8.5, 1, 10, 0, 2, ['#a', '#b']]);
assert.deepEqual([metrics({ ...vid, transcript: [], stats: {} }).engagement_pct, metrics({ ...vid, transcript: [] }).words_first_3s], [null, null]);
// metrics.csv: spreadsheet formulas from platform text are neutralised
{ const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-csv-'));
  fs.mkdirSync(path.join(cd, '1')); fs.writeFileSync(path.join(cd, '1', 'video.json'), JSON.stringify({ ...vid, uploader: '=HYPERLINK("x")' }));
  fs.writeFileSync(path.join(cd, 'analysis.json'), JSON.stringify({ videos: { 1: GOOD }, tldr: ['one'] }));
  const sheet = csv(cd);
  assert.ok(sheet.startsWith('\uFEFFid,rank,creator,') && sheet.includes('engagement_pct,engagement_counts,') && sheet.includes(`"'=HYPERLINK(""x"")"`) && !/,=/.test(sheet), 'csv escaped');
  assert.ok(render(cd).includes('<ul class="tldr"><li>one</li>'), 'tldr in header');
  assert.match(check({ videos: { 1: GOOD }, tldr: 'x' }, [vid]).join(), /tldr/);
  // a silent video whose opening is only visual still reaches the sheet and the spreadsheet
  fs.writeFileSync(path.join(cd, '1', 'video.json'), JSON.stringify({ ...vid, transcript: [] }));
  fs.writeFileSync(path.join(cd, 'analysis.json'), JSON.stringify({ videos: { 1: { ...GOOD, hook: { visual: 'Phone held up to camera' } } } }));
  assert.ok(cheatsheet(cd).includes('Visual: Phone held up to camera') && csv(cd).includes('Phone held up to camera,visual'), 'visual-only opening kept, with its source');
  fs.rmSync(cd, { recursive: true }); }

// prose: long paragraphs break every 2 sentences, blank lines are kept, figures with units go bold, entities stay intact
const long = Array.from({ length: 6 }, (_, i) => `Sentence ${i} has several words in it to pass the length limit easily.`).join(' ');
assert.equal((prose(long).match(/<p>/g) || []).length, 3);
assert.equal((prose('Short one. Short two.\n\nNew para.').match(/<p>/g) || []).length, 2);
assert.equal(figures(esc("got 7.36x and 12.8K views, 0.28% shares, Kallaway's 2026 post")), 'got <b class="fig">7.36×</b> and <b class="fig">12.8K</b> views, <b class="fig">0.28%</b> shares, Kallaway&#39;s 2026 post');
assert.ok(!prose('<script>x</script>').includes('<script>'), 'prose escapes');
assert.equal(prose('He said "go" and it\'s done.'), '<p>He said “go” and it’s done.</p>', 'curly quotes');
assert.equal(figures('1.1–1.2M views on 2026-11-24'), '<b class="fig">1.1–1.2M</b> views on 2026-11-24', 'ranges bold whole, dates untouched');

// scout: profile links only, ranked against the settled median, fresh posts flagged but kept out of it
assert.equal(profileList('https://www.tiktok.com/@kallaway.marketing?lang=en'), 'https://www.tiktok.com/@kallaway.marketing');
assert.equal(profileList('https://www.youtube.com/@moultonpoint/videos'), 'https://www.youtube.com/@moultonpoint/shorts');
for (const bad of ['https://www.tiktok.com/@u/video/1', 'https://www.youtube.com/watch?v=x', 'https://www.instagram.com/u/']) assert.throws(() => profileList(bad), /profile/);
assert.equal(rank([1, 2, 3, 4, 5].map((i) => ({ view_count: i * 100, timestamp: 1 })), 1e9), null, 'five settled posts leave each only 4 peers, short of the 5 fetch needs');
const ranked = rank([...[1, 2, 3, 4, 5, 6].map((i) => ({ view_count: i * 100, timestamp: 1, url: 'https://x/' + i, title: 'p' + i })), { view_count: 9000, timestamp: 1e9, url: 'javascript:x' }], 1e9 + 60);
assert.deepEqual([ranked.median_views, ranked.posts[0].multiple, ranked.posts[0].fresh, ranked.posts[0].url, ranked.posts[1].multiple], [350, 25.71, true, null, 2]); // 600 against the other five (median 300), as fetch measures it
fs.rmSync(dir, { recursive: true });
console.log('selfcheck ok');
