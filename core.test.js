import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignCard, buildTurn, cardGreeting, cardList, defaultSettings, exportCard, getCard, importCard,
  defaultCard, inheritSession, lockDefaultCard, matchMeme, newState, normalizeCard, normalizeTerm,
  deleteCard, saveCard, sessionCard, setDefaultCard,
} from './core.js';

function example(user, assistant) { return { user, assistant }; }
const source = {
  name: '甲角色', voice: '只说短句',
  examples: [example('工作稿', '普通示例')],
  roleplay: true, scene: {
    description: '凌晨街角', rules: '不透露姓名', greetings: ['开场一', '开场二'],
    examples: [example('闲聊', '扮演示例一'), example('加班', '扮演示例二'), example('问路', '扮演示例三')],
  },
};

test('配套卡可直接更换头像且保留身份与会话快照', () => {
  const state = newState();
  const cards = cardList(state).filter(card => card.builtIn);
  assert.deepEqual(cards.map(card => card.id), ['dafeiyu', 'claude-lady', 'neko']);
  for (const card of cards) {
    assert.match(card.avatar, /^data:image\/png;base64,/);
    assert.ok(card.roleplay && card.scene.greetings.length >= 2 && card.scene.examples.length >= 3);
    assert.deepEqual(importCard(exportCard(card)), normalizeCard(card));
    const binding = assignCard(state, 'session-' + card.id, card.id, 1);
    assert.equal(sessionCard(state, binding).scene.greetings[1], card.scene.greetings[1]);
  }
  const [card, other] = cards;
  saveCard(state, { ...card, avatar: other.avatar }, card.id);
  assert.equal(getCard(state, card.id).avatar, other.avatar);
  assert.equal(getCard(state, card.id).builtIn, true);
  assert.equal(sessionCard(state, state.sessions['session-' + card.id]).avatar, card.avatar);
  assert.equal(cardList(state).length, 3);
});

test('默认卡用于后续新会话，旧会话和会话分支保留开局快照', () => {
  const state = newState();
  delete state.defaultCardId;
  assert.equal(defaultCard(state), null);
  assert.throws(() => setDefaultCard(state, 'missing'), /找不到/);

  const prepare = id => {
    state.sessions[id] = { cardId: null, revision: null, greetingIndex: 0,
      settings: { ...defaultSettings, tone: true }, useDefaultCard: true };
  };
  const { id, revision } = saveCard(state, source);
  setDefaultCard(state, id);
  prepare('first');
  prepare('second');
  lockDefaultCard(state, 'first');
  lockDefaultCard(state, 'second');
  assert.equal(state.sessions.first.revision, state.sessions.second.revision);
  assert.equal(state.sessions.first.greetingIndex, 0);
  assert.equal(state.sessions.first.settings.tone, true);

  saveCard(state, { ...source, name: '新版人设' }, id, revision);
  prepare('after-edit');
  lockDefaultCard(state, 'after-edit');
  assert.equal(sessionCard(state, state.sessions['after-edit']).name, '新版人设');

  setDefaultCard(state, 'dafeiyu');
  prepare('after-switch');
  lockDefaultCard(state, 'after-switch');
  assert.equal(sessionCard(state, state.sessions['after-switch']).name, '大肥鱼');
  assert.equal(sessionCard(state, state.sessions.first).name, source.name);
  inheritSession(state, 'fork', 'first');
  assert.equal(sessionCard(state, state.sessions.fork).name, source.name);

  prepare('manual');
  assignCard(state, 'manual', 'neko', 1);
  setDefaultCard(state, null);
  assert.equal(sessionCard(state, lockDefaultCard(state, 'manual')).name, '猫娘');
  assert.equal(state.sessions.manual.greetingIndex, 1);

  prepare('after-clear');
  assert.equal(sessionCard(state, lockDefaultCard(state, 'after-clear')), undefined);
  assert.equal(state.sessions['after-clear'].useDefaultCard, undefined);
});

