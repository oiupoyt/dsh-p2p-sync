import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Duplex } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { Channel } from '../lib/wire.js';
import { LocalReplica } from '../lib/local.js';
import { executeSyncRound } from '../lib/sync.js';
import {
  encodeSessionLog,
  decodeSessionLog,
  appendEventsToBuffer,
  SessionLogContiguityError,
} from '../lib/sessionlog.js';

function createDuplexPair() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const sideA = Duplex.from({ readable: bToA, writable: aToB });
  const sideB = Duplex.from({ readable: aToB, writable: bToA });
  return [sideA, sideB];
}

function createHome(prefix = 'dsh-sim-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSession(homeDir, projectKey, sessionId, events, headerExtra = {}) {
  const sessDir = path.join(homeDir, 'sessions', projectKey, sessionId);
  fs.mkdirSync(sessDir, { recursive: true });
  const header = {
    type: 'session',
    version: 4,
    id: sessionId,
    createdAt: Date.now(),
    cwd: '/workspace',
    isSeeded: false,
    delegationDepth: 0,
    ...headerExtra,
  };
  const buf = encodeSessionLog(header, events);
  const logFile = path.join(sessDir, 'session.v4.jsonl.zstd');
  fs.writeFileSync(logFile, buf);
  return { logFile, buf };
}

