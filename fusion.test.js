import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildTurn, defaultSettings, normalizeTerm, settings } from './core.js';
import { openGlossary } from './glossary.js';
import { previewTone } from './tone-preview.js';

test('旧的减少套话档位与新开关都能启用同一条事实约束', () => {
  const text = prefs => buildTurn(null, null, { ...defaultSettings, tone: true, ...prefs }, '我只能再改十分钟', []).text;
  assert.equal(text({ filler: 3 }), text({ filler: 1 }));
  assert.match(text(settings({ filler: true, tone: true })), /不补写未经确认的数字/);
  assert.doesNotMatch(text(settings({ filler: false, tone: true })), /不补写未经确认的数字/);
  assert.match(text({ filler: 0 }), /事实不动/);
  assert.doesNotMatch(text({ tone: false }), /说话的松紧/);
});

test('试改关档原样返回，其他档位可重复且保留代码块', () => {
  const code = '\x60\x60\x60js\nconst count = 42;\n\x60\x60\x60';
  const original = '我觉得这事挺麻烦。先这样试一下，明天有空再聊。\n' + code;
  assert.equal(previewTone(original, { strength: 'off' }), original);
  const result = previewTone(original, { strength: 'max', seed: 7 });
  assert.notEqual(result, original);
  assert.equal(result, previewTone(original, { strength: 'max', seed: 7 }));
  assert.ok(result.endsWith(code));
});

test('社区库接入后支持原版匹配，自定义释义优先，预查服从会话开关', () => {
  const folder = mkdtempSync(join(tmpdir(), 'quyubagu-test-'));
  const file = join(folder, 'memes.db');
  const glossary = openGlossary(file, error => { throw error; });
  try {
    const custom = normalizeTerm({ name: '去码头整点薯条', definition: '自定义释义' });
    assert.deepEqual(glossary.info(), { status: 'missing', count: 0 });
    assert.equal(glossary.search([custom], custom.name), custom);
    const db = new DatabaseSync(file);
    try {
      db.exec("CREATE TABLE memes(title TEXT, aliases TEXT, usage TEXT, summary TEXT, origin TEXT)");
      db.prepare('INSERT INTO memes VALUES (?, ?, ?, ?, ?)').run(custom.name, 'gofries', '', '社区释义', '');
    } finally {
      db.close();
    }
    assert.deepEqual(glossary.info(), { status: 'ready', count: 1 });
    assert.equal(glossary.search([], '码头整').name, custom.name);
    assert.equal(glossary.search([custom], 'gofries'), custom);
    assert.equal(glossary.prefetch([], '大肥鱼，去码头整点薯条是什么梗？').definition, '社区释义');
    assert.equal(glossary.prefetch([], '晚安'), null);
    assert.equal(glossary.search([], '%'), null);
    const input = 'gofries是什么梗？';
    const options = { prefetch: message => glossary.prefetch([custom], message) };
    assert.match(buildTurn(null, null, { ...defaultSettings, memes: true }, input, [], options).text, /自定义释义/);
    assert.doesNotMatch(buildTurn(null, null, { ...defaultSettings, memes: true, autoLookup: false }, input, [], options).text, /自定义释义/);
  } finally {
    glossary.close();
    rmSync(file, { force: true });
    rmdirSync(folder);
  }
});