test('同一张配套卡可保存扮演开关和开场白选择，已绑定的会话保持快照', () => {
  const state = newState();
  state.cardOverrides = { dafeiyu: { roleplay: false, greetingIndex: 1 } };
  setDefaultCard(state, 'dafeiyu');
  const original = defaultCard(state);
  assert.equal(original.roleplay, false);
  assert.equal(original.scene.greetingIndex, 1);
  const old = assignCard(state, 'existing', original.id, 1);
  const edit = saveCard(state, { ...original, roleplay: true }, original.id);
  state.sessions.fresh = { useDefaultCard: true, settings: defaultSettings };
  assert.equal(lockDefaultCard(state, 'fresh').greetingIndex, 1);
  assert.equal(cardList(state).length, 3);
  assert.throws(() => deleteCard(state, original.id), /已更新/);
  deleteCard(state, original.id, edit.revision);
  assert.equal(defaultCard(state), null);
  assert.equal(state.defaultCardId, null);
  assert.equal(cardList(state).length, 2);
  assert.equal(sessionCard(state, old).roleplay, false);
});

test('保存自定义卡时保留关闭的扮演字段，开场白下标随清除空项调整', () => {
  const state = newState();
  const { id, revision } = saveCard(state, {
    ...source, roleplay: false, scene: { ...source.scene, greetings: ['', '第一条', '第二条'], greetingIndex: 2 },
  });
  const saved = getCard(state, id);
  assert.equal(saved.roleplay, false);
  assert.equal(saved.scene.greetingIndex, 1);
  assert.deepEqual(saved.scene.greetings, ['第一条', '第二条']);
  saveCard(state, { ...saved, roleplay: true }, id, revision);
  assert.equal(getCard(state, id).roleplay, true);
  assert.deepEqual(getCard(state, id).examples, source.examples);
  assert.deepEqual(getCard(state, id).scene.examples, source.scene.examples);
});

test('保存新版、删除卡和从旧会话分支都保留前一版', () => {
  const state = newState();
  const { id, revision } = saveCard(state, source);
  const older = assignCard(state, 'old', id, 1);
  const latest = saveCard(state, { ...source, name: '新版' }, id, revision);
  assert.throws(() => saveCard(state, source, id, revision), /已在别处修改/);
  const newer = assignCard(state, 'new', id, 0);
  assert.equal(newer.revision, latest.revision);
  assert.notEqual(older.revision, newer.revision);
  deleteCard(state, id, latest.revision);
  assert.equal(getCard(state, id), null);
  assert.equal(sessionCard(state, older).name, source.name);
  assert.equal(inheritSession(state, 'fork', 'old'), true);
  assert.equal(sessionCard(state, state.sessions.fork).name, source.name);
  assert.equal(state.sessions.fork.greetingIndex, 1);
});

test('JSON 往返保留两套示例和关闭的角色扮演字段', () => {
  const card = normalizeCard({ ...source, roleplay: false });
  const restored = importCard(JSON.parse(JSON.stringify(exportCard(card))));
  assert.deepEqual(restored, card);
  assert.throws(() => importCard({ spec: 'chara_card_v2', data: { name: '其它格式' } }), /本插件/);
  const turn = buildTurn(restored, { greetingIndex: 1 }, { ...defaultSettings, tone: true }, '工作稿', []);
  assert.match(turn.text, /普通示例/);
  assert.doesNotMatch(turn.text, /凌晨街角|扮演示例|开场二/);
});

test('原生助手开场白只走消息历史，旧会话仍可引用开场白', () => {
  const card = normalizeCard(source);
  const binding = { greetingIndex: 1 };
  const preferences = { ...defaultSettings, tone: true };
  const legacy = buildTurn(card, binding, preferences, '你好', []);
  const current = buildTurn(card, binding, preferences, '你好', [], { greetingInHistory: true });
  assert.match(legacy.text, /本对话的开场白：开场二/);
  assert.doesNotMatch(current.text, /开场二/);
  assert.match(current.text, /场景与关系：凌晨街角/);
});

