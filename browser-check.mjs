import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
const testFolder = process.argv[2];
if (!testFolder) throw new Error('Pass the isolated DSH test directory');
const root = resolve(testFolder);
const dir = pathToFileURL(root + '/');
const requireBrowser = createRequire(process.env.QYB_BROWSER_TOOLS || join(root, 'browser-tools', 'package.json'));
const { chromium } = requireBrowser('playwright-core');
const log = await readFile(new URL('web-fixture.log', dir), 'utf8');
const url = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0];
const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true });
page.setDefaultTimeout(8000);
const issues=[];
page.on('pageerror', e => issues.push(e.message));
page.on('console', m => { if (m.type() === 'error') issues.push(m.text().split('\n')[0]); });
const button = name => page.getByRole('button', { name, exact: true });
const panel = () => page.locator('.qyb[role],.qyb.qyb-stack').first();
const field = (root, name) => root.locator('label').filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).locator('input, select, textarea');
async function openSettings() {
  await button('账号菜单').click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await button('角色扮演').click();
}
async function api(path, data) {
  return page.evaluate(async ({path,data}) => {
    const response = await fetch('/api/quyubagu'+path, {
      headers:{'x-quyubagu':'1',...(data === undefined ? {} : {'content-type':'application/json'})},
      ...(data === undefined ? {} : {method:'POST',body:JSON.stringify(data)}),
    });
    return {status:response.status, body:await response.json()};
  }, {path,data});
}
async function requests() {
  const content = await readFile(new URL('fixture.ndjson',dir),'utf8').catch(()=>'');
  return content.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
async function submit(message, reply = '隔离模型回执：测试回复。') {
  const box=page.locator('[contenteditable=true]').last();
  await box.fill(message);
  await button('发送消息').click();
  await page.getByText(reply, { exact: true }).last().waitFor();
  for(let i=0;i<30;i++){
    const found = (await requests()).findLast(entry => {
      const messages = JSON.stringify(entry.body.messages);
      return messages.includes(message) && !messages.includes('Generate the session title');
    });
    if(found) return JSON.stringify(found.body);
    await page.waitForTimeout(250);
  }
  throw Error('未捕获模型请求：'+message);
}
const suffix = Date.now().toString().slice(-7);
const original = '测试卡' + suffix;
const scene = '便利店场景' + suffix;
const dailyReply = '日常口吻' + suffix;
const opener = '第二条开场白' + suffix;
const meme = '松鼠找梯' + suffix;
const memeMeaning = '测试梗释义' + suffix;
const cardRow = name => panel().getByRole('group', { name, exact: true });
const roleplayConfig = () => panel().getByText('角色扮演配置', { exact: false }).first().click();
const editCard = async name => {
  await cardRow(name).getByRole('button', { name: '编辑', exact: true }).click();
  await roleplayConfig();
};
const roleplay = () => page.getByRole('switch', { name: '启用角色扮演', exact: true });
const narration = () => page.getByRole('switch', { name: '带动作与旁白', exact: true });
const switchedOn = switcher => switcher.getAttribute('aria-checked').then(value => value === 'true');
const dialogue = '“这锅刚焖好。”';
const setDefault = async name => {
  const row = cardRow(name);
  await row.waitFor();
  const action = row.getByRole('button', { name: '设为默认', exact: true });
  if (await action.isVisible()) await action.click();
  await row.getByText('默认人设', { exact: true }).waitFor();
};
const newChat = async () => {
  await button('关闭').click();
  await page.getByText('新会话', { exact: true }).first().click();
};
try {
  const unauthenticated = await fetch(new URL('/api/quyubagu/library', url), {
    headers: { 'x-quyubagu': '1' },
  });
  assert.equal(unauthenticated.status, 401);
  await page.goto(url, { wait_until: 'domcontentloaded', timeout: 30000 });
  await button('账号菜单').waitFor({ timeout: 30000 });
  if (await button('继续').isVisible()) await button('继续').click();
  await openSettings();

  await editCard('大肥鱼');
  await button('更换头像').waitFor();
  await roleplay().click();
  assert.equal(await field(panel(), '场景与关系').count(), 0);
  await button('保存人设卡').click();
  await editCard('大肥鱼');
  assert.equal(await switchedOn(roleplay()), false);
  await roleplay().click();
  assert.match(await field(panel(), '场景与关系').inputValue(), /化成人形后住进你家/);
  await button('保存人设卡').click();
  assert.equal((await api('/library')).body.cards.filter(card => card.name === '大肥鱼').length, 1);

  await button('新建人设卡').click();
  await roleplayConfig();
  assert.equal(await switchedOn(roleplay()), false);
  const form = panel();
  await field(form, '名称（必填） · 1–24 个可见字符').fill(original);
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#4554a2';
    context.fillRect(0, 0, 160, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await form.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({
    name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await button('使用裁剪结果').click();
  await button('添加日常对话示例').click();
  await field(form, '用户输入').fill('日常问题');
  await field(form, '角色日常回复').fill(dailyReply);
  await roleplay().click();
  assert.equal(await field(form, '角色日常回复').inputValue(), dailyReply);
  await field(form, '场景与关系').fill(scene);
  await button('添加开场白').click();
  await field(form, '第 1 条').fill('备用开场白' + suffix);
  await button('添加开场白').click();
  await field(form, '第 2 条').fill(opener);
  await field(form, '新会话使用的开场白').selectOption('1');
  await button('添加扮演示例').click();
  await field(form, '玩家台词').fill('你听到后门响了吗？');
  await field(form, '角色回复').fill('角色示例' + suffix);

  await roleplay().click();
  assert.equal(await field(form, '场景与关系').count(), 0);
  await button('保存人设卡').click();
  await editCard(original);
  assert.equal(await switchedOn(roleplay()), false);
  const downloadEvent = page.waitForEvent('download');
  await button('导出 JSON').click();
  const downloaded = await downloadEvent;
  const cardJson = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  assert.match(cardJson.card.avatar, /^data:image\/png;base64,/);
  assert.equal(cardJson.card.roleplay, false);
  assert.equal(cardJson.card.scene.greetingIndex, 1);
  assert.equal(cardJson.card.scene.greetings[1], opener);
  assert.equal((await api('/card/validate', { file: cardJson })).status, 200);
  await button('返回卡库').click();
  await button('导入 JSON').click();
  await field(panel(), '或粘贴 JSON').fill(JSON.stringify(cardJson));
  await button('预览导入').click();
  assert.equal(await field(panel(), '名称（必填） · 1–24 个可见字符').inputValue(), original);
  await button('返回卡库').click();

  await setDefault(original);
  assert.equal((await api('/library')).body.cards.find(card => card.name === original).roleplay, false);
  await newChat();
  await page.getByText('探索未至之境', { exact: true }).waitFor();
  const ordinary = await submit('普通聊天' + suffix);
  assert.ok(ordinary.includes(dailyReply));
  assert.ok(!ordinary.includes(scene) && !ordinary.includes(opener));

  await openSettings();
  await editCard(original);
  await roleplay().click();
  assert.equal(await field(panel(), '场景与关系').inputValue(), scene);
  assert.equal(await field(panel(), '新会话使用的开场白').inputValue(), '1');
  assert.equal(await field(panel(), '角色日常回复').inputValue(), dailyReply);
  await button('保存人设卡').click();
  await page.getByRole('tab', { name: '去八股', exact: true }).click();
  const tone = page.getByRole('switch', { name: '启用去八股', exact: true });
  if (!await switchedOn(tone)) await tone.click();
  await page.getByRole('switch', { name: '启用去八股', exact: true, checked: true }).waitFor();
  await page.getByRole('tab', { name: '梗百科', exact: true }).click();
  const memes = page.getByRole('switch', { name: '启用梗百科', exact: true });
  if (!await switchedOn(memes)) await memes.click();
  await page.getByRole('switch', { name: '启用梗百科', exact: true, checked: true }).waitFor();
  await button('新建词条').click();
  await field(panel(), '词名（必填）').fill(meme);
  await field(panel(), '释义（必填）').fill(memeMeaning);
  await button('保存词条').click();
  await page.getByRole('status').getByText('词条已保存', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '人设卡', exact: true }).click();
  await cardRow(original).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('配套卡与默认人设.png', dir)) });

  const chatRequests = async () => (await requests()).filter(entry => !JSON.stringify(entry.body.messages).includes('Generate the session title'));
  const beforeGreeting = (await chatRequests()).length;
  await newChat();
  await page.getByText(opener, { exact: true }).waitFor();
  assert.equal((await chatRequests()).length, beforeGreeting);
  assert.equal(await page.locator('.qyb-session').count(), 0);
  assert.equal(await button('选人设').count(), 0);
  const sent = JSON.parse(await submit(meme + '是什么梗？', dialogue));
  assert.equal(sent.messages[0].role, 'assistant');
  assert.ok(JSON.stringify(sent.messages[0].content).includes(opener));
  const prompt = JSON.stringify([sent.system, ...sent.messages.slice(1)]);
  assert.ok(prompt.includes(scene));
  assert.ok(!prompt.includes(opener) && !prompt.includes(dailyReply));
  assert.ok(JSON.stringify(sent).includes(memeMeaning));
  await openSettings();
  await editCard('大肥鱼');
  if (!await switchedOn(narration())) await narration().click();
  await button('保存人设卡').click();
  await setDefault('大肥鱼');
  await newChat();
  const dafeiyuGreeting = '“回来了，主人。饭还在锅里焖着。今天过得怎么样？”';
  const openerAction = page.locator('em').filter({ hasText: '门锁一响' }).last();
  const openerDialogue = page.getByText(dafeiyuGreeting, { exact: true }).last();
  await openerAction.waitFor();
  await openerDialogue.waitFor();
  assert.equal(await openerAction.evaluate(el => el.closest('p')?.nextElementSibling?.textContent), dafeiyuGreeting);
  const narrated = JSON.parse(await submit('带旁白测试' + suffix, dialogue));
  await page.locator('em').filter({ hasText: '大肥鱼把碗放下。' }).waitFor();
  assert.ok(JSON.stringify(narrated).includes('独立的 Markdown 斜体段'));
  await page.screenshot({ path: fileURLToPath(new URL('大肥鱼带旁白.png', dir)) });

  await openSettings();
  await editCard('大肥鱼');
  await narration().click();
  await button('保存人设卡').click();
  const beforePlain = (await chatRequests()).length;
  await newChat();
  await openerAction.waitFor({ state: 'detached' });
  await page.getByText(dafeiyuGreeting, { exact: true }).waitFor();
  assert.equal(await page.getByText('门锁一响', { exact: false }).count(), 0);
  assert.equal((await chatRequests()).length, beforePlain);
  const plain = JSON.parse(await submit('只对白测试' + suffix, dialogue));
  assert.ok(JSON.stringify(plain.messages[0].content).includes(dafeiyuGreeting));
  assert.ok(JSON.stringify(plain).includes('只写角色本人说出口的话'));
  assert.ok(!JSON.stringify(plain).includes('她把锅盖往回拨了一寸'));
  assert.equal(await page.getByText('大肥鱼把碗放下。', { exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('大肥鱼只对白.png', dir)) });

  await openSettings();
  await setDefault(original);
  page.once('dialog', async dialog => {
    assert.ok(dialog.message().includes('新会话将不使用默认人设'));
    await dialog.dismiss();
  });
  const remove = cardRow(original).getByRole('button', { name: '删除', exact: true });
  await remove.click();
  assert.equal(await cardRow(original).count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await cardRow(original).waitFor({ state: 'detached' });
  assert.equal((await api('/library')).body.defaultCardId, null);
  assert.equal(issues.length, 0, issues.join('\n'));
  console.log('DSH 端到端通过：列表设置、开关、头像、两种模式的开场白和后续消息、原生斜体分段、确认删除。');
} catch (error) {
  console.error(issues);
  console.error((await page.locator('body').innerText()).slice(-1300));
  throw error;
} finally { await browser.close(); }
