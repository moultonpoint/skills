import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const entries = dir => readdirSync(dir, { withFileTypes: true });
const shipped = [];
for (const bucket of entries('skills')) {
  if (!bucket.isDirectory() || bucket.name === 'in-progress') continue;
  for (const skill of entries(join('skills', bucket.name))) {
    if (skill.isDirectory()) shipped.push(`./skills/${bucket.name}/${skill.name}`);
  }
}
const manifest = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8')).skills;
if (!shipped.length || !Array.isArray(manifest) || manifest.length !== shipped.length
    || !shipped.every(dir => manifest.includes(dir))) {
  console.error(`Expected plugin.json skills to list every shipped skill exactly once. Shipped: ${JSON.stringify(shipped)}, manifest: ${JSON.stringify(manifest)}`);
  process.exitCode = 1;
}

function* skillFiles(dir) {
  for (const entry of entries(dir)) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* skillFiles(file);
    else if (entry.isFile() && entry.name === 'SKILL.md') yield file;
  }
}
for (const dir of shipped) {
  if (!existsSync(join(dir, 'SKILL.md'))) {
    console.error(dir + ': missing SKILL.md');
    process.exitCode = 1;
  }
}
let checked = 0;
for (const path of skillFiles('skills')) {
  checked++;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) {
    console.error(`${path}: expected a frontmatter block`);
    process.exitCode = 1;
    continue;
  }

  // Skills use single-line scalar fields. Only read keys inside the header.
  const fields = new Map();
  for (const line of lines.slice(1, end)) {
    const match = /^(name|description):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    fields.set(match[1], value);
  }

  const folder = basename(dirname(path));
  if (fields.get('name') !== folder) {
    console.error(`${path}: expected name "${folder}"`);
    process.exitCode = 1;
  }
  if (!fields.get('description') || fields.get('description').startsWith('#')) {
    console.error(`${path}: expected a nonempty description`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`Frontmatter and plugin inventory OK. Skill files checked: ${checked}.`);
