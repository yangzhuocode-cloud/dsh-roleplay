// rc.3 authenticates plugin routes with requestRejection; alpha.2 supplies an admitted Peer.
// Keep network authorization here so business handlers cannot accidentally skip it.
export function createRouteAdapter(connection, register) {
  const peers = new WeakMap();
  const legacy = typeof connection.requestRejection === 'function';
  const peerAdmission = typeof connection.admit === 'function';
  return {
    registerRoute(definition) {
      if (legacy) return register(definition);
      if (!peerAdmission) throw new Error('角色扮演：宿主没有受支持的请求鉴权接口');
      return register({ ...definition, auth: 'required', handler: async (req, res, peer) => {
        if (peer?.principal?.kind !== 'owner') {
          res.writeHead(403); res.end(); return;
        }
        peers.set(req, peer);
        try { return await definition.handler(req, res); }
        finally { peers.delete(req); }
      } });
    },
    requestRejection(req) {
      if (legacy) return connection.requestRejection(req);
      return peers.get(req)?.principal?.kind === 'owner' ? undefined : 403;
    },
  };
}