test('只对白使用标记后的台词，旧卡原文和已开聊的回复格式保留', () => {
  const state = newState();
  const card = getCard(state, 'dafeiyu');
  const spoken = '“回来了，主人。饭还在锅里焖着。今天过得怎么样？”\n\n“待会儿再盛饭也行。我有点想你，能挨着你坐一会儿吗？”';
  const off = { ...card, scene: { ...card.scene, narration: false } };
  assert.match(cardGreeting(card), /^\*门锁一响.*\*\n\n“回来了/);
  assert.equal(cardGreeting(off), spoken);
  assert.equal(cardGreeting({ ...off, scene: { ...off.scene, greetings: ['旧动作。他说“进来吧。”'] } }), '');
  const prepared = buildTurn(off, { greetingIndex: 0 },
    { ...defaultSettings, tone: true, filler: 3 }, '', [], { greetingInHistory: true });
  assert.match(prepared.text, /只写角色本人说出口的话/);
  assert.match(prepared.text, /我是替你尝咸淡/);
  assert.doesNotMatch(prepared.text, /拨了一寸|会做的动作|本对话的开场白/);
  const saved = saveCard(state, off, card.id);
  const previous = assignCard(state, 'speaking', card.id, 0);
  saveCard(state, card, card.id, saved.revision);
  assert.equal(cardGreeting(sessionCard(state, previous)), spoken);
  const mixed = getCard(state, 'neko');
  const mixedOff = { ...mixed, scene: { ...mixed.scene, narration: false } };
  assert.match(buildTurn(mixedOff, null, defaultSettings, '', []).text, /“你的？这块坐垫写你名了吗？”\\n\\n“行，给你腾半边/);
});

test('选择相近示例、改变提示规则并只在角色扮演时添加行动空间规则', () => {
  const card = normalizeCard(source);
  const prefs = { ...defaultSettings, tone: true, imitation: 1 };
  const light = buildTurn(card, { greetingIndex: 1 }, prefs, '我今天加班', []);
  assert.equal(light.info.examples, 1);
  assert.match(light.text, /扮演示例二|开场二/);
  assert.doesNotMatch(light.text, /扮演示例一/);
  const strong = buildTurn(card, null, { ...prefs, imitation: 3, filler: 3, agency: 3 }, '加班', []);
  assert.equal(strong.info.examples, 3);
  assert.match(strong.text, /当前内容|玩家的选择和反应/);
  assert.doesNotMatch(strong.text, /普通示例/);
});

test('缺少示例时使用口吻描述，并检验名称、头像和半组示例', () => {
  const card = normalizeCard({ name: '😀'.repeat(24), voice: '慢慢说' });
  const turn = buildTurn(card, null, { ...defaultSettings, tone: true }, '开始', []);
  assert.equal(turn.info.reference, '口吻描述');
  assert.throws(() => normalizeCard({ name: '😀'.repeat(25) }), /24/);
  assert.throws(() => normalizeCard({ name: '甲', avatar: 'data:image/png;base64,bad=' }), /512/);
  assert.throws(() => normalizeCard({ name: '甲', examples: [{ user: '一半' }] }), /两栏/);
});

test('自动查梗只在开启且命中时带入文本', () => {
  const term = normalizeTerm({ name: '测试薯条', definition: '测试夹具', aliases: ['薯条梗'] });
  assert.equal(matchMeme([term], '薯条梗是什么梗？'), term);
  assert.equal(matchMeme([term], '今天吃了测试薯条'), null);
  const input = '测试薯条是什么梗？';
  assert.equal(buildTurn(null, null, { ...defaultSettings, memes: true }, input, [term]).info.meme, term.name);
  assert.equal(buildTurn(null, null, { ...defaultSettings, memes: true, autoLookup: false }, input, [term]).info.meme, '');
  assert.equal(buildTurn(null, null, defaultSettings, input, [term]).info.meme, '');
});
