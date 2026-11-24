import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteAdapter } from './compat/routes.js';

test('rc.3 retains host request rejection including unauthenticated requests', () => {
  const rejected = {};
  const connection = { requestRejection: req => req === rejected ? 401 : undefined };
  let registered;
  const adapter = createRouteAdapter(connection, route => registered = route);
  const route = { path: '/api/quyubagu', handler() {} };
  adapter.registerRoute(route);
  assert.equal(registered, route);
  assert.equal(adapter.requestRejection(rejected), 401);
  assert.equal(adapter.requestRejection({}), undefined);
});

test('alpha.2 only admits the carrier-selected owner Peer and expires request admission', async () => {
  let registered, calls = 0;
  const adapter = createRouteAdapter({ admit() { throw Error('must not repeat authentication'); } }, route => registered = route);
  adapter.registerRoute({ handler: async req => { calls++; assert.equal(adapter.requestRejection(req), undefined); } });
  assert.equal(registered.auth, 'required');
  const req = {}, res = { writeHead(status) { this.status = status; }, end() {} };
  for (const peer of [undefined, { principal: { kind: 'api' } }]) {
    await registered.handler(req, res, peer);
    assert.equal(res.status, 403);
  }
  assert.equal(calls, 0);
  await registered.handler(req, res, { principal: { kind: 'owner' } });
  assert.equal(calls, 1);
  assert.equal(adapter.requestRejection(req), 403);
});

test('unknown authentication APIs fail closed before registering a route', () => {
  const adapter = createRouteAdapter({}, () => assert.fail('must not register'));
  assert.throws(() => adapter.registerRoute({}), /鉴权接口/);
  assert.equal(adapter.requestRejection({}), 403);
});
