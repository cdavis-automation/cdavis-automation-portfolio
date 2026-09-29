import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', '.netlify']);

function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) found.push(...files(full));
    else found.push(full);
  }
  return found;
}

test('public files stay fake, credential-free, and free of private system detail', () => {
  const texts = files(root).filter((file) => /\.(md|json|js|mjs|csv|txt)$/.test(file));
  assert.ok(texts.length > 0);
  const combined = texts.map((file) => ({
    file: relative(root, file),
    text: readFileSync(file, 'utf8'),
  }));
  const published = combined.filter((item) => item.file !== 'scripts/redaction.test.js');
  const all = published.map((item) => item.text).join('\n');

  const makeHits = published.filter((item) => /\bMake\b/.test(item.text));
  assert.deepEqual(makeHits.map((item) => item.file), ['README.md']);
  assert.equal((all.match(/\bMake\b/g) || []).length, 1);
  assert.match(all, /I also ship production systems on Make\./);
  assert.doesNotMatch(all, /make\.com/i);
  assert.doesNotMatch(all, /kalshi/i);
  assert.doesNotMatch(all, /\btrading\b/i);
  assert.doesNotMatch(all, /\bvps\b/i);
  assert.doesNotMatch(all, /sk-[A-Za-z0-9]/);
  assert.doesNotMatch(all, /AKIA[0-9A-Z]{16}/);
  const appIds = all.match(/\bapp[A-Za-z0-9]{14}\b/g) || [];
  const unexpectedAppIds = [...new Set(appIds)].filter((id) => id !== 'appendAttribution');
  assert.deepEqual(unexpectedAppIds, []);

  const emails = all.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  assert.ok(emails.length > 0);
  for (const email of emails) {
    assert.match(email, /@example\.com$/i, email);
  }

  for (const item of combined) {
    if (!item.file.endsWith('.workflow.json')) continue;
    const workflow = JSON.parse(item.text);
    assert.equal(workflow.active, false, item.file);
    assert.match(workflow.name, /^CKA Demo — /);
  }
});
