// Self-contained Anki TSV interchange logic for project-local flashcards.
'use strict';
const {createHash} = require('node:crypto');
const fields = ['ID','Question','A','B','C','D','Answer','Hint','Source','Explanation','Tags'];
const letters = ['A','B','C','D'];
// Review tiers and the mastery tier are the single source of truth for archiving.
const intervals = [1, 3, 7, 14, 30];
const masteredStage = intervals.length - 1;
// A single lesson may contribute at most this many new cards, so the deck grows
// from deliberate per-lesson authoring rather than bulk generation.
const newCardsPerLesson = 3;
// An archived row keeps the eleven card columns, then its own mastery record,
// so the first eleven columns merge straight back into cards.tsv to restore.
const masteredFields = [...fields, 'MasteredAt', 'MasteredStage'];
const masteredHeader = '#separator:Tab\n#html:false\n#tags column:11\n#columns:' + masteredFields.join('\t') + '\n'
  + '#已掌握归档：前 11 列与 cards.tsv 相同，合并回 cards.tsv 即可恢复复习。MasteredAt 为归档时间，MasteredStage 为归档时的掌握等级。\n';
function archiveCards(entries) {
  const cards = entries.map(entry => Object.fromEntries(fields.map(field => [field, entry[field]])));
  validate(cards);
  for (const [index, entry] of entries.entries()) {
    if (typeof entry.MasteredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.MasteredAt) || typeof entry.MasteredStage !== 'string' || !new RegExp('^[0-' + masteredStage + ']$').test(entry.MasteredStage)) throw Error(`归档第 ${index + 1} 条缺少掌握记录`);
  }
  return masteredHeader + encode(entries.map(entry => masteredFields.map(field => entry[field])));
}
function rows(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out = []; let row = []; let cell = ''; let quoted = false; let closed = false;
  const field = () => { row.push(cell); cell = ''; closed = false; };
  const end = () => { field(); if (row.some(value => value !== '')) out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!quoted && !closed && !row.length && !cell && char === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '\t') field();
    else if (char === '\n') end();
    else if (closed) throw Error('引号后只能是分隔符或换行');
    else if (char === '"') { if (cell) throw Error('双引号需要转义'); quoted = true; }
    else cell += char;
  }
  if (quoted) throw Error('引号未闭合');
  if (cell || row.length || closed) end();
  return out;
}
function validate(cards) {
  if (!Array.isArray(cards) || cards.length > 10000) throw Error('卡片数量必须为 0–10000');
  const ids = new Set();
  return cards.map((card, index) => {
    const normalized = {};
    for (const field of fields) {
      if (typeof card[field] !== 'string') throw Error(`第 ${index + 1} 张缺少文本字段 ${field}`);
      normalized[field] = card[field];
    }
    if (!/^[A-Za-z0-9_-]+$/.test(normalized.ID) || ids.has(normalized.ID)) throw Error('ID 无效或重复');
    ids.add(normalized.ID);
    if (['Question','A','B','C','D','Source'].some(field => !normalized[field].trim()) || !letters.includes(normalized.Answer) || new Set(letters.map(field => normalized[field].trim())).size !== 4) throw Error('题目、选项、答案或出处无效');
    return normalized;
  });
}
function parse(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw Error('卡组必须为不超过 5MB 的文本');
  if (/^#html:true\s*$/mi.test(text)) throw Error('不支持 HTML 卡片，请导出纯文本');
  const list = rows(text);
  if (list[0]?.join('\t') === fields.join('\t')) list.shift();
  return validate(list.map((row, index) => {
    if (row.length !== 11) throw Error(`第 ${index + 1} 条需为 11 列选择题 TSV`);
    return Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
  }));
}
const encode = rowsToEncode => rowsToEncode.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join('\t')).join('\n') + (rowsToEncode.length ? '\n' : '');
function exportTSV(cards) { return '#separator:Tab\n#html:false\n#tags column:11\n#columns:' + fields.join('\t') + '\n' + encode(validate(cards).map(card => fields.map(field => card[field]))); }
function exportBasic(cards) { return '#separator:Tab\n#html:false\n#tags column:3\n#columns:Front\tBack\tTags\n' + encode(validate(cards).map(card => ['[' + card.ID + '] ' + card.Question + '\n' + letters.map(key => key + '. ' + card[key]).join('\n'), card.Answer + '. ' + card[card.Answer] + '\n' + card.Explanation + '\n出处：' + card.Source, card.Tags])); }
function merge(oldCards, incoming) { const byId = new Map(oldCards.map(card => [card.ID, card])); incoming.forEach(card => byId.set(card.ID, card)); return validate([...byId.values()]); }
function schedule(old, passed, now) { const stage = passed ? Math.min((old?.stage || 0) + 1, masteredStage) : 0; return {stage, due: now + intervals[stage] * 86400000}; }
function parseMastered(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw Error('归档必须为不超过 5MB 的文本');
  if (/^#html:true\s*$/mi.test(text)) throw Error('不支持 HTML 卡片，请导出纯文本');
  const list = rows(text);
  if (list[0]?.join('\t') === masteredFields.join('\t')) list.shift();
  const entries = list.map((row, index) => {
    if (row.length !== masteredFields.length) throw Error(`归档第 ${index + 1} 条需为 ${masteredFields.length} 列`);
    return Object.fromEntries(masteredFields.map((field, fieldIndex) => [field, row[fieldIndex]]));
  });
  archiveCards(entries);
  return entries;
}
// A lesson-authored card arrives as loose prose, not as a typed TSV row, so
// normalize and validate it here instead of making the model build TSV by hand.
// The ID is derived from the question text, so re-authoring the same question
// updates that card through merge() rather than creating a near-duplicate.
function draftCard(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`第 ${index + 1} 张卡片必须是对象`);
  const pick = (...names) => {
    for (const name of names) if (typeof input[name] === 'string' && input[name].trim()) return input[name].trim();
    return '';
  };
  const question = pick('Question', 'question');
  const options = {A: pick('A', 'a'), B: pick('B', 'b'), C: pick('C', 'c'), D: pick('D', 'd')};
  const answer = pick('Answer', 'answer').toUpperCase();
  const source = pick('Source', 'source');
  if (!question) throw Error(`第 ${index + 1} 张缺题干`);
  if (Object.values(options).some(value => !value)) throw Error(`第 ${index + 1} 张需要 A–D 四个选项`);
  if (new Set(Object.values(options)).size !== 4) throw Error(`第 ${index + 1} 张的四个选项不能重复`);
  if (!letters.includes(answer)) throw Error(`第 ${index + 1} 张的 Answer 必须是 A/B/C/D`);
  if (!source) throw Error(`第 ${index + 1} 张缺出处（Source），必须锚定 textbooks/`);
  const id = typeof input.ID === 'string' && /^[A-Za-z0-9_-]+$/.test(input.ID) ? input.ID : 'q' + createHash('sha256').update(question).digest('hex').slice(0, 12);
  return {ID: id, Question: question, A: options.A, B: options.B, C: options.C, D: options.D, Answer: answer, Hint: pick('Hint', 'hint'), Source: source, Explanation: pick('Explanation', 'explanation'), Tags: pick('Tags', 'tags')};
}
function draftCards(list) {
  if (!Array.isArray(list)) throw Error('cards 必须是数组');
  if (list.length > newCardsPerLesson) throw Error(`每节课最多新增 ${newCardsPerLesson} 张卡片`);
  return validate(list.map(draftCard));
}
module.exports = {fields, letters, intervals, masteredStage, masteredFields, newCardsPerLesson, rows, parse, validate, exportTSV, exportBasic, exportMastered: archiveCards, parseMastered, draftCard, draftCards, merge, schedule};
