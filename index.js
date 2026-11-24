import { createHostAdapter, hostServices } from './compat/dsh.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  InputError, buildTurn, cardGreeting, cardList, deleteCard, exportCard, getCard, importCard,
  defaultCard, inheritSession, lockDefaultCard, newState, normalizeTerm, saveCard,
  sessionCard, setDefaultCard, settings,
} from './core.js';
import { openGlossary } from './glossary.js';
import { previewLevels, previewTone } from './tone-preview.js';

export const name = 'quyubagu';
export const inject = hostServices;
const api = '/api/quyubagu';
const maxBody = 8 * 1024 * 1024;
function respond(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function bodyOf(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new InputError('需要 JSON 请求');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBody) throw new InputError('文件过大，最大 8 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('JSON 格式不正确'); }
}

export function apply(ctx) {
  const host = createHostAdapter(ctx);
  const folder = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'quyubagu');
  const stateFile = join(folder, 'state.json');
  mkdirSync(folder, { recursive: true });
  const glossary = openGlossary(process.env.DSH_QUYUBAGU_MEME_DB || join(folder, 'memes.db'), error => {
    ctx.logger.warn('角色扮演无法读取社区词库：' + String(error));
  });
  ctx.effect(() => () => glossary.close(), '角色扮演社区词库');
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : newState();
  if (state.version !== 1) throw new Error('角色扮演数据版本不支持');
  const turns = new Map();
  const incoming = new Map();
  const forkContext = new AsyncLocalStorage();

  function change(update) {
    const next = structuredClone(state);
    const result = update(next);
    const temporary = join(folder, '.' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify(next), { flag: 'wx' });
      renameSync(temporary, stateFile);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    state = next;
    return result;
  }

  function ensure(session) {
    if (Object.hasOwn(state.sessions, session.id)) return state.sessions[session.id];
    return change(next => {
      const fork = host.sessionMetadata(session).isSeeded && forkContext.getStore();
      if (fork?.active && !fork.childId) {
        fork.childId = session.id;
        next.sessions[session.id] = structuredClone(fork.binding);
        return next.sessions[session.id];
      }
      if (inheritSession(next, session.id, host.sessionMetadata(session).parentSession)) return next.sessions[session.id];
      next.sessions[session.id] = { cardId: null, revision: null, greetingIndex: 0, settings: { ...next.defaults } };
      return next.sessions[session.id];
    });
  }

  function bindingForTurn(session) {
    const binding = ensure(session);
    return binding.useDefaultCard ? change(next => lockDefaultCard(next, session.id)) : binding;
  }

  function prepareBlank(session) {
    const binding = ensure(session);
    const needsCard = !binding.revision && !binding.useDefaultCard;
    const newSettings = Object.keys(state.defaults).some(key => state.defaults[key] !== binding.settings[key]);
    if (!needsCard && !newSettings) return binding;
    return change(next => {
      const pending = next.sessions[session.id];
      if (needsCard) pending.useDefaultCard = true;
      pending.settings = { ...next.defaults };
      return pending;
    });
  }

  async function openWithGreeting(session) {
    if (host.isStarted(session) || host.sessionMetadata(session).isSeeded || host.sessionMetadata(session).parentSession) return;
    const binding = prepareBlank(session);
    const card = binding.useDefaultCard ? defaultCard(state) : sessionCard(state, binding);
    const greetingIndex = binding.useDefaultCard ? card?.scene.greetingIndex ?? 0 : binding.greetingIndex;
    const text = cardGreeting(card, greetingIndex);
    if (!text) return;

    await host.writeGreeting(session, text, () => bindingForTurn(session));
  }

  // Card bindings belong to the plugin; host controller wrapping belongs to the adapter.
  host.wrapController({
    created: openWithGreeting,
    fork: async (request, run) => {
      if (!request || !Object.hasOwn(state.sessions, request.sessionId)) return run(request);
      const binding = structuredClone(state.sessions[request.sessionId]);
      delete binding.useDefaultCard;
      const fork = { active: true, binding };
      return forkContext.run(fork, async () => {
        try {
          const result = await run(request);
          if (result.sessionId && fork.childId !== result.sessionId) {
            change(next => next.sessions[result.sessionId] = fork.binding);
          }
          return result;
        } finally {
          fork.active = false;
        }
      });
    },
  });
  host.onSessionCreated(session => {
    if (session?.id) ensure(session);
  });
  host.onSessionEvent((session, event) => {
    if (event.type === 'turn/start') turns.set(session.id, { turn: event.data.turn, ...bindingForTurn(session) });
    if (event.type === 'turn/end') {
      turns.delete(session.id);
      incoming.delete(session.id);
    }
  });
  // Claimed messages are available before DSH assembles the request, unlike pre-step.
  host.onUserMessage(({ agent, text, turn }) => {
    if (turns.get(agent.id)?.turn !== turn) turns.set(agent.id, { ...bindingForTurn(agent.session), turn });
    incoming.set(agent.id, text);
  });

  host.registerPrompt({
    name: 'quyubagu:current-turn',
    order: 940,
    interpolate: false,
    required: true,
    text: ({ agent }) => {
      if (!agent?.session) return '';
      const binding = turns.get(agent.id) ?? bindingForTurn(agent.session);
      const previous = turns.get(agent.id);
      const result = previous?.prepared ?? buildTurn(sessionCard(state, binding), binding, binding.settings,
        incoming.get(agent.id) || host.lastUserText(agent.session), [], {
          greetingInHistory: host.hasGreeting(agent.session),
          prefetch: text => glossary.prefetch(Object.values(state.terms), text),
        });
      if (previous) previous.prepared = result;
      return result.text;
    },
  });

  function lookupEnabled(context) {
    const id = context?.agent?.id ?? context?.session?.id ?? context?.sessionId;
    return Boolean(id && (turns.get(id) ?? state.sessions[id])?.settings.memes);
  }

  host.registerTool({
    name: 'quyubagu_lookup_meme',
    description: '在本地自定义及社区词库中查询网络梗、缩写和黑话。查不到时说明本地词库未收录。',
    parameters: { query: { type: 'string', required: true, description: '梗名' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async ({ query }) => {
      if (typeof query !== 'string') return '请输入梗名。';
      const term = glossary.search(Object.values(state.terms), query);
      return term ? JSON.stringify(term) : '本地词库没有找到这个梗。';
    },
  }, lookupEnabled);

  host.registerRoute({
    kind: 'prefix',
    path: api,
    handler: async (req, res) => {
      if (req.headers['x-quyubagu'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
        return respond(res, 403, { error: '仅限 DSH 插件页面访问' });
      }
      // Apply DSH's authenticated connection boundary to this plugin-owned HTTP route.
      const rejection = host.requestRejection(req);
      if (rejection) return respond(res, rejection, { error: '请在已连接的 DSH 中打开插件' });
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname.slice(api.length);
        if (req.method === 'GET' && path === '/library') {
          return respond(res, 200, {
            cards: cardList(state).map(card => ({
              id: card.id, name: card.name, avatar: card.avatar, roleplay: card.roleplay,
              builtIn: card.builtIn, revision: state.cards[card.id]?.revision,
            })),
            defaults: state.defaults,
            defaultCardId: defaultCard(state)?.id ?? null,
          });
        }
        if (req.method === 'GET' && path === '/terms') {
          const input = (url.searchParams.get('q') || '').trim().slice(0, 1000);
          const query = input.toLocaleLowerCase();
          const all = Object.entries(state.terms);
          const filtered = query ? all.filter(([, term]) => [term.name, ...term.aliases, term.definition]
            .some(value => value.toLocaleLowerCase().includes(query))) : all;
          return respond(res, 200, {
            total: all.length, matched: filtered.length,
            items: filtered.slice(0, 100).map(([id, term]) => ({ id, ...term })),
            community: glossary.info(),
            found: input ? glossary.search(Object.values(state.terms), input) : null,
          });
        }
        if (req.method === 'GET' && path === '/card') {
          const id = url.searchParams.get('id');
          const card = getCard(state, id);
          if (!card) throw new InputError('找不到这张人设卡');
          return respond(res, 200, { ...exportCard(card), id, builtIn: card.builtIn, revision: state.cards[id]?.revision });
        }
        if (req.method !== 'POST') return respond(res, 404, { error: '找不到这个操作' });
        const body = await bodyOf(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求格式不正确');
        if (path === '/tone/preview') {
          if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 12000) throw new InputError('请输入 1–12000 字的原文');
          if (!previewLevels.includes(body.strength)) throw new InputError('无效的文本试改档位');
          if (!Number.isSafeInteger(body.seed)) throw new InputError('随机种子须为整数');
          return respond(res, 200, { text: previewTone(body.text, { strength: body.strength, seed: body.seed, grammar: body.grammar !== false }) });
        }
        if (path === '/card/validate') return respond(res, 200, importCard(body.file));
        if (path === '/card/save') return respond(res, 200, change(next => saveCard(next, body.card, body.id, body.revision)));
        if (path === '/card/delete') {
          change(next => deleteCard(next, body.id, body.revision));
          return respond(res, 200, { ok: true });
        }
        if (path === '/card/default') {
          change(next => setDefaultCard(next, body.cardId));
          return respond(res, 200, { defaultCardId: state.defaultCardId });
        }
        if (path === '/defaults') return respond(res, 200, change(next => next.defaults = settings(body, next.defaults)));
        if (path === '/term/save' || path === '/term/import') {
          const terms = path === '/term/save' ? [body.term] : body.terms;
          if (!Array.isArray(terms) || terms.length > 10_000) throw new InputError('词库须为 JSON 数组，最多一次导入 10,000 条');
          const normalized = terms.map(normalizeTerm);
          const count = change(next => {
            const names = new Map(Object.entries(next.terms).map(([id, term]) => [term.name.toLocaleLowerCase(), id]));
            if (body.id && path === '/term/save') {
              if (!Object.hasOwn(next.terms, body.id)) throw new InputError('词条已删除');
              names.delete(next.terms[body.id].name.toLocaleLowerCase());
            }
            let saved = 0;
            for (const term of normalized) {
              const name = term.name.toLocaleLowerCase();
              if (names.has(name)) {
                if (path === '/term/save') throw new InputError('已经有同名词条');
                continue;
              }
              const id = path === '/term/save' && body.id ? body.id : randomUUID();
              next.terms[id] = term;
              names.set(name, id);
              saved++;
            }
            return saved;
          });
          return respond(res, 200, { saved: count, skipped: normalized.length - count });
        }
        if (path === '/term/delete') {
          change(next => {
            if (!Object.hasOwn(next.terms, body.id)) throw new InputError('词条已删除');
            delete next.terms[body.id];
          });
          return respond(res, 200, { ok: true });
        }
        return respond(res, 404, { error: '找不到这个操作' });
      } catch (error) {
        if (error instanceof InputError) return respond(res, 400, { error: error.message });
        ctx.logger.error('角色扮演操作失败：' + String(error));
        return respond(res, 500, { error: '插件操作失败，请查看 DSH 日志' });
      }
    },
  });
}
