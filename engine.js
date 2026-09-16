import {readFile, rename, mkdir, lstat, open, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import C from './core.cjs';

export const DATA_DIRECTORY = 'flashcards';
export function sidCheck(sid) {
  if (typeof sid !== 'string' || !/^session-[A-Za-z0-9-]{1,160}$/.test(sid)) throw Error('无效会话 ID');
  return sid;
}
export const MASTERED_FILE = 'mastered.tsv';
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
    this.mastered = await this.readMastered();
    return this;
  }
  async readMastered() {
    const raw = await this.read(MASTERED_FILE);
    return raw === null ? [] : C.parseMastered(raw);
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
  async scanMastery() {
    const best = new Map(), inFlight = new Set(), states = [], skipped = [];
    for (const name of await readdir(this.root)) {
      const match = /^dsh-state\.(session-[A-Za-z0-9-]{1,160})\.json$/.exec(name);
      if (!match) continue;
      let state;
      try { state = await this.load(match[1]); }
      catch { skipped.push(match[1]); continue; }
      states.push(state);
      const round = state.round;
      // Only cards the round has not reached yet must stay: a card the student
      // already answered is fully recorded in `results`, so archiving it cannot
      // disturb the round. Position is round-local (cards are cloned at start).
      if (round && round.index < round.cards.length) for (const card of round.cards.slice(round.index)) inFlight.add(card.ID);
      for (const [id, entry] of Object.entries(state.progress)) best.set(id, Math.max(best.get(id) ?? -1, entry.stage));
    }
    return {best, inFlight, states, skipped};
  }
  async archive() {
    const {best, inFlight, states, skipped} = await this.scanMastery();
    const mastered = this.cards.filter(card => (best.get(card.ID) ?? -1) >= C.masteredStage && !inFlight.has(card.ID));
    if (!mastered.length) return {archived: [], remaining: this.cards.length, masteredTotal: this.mastered.length, skippedSessions: skipped};
    const at = new Date().toISOString();
    const moving = mastered.map(card => Object.assign({}, card, {MasteredAt: at, MasteredStage: String(best.get(card.ID))}));
    const byId = new Map(this.mastered.map(entry => [entry.ID, entry]));
    for (const entry of moving) byId.set(entry.ID, entry);
    const archived = C.validate([...byId.values()].map(entry => Object.fromEntries(C.fields.map(field => [field, entry[field]]))));
    const kept = archived.map(entry => byId.get(entry.ID));
    // Write the archive first: a duplicate across both files can be re-archived,
    // whereas dropping a card from cards.tsv before it is archived would lose it.
    await this.atomic(MASTERED_FILE, C.exportMastered(kept));
    this.mastered = kept;
    const ids = new Set(mastered.map(card => card.ID));
    this.cards = this.cards.filter(card => !ids.has(card.ID));
    await this.atomic('cards.tsv', C.exportTSV(this.cards));
    // Progress rows for cards no longer in the deck are inert but would make a
    // restored card look mastered again, so clear them in every session state.
    for (const state of states) {
      if (!Object.keys(state.progress).some(id => ids.has(id))) continue;
      for (const id of ids) delete state.progress[id];
      await this.commit(state);
    }
    return {archived: moving.map(card => ({id: card.ID, question: card.Question, tags: card.Tags, masteredStage: card.MasteredStage})), remaining: this.cards.length, masteredTotal: this.mastered.length, skippedSessions: skipped};
  }
  async add(list) {
    const drafted = C.draftCards(list);
    const byId = new Map(this.cards.map(card => [card.ID, card]));
    const added = [], updated = [];
    for (const card of drafted) (byId.has(card.ID) ? updated : added).push(card);
    // Archiving keeps an ID in mastered.tsv; letting it also live in cards.tsv
    // would let a restored duplicate overwrite the archived row.
    const archivedIds = new Set(this.mastered.map(entry => entry.ID));
    const conflict = drafted.filter(card => archivedIds.has(card.ID));
    if (conflict.length) throw Error('以下卡片已存在于已掌握归档，请先 restore 或换一个题干：' + conflict.map(card => card.ID).join('、'));
    const merged = C.merge(this.cards, drafted);
    await this.atomic('cards.tsv', C.exportTSV(merged));
    this.cards = merged;
    return {added: added.map(card => ({id: card.ID, question: card.Question})), updated: updated.map(card => ({id: card.ID, question: card.Question})), totalCards: this.cards.length, masteredCards: this.mastered.length};
  }
  async restore() {
    if (!this.mastered.length) return {restored: [], remaining: this.cards.length, masteredTotal: 0};
    const merged = C.merge(this.cards, this.mastered.map(entry => Object.fromEntries(C.fields.map(field => [field, entry[field]]))));
    await this.atomic('cards.tsv', C.exportTSV(merged));
    this.cards = merged;
    const restored = this.mastered.map(entry => entry.ID);
    this.mastered = [];
    await this.atomic(MASTERED_FILE, C.exportMastered([]));
    return {restored, remaining: this.cards.length, masteredTotal: 0};
  }
  view(state) {
    const round = state.round;
    const card = round?.cards[round.index];
    return {sessionId: state.sessionId, revision: state.revision, totalCards: this.cards.length, masteredCards: this.mastered.length, due: this.cards.filter(item => !state.progress[item.ID] || state.progress[item.ID].due <= Date.now()).length, open: state.visible, done: !!round && round.index === round.cards.length, practice: round?.practice || false, index: round?.index || 0, total: round?.cards.length || 0, roundId: round?.id || null, card: card ? {id: card.ID, question: card.Question, source: card.Source, options: C.letters.map(key => ({key, text: card[key]}))} : null, tried: round ? [...round.tried] : [], correct: round?.correct || false, feedback: round?.feedback || '', feedbackKind: round?.feedbackKind || 'hint', results: round ? round.results.map(item => ({id: item.id, question: item.question, passed: item.passed})) : []};
  }
  async request(sid, action) {
    if (action.action === 'archive' || action.action === 'restore') return this.run(async () => { await this.load(sid); return action.action === 'archive' ? this.archive() : this.restore(); });
    if (action.action === 'add') return this.run(async () => { await this.load(sid); return this.add(action.cards); });
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
