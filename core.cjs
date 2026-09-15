// Self-contained Anki TSV interchange logic for project-local flashcards.
'use strict';
const fields = ['ID','Question','A','B','C','D','Answer','Hint','Source','Explanation','Tags'];
const letters = ['A','B','C','D'];
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
function schedule(old, passed, now) { const stage = passed ? Math.min((old?.stage || 0) + 1, 4) : 0; return {stage, due: now + [1,3,7,14,30][stage] * 86400000}; }
module.exports = {fields, letters, rows, parse, validate, exportTSV, exportBasic, merge, schedule};
