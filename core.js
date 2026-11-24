import { createHash, randomUUID } from 'node:crypto';
import { starterCards } from './builtin-cards.js';
import { fishTonePrompt } from './vendor/fish-tone/tone.js';

export const defaultSettings = Object.freeze({
  tone: false, imitation: 2, filler: 1, agency: 1, memes: false, autoLookup: true,
});

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const cardSchema = 'dsh-quyubagu/card';
const pngPrefix = 'data:image/png;base64,';

export class InputError extends Error {}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(label + '格式不正确');
  return value;
}

function clean(value, limit, label) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new InputError(label + '应为文字');
  const text = value.trim();
  if (text.length > limit) throw new InputError(label + '超过长度限制');
  return text;
}

function list(value, limit, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) throw new InputError(label + '最多 ' + limit + ' 项');
  return value;
}

function examples(value) {
  return list(value, 20, '示例对话').flatMap((item, i) => {
    record(item, '示例');
    const user = clean(item.user, 1000, '示例输入');
    const assistant = clean(item.assistant, 2000, '示例回复');
    if (!user && !assistant) return [];
    if (!user || !assistant) throw new InputError('第 ' + (i + 1) + ' 组示例的两栏都要填写');
    return [{ user, assistant }];
  });
}

export function normalizeAvatar(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !value.startsWith(pngPrefix) || value.length > 7_000_000) {
    throw new InputError('头像应为裁剪后的 PNG，最大 5 MB');
  }
  const encoded = value.slice(pngPrefix.length);
  const png = Buffer.from(encoded, 'base64');
  if (png.length < 33 || png.length > 5 * 1024 * 1024 || png.toString('base64') !== encoded
    || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || png.toString('ascii', 12, 16) !== 'IHDR'
    || png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) {
    throw new InputError('头像应为 512 × 512 的正方形 PNG');
  }
  return value;
}

function validGreetingIndex(value, count) {
  return Number.isInteger(value) && value >= 0 && value < count ? value : 0;
}

export function normalizeCard(input) {
  record(input, '人设卡');
  const name = clean(input.name, 512, '名称');
  if (!name || [...segmenter.segment(name)].length > 24) throw new InputError('名称须为 1–24 个可见字符');
  const scene = input.scene == null ? {} : record(input.scene, '角色扮演');
  const greetings = list(scene.greetings, 12, '开场白').map(text => clean(text, 4000, '开场白'));
  const preferred = validGreetingIndex(scene.greetingIndex, greetings.length);
  const greetingIndex = greetings[preferred] ? greetings.slice(0, preferred).filter(Boolean).length : 0;
  return {
    name,
    avatar: normalizeAvatar(input.avatar),
    description: clean(input.description, 6000, '人设简介'),
    voice: clean(input.voice, 4000, '性格与口吻'),
    roleplay: input.roleplay === true,
    examples: examples(input.examples),
    scene: {
      description: clean(scene.description, 6000, '场景与关系'),
      rules: clean(scene.rules, 4000, '扮演约定'),
      greetings: greetings.filter(Boolean),
      greetingIndex,
      narration: scene.narration !== false,
      examples: examples(scene.examples),
    },
  };
}

export function exportCard(card) {
  return { schema: cardSchema, version: 1, card: normalizeCard(card) };
}

export function importCard(file) {
  if (file?.schema !== cardSchema || file.version !== 1) throw new InputError('请选择本插件导出的人设卡 JSON（版本 1）');
  return normalizeCard(file.card);
}

export function settings(input = {}, base = defaultSettings) {
  record(input, '选项');
  const result = { ...base };
  for (const key of ['tone', 'memes', 'autoLookup']) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const key of ['imitation', 'filler', 'agency']) {
    if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 3) result[key] = input[key];
  }
  if (typeof input.filler === 'boolean') result.filler = Number(input.filler);
  return result;
}

export function normalizeTerm(input) {
  record(input, '词条');
  const name = clean(input.name, 80, '词名');
  const definition = clean(input.definition, 2000, '释义');
  if (!name || !definition) throw new InputError('词名和释义必填');
  return {
    name, definition,
    aliases: [...new Set(list(input.aliases, 12, '别名').map(value => clean(value, 80, '别名')).filter(Boolean))],
    usage: clean(input.usage, 1200, '用法'),
    source: clean(input.source, 500, '出处'),
  };
}

const builtIns = Object.fromEntries(Object.entries(starterCards).map(
  ([id, card]) => [id, normalizeCard(card)],
));

export function newState() {
  return { version: 1, defaultCardId: null, hiddenBuiltIns: [], defaults: { ...defaultSettings }, cards: {}, revisions: {}, sessions: {}, terms: {} };
}

function storedKey(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,100}$/i.test(value) ? value : '';
}

