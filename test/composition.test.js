import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Context} from '@deepseek-ai/cordis';
import * as consumer from '../tool.js';

test('real Cordis preset consumer enrolls exact tool and unloads effects', async () => {
  const ctx = new Context(), definitions = new Map(), enrolled = new Set(); let text = '';
  ctx.provide('tools', {register(definition) { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); }});
  ctx.provide('systemPrompt', {context(definition) { text = definition.text; return () => { text = ''; }; }});
  ctx.provide('socraticTeaching', {enroll(definition) { enrolled.add(definition); return () => enrolled.delete(definition); }, request(agent, args) { return Promise.resolve({sessionId: agent.id, action: args.action}); }, initialize(agent) { return Promise.resolve({initialized: true, projectRoot: '/course', changed: true, created: [], existing: [], sessionId: agent.id}); }});
  const fiber = ctx.plugin(consumer);
  await fiber;
  const definition = definitions.get('socratic_review');
  const project = definitions.get('socratic_project');
  assert.ok(definition);
  assert.ok(project);
  assert.ok(enrolled.has(definition));
  assert.ok(text.includes('第一次处理当前工作目录'));
  assert.deepEqual(await definition.execute({action: 'status'}, {agent: {id: 'session-a'}}), {sessionId: 'session-a', action: 'status'});
  assert.equal((await project.execute({action: 'initialize'}, {agent: {id: 'session-a'}})).initialized, true);
  await fiber.dispose();
  assert.equal(enrolled.size, 0);
});

test('browser artifact follows real ModuleLoader protocol and owns UI slot', async () => {
  let definition; const styles = [];
  const script = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const React = {createElement() {}, useState() {}, useEffect() {}};
  vm.runInNewContext(script, {window: {__ModuleLoader__: {load(value) { assert.equal(value.id, 'dsh-socratic-teaching-system'); definition = value.factory(name => { assert.equal(name, 'react'); return React; }); }}}, document: {createElement() { return {remove() {}, textContent: ''}; }, head: {append(style) { styles.push(style); }}}});
  assert.deepEqual(Array.from(definition.inject), ['slots']);
  const cleanup = []; let options;
  definition.apply({effect(operation) { cleanup.push(operation()); }, slots: {inject(name, operation) { assert.equal(name, 'conversation.input.dock'); operation(); }, register(value) { options = value; }}});
  assert.equal(options.id, 'socratic-review-durable');
  assert.ok(styles[0].textContent.includes('min-height:56px'));
  assert.ok(styles[0].textContent.includes('max-height:min(68dvh,720px)'));
  assert.ok(styles[0].textContent.includes('background:white'));
  cleanup.forEach(operation => operation());
});

test('every card action is reachable through each layer that gates it', async () => {
  // The tool schema, host whitelist and client panel must agree on the actions.
  const tool = await readFile(new URL('../tool.js', import.meta.url), 'utf8');
  const host = await readFile(new URL('../host.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(tool, /enum: \['start', 'status', 'add', 'archive', 'restore'\]/);
  assert.match(host, /'archive','restore','add'/);
  assert.match(client, /kind==='archive'\|\|kind==='restore'/);
  assert.match(client, /button\('归档已掌握','archive'\)/);
  assert.match(client, /button\('恢复全部已掌握','restore'\)/);
});
