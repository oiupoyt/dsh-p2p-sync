import fs from 'node:fs';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { LocalReplica } from './local.js';
import { PeerManager } from './peer.js';

export const name = 'dsh-p2p-sync';
export const inject = ['tools'];

export const Config = z.object({
  port: z.number().default(7421).description('TCP listening port for P2P sync (default 7421)'),
  peers: z.array(z.string()).default([]).description('Configured peer addresses (host:port or host)'),
  sharedSecret: z.string().default('').description('Shared secret for HMAC-SHA256 peer authentication'),
  intervalMs: z.number().default(0).description('Background loop interval in ms (0 = disabled)'),
  dshHome: z.string().default('').description('Path to DSH home directory (defaults to DSH_HOME env var)'),
  syncProjectDir: z.boolean().default(false).description('Sync working project directory (default false)'),
});

export async function apply(ctx, config = {}) {
  const dshHome = config.dshHome || process.env.DSH_HOME || process.cwd();
  const localReplica = new LocalReplica(dshHome);
  await localReplica.init();

  const peerManager = new PeerManager(localReplica, {
    port: config.port ?? 7421,
    peers: config.peers ?? [],
    sharedSecret: config.sharedSecret ?? '',
    intervalMs: config.intervalMs ?? 0,
  });

  await peerManager.start();

  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', async () => {
      await peerManager.stop();
    });
  }

  const toolDefs = [
    {
      name: 'sync_status',
      description: 'Report peers, last round result, per-session high-water marks, and pending conflicts.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
      },
      async execute() {
        const manifest = await localReplica.getManifest();
        const mgrStatus = peerManager.getStatus();

        const conflictDir = path.join(dshHome, 'sync-state', 'conflicts');
        const conflicts = fs.existsSync(conflictDir)
          ? fs.readdirSync(conflictDir)
          : [];

        return {
          deviceId: localReplica.deviceId,
          port: mgrStatus.port,
          peers: mgrStatus.peers,
          peerStatus: mgrStatus.peerStatus,
          activeSyncs: mgrStatus.activeSyncs,
          sessions: manifest.sessions,
          configs: manifest.configs,
          conflicts,
        };
      },
    },
    {
      name: 'sync_now',
      description: 'Force a sync round with a peer (or all peers); supports dryRun returning what would move.',
      parameters: {
        peer: { type: 'string', description: 'Peer address (host:port or host). If omitted, syncs with all peers.' },
        dryRun: { type: 'boolean', description: 'If true, simulates the sync and reports what would move.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
      },
      async execute(args = {}) {
        const targets = args.peer ? [args.peer] : peerManager.peers;
        if (targets.length === 0) {
          return { message: 'No peers configured to sync with' };
        }

        const results = {};
        for (const target of targets) {
          try {
            results[target] = await peerManager.syncPeer(target, { dryRun: !!args.dryRun });
          } catch (err) {
            results[target] = { error: err.message };
          }
        }
        return results;
      },
    },
    {
      name: 'sync_peers',
      description: 'List, add, or remove configured sync peers.',
      parameters: {
        action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Action to perform' },
        peer: { type: 'string', description: 'Peer address to add or remove' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
      },
      async execute(args = {}) {
        const action = args.action || 'list';
        if (action === 'add' && args.peer) {
          const norm = args.peer.trim();
          if (!peerManager.peers.includes(norm)) {
            peerManager.peers.push(norm);
          }
        } else if (action === 'remove' && args.peer) {
          const norm = args.peer.trim();
          peerManager.peers = peerManager.peers.filter((p) => p !== norm);
        }
        return { peers: peerManager.peers };
      },
    },
    {
      name: 'sync_pending',
      description: 'Inspect sessions and configs that differ right now by performing a dryRun comparison with peer.',
      parameters: {
        peer: { type: 'string', description: 'Peer address to check against' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
      },
      async execute(args = {}) {
        const target = args.peer || peerManager.peers[0];
        if (!target) {
          return { error: 'No peer specified or configured' };
        }
        try {
          return await peerManager.syncPeer(target, { dryRun: true });
        } catch (err) {
          return { error: err.message };
        }
      },
    },
  ];

  if (ctx?.tools?.register) {
    for (const t of toolDefs) {
      ctx.tools.register(t);
    }
  }

  async function getStatusData() {
    const manifest = await localReplica.getManifest();
    const mgrStatus = peerManager.getStatus();

    const conflictDir = path.join(dshHome, 'sync-state', 'conflicts');
    const conflicts = fs.existsSync(conflictDir)
      ? fs.readdirSync(conflictDir)
      : [];

    const now = Date.now();
    let isConnected = mgrStatus.activeSyncs.length > 0;
    for (const p of mgrStatus.peers) {
      const pStat = mgrStatus.peerStatus[p];
      if (pStat?.lastSuccess && now - pStat.lastSuccess < 15 * 60 * 1000) {
        isConnected = true;
        break;
      }
    }

    return {
      deviceId: localReplica.deviceId,
      port: mgrStatus.port,
      peers: mgrStatus.peers,
      peerStatus: mgrStatus.peerStatus,
      activeSyncs: mgrStatus.activeSyncs,
      listenerActive: mgrStatus.listenerActive,
      listenerError: mgrStatus.listenerError,
      connected: isConnected,
      sessionsCount: Object.keys(manifest.sessions).length,
      configsCount: Object.keys(manifest.configs).length,
      conflicts,
    };
  }

  const handleHttpRequest = async (req, res) => {
    const url = new URL(String(req.url), 'http://localhost');
    const pathname = url.pathname;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/api/p2p-sync/status' && req.method === 'GET') {
      try {
        const data = await getStatusData();
        res.writeHead(200);
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/p2p-sync/sync' && req.method === 'POST') {
      let bodyText = '';
      for await (const chunk of req) {
        bodyText += chunk;
      }
      let body = {};
      try { if (bodyText) body = JSON.parse(bodyText); } catch {}

      try {
        const targets = body.peer ? [body.peer] : peerManager.peers;
        if (targets.length === 0) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: false, message: 'No peers configured to sync with' }));
          return;
        }
        const results = {};
        for (const target of targets) {
          try {
            results[target] = await peerManager.syncPeer(target, { dryRun: !!body.dryRun });
          } catch (err) {
            results[target] = { error: err.message };
          }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, results }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/p2p-sync/peers' && req.method === 'POST') {
      let bodyText = '';
      for await (const chunk of req) {
        bodyText += chunk;
      }
      let body = {};
      try { if (bodyText) body = JSON.parse(bodyText); } catch {}

      const action = body.action || 'list';
      if (action === 'add' && body.peer) {
        const norm = body.peer.trim();
        if (!peerManager.peers.includes(norm)) {
          peerManager.peers.push(norm);
        }
      } else if (action === 'remove' && body.peer) {
        const norm = body.peer.trim();
        peerManager.peers = peerManager.peers.filter((p) => p !== norm);
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, peers: peerManager.peers }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  };

  const disposers = [];

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  if (webServer?.register) {
    const unregister = webServer.register({
      kind: 'prefix',
      path: '/api/p2p-sync/',
      handler: handleHttpRequest,
    });
    if (typeof unregister === 'function') disposers.push(unregister);
  }

  const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  if (conn?.fetch?.register) {
    const unregister = conn.fetch.register({
      path: '/api/p2p-sync/status',
      methods: ['GET'],
      fetch: async () => new Response(JSON.stringify(await getStatusData()), {
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    if (typeof unregister === 'function') disposers.push(unregister);
  }

  const cleanup = async () => {
    while (disposers.length > 0) {
      try {
        disposers.pop()();
      } catch {}
    }
    await peerManager.stop();
  };

  Object.defineProperty(cleanup, 'name', { value: name, configurable: true });
  cleanup.localReplica = localReplica;
  cleanup.peerManager = peerManager;
  cleanup.tools = toolDefs;
  cleanup.sync_status = toolDefs[0].execute;
  cleanup.sync_now = toolDefs[1].execute;
  cleanup.sync_peers = toolDefs[2].execute;
  cleanup.sync_pending = toolDefs[3].execute;
  cleanup.stop = cleanup;

  return cleanup;
}

Object.defineProperty(apply, 'name', { value: name, configurable: true });
export default Object.assign(apply, { Config, inject });
