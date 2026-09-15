import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeProject} from '../project.js';

test('session initializer creates a complete blank teaching project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socratic-project-'));
  const result = await initializeProject(root);
  assert.equal(result.initialized, true);
  assert.equal(result.changed, true);
  for (const path of ['AGENTS.md', 'system/core_prompt.md', 'memory/student_profile.md', 'curriculum/syllabus.md', 'flashcards/cards.tsv', 'textbooks/README.md']) await lstat(join(root, path));
  const cards = await readFile(join(root, 'flashcards/cards.tsv'), 'utf8');
  assert.doesNotMatch(cards, /coa-002|数据的表示和运算/);
});

test('session initializer is idempotent and never overwrites existing learning data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socratic-project-'));
  await initializeProject(root);
  const profile = join(root, 'memory/student_profile.md');
  await writeFile(profile, '我的已有记忆\n');
  const second = await initializeProject(root);
  assert.equal(second.changed, false);
  assert.equal(await readFile(profile, 'utf8'), '我的已有记忆\n');
  assert.ok(second.existing.includes('memory/student_profile.md'));
});