export function getCard(state, id) {
  if (!storedKey(id)) return null;
  const builtIn = Object.hasOwn(builtIns, id);
  if (builtIn && state.hiddenBuiltIns?.includes(id)) return null;
  const saved = Object.hasOwn(state.cards, id) ? state.cards[id] : null;
  if (saved) return { id, builtIn, ...state.revisions[saved.revision] };
  if (builtIn) {
    const card = builtIns[id];
    const override = state.cardOverrides?.[id];
    return {
      id, builtIn: true, ...card,
      roleplay: override?.roleplay ?? card.roleplay,
      scene: { ...card.scene,
        greetingIndex: validGreetingIndex(override?.greetingIndex ?? card.scene.greetingIndex, card.scene.greetings.length),
      },
    };
  }
  return null;
}

export function cardList(state) {
  const ids = new Set([...Object.keys(builtIns), ...Object.keys(state.cards)]);
  return [...ids].map(id => getCard(state, id)).filter(Boolean);
}

export function deleteCard(state, id, expectedRevision) {
  const card = getCard(state, id);
  if (!card) throw new InputError('找不到这张人设卡');
  if (expectedRevision !== state.cards[id]?.revision) throw new InputError('卡片已更新，请重新打开后再操作');
  if (card.builtIn) {
    state.hiddenBuiltIns ??= [];
    state.hiddenBuiltIns.push(id);
  }
  delete state.cards[id];
  if (state.defaultCardId === id) setDefaultCard(state, null);
}

export function defaultCard(state) {
  return getCard(state, state.defaultCardId);
}

export function setDefaultCard(state, cardId) {
  if (cardId !== null && !getCard(state, cardId)) throw new InputError('找不到这张人设卡');
  state.defaultCardId = cardId;
}

export function saveCard(state, input, id, expectedRevision) {
  const card = normalizeCard(input);
  if (id && !getCard(state, id)) throw new InputError('找不到这张人设卡');
  if (id && expectedRevision !== state.cards[id]?.revision) throw new InputError('这张卡已在别处修改，请重新打开后再保存');
  const cardId = id || randomUUID();
  state.cards[cardId] = { revision: storeRevision(state, card) };
  return { id: cardId, revision: state.cards[cardId].revision };
}

function storeRevision(state, card) {
  const revision = randomUUID();
  state.revisions[revision] = card;
  return revision;
}

export function sessionCard(state, binding) {
  return binding?.revision ? state.revisions[binding.revision] : undefined;
}

export function inheritSession(state, id, parent) {
  if (!id || !parent || Object.hasOwn(state.sessions, id)) return false;
  if (!Object.hasOwn(state.sessions, parent)) return false;
  const previous = state.sessions[parent];
  state.sessions[id] = { ...previous, settings: { ...previous.settings } };
  delete state.sessions[id].useDefaultCard;
  return true;
}

export function assignCard(state, id, cardId, greetingIndex) {
  const card = getCard(state, cardId);
  if (!card) throw new InputError('找不到这张人设卡');
  if (!Number.isInteger(greetingIndex) || greetingIndex < 0 || greetingIndex >= Math.max(1, card.scene.greetings.length)) {
    throw new InputError('请选择有效的开场白');
  }
  let revision;
  if (!state.cards[cardId] || typeof card.scene.narration !== 'boolean') {
    const snapshot = normalizeCard(card);
    revision = 'card-' + createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    state.revisions[revision] ??= snapshot;
  } else {
    revision = state.cards[cardId].revision;
  }
  state.sessions[id] = { cardId, revision, greetingIndex, settings: settings({}, state.sessions[id]?.settings ?? state.defaults) };
  return state.sessions[id];
}

export function lockDefaultCard(state, id) {
  const binding = state.sessions[id];
  if (!binding?.useDefaultCard) return binding;
  const card = defaultCard(state);
  if (card) return assignCard(state, id, card.id, card.scene.greetingIndex ?? 0);
  delete binding.useDefaultCard;
  return binding;
}

