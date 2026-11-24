import { createRouteAdapter } from './routes.js';
// All host service access and native history writes live here. Business state stays in index/core.
import { symbols } from '@deepseek-ai/cordis';
import { createAssistantMessage, createSystemMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const hostServices = ['agents', 'sessions', 'systemPrompt', 'tools', 'webServer', 'connection'];
export const supportedHosts = ['0.2.2-rc.3', '0.2.3-alpha.2'];
const greetingSource = { provider: 'dsh-quyubagu', model: 'greeting' };

export function isGreetingMessage(event) {
  const source = event.type === 'assistant/message' && event.data.message.source;
  return source?.provider === greetingSource.provider && source?.model === greetingSource.model;
}

function textOf(message) {
  const content = message?.content;
  return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
}

function isUserMessage(message) {
  return message?.role === 'user' && message.source?.kind === 'user';
}

function lastUserText(session) {
  return textOf(session.snapshotEvents().findLast(event => event.type === 'user/message' &&
    isUserMessage(event.data))?.data);
}

export function createHostAdapter(ctx) {
  const routes = createRouteAdapter(ctx.connection, route => ctx.webServer.register(route));
  function isStarted(session) {
    return session.snapshotEvents().some(event => event.type === 'turn/start' || event.type === 'user/message')
      || session.surface.nodes.length > 0;
  }
  const warned = new Set();
  function warn(feature) {
    if (warned.has(feature)) return;
    warned.add(feature);
    ctx.logger.warn(`角色扮演：宿主缺少 ${feature}，对应功能未启用。`);
  }
  return {
    isStarted,
    lastUserText,
    sessionMetadata: session => session.header,
    hasGreeting: session => session.snapshotEvents().some(isGreetingMessage),
    async writeGreeting(session, text, beforeWrite) {
      const agent = ctx.agents.get(session.id);
      if (!agent || agent.phase?.kind !== 'idle') return;
      if (typeof agent.runMaintenance !== 'function') { warn('runMaintenance'); return; }
      await agent.runMaintenance(async () => {
        const phase = agent.phase;
        if (phase.kind !== 'maintenance' || phase.lastTurn !== 0 || isStarted(session)) return;
        beforeWrite();
        const step = { turn: 1, step: 1 };
        const append = { surfaceOp: 'append' };
        session.append('turn/start', { turn: 1 });
        session.append('step/start', step);
        session.append('system/message', { ...step, message: createSystemMessage('') }, append);
        session.append('assistant/message', {
          ...step, message: createAssistantMessage({ content: [{ type: 'text', text }], source: greetingSource }), stream: [],
        }, append);
        session.append('step/end', step);
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
        phase.lastTurn = 1;
      });
    },
    wrapController({ created, fork }) {
      return ctx.inject(['sessionController'], scope => {
        const proxy = scope.get('sessionController');
        const controller = proxy[symbols.original] ?? proxy;
        const create = controller.create;
        const begin = async function (request) {
          const result = await create.call(this, request);
          const session = ctx.sessions.get(result.sessionId);
          if (session) await created(session);
          return result;
        };
        if (typeof create === 'function') controller.create = begin;
        else warn('sessionController.create');
        const originalFork = controller.fork;
        const withBinding = async function (request) {
          return fork(request, input => originalFork.call(this, input));
        };
        if (typeof originalFork === 'function') controller.fork = withBinding;
        else warn('sessionController.fork');
        scope.effect(() => () => {
          if (controller.create === begin) controller.create = create;
          if (controller.fork === withBinding) controller.fork = originalFork;
        }, '角色扮演新会话与会话分支');
      });
    },
    onSessionCreated: handler => ctx.on('session/created', handler),
    onSessionEvent: handler => ctx.on('session/event', handler),
    onUserMessage: handler => ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (isUserMessage(message)) handler({ agent, turn, text: textOf(message) });
    }),
    registerPrompt: definition => ctx.systemPrompt.context(definition),
    registerTool: (definition, when) => ctx.tools.register(defineTool(definition), { when }),
    registerRoute: definition => ctx.effect(() => routes.registerRoute(definition), '角色扮演设置接口'),
    requestRejection: routes.requestRejection,
  };
}
