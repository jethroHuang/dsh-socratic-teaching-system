import {join, resolve, isAbsolute} from 'node:path';
import {ReviewEngine, DATA_DIRECTORY} from './engine.js';
import {initializeProject} from './project.js';
export const name = 'dsh-socratic-teaching-system';
export const inject = ['webServer', 'agents', 'tools', 'sessions'];
export const ENDPOINT = '/api/socratic-teaching/review';
export function sameOrigin(req) { const host = req.headers.host, origin = req.headers.origin; if (typeof host !== 'string' || typeof origin !== 'string') return false; try { const url = new URL(origin); return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin'); } catch { return false; } }
export async function readJSON(req) { if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw Error('Content-Type must be application/json'); let size = 0; const parts = []; for await (const part of req) { size += part.length; if (size > 6 * 1024 * 1024) throw Error('Request too large'); parts.push(part); } return JSON.parse(Buffer.concat(parts).toString('utf8')); }
export async function apply(ctx) {
  const engines = new Map();
  const definitions = new Set();
  const workspaceFor = agent => {
    const session = ctx.sessions.get(agent.id);
    if (!session || ctx.agents.get(agent.id) !== agent) throw Error('会话已失效');
    const cwd = session.header.cwd;
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw Error('本会话没有有效项目目录');
    return resolve(cwd);
  };
  const getEngine = agent => {
    const cwd = workspaceFor(agent);
    let pending = engines.get(cwd);
    if (!pending) {
      pending = new ReviewEngine(join(cwd, DATA_DIRECTORY)).init().catch(error => { engines.delete(cwd); throw error; });
      engines.set(cwd, pending);
    }
    return pending;
  };
  const enabled = agent => !!agent && definitions.has(ctx.tools.get('socratic_review', agent));
  const requireEnabled = agent => { if (!enabled(agent)) throw Error('此会话未启用 dsh-苏格拉底教学系统'); };
  const service = {
    enroll(definition) { definitions.add(definition); return () => definitions.delete(definition); },
    async initialize(agent) { requireEnabled(agent); return initializeProject(workspaceFor(agent)); },
    async request(agent, args) { requireEnabled(agent); return (await getEngine(agent)).request(agent.id, args); }
  };
  ctx.provide('socraticTeaching', service);
  ctx.webServer.register({kind: 'exact', path: ENDPOINT, async handler(req, res) {
    const send = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(JSON.stringify(data)); };
    if (req.method !== 'POST') { send(405, {error: 'POST required'}); return; }
    if (!sameOrigin(req)) { send(403, {error: 'Same-origin request required'}); return; }
    let enrolled = false;
    try {
      const action = await readJSON(req);
      const agent = typeof action?.sessionId === 'string' ? ctx.agents.get(action.sessionId) : undefined;
      if (!enabled(agent)) { send(200, {enabled: false}); return; }
      enrolled = true;
      if (!['status','start','close','choose','hint','pass','skip','export','import','archive','restore','add'].includes(action.action)) throw Error('未知操作');
      if (!['status','export','archive','restore','add'].includes(action.action) && !Number.isSafeInteger(action.expectedRevision)) throw Error('Mutation requires expectedRevision');
      const data = await service.request(agent, action);
      send(200, {enabled: true, ...data});
    } catch (error) { send(400, {enabled: enrolled, error: error.message || 'Review request failed'}); }
  }});
}
