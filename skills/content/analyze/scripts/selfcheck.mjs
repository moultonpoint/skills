#!/usr/bin/env node
// node selfcheck.mjs: offline checks for fetch.mjs parsers and render.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVtt, wordsToLines, sheetTimes, baselineStats, promoSignals, parseArgs, downloaderArgs, commitVideo, readTranscript, run, batchStatus } from './fetch.mjs';
import { render, esc, check, unframed } from './render.mjs';

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
assert.deepEqual(baselineStats(nolike, 't', now, 300), { posts: 5, median_views: 300, median_like_pct: null, multiple: 1, from: null });

assert.deepEqual(promoSignals('Gemini 4 #googlepartner see https://x.y/z #AI'), ['#googlepartner', 'https://x.y/z']);
assert.deepEqual(promoSignals('no promo #adventure'), []);
assert.deepEqual(promoSignals('thanks #Gifted #sponsoredby #paid see https://a.b/c.'), ['#gifted', '#sponsoredby', '#paid', 'https://a.b/c']);
assert.deepEqual(promoSignals(null), []);
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

// two videos: scorecard (one with a baseline, one without), patterns as <details> linking to #v-ids, no table
const two = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-two-'));
for (const [id, base] of [['1', { multiple: 7.62, median_views: 144400, posts: 29 }], ['2', { error: 'test' }]]) {
  fs.mkdirSync(path.join(two, id)); fs.writeFileSync(path.join(two, id, 'video.json'), JSON.stringify({ ...vid, id, uploader: 'u' + id, baseline: base, stats: { ...vid.stats, saves: 7 } }));
}
fs.writeFileSync(path.join(two, 'analysis.json'), JSON.stringify({ title: 'T2', videos: { 1: GOOD, 2: GOOD }, batch: { summary: 's', patterns: [{ title: 'Shared pattern', detail: 'd', videos: ['1', '2'] }], for_you: ['do x'] } }));
const h2 = render(two);
assert.ok(h2.includes('class="scores"') && h2.includes('≈7.62×') && h2.includes('No baseline'), 'scorecard');
assert.ok(/<details class="pattern"><summary>Shared pattern<\/summary>/.test(h2) && h2.includes('href="#v-1"') && h2.includes('href="#v-2"') && h2.includes('do x') && h2.includes('7 saves'), 'batch');
assert.ok(!h2.includes('<table') && !h2.includes('<script'), 'no table or script');
assert.ok(!html.includes('class="scores"'), 'single video: no scorecard');
fs.rmSync(two, { recursive: true });

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
assert.throws(() => readTranscript(tracks, 'media'), /English.*VTT or SRT/);
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
assert.equal(renderCli('--force').status, 0);
assert.equal(renderCli('--other').status, 2);

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
fs.rmSync(dir, { recursive: true });
console.log('selfcheck ok');
