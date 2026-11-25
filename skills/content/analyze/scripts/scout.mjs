#!/usr/bin/env node
// node scout.mjs <profile-url> [--cookies-from-browser browser]
// Ranks a creator's 30 most recent posts against their own median views. Reads the channel list only: no downloads, no frames.
// Prints one line per post (multiple, views, date, link, title) and a JSON summary on the last line.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { platform, channelEntries } from './fetch.mjs';

// TikTok @handle pages and YouTube channel pages; a single video link belongs to fetch.mjs.
export function profileList(url) {
  const host = platform(url), u = new URL(url), seg = u.pathname.split('/').filter(Boolean);
  if (host === 'tiktok.com' && seg.length === 1 && /^@[\w.-]+$/.test(seg[0])) return `https://www.tiktok.com/${seg[0]}`;
  if (host === 'youtube.com' && (/^@[\w.-]+$/.test(seg[0]) || (['channel', 'c', 'user'].includes(seg[0]) && seg[1])) && !['watch', 'shorts'].includes(seg[0]))
    return `https://www.youtube.com/${seg.slice(0, seg[0].startsWith('@') ? 1 : 2).join('/')}/shorts`;
  throw new Error('expected a TikTok profile (tiktok.com/@name) or YouTube channel link; Instagram profiles are not supported');
}

export function rank(entries, nowSec) {
  // Posts under 3 days old are still collecting views: listed, but kept out of the median.
  const fresh = (e) => !!(e.timestamp && nowSec - e.timestamp < 3 * 86400), settled = entries.filter((e) => e.view_count > 0 && !fresh(e)).map((e) => e.view_count).sort((a, b) => a - b);
  // fetch.mjs needs 5 other posts for a usual, so each settled post needs 5 peers here too.
  if (settled.length < 6) return null;
  const med = (s) => { const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }, median = med(settled);
  // Like fetch.mjs, each post is measured against the others, so scout and the report agree on the same list.
  const usual = (e) => (fresh(e) ? median : med(settled.toSpliced(settled.indexOf(e.view_count), 1)));
  const posts = entries.filter((e) => e.view_count > 0).map((e) => ({ multiple: +(e.view_count / usual(e)).toFixed(2), views: e.view_count,
    date: e.timestamp ? new Date(e.timestamp * 1000).toISOString().slice(0, 10) : null, fresh: fresh(e),
    url: [e.webpage_url, e.url].find((x) => /^https:\/\//.test(String(x))) ?? null, title: String(e.title || e.description || '').replace(/\s+/g, ' ').slice(0, 120) }))
    .sort((a, b) => b.multiple - a.multiple);
  return { median_views: median, posts };
}

const isMain = () => { try { return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } };
if (isMain()) {
  const [url, flag, browser, ...extra] = process.argv.slice(2);
  let list;
  try {
    if (!url || extra.length || (flag && (flag !== '--cookies-from-browser' || !['chrome', 'firefox', 'safari', 'edge', 'brave'].includes(browser)))) throw new Error('usage: scout.mjs <profile-url> [--cookies-from-browser chrome|firefox|safari|edge|brave]');
    list = profileList(url);
  } catch (e) { console.error(e.message); process.exit(2); }
  const r = rank(channelEntries(list, browser), Date.now() / 1000);
  if (!r) { console.error('fewer than 6 settled posts with view counts; try again or check the link'); process.exit(1); }
  for (const p of r.posts) console.log(`${p.multiple.toFixed(2).padStart(6)}x\t${p.views}\t${p.date ?? '?'}${p.fresh ? ' (new)' : ''}\t${p.url ?? ''}\t${p.title}`);
  console.log(JSON.stringify({ median_views: r.median_views, outliers: r.posts.filter((p) => p.multiple >= 2 && !p.fresh).length, posts: r.posts.length }));
}
