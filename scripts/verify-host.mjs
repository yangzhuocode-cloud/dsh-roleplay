// Run against an explicitly installed host and isolated Home. Never defaults to the user's DSH_HOME.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const [runtimeArg, homeArg, evidenceArg, browserTools, restartExpectation] = process.argv.slice(2);
if (![runtimeArg, homeArg, evidenceArg, browserTools].every(Boolean)) throw Error('Usage: node scripts/verify-host.mjs <runtime> <isolated-home> <evidence> <browser-tools-package.json>');
const runtime = resolve(runtimeArg), home = resolve(homeArg), evidence = resolve(evidenceArg);
if (home === resolve(process.env.DSH_HOME || '.')) throw Error('Refusing inherited DSH_HOME; choose an explicit separate test Home');
process.env.DSH_HOME = home;
process.env.DSH_ROLEPLAY_FIXTURE_KEY = 'local-test-only';
process.env.QYB_BROWSER_TOOLS = resolve(browserTools);
const repo = fileURLToPath(new URL('../', import.meta.url));
await mkdir(evidence, { recursive: true });
try { await stat(join(evidence, 'fixture.port')); throw Error('Evidence directory already used; choose a fresh directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const fixture = spawn(process.execPath, [join(repo, 'fixture-model.mjs'), join(evidence, 'fixture.port'), join(evidence, 'fixture.ndjson')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let fixtureError = '';
fixture.stderr.on('data', b => fixtureError += b);
const waitFor = async (fn, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn(); if (result) return result;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('Timed out waiting for fixture: ' + fixtureError);
};
let app;
try {
  const port = await waitFor(async () => { try { return (await readFile(join(evidence, 'fixture.port'), 'utf8')).trim(); } catch { return ''; } });
  // Test-only routing. No real account credentials, providers or daily settings are copied.
  const patch = [
    { id: 'agent-default-model', config: { provider: 'roleplay-fixture', model: 'roleplay-fixture' } },
    { id: 'llm-pi-ai', config: { providers: { 'roleplay-fixture': {
      apiKeyEnv: 'DSH_ROLEPLAY_FIXTURE_KEY', api: 'anthropic-messages', baseURL: `http://127.0.0.1:${port}`,
      retryPolicy: { mode: 'normal', maxRetries: 0 }, models: [{ id: 'roleplay-fixture', name: 'Roleplay fixture', contextWindow: 200000, maxTokens: 4096 }],
    } } } },
    { id: 'workspace-controller', config: { documentsDirectory: join(evidence, 'documents') } },
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
  ];
  // JSON is valid YAML; keep this overlay separate from the installed profile's patch.
  const patchFile = join(evidence, 'fixture.patch.yml');
  await writeFile(patchFile, JSON.stringify(patch, null, 2));
  const root = join(runtime, 'node_modules', '@deepseek-ai');
  const imp = path => import(pathToFileURL(join(root, path)).href);
  console.log('Loading host libraries');
  const { loadProfileDirectory, loadLayeredEnv } = await imp('dsh-app-boot/lib/index.js');
  console.log('Loading profile runner');
  const { runProfile } = await imp('dsh/lib/profile-boot.js');
  const anchor = join(root, 'dsh/package.json');
  console.log('Reading isolated profile');
  const profile = loadProfileDirectory('dsh', join(home, 'profiles/web'), anchor);
  const boot = () => runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web', resolvedProfile: { profile, installAnchor: anchor }, patchFiles: [patchFile], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] });
  console.log('Booting host');
  app = await boot();
  console.log('Host ready');
  const required = ['workspaceController', 'workspaceRegistry', 'sessionController', 'sessionPersistence', 'sessions', 'agents', 'connection', 'tools'];
  for (const service of required) assert.ok(app.ctx.get(service), `missing ${service}`);
  const workspace = join(evidence, 'workspace');
  await mkdir(workspace, { recursive: true });
  await app.ctx.get('workspaceController').create({ path: workspace });
  const stateFile = join(home, 'quyubagu/state.json');
  if (restartExpectation) {
    const expected = JSON.parse(await readFile(resolve(restartExpectation), 'utf8'));
    const controller = app.ctx.get('sessionController');
    await controller.resolveAgent(expected.parentId);
    await controller.resolveAgent(expected.forkId);
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.deepEqual(state.sessions[expected.parentId], expected.binding);
    assert.deepEqual(state.sessions[expected.forkId], expected.binding);
    const greetings = app.ctx.get('sessions').get(expected.parentId).snapshotEvents().filter(event =>
      event.type === 'assistant/message' && event.data.message.source?.provider === 'dsh-quyubagu');
    assert.equal(greetings.length, expected.greetingCount, 'restoring must not duplicate or remove greetings');
    assert.equal(state.defaultCardId, null, 'browser deletion must persist');
    await writeFile(join(evidence, 'restart-result.json'), JSON.stringify({ restoredBindings: true, greetingCount: greetings.length, deletedDefaultPreserved: true }, null, 2));
    console.log('Restart acceptance passed');
  } else {
  const browser = spawn(process.execPath, [join(repo, 'browser-check.mjs'), evidence], { env: process.env, stdio: 'inherit', windowsHide: true });
  const exit = await new Promise((res, rej) => { browser.on('error', rej); browser.on('exit', res); });
  assert.equal(exit, 0, 'browser acceptance failed');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const greetingCount = id => app.ctx.get('sessions').get(id)?.snapshotEvents().filter(event => event.type === 'assistant/message' && event.data.message.source?.provider === 'dsh-quyubagu').length ?? 0;
  const parentId = Object.keys(state.sessions).find(id => state.sessions[id].revision && greetingCount(id) > 0);
  assert.ok(parentId, 'need a bound parent session');
  const controller = app.ctx.get('sessionController');
  const { symbols } = await imp('cordis/lib/index.js');
  const rawController = controller[symbols.original] ?? controller;
  const wrappedCreate = rawController.create;
  const entry = [...app.ctx.get('loader').entries()].find(entry => entry.options.id === 'quyubagu');
  assert.ok(entry, 'plugin loader entry is required');
  const disabled = await app.ctx.get('pluginManager').setPluginEnabled(entry.id, false);
  assert.equal(disabled.application, 'applied', JSON.stringify(disabled));
  await app.ctx.get('loader').await();
  assert.notEqual(rawController.create, wrappedCreate, 'disable must restore native controller');
  assert.ok(!app.ctx.get('tools').definitions().some(tool => tool.name === 'quyubagu_lookup_meme'));
  const nativeSession = await controller.create({ cwd: workspace });
  assert.ok(nativeSession.sessionId, 'native session creation must survive plugin disable');
  for (const service of required) assert.ok(app.ctx.get(service), `disable removed ${service}`);
  const enabled = await app.ctx.get('pluginManager').setPluginEnabled(entry.id, true);
  assert.equal(enabled.application, 'applied', JSON.stringify(enabled));
  await app.ctx.get('loader').await();
  assert.ok(app.ctx.get('tools').definitions().some(tool => tool.name === 'quyubagu_lookup_meme'));
  const fork = await controller.fork({ sessionId: parentId });
  const forkState = JSON.parse(await readFile(stateFile, 'utf8'));
  const expected = { ...state.sessions[parentId] }; delete expected.useDefaultCard;
  assert.deepEqual(forkState.sessions[fork.sessionId], expected, 'fork must retain original card/settings snapshot');
  const beforeRestart = await readFile(stateFile, 'utf8');
  // A separate process is used for actual restart checks; keep this process's module/service lifecycle unambiguous.
  await writeFile(join(evidence, 'restart-expectation.json'), JSON.stringify({ parentId, binding: state.sessions[parentId], greetingCount: greetingCount(parentId), forkId: fork.sessionId }));
  assert.equal(await readFile(stateFile, 'utf8'), beforeRestart);
  const version = JSON.parse(await readFile(anchor, 'utf8')).version;
  await writeFile(join(evidence, 'host-result.json'), JSON.stringify({ version, requiredServices: required, browser: 'passed', fork: 'passed', disableReenable: 'passed', snapshotPersistence: 'passed' }, null, 2));
  console.log(`Host acceptance passed: ${version}`);
  }
} finally {
  fixture.kill();
  if (app) await app.shutdown.shutdown(0);
}
