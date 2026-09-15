import {readFile, rename, mkdir, lstat, open} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import C from './core.cjs';

export const DATA_DIRECTORY = 'flashcards';
export function sidCheck(sid) {
  if (typeof sid !== 'string' || !/^session-[A-Za-z0-9-]{1,160}$/.test(sid)) throw Error('无效会话 ID');
  return sid;
}
const clone = value => JSON.parse(JSON.stringify(value));
const blank = sid => ({version: 2, sessionId: sid, revision: 0, visible: false, progress: Object.create(null), round: null});
function progress(raw) {
  const result = Object.create(null);
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || !Number.isInteger(item.stage) || item.stage < 0 || item.stage > 4 || !Number.isFinite(item.due)) throw Error('进度文件损坏，未覆盖');
    Object.defineProperty(result, item.id, {value: {stage: item.stage, due: item.due}, enumerable: true, writable: true, configurable: true});
  }
  return result;
}
function validateState(data, sid) {
  if (data?.version !== 2 || data.sessionId !== sid || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.visible !== 'boolean' || !data.progress || typeof data.progress !== 'object') throw Error('会话状态损坏，未覆盖');
  data.progress = progress(Object.entries(data.progress).map(([id, value]) => ({id, ...value})));
  if (data.round) {
    const round = data.round;
    if (!Array.isArray(round.cards) || round.cards.length > 5 || !Number.isInteger(round.index) || round.index < 0 || round.index > round.cards.length || typeof round.id !== 'string' || typeof round.practice !== 'boolean' || typeof round.correct !== 'boolean' || typeof round.failed !== 'boolean' || typeof round.feedback !== 'string' || !Array.isArray(round.tried) || round.tried.some(value => !C.letters.includes(value)) || !Array.isArray(round.results) || round.results.length !== round.index || round.results.some(value => typeof value.id !== 'string' || typeof value.question !== 'string' || typeof value.passed !== 'boolean')) throw Error('复习轮次损坏，未覆盖');
    if (!['hint','wrong','correct'].includes(round.feedbackKind) || new Set(round.tried).size !== round.tried.length) throw Error('反馈状态损坏');
    round.cards = C.validate(round.cards);
    const card = round.cards[round.index];
    if (card && round.correct !== (round.tried.at(-1) === card.Answer)) throw Error('答案状态损坏');
    if (!card && (round.correct || round.tried.length)) throw Error('完成状态损坏');
  }
  return data;
}
export class ReviewEngine {
  constructor(root) {
    if (typeof root !== 'string' || !root) throw Error('需要项目闪卡目录');
    this.root = resolve(root);
    this.cache = new Map();
    this.tail = Promise.resolve();
  }
  async init() {
    await mkdir(this.root, {recursive: true});
    if ((await lstat(this.root)).isSymbolicLink()) throw Error('数据目录不可为符号链接');
    const local = await this.read('cards.tsv');
    const text = local ?? await readFile(new URL('./starter.tsv', import.meta.url), 'utf8');
    this.cards = C.parse(text);
    if (local === null) await this.atomic('cards.tsv', C.exportTSV(this.cards));
    return this;
  }
  async read(name) {
    const path = join(this.root, name);
    try {
      if ((await lstat(path)).isSymbolicLink()) throw Error('数据文件不可为符号链接');
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async atomic(name, text) {
    const path = join(this.root, name);
    try { if ((await lstat(path)).isSymbolicLink()) throw Error('拒绝覆盖符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = join(this.root, '.' + name + '.' + randomUUID() + '.tmp');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  }
  run(operation) { const task = this.tail.then(operation); this.tail = task.catch(() => {}); return task; }
  async load(sid) {
    sidCheck(sid);
    if (this.cache.has(sid)) return this.cache.get(sid);
    const raw = await this.read('dsh-state.' + sid + '.json');
    const state = raw ? validateState(JSON.parse(raw), sid) : blank(sid);
    this.cache.set(sid, state);
    return state;
  }
  async commit(state) { await this.atomic('dsh-state.' + state.sessionId + '.json', JSON.stringify(state)); this.cache.set(state.sessionId, state); }
  view(state) {
    const round = state.round;
    const card = round?.cards[round.index];
    return {sessionId: state.sessionId, revision: state.revision, totalCards: this.cards.length, due: this.cards.filter(item => !state.progress[item.ID] || state.progress[item.ID].due <= Date.now()).length, open: state.visible, done: !!round && round.index === round.cards.length, practice: round?.practice || false, index: round?.index || 0, total: round?.cards.length || 0, roundId: round?.id || null, card: card ? {id: card.ID, question: card.Question, source: card.Source, options: C.letters.map(key => ({key, text: card[key]}))} : null, tried: round ? [...round.tried] : [], correct: round?.correct || false, feedback: round?.feedback || '', feedbackKind: round?.feedbackKind || 'hint', results: round ? round.results.map(item => ({id: item.id, question: item.question, passed: item.passed})) : []};
  }
  async request(sid, action) {
    return this.run(async () => {
      const current = await this.load(sid);
      if (action.action === 'status') return this.view(current);
      if (action.action === 'export') return {text: action.basic ? C.exportBasic(this.cards) : C.exportTSV(this.cards)};
      if (action.expectedRevision !== undefined && action.expectedRevision !== current.revision) throw Error('界面已更新，请重试');
      const state = clone(current);
      state.progress = Object.assign(Object.create(null), state.progress);
      if (action.action === 'start') {
        state.visible = true;
        if (!state.round || state.round.index === state.round.cards.length) {
          const candidates = action.practice === true ? this.cards : this.cards.filter(card => !state.progress[card.ID] || state.progress[card.ID].due <= Date.now());
          state.round = {id: randomUUID(), cards: clone(candidates.slice(0, 5)), index: 0, practice: action.practice === true, correct: false, failed: false, feedback: '', feedbackKind: 'hint', tried: [], results: []};
        }
      } else if (action.action === 'close') state.visible = false;
      else if (action.action === 'import') {
        if (state.visible && state.round && state.round.index < state.round.cards.length) throw Error('请先收起复习再导入');
        const merged = C.merge(this.cards, C.parse(action.text));
        await this.atomic('cards.tsv', C.exportTSV(merged));
        this.cards = merged;
        state.round = null;
        state.visible = false;
      } else {
        const round = state.round;
        const card = round?.cards[round.index];
        if (!card || action.cardId !== card.ID || action.roundId !== round.id) throw Error('卡片或轮次已变化，请重试');
        if (action.action === 'choose') {
          if (round.correct || round.tried.includes(action.choice)) return this.view(current);
          if (!C.letters.includes(action.choice)) throw Error('无效选项');
          round.tried.push(action.choice);
          round.correct = action.choice === card.Answer;
          if (round.correct) { round.feedback = '✓ 回答正确。能解释理由吗？'; round.feedbackKind = 'correct'; }
          else { round.failed = true; round.feedback = '✕ 还不对。' + (card.Hint || '请从教材定义重新检查。'); round.feedbackKind = 'wrong'; }
        } else if (action.action === 'hint') {
          if (!round.correct) { round.failed = true; round.feedback = '提示：' + (card.Hint || '从定义出发，逐一检验选项。'); round.feedbackKind = 'hint'; }
        } else if (action.action === 'pass' || action.action === 'skip') {
          if (action.action === 'pass' && !round.correct) throw Error('请先选对答案');
          const passed = action.action === 'pass' && round.correct && !round.failed;
          if (!round.practice) state.progress[card.ID] = C.schedule(state.progress[card.ID], passed, Date.now());
          round.results.push({id: card.ID, question: card.Question, passed});
          round.index++; round.correct = false; round.failed = false; round.tried = []; round.feedback = ''; round.feedbackKind = 'hint';
        } else throw Error('未知操作');
      }
      state.revision++;
      await this.commit(state);
      return this.view(state);
    });
  }
}