describe('dsh-p2p-sync simulation suite', () => {
  it('1. Cold start — A has 3 sessions, B none → after one round B has all 3, identical sha', async () => {
    const homeA = createHome('home-a-');
    const homeB = createHome('home-b-');

    const repA = new LocalReplica(homeA, 'dev-a');
    const repB = new LocalReplica(homeB, 'dev-b');
    await repA.init();
    await repB.init();

    writeSession(homeA, 'proj1', 'sess1', [
      { seq: 0, text: 'hello 1' },
      { seq: 1, text: 'hello 2' },
    ]);
    writeSession(homeA, 'proj1', 'sess2', [
      { seq: 0, text: 'sess2 ev0' },
    ]);
    writeSession(homeA, 'proj2', 'sess3', [
      { seq: 0, text: 'sess3 ev0' },
      { seq: 1, text: 'sess3 ev1' },
      { seq: 2, text: 'sess3 ev2' },
    ]);

    const [sA, sB] = createDuplexPair();
    const chA = new Channel(sA);
    const chB = new Channel(sB);

    await Promise.all([
      executeSyncRound(chA, repA),
      executeSyncRound(chB, repB),
    ]);

    const mfA = await repA.getManifest();
    const mfB = await repB.getManifest();

    assert.equal(Object.keys(mfB.sessions).length, 3);
    for (const key of ['proj1/sess1', 'proj1/sess2', 'proj2/sess3']) {
      assert.ok(mfB.sessions[key], `Missing ${key} in B`);
      assert.equal(mfB.sessions[key].seq, mfA.sessions[key].seq);
      assert.equal(mfB.sessions[key].sha, mfA.sessions[key].sha);
    }
  });

  it('2. Incremental — both start synced; A appends 2 events → one round moves exactly 2', async () => {
    const homeA = createHome('home-a-');
    const homeB = createHome('home-b-');

    const repA = new LocalReplica(homeA, 'dev-a');
    const repB = new LocalReplica(homeB, 'dev-b');
    await repA.init();
    await repB.init();

    const initialEvents = [
      { seq: 0, text: 'msg 0' },
      { seq: 1, text: 'msg 1' },
    ];
    const initialHeader = { createdAt: 1000000 };
    writeSession(homeA, 'proj1', 'sess1', initialEvents, initialHeader);
    writeSession(homeB, 'proj1', 'sess1', initialEvents, initialHeader);

    // A appends 2 new events
    const logA = path.join(homeA, 'sessions', 'proj1', 'sess1', 'session.v4.jsonl.zstd');
    const currentBufA = fs.readFileSync(logA);
    const newEvents = [
      { seq: 2, text: 'msg 2' },
      { seq: 3, text: 'msg 3' },
    ];
    const { buffer: updatedBufA } = appendEventsToBuffer(currentBufA, newEvents);
    fs.writeFileSync(logA, updatedBufA);

    const [sA, sB] = createDuplexPair();
    const chA = new Channel(sA);
    const chB = new Channel(sB);

    const [statsA, statsB] = await Promise.all([
      executeSyncRound(chA, repA),
      executeSyncRound(chB, repB),
    ]);

    assert.equal(statsB.sessionsReceived, 1);

    const mfA = await repA.getManifest();
    const mfB = await repB.getManifest();
    assert.equal(mfB.sessions['proj1/sess1'].seq, 3);
    assert.equal(mfB.sessions['proj1/sess1'].sha, mfA.sessions['proj1/sess1'].sha);

    // Verify B's session has exactly 4 events now
    const logB = path.join(homeB, 'sessions', 'proj1', 'sess1', 'session.v4.jsonl.zstd');
    const decodedB = decodeSessionLog(fs.readFileSync(logB));
    assert.equal(decodedB.events.length, 4);
    assert.equal(decodedB.events[2].text, 'msg 2');
    assert.equal(decodedB.events[3].text, 'msg 3');
  });

  it('3. Offline divergence — both append to the same session while disconnected → converges with fork and idempotent stability', async () => {
    const homeZ = createHome('home-z-');
    const homeA = createHome('home-a-');

    // dev-z has higher deviceId than dev-a
    const repZ = new LocalReplica(homeZ, 'dev-z-greater');
    const repA = new LocalReplica(homeA, 'dev-a-lesser');
    await repZ.init();
    await repA.init();

    const baseEvents = [{ seq: 0, text: 'base event' }];
    writeSession(homeZ, 'proj', 'sess1', baseEvents);
    writeSession(homeA, 'proj', 'sess1', baseEvents);

    // Offline: both advance independently at seq 1
    const logZ = path.join(homeZ, 'sessions', 'proj', 'sess1', 'session.v4.jsonl.zstd');
    const logA = path.join(homeA, 'sessions', 'proj', 'sess1', 'session.v4.jsonl.zstd');

    const { buffer: bufZ } = appendEventsToBuffer(fs.readFileSync(logZ), [{ seq: 1, text: 'Z edit' }]);
    const { buffer: bufA } = appendEventsToBuffer(fs.readFileSync(logA), [{ seq: 1, text: 'A edit' }]);
    fs.writeFileSync(logZ, bufZ);
    fs.writeFileSync(logA, bufA);

    // Round 1
    const [s1Z, s1A] = createDuplexPair();
    const ch1Z = new Channel(s1Z);
    const ch1A = new Channel(s1A);

    await Promise.all([
      executeSyncRound(ch1Z, repZ),
      executeSyncRound(ch1A, repA),
    ]);

    const dev8 = 'dev-z-gr'; // first 8 chars of 'dev-z-greater'
    const forkedKey = `proj/sess1-fork-${dev8}`;

    // After Round 1: repZ renamed its copy to forkedKey, repA kept canonical sess1
    const mfZ1 = await repZ.getManifest();
    const mfA1 = await repA.getManifest();

    assert.ok(mfZ1.sessions[forkedKey], `Expected ${forkedKey} on Z`);
    assert.ok(mfA1.sessions['proj/sess1'], 'Expected canonical proj/sess1 on A');

    // Round 2: Now both replicas see the peer has a session they lack and exchange them
    const [s2Z, s2A] = createDuplexPair();
    const ch2Z = new Channel(s2Z);
    const ch2A = new Channel(s2A);

    await Promise.all([
      executeSyncRound(ch2Z, repZ),
      executeSyncRound(ch2A, repA),
    ]);

    const mfZ2 = await repZ.getManifest();
    const mfA2 = await repA.getManifest();

    // Both sessions exist on both replicas now!
    assert.ok(mfZ2.sessions['proj/sess1'], 'Z has canonical sess1');
    assert.ok(mfZ2.sessions[forkedKey], 'Z has forked sess1');
    assert.ok(mfA2.sessions['proj/sess1'], 'A has canonical sess1');
    assert.ok(mfA2.sessions[forkedKey], 'A has forked sess1');

    assert.equal(mfZ2.sessions['proj/sess1'].sha, mfA2.sessions['proj/sess1'].sha);
    assert.equal(mfZ2.sessions[forkedKey].sha, mfA2.sessions[forkedKey].sha);

    // Round 3: Idempotent stability check (no changes, 0 received)
    const [s3Z, s3A] = createDuplexPair();
    const ch3Z = new Channel(s3Z);
    const ch3A = new Channel(s3A);

    const [statsZ3, statsA3] = await Promise.all([
      executeSyncRound(ch3Z, repZ),
      executeSyncRound(ch3A, repA),
    ]);

    assert.equal(statsZ3.sessionsReceived, 0);
    assert.equal(statsA3.sessionsReceived, 0);
    assert.equal(statsZ3.forks, 0);
    assert.equal(statsA3.forks, 0);
  });

  it('4. Config LWW — B edits later → B wins; A content survives in sync-state/conflicts/', async () => {
    const homeA = createHome('home-a-');
    const homeB = createHome('home-b-');

    const repA = new LocalReplica(homeA, 'dev-a');
    const repB = new LocalReplica(homeB, 'dev-b');
    await repA.init();
    await repB.init();

    const confRel = 'profiles/default/cordis.patch.yml';
    const confA = path.join(homeA, confRel);
    const confB = path.join(homeB, confRel);

    fs.mkdirSync(path.dirname(confA), { recursive: true });
    fs.mkdirSync(path.dirname(confB), { recursive: true });

    fs.writeFileSync(confA, 'initial-a');
    fs.writeFileSync(confB, 'initial-a');

    // Run round to align versions
    const [s1A, s1B] = createDuplexPair();
    await Promise.all([
      executeSyncRound(new Channel(s1A), repA),
      executeSyncRound(new Channel(s1B), repB),
    ]);

    // Now B edits later
    // Advance B clock and write
    repB.hlc.now();
    fs.writeFileSync(confB, 'edited-by-b');

    const [s2A, s2B] = createDuplexPair();
    await Promise.all([
      executeSyncRound(new Channel(s2A), repA),
      executeSyncRound(new Channel(s2B), repB),
    ]);

    // B's edit wins on both
    assert.equal(fs.readFileSync(confA, 'utf8'), 'edited-by-b');
    assert.equal(fs.readFileSync(confB, 'utf8'), 'edited-by-b');

    // A's old content survived in conflicts
    const conflictDirA = path.join(homeA, 'sync-state', 'conflicts');
    assert.ok(fs.existsSync(conflictDirA));
    const conflicts = fs.readdirSync(conflictDirA);
    assert.ok(conflicts.length >= 1);
    const stashed = fs.readFileSync(path.join(conflictDirA, conflicts[0]), 'utf8');
    assert.equal(stashed, 'initial-a');
  });

  it('5. Contiguity refusal — a crafted gap must throw, and local log must be unchanged', () => {
    const home = createHome('home-gap-');
    const { logFile, buf: origBuf } = writeSession(home, 'proj', 's1', [
      { seq: 0, text: 'a' },
      { seq: 1, text: 'b' },
    ]);

    const gapEvents = [{ seq: 3, text: 'c (gap at 2)' }];
    assert.throws(
      () => appendEventsToBuffer(origBuf, gapEvents),
      SessionLogContiguityError
    );

    // Verify local file untouched
    const currentBuf = fs.readFileSync(logFile);
    assert.ok(currentBuf.equals(origBuf));
  });

  it('6. Corrupt payload — a sha mismatch must be rejected and local file untouched', async () => {
    const home = createHome('home-corrupt-');
    const rep = new LocalReplica(home, 'dev-1');
    await rep.init();

    const confRel = 'android/extensions-state.json';
    const confPath = path.join(home, confRel);
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(confPath, 'good-original-data');

    await assert.rejects(
      rep.applyConfig({
        relPath: confRel,
        version: '000000002000000000000000:dev-2',
        contentBase64: Buffer.from('tampered-data').toString('base64'),
        sha: 'fake-corrupt-sha',
      }),
      (err) => err.message.includes('sha mismatch')
    );

    assert.equal(fs.readFileSync(confPath, 'utf8'), 'good-original-data');
  });

  it('7. Exclusions — sensitive & local files never appear in manifest or get written', async () => {
    const home = createHome('home-exclusions-');
    const rep = new LocalReplica(home, 'dev-1');
    await rep.init();

    // Create excluded files
    fs.writeFileSync(path.join(home, '.credentials.yaml'), 'SECRET_TOKEN: 12345');

    const modDir = path.join(home, 'profiles', 'default', 'node_modules', 'evil');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'index.js'), 'malicious');

    const androidDir = path.join(home, 'android');
    fs.mkdirSync(androidDir, { recursive: true });
    fs.writeFileSync(path.join(androidDir, 'app-layer.patch.yml'), 'regen');
    fs.writeFileSync(path.join(androidDir, 'budget.json'), '{}');
    fs.writeFileSync(path.join(androidDir, 'boot-journal.json'), '{}');
    fs.writeFileSync(path.join(androidDir, 'pnpm-report.jsonl'), '');

    const logsDir = path.join(home, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'app.log'), 'logs');

    const cacheDir = path.join(home, 'storages', 'session_projcache', 'sessions');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'cache.json'), '{}');

    // Also create valid config
    const prefDir = path.join(home, 'datastore');
    fs.mkdirSync(prefDir, { recursive: true });
    fs.writeFileSync(path.join(prefDir, 'settings.preferences_pb'), 'prefs');

    const manifest = await rep.getManifest();
    const configKeys = Object.keys(manifest.configs);

    // Only allowed config appears
    assert.deepEqual(configKeys, ['datastore/settings.preferences_pb']);

    // Attempting to apply an excluded path directly must throw
    await assert.rejects(
      rep.applyConfig({
        relPath: '.credentials.yaml',
        version: '000000001000000000000000:dev-x',
        contentBase64: Buffer.from('leak').toString('base64'),
        sha: crypto.createHash('sha256').update(Buffer.from('leak')).digest('hex'),
      }),
      (err) => err.message.includes('Attempt to apply excluded path')
    );
  });

  it('8. Locked session — present session.lock makes the round skip, not corrupt', async () => {
    const homeA = createHome('home-a-');
    const homeB = createHome('home-b-');

    const repA = new LocalReplica(homeA, 'dev-a');
    const repB = new LocalReplica(homeB, 'dev-b');
    await repA.init();
    await repB.init();

    writeSession(homeA, 'p1', 's1', [{ seq: 0, text: 'a' }]);
    const { logFile: logB } = writeSession(homeB, 'p1', 's1', [{ seq: 0, text: 'b' }]);
    const origB = fs.readFileSync(logB);

    // Lock session on B
    const lockB = path.join(homeB, 'sessions', 'p1', 's1', 'session.lock');
    fs.writeFileSync(lockB, '');

    const [sA, sB] = createDuplexPair();
    await Promise.all([
      executeSyncRound(new Channel(sA), repA),
      executeSyncRound(new Channel(sB), repB),
    ]);

    // B was locked, so its session was skipped and not modified
    assert.ok(fs.readFileSync(logB).equals(origB));
  });
});
