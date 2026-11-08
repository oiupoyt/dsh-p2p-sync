import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Duplex } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Channel } from '../lib/wire.js';
import { LocalReplica } from '../lib/local.js';
import { executeSyncRound } from '../lib/sync.js';
import { authenticateHandshake, PeerManager } from '../lib/peer.js';

function createDuplexPair() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const sideA = Duplex.from({ readable: bToA, writable: aToB });
  const sideB = Duplex.from({ readable: aToB, writable: bToA });
  return [sideA, sideB];
}

describe('sync protocol and peer transport', () => {
  it('authenticates peers with HMAC-SHA256 handshake over shared secret', async () => {
    const [streamA, streamB] = createDuplexPair();

    const chA = new Channel(streamA, { timeoutMs: 2000 });
    const chB = new Channel(streamB, { timeoutMs: 2000 });

    const secret = 'test-secret-key-123';

    const [resA, resB] = await Promise.all([
      authenticateHandshake(chA, secret),
      authenticateHandshake(chB, secret),
    ]);

    assert.equal(resA, true);
    assert.equal(resB, true);
  });

  it('rejects handshake when shared secrets do not match', async () => {
    const [streamA, streamB] = createDuplexPair();

    const chA = new Channel(streamA, { timeoutMs: 2000 });
    const chB = new Channel(streamB, { timeoutMs: 2000 });

    await assert.rejects(
      Promise.all([
        authenticateHandshake(chA, 'secret-a'),
        authenticateHandshake(chB, 'secret-b'),
      ])
    );
  });

  it('runs symmetric sync round between two in-memory replicas', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-b-'));

    const repA = new LocalReplica(dirA, 'dev-a');
    const repB = new LocalReplica(dirB, 'dev-b');
    await repA.init();
    await repB.init();

    // Setup a dummy config in A
    const confA = path.join(dirA, 'datastore', 'settings.preferences_pb');
    fs.mkdirSync(path.dirname(confA), { recursive: true });
    fs.writeFileSync(confA, 'prefs-content');

    const [streamA, streamB] = createDuplexPair();

    const chA = new Channel(streamA, { timeoutMs: 5000 });
    const chB = new Channel(streamB, { timeoutMs: 5000 });

    const [statsA, statsB] = await Promise.all([
      executeSyncRound(chA, repA),
      executeSyncRound(chB, repB),
    ]);

    assert.ok(statsA);
    assert.ok(statsB);

    // Verify B now has the config file
    const confB = path.join(dirB, 'datastore', 'settings.preferences_pb');
    assert.ok(fs.existsSync(confB));
    assert.equal(fs.readFileSync(confB, 'utf8'), 'prefs-content');
  });

  it('runs sync over real TCP sockets using PeerManager', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tcp-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tcp-b-'));

    const repA = new LocalReplica(dirA, 'tcp-a');
    const repB = new LocalReplica(dirB, 'tcp-b');
    await repA.init();
    await repB.init();

    // Create session in A
    const sessDirA = path.join(dirA, 'sessions', 'proj-tcp', 'sess-1');
    fs.mkdirSync(sessDirA, { recursive: true });
    const { encodeSessionLog } = await import('../lib/sessionlog.js');
    const buf = encodeSessionLog(
      { type: 'session', version: 4, id: 'sess-1' },
      [{ seq: 0, text: 'hello tcp' }]
    );
    fs.writeFileSync(path.join(sessDirA, 'session.v4.jsonl.zstd'), buf);

    // Pick a random available high port
    const port = 17421;
    const secret = 'super-secret-sync';

    const pmA = new PeerManager(repA, { port, sharedSecret: secret });
    const pmB = new PeerManager(repB, { port: port + 1, sharedSecret: secret });

    await pmA.start();

    try {
      // B dials A
      const res = await pmB.syncPeer(`127.0.0.1:${port}`);
      assert.equal(res.sessionsReceived, 1);

      // Verify B received session
      const sessDirB = path.join(dirB, 'sessions', 'proj-tcp', 'sess-1');
      assert.ok(fs.existsSync(path.join(sessDirB, 'session.v4.jsonl.zstd')));
    } finally {
      await pmA.stop();
      await pmB.stop();
    }
  });
});