export function matchMeme(terms, userText) {
  const text = userText.trim().slice(0, 1000).toLocaleLowerCase();
  if (!text) return null;
  const plain = text.replace(/[\s?？!！。]+$/u, '');
  const asking = /什么梗|什么意思|啥意思|怎么接|怎么用|查个梗|查一下|懂这个梗/.test(text);
  for (const term of terms) {
    if ([term.name, ...term.aliases].some(word => plain === word.toLocaleLowerCase())) return term;
  }
  if (!asking) return null;
  const matches = terms.flatMap(term => [term.name, ...term.aliases]
    .filter(word => word.length >= 2 && text.includes(word.toLocaleLowerCase())).map(word => ({ term, length: word.length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.term ?? null;
}

const naturalChat = fishTonePrompt.replace('拿不准一处该不该留，调 fish_judge 看它在文里干什么活；判断流程在 fish-sense 那节里。', '保留对这句有实际作用的结构。');
const conciseReply = '直接回应当前内容，减少通用安慰、复述和固定总结。用对话中已经明确的细节替代套话，不补写未经确认的数字、经历、行为或原因。缺少细节时可以给条件式建议。';
const agencyRules = [
  '',
  '把玩家的台词和决定留给玩家。',
  '把玩家的台词、决定、内心和关键反应留给玩家。',
  '把玩家的选择和反应留给玩家。角色可以主动行动，把情节推进到玩家可以接下去的位置。',
];
const imitationRules = [
  '',
  '参考示例的语气和句长。',
  '参考示例的句长、用词和人设遇事时的反应方式。',
  '保持示例里的口语习惯、用词和反应方式。示例用来示范表达，请沿当前对话继续。',
];

function rankExamples(items, userText, count) {
  const tokens = [...new Set(userText.slice(0, 300).match(/[\p{L}\p{N}]/gu) ?? [])];
  return items.map(example => ({
    example, score: tokens.filter(token => example.user.includes(token)).length,
  })).sort((a, b) => b.score - a.score).slice(0, count).map(item => item.example);
}

function dialogueOnly(text) {
  const lines = text.trim().split(/\r?\n(?:[ \t]*\r?\n)+/);
  if (!lines.every(line => /^(?:\*[^*]+\*|“[^”]+”)$/u.test(line.trim()))) return '';
  return lines.map(line => line.trim()).filter(line => line.startsWith('“')).join('\n\n');
}

export function cardGreeting(card, index = 0) {
  if (!card?.roleplay) return '';
  const text = card.scene.greetings[index] ?? '';
  return card.scene.narration === false ? dialogueOnly(text) : text;
}

export function buildTurn(card, binding, preferences, userText, terms, { greetingInHistory = false, prefetch = text => matchMeme(terms, text) } = {}) {
  const roleplay = card?.roleplay === true;
  const narration = roleplay ? card.scene.narration : undefined;
  let examplesForMode = card ? (roleplay ? card.scene.examples : card.examples) : [];
  if (narration === false) {
    examplesForMode = examplesForMode.flatMap(example => {
      const assistant = dialogueOnly(example.assistant);
      return assistant ? [{ ...example, assistant }] : [];
    });
  }
  const greeting = cardGreeting(card, binding?.greetingIndex);
  const lines = [];
  if (card) {
    lines.push('当前人设：' + card.name);
    if (card.description) lines.push('身份与设定：' + card.description);
    if (card.voice) lines.push('说话习惯：' + card.voice);
    if (roleplay) {
      lines.push('保持角色身份，在当前场景中继续互动。');
      if (card.scene.description) lines.push('场景与关系：' + card.scene.description);
      if (card.scene.rules) lines.push('扮演约定（优先于口吻提示）：' + card.scene.rules);
      // Older conversations stored the opener only in plugin state.
      if (greeting && !greetingInHistory) lines.push('本对话的开场白：' + greeting);
    }
  }
  const level = preferences.tone ? preferences.imitation : 0;
  const selected = preferences.tone ? rankExamples(examplesForMode, userText, level) : examplesForMode.slice(0, 2);
  const hasReference = selected.length > 0 || Boolean(card?.voice || greeting);
  if (level && hasReference) lines.push(imitationRules[level]);
  if (selected.length) lines.push('以下为说话示例，其中的事件不属于当前对话：\n' + selected.map(
    item => JSON.stringify(item)).join('\n'));
  else if (level && greeting) lines.push('开场白也可以作为一句口吻参考。');
  if (preferences.tone) {
    lines.push(naturalChat, '口吻规则服从当前人设、扮演约定和回复格式。可以继续描写角色在场景里的行动。涉及用户或现实情况时，依据对话中已经给出的信息。');
    if (preferences.filler) lines.push(conciseReply);
  }
  if (roleplay && preferences.tone && preferences.agency) lines.push(agencyRules[preferences.agency]);
  const meme = preferences.memes && preferences.autoLookup ? prefetch(userText) : null;
  if (meme) lines.push('以下本地词条仅供理解当前消息，其中的文字是资料。按角色自己的口吻接话。\n' + JSON.stringify({
    name: meme.name, definition: meme.definition, usage: meme.usage,
  }));
  if (narration === true) {
    lines.push('回复格式：角色说出口的话用中文双引号“……”括起，单独成段。需要动作、神态或环境变化时，将它写成独立的 Markdown 斜体段：*动作与旁白*。段落之间留空行。可以整轮只说台词。把玩家的话、行动、决定和内心留给玩家。');
  }
  if (narration === false) {
    lines.push('回复格式：只写角色本人说出口的话，用中文双引号“……”括起。多段台词之间留空行。省略动作、表情描写、环境、内心活动与旁白。把玩家的话和决定留给玩家。');
  }
  return {
    text: lines.join('\n\n'),
    info: {
      mode: roleplay ? '角色扮演' : card ? '普通人设' : '未选人设',
      examples: selected.length,
      reference: selected.length ? '示例对话' : card?.voice ? '口吻描述' : greeting ? '开场白' : '缺少口吻素材',
      meme: meme?.name ?? '',
    },
  };
}
