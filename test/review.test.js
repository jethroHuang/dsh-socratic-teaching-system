import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewEngine} from '../engine.js';
import {sameOrigin} from '../host.js';
import C from '../core.cjs';

const sid = 'session-test-a', sid2 = 'session-test-b';
const cards = Array.from({length: 6}, (_, index) => ({ID: `test-${index + 1}`, Question: `示例问题 ${index + 1}`, A: '选项甲', B: '选项乙', C: '选项丙', D: '选项丁', Answer: 'C', Hint: '比较四个选项。', Source: 'textbooks/example.md > 测试章节', Explanation: '测试解释。', Tags: 'test'}));
async function setup(seed = cards) { const root = await mkdtemp(join(tmpdir(), 'dsh-socratic-test-')); await writeFile(join(root, 'cards.tsv'), C.exportTSV(seed)); const engine = await new ReviewEngine(root).init(); return {root, engine}; }
// A valid in-flight round holding `cards` with `index` already answered.
function round(cards, index = 0) {
  return {id: 'round-1', cards, index, practice: false, correct: false, failed: false, feedback: '', feedbackKind: 'hint', tried: [], results: Array.from({length: index}, (_, i) => ({id: cards[i].ID, question: cards[i].Question, passed: true}))};
}
// Seed a session state file directly, then hand back a fresh engine that reads it.
async function seed(root, sessionId, progress, pending = null) {
  await writeFile(join(root, `dsh-state.${sessionId}.json`), JSON.stringify({version: 2, sessionId, revision: 1, visible: false, progress, round: pending}));
  return new ReviewEngine(root).init();
}
function act(engine, sessionId, view, action, extra = {}) { return engine.request(sessionId, {action, expectedRevision: view.revision, roundId: view.roundId, cardId: view.card?.id, ...extra}); }

