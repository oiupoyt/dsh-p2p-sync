import net from 'node:net';
import crypto from 'node:crypto';
import { Channel } from './wire.js';
import { executeSyncRound } from './sync.js';

export async function authenticateHandshake(channel, sharedSecret) {
  if (!sharedSecret) {
    return true;
  }

  const localNonce = crypto.randomBytes(32).toString('hex');
  await channel.send({ type: 'auth-challenge', nonce: localNonce });

  const remoteChallenge = await channel.receive('auth-challenge');
  const remoteNonce = remoteChallenge.nonce;

  const proof = crypto
    .createHmac('sha256', sharedSecret)
    .update(localNonce + remoteNonce)
    .digest('hex');

  const expectedRemoteProof = crypto
    .createHmac('sha256', sharedSecret)
    .update(remoteNonce + localNonce)
    .digest('hex');

  await channel.send({ type: 'auth-response', proof });

  const remoteResponse = await channel.receive('auth-response');
  if (remoteResponse.proof !== expectedRemoteProof) {
    throw new Error('Authentication failed: proof mismatch');
  }

  return true;
}

export function parsePeerAddress(peerStr, defaultPort = 7421) {
  const str = peerStr.trim();
  const colonIdx = str.lastIndexOf(':');
  if (colonIdx === -1) {
    return { host: str, port: defaultPort };
  }
  const host = str.slice(0, colonIdx);
  const port = parseInt(str.slice(colonIdx + 1), 10);
  return { host, port: Number.isNaN(port) ? defaultPort : port };
}

export class PeerManager {
  constructor(localReplica, config = {}) {
    this.localReplica = localReplica;
    this.port = config.port || 7421;
    this.peers = Array.isArray(config.peers) ? [...config.peers] : [];
    this.sharedSecret = config.sharedSecret || '';
    this.intervalMs = config.intervalMs || 0;
    this.server = null;
    this.timer = null;
    this.activeSyncs = new Set();
    this.peerStatus = new Map();
  }

  async start() {
    await this.startListener();
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        this.runScheduledRound().catch(() => {});
      }, this.intervalMs);
    }
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
  }

  async startListener() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer(async (socket) => {
        const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
        const channel = new Channel(socket);
        try {
          await authenticateHandshake(channel, this.sharedSecret);
          await executeSyncRound(channel, this.localReplica);
        } catch {
          // Socket error or sync fail
        } finally {
          channel.close();
        }
      });

      srv.on('error', (err) => {
        reject(err);
      });

      srv.listen(this.port, () => {
        this.server = srv;
        resolve();
      });
    });
  }

  async syncPeer(peerStr, opts = {}) {
    const norm = peerStr.trim();
    if (this.activeSyncs.has(norm)) {
      return { skipped: 'concurrent_sync_in_progress' };
    }

    this.activeSyncs.add(norm);
    const { host, port } = parsePeerAddress(norm, this.port);

    try {
      const socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host, port }, () => resolve(s));
        s.once('error', reject);
      });

      const channel = new Channel(socket);
      try {
        await authenticateHandshake(channel, this.sharedSecret);
        const result = await executeSyncRound(channel, this.localReplica, opts);

        const status = this.peerStatus.get(norm) || {};
        this.peerStatus.set(norm, {
          ...status,
          lastSuccess: Date.now(),
          lastError: null,
          backoffMs: 1000,
        });

        return result;
      } finally {
        channel.close();
      }
    } catch (err) {
      const status = this.peerStatus.get(norm) || {};
      const nextBackoff = Math.min((status.backoffMs || 1000) * 2, 60000);
      this.peerStatus.set(norm, {
        ...status,
        lastError: err.message,
        lastFailure: Date.now(),
        backoffMs: nextBackoff,
      });
      throw err;
    } finally {
      this.activeSyncs.delete(norm);
    }
  }

  async runScheduledRound() {
    const now = Date.now();
    for (const peer of this.peers) {
      const status = this.peerStatus.get(peer);
      if (status?.lastFailure && status?.backoffMs) {
        if (now - status.lastFailure < status.backoffMs) {
          continue; // In backoff period
        }
      }
      this.syncPeer(peer).catch(() => {});
    }
  }

  getStatus() {
    const peerStatuses = {};
    for (const peer of this.peers) {
      peerStatuses[peer] = this.peerStatus.get(peer) || {
        lastSuccess: null,
        lastError: null,
      };
    }
    return {
      port: this.port,
      peers: this.peers,
      activeSyncs: Array.from(this.activeSyncs),
      peerStatus: peerStatuses,
    };
  }
}