test('empty project initializes a header-only project card file', async () => { const root = await mkdtemp(join(tmpdir(), 'dsh-socratic-empty-')); const engine = await new ReviewEngine(root).init(); assert.equal(engine.cards.length, 0); assert.match(await readFile(join(root, 'cards.tsv'), 'utf8'), /#columns:ID\tQuestion/); const view = await engine.request(sid, {action: 'start'}); assert.equal(view.total, 0); assert.equal(view.done, true); });
test('TSV lossless roundtrip and Basic output', async () => { const {engine} = await setup(); const copy = engine.cards.map(card => ({...card})); copy[0].Hint = '多行\n"引号"\tTAB'; assert.deepEqual(C.parse(C.exportTSV(copy)), copy); assert.equal(C.rows(C.exportBasic(copy))[0].length, 3); assert.throws(() => C.parse('a\tb')); });
test('session separation, wrong feedback, retry and restart restore full round', async () => { const {engine, root} = await setup(); let first = await engine.request(sid, {action: 'start'}); const second = await engine.request(sid2, {action: 'start'}); assert.equal(first.total, 5); first = await act(engine, sid, first, 'choose', {choice: 'A'}); assert.equal(first.feedbackKind, 'wrong'); assert.equal((await engine.request(sid2, {action: 'status'})).tried.length, 0); first = await act(engine, sid, first, 'choose', {choice: 'C'}); const resumed = await new ReviewEngine(root).init(); assert.deepEqual(await resumed.request(sid, {action: 'status'}), first); first = await act(resumed, sid, first, 'pass'); assert.equal(first.results[0].passed, false); assert.equal((await resumed.load(sid)).progress['test-1'].stage, 0); assert.equal((await resumed.request(sid2, {action: 'status'})).roundId, second.roundId); });
test('independent pass extends, stale revision/card rejected, close retains results', async () => { const {engine} = await setup(); let view = await engine.request(sid, {action: 'start'}); const stale = view; view = await act(engine, sid, view, 'choose', {choice: 'C'}); await assert.rejects(act(engine, sid, stale, 'skip'), /界面已更新/); await assert.rejects(act(engine, sid, view, 'pass', {roundId: 'bad'}), /轮次/); view = await act(engine, sid, view, 'pass'); assert.equal((await engine.load(sid)).progress['test-1'].stage, 1); view = await act(engine, sid, view, 'close'); assert.equal(view.open, false); assert.equal(view.results.length, 1); });
test('free practice does not alter schedule; hints prevent independent pass', async () => { const {engine} = await setup(); let first = await engine.request(sid, {action: 'start', practice: true}); first = await act(engine, sid, first, 'choose', {choice: 'C'}); await act(engine, sid, first, 'pass'); assert.equal(Object.keys((await engine.load(sid)).progress).length, 0); let second = await engine.request(sid2, {action: 'start'}); second = await act(engine, sid2, second, 'hint'); second = await act(engine, sid2, second, 'choose', {choice: 'C'}); second = await act(engine, sid2, second, 'pass'); assert.equal(second.results[0].passed, false); });
test('parallel duplicate submission only commits once', async () => { const {engine} = await setup(); const view = await engine.request(sid, {action: 'start'}); const all = await Promise.allSettled([act(engine, sid, view, 'skip'), act(engine, sid, view, 'skip')]); assert.equal(all.filter(result => result.status === 'fulfilled').length, 1); assert.equal((await engine.request(sid, {action: 'status'})).index, 1); });
test('different workspace roots isolate cards and state', async () => { const first = await setup(cards); const secondCards = [{...cards[0], ID: 'other-1', Question: '另一个项目的问题'}]; const second = await setup(secondCards); assert.equal(first.engine.cards.length, 6); assert.equal(second.engine.cards.length, 1); await first.engine.request(sid, {action: 'start'}); assert.equal((await second.engine.request(sid, {action: 'status'})).roundId, null); });
test('prototype-like card IDs remain data across disk roundtrip', async () => { const special = [{...cards[0], ID: '__proto__'}]; const {engine, root} = await setup(special); let view = await engine.request(sid, {action: 'start'}); view = await act(engine, sid, view, 'choose', {choice: 'C'}); await act(engine, sid, view, 'pass'); assert.equal((await engine.load(sid)).progress.__proto__.stage, 1); const next = await new ReviewEngine(root).init(); assert.equal((await next.load(sid)).progress.__proto__.stage, 1); assert.equal({}.stage, undefined); });
test('imports retain another session active snapshot', async () => { const {engine} = await setup(); const active = await engine.request(sid, {action: 'start'}); const idle = await engine.request(sid2, {action: 'status'}); const text = C.exportTSV([{...engine.cards[0], Question: '更新题干'}]); await act(engine, sid2, idle, 'import', {text}); assert.equal((await engine.request(sid, {action: 'status'})).card.question, active.card.question); assert.equal(engine.cards[0].Question, '更新题干'); });
test('path traversal and corrupted state fail closed', async () => { const {engine, root} = await setup(); await assert.rejects(engine.request('../x', {action: 'status'})); await writeFile(join(root, 'dsh-state.' + sid + '.json'), '{broken'); await assert.rejects(engine.request(sid, {action: 'start'})); assert.equal(await readFile(join(root, 'dsh-state.' + sid + '.json'), 'utf8'), '{broken'); });
test('HTTP origin rejects missing foreign and cross-site requests', () => { assert.equal(sameOrigin({headers: {host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin'}}), true); for (const headers of [{host: 'x'}, {host: 'x', origin: 'http://evil'}, {host: 'x', origin: 'http://x', 'sec-fetch-site': 'cross-site'}]) assert.equal(sameOrigin({headers}), false); });

test('archive moves mastered cards out, keeps the rest, and records the source tier', async () => {
  const {root, engine} = await setup();
  const resumed = await seed(root, sid, {'test-1': {stage: C.masteredStage, due: Date.now()}, 'test-2': {stage: 2, due: Date.now()}}, round([engine.cards[5]], 0));
  const result = await resumed.request(sid, {action: 'archive'});
  assert.deepEqual(result.archived.map(card => card.id), ['test-1']);
  assert.equal(result.archived[0].masteredStage, String(C.masteredStage));
  assert.equal(result.remaining, 5);
  assert.equal(resumed.cards.some(card => card.ID === 'test-1'), false);
  assert.equal(resumed.cards.some(card => card.ID === 'test-2'), true);
  const archive = await readFile(join(root, 'mastered.tsv'), 'utf8');
  assert.match(archive, /test-1/);
  assert.doesNotMatch(archive, /test-2/);
  // The eleven card columns survive verbatim, so the row merges straight back.
  assert.deepEqual(C.parseMastered(archive)[0].Question, '示例问题 1');
  assert.deepEqual(C.fields.map(field => C.parseMastered(archive)[0][field]), C.fields.map(field => engine.cards[0][field]));
  // Progress for a card no longer in the deck is cleared so a restore is not instantly re-archived.
  assert.deepEqual(Object.keys((await resumed.load(sid)).progress), ['test-2']);
});

test('archive is idempotent, skips cards locked in an in-flight round, and restore brings them back', async () => {
  const {root, engine} = await setup();
  const inFlight = round([engine.cards[3]], 0);
  let resumed = await seed(root, sid, {'test-1': {stage: 4, due: 0}, 'test-4': {stage: 4, due: 0}}, inFlight);
  const first = await resumed.request(sid, {action: 'archive'});
  assert.deepEqual(first.archived.map(card => card.id), ['test-1']);
  assert.equal(resumed.cards.some(card => card.ID === 'test-4'), true, 'the in-flight card must stay');
  // Re-archiving the same mastered card again must not duplicate its archive row.
  const second = await resumed.request(sid, {action: 'archive'});
  assert.deepEqual(second.archived, []);
  assert.equal(C.parseMastered(await readFile(join(root, 'mastered.tsv'), 'utf8')).length, 1);
  // A later point where the round has moved past that card releases it.
  const state = await resumed.load(sid);
  state.round = round([engine.cards[3]], 1);
  await resumed.commit(state);
  assert.deepEqual((await resumed.request(sid, {action: 'archive'})).archived.map(card => card.id), ['test-4']);
  const restored = await resumed.request(sid, {action: 'restore'});
  assert.deepEqual(restored.restored.sort(), ['test-1', 'test-4']);
  assert.equal(restored.remaining, 6);
  assert.equal(resumed.mastered.length, 0);
  assert.equal((await resumed.request(sid, {action: 'start'})).total, 5);
});

test('mastery spans sessions: the best tier across state files decides', async () => {
  const {root} = await setup();
  const engine = await seed(root, sid, {'test-1': {stage: 1, due: 0}});
  await writeFile(join(root, `dsh-state.${sid2}.json`), JSON.stringify({version: 2, sessionId: sid2, revision: 1, visible: false, progress: {'test-1': {stage: 4, due: 0}}, round: null}));
  const archived = await new ReviewEngine(root).init();
  assert.deepEqual((await archived.request(sid, {action: 'archive'})).archived.map(card => card.id), ['test-1'], 'another session mastering the card is enough');
  assert.equal((await engine.request(sid, {action: 'status'})).totalCards, 6, 'a stale in-memory engine is not silently rewritten');
});

test('a corrupted sibling state file is skipped, not silently trusted or fatal', async () => {
  const {root} = await setup();
  const engine = await seed(root, sid, {'test-1': {stage: 4, due: 0}});
  await writeFile(join(root, `dsh-state.${sid2}.json`), '{broken');
  const result = await engine.request(sid, {action: 'archive'});
  assert.deepEqual(result.archived.map(card => card.id), ['test-1']);
  assert.deepEqual(result.skippedSessions, [sid2]);
});

test('a card just answered in the round is still archived at 下课', async () => {
  const {root, engine} = await setup();
  // A real round of five: the student answered cards 1-4, card 5 is still pending.
  const state = {version: 2, sessionId: sid, revision: 3, visible: true, progress: {'test-1': {stage: 4, due: 0}}, round: round(engine.cards.slice(0, 5), 4)};
  await writeFile(join(root, `dsh-state.${sid}.json`), JSON.stringify(state));
  const resumed = await new ReviewEngine(root).init();
  // test-1 was answered at this position and reached stage 4: it must be archived now.
  const result = await resumed.request(sid, {action: 'archive'});
  assert.deepEqual(result.archived.map(card => card.id), ['test-1']);
  // The round is untouched and the remaining cards are still pending for the student.
  const after = await resumed.request(sid, {action: 'status'});
  assert.equal(after.total, 5);
  assert.equal(after.index, 4);
  assert.equal(after.card.id, 'test-5');
});

test('archived cards are never served in a review round', async () => {
  const {root} = await setup();
  const engine = await seed(root, sid, {});
  await engine.request(sid, {action: 'archive'});
  await engine.request(sid, {action: 'restore'});
  const view = await engine.request(sid, {action: 'start'});
  assert.equal(view.total, 5);
  assert.equal(view.masteredCards, 0);
});

const draft = {question: '什么是数据的最小单位？', A: '位', B: '字节', C: '字', D: '块', answer: 'A', hint: '想想二进制。', source: 'textbooks/example.md > 1.2', explanation: '位是最小单位。', tags: '基础'};

test('add validates drafts, writes atomically, and is reviewable immediately', async () => {
  const {root, engine} = await setup();
  const result = await engine.request(sid, {action: 'add', cards: [draft]});
  assert.equal(result.added.length, 1);
  assert.equal(result.updated.length, 0);
  assert.equal(result.totalCards, 7);
  const written = C.parse(await readFile(join(root, 'cards.tsv'), 'utf8'));
  assert.equal(written.length, 7);
  assert.equal(written.at(-1).Answer, 'A');
  assert.equal(written.at(-1).Source, 'textbooks/example.md > 1.2');
  // A brand-new card has no progress, so it is due on the very next round.
  const view = await engine.request(sid, {action: 'start'});
  assert.equal(view.total, 5);
  assert.ok(view.card, 'a new card is immediately reviewable');
});

test('re-authoring the same question updates it instead of creating a near-duplicate', async () => {
  const {root, engine} = await setup();
  const first = (await engine.request(sid, {action: 'add', cards: [draft]})).added[0].id;
  const again = await engine.request(sid, {action: 'add', cards: [Object.assign({}, draft, {D: '块（block）'})]});
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.updated, [{id: first, question: draft.question}]);
  assert.equal(again.totalCards, 7, 'no near-duplicate row');
  const written = C.parse(await readFile(join(root, 'cards.tsv'), 'utf8'));
  assert.equal(written.filter(card => card.ID === first).length, 1);
  assert.equal(written.find(card => card.ID === first).D, '块（block）');
});

test('add rejects malformed or over-limit input without touching the deck', async () => {
  const {root, engine} = await setup();
  const before = await readFile(join(root, 'cards.tsv'), 'utf8');
  // An empty list is a no-op, not a corruption: nothing is written.
  assert.deepEqual(await engine.request(sid, {action: 'add', cards: []}), {added: [], updated: [], totalCards: 6, masteredCards: 0});
  for (const bad of [
    ['missing source', [Object.assign({}, draft, {source: ''})]],
    ['duplicate options', [Object.assign({}, draft, {C: '位'})]],
    ['bad answer', [Object.assign({}, draft, {answer: 'E'})]],
    ['not an object', [draft.Question]],
    ['missing question', [Object.assign({}, draft, {question: '   '})]],
    ['over the lesson limit', [draft, Object.assign({}, draft, {question: '第二题？'}), Object.assign({}, draft, {question: '第三题？'}), Object.assign({}, draft, {question: '第四题？'})]],
  ]) await assert.rejects(engine.request(sid, {action: 'add', cards: bad[1]}), undefined, bad[0]);
  assert.equal(await readFile(join(root, 'cards.tsv'), 'utf8'), before, 'a rejected add must not partially write');
});

test('add refuses an ID already held in the mastered archive', async () => {
  const {root} = await setup();
  const engine = await seed(root, sid, {'test-1': {stage: 4, due: 0}});
  await engine.request(sid, {action: 'archive'});
  const archivedId = C.parseMastered(await readFile(join(root, 'mastered.tsv'), 'utf8'))[0].ID;
  // Re-authoring a mastered card would collide with its archive row on restore.
  await assert.rejects(engine.request(sid, {action: 'add', cards: [{...draft, ID: archivedId}]}), /已掌握归档/);
  assert.equal(engine.cards.some(card => card.ID === archivedId), false);
});

test('a card created at 下课 is archivable once it matures', async () => {
  const {root, engine} = await setup([cards[0]]);
  const id = (await engine.request(sid, {action: 'add', cards: [draft]})).added[0].id;
  const state = await engine.load(sid);
  state.round = round([engine.cards.find(card => card.ID === id)], 0);
  await engine.commit(state);
  const view = await engine.request(sid, {action: 'status'});
  assert.equal(view.card.id, id, 'the newly authored card is the one under review');
  let next = await act(engine, sid, view, 'choose', {choice: 'A'});
  await act(engine, sid, next, 'pass');
  assert.equal((await engine.load(sid)).progress[id].stage, 1);
  const matured = await engine.load(sid);
  matured.progress[id] = {stage: 4, due: 0};
  matured.round = round([engine.cards.find(card => card.ID === id)], 1);
  await engine.commit(matured);
  assert.deepEqual((await engine.request(sid, {action: 'archive'})).archived.map(card => card.id), [id]);
  assert.equal(engine.cards.some(card => card.ID === id), false);
});
