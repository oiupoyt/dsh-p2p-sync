import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { LocalReplica } from '../lib/local.js';
import { encodeSessionLog } from '../lib/sessionlog.js';
import { isExcludedPath, atomicWriteFile } from '../lib/replica.js';

describe('replica and local storage', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-home-'));
  });

  it('correctly filters excluded paths', () => {
    assert.equal(isExcludedPath('.credentials.yaml'), true);
    assert.equal(isExcludedPath('profiles/default/node_modules/pkg/index.js'), true);
    assert.equal(isExcludedPath('android/app-layer.patch.yml'), true);
    assert.equal(isExcludedPath('android/budget.json'), true);
    assert.equal(isExcludedPath('logs/app.log'), true);
    assert.equal(isExcludedPath('storages/session_projcache/sessions/abc.json'), true);
    assert.equal(isExcludedPath('sessions/p1/s1/session.lock'), true);

    // Allowed paths
    assert.equal(isExcludedPath('profiles/default/package.json'), false);
    assert.equal(isExcludedPath('profiles/default/cordis.patch.yml'), false);
    assert.equal(isExcludedPath('android/extensions-state.json'), false);
    assert.equal(isExcludedPath('datastore/settings.preferences_pb'), false);
  });

  it('scans sessions and marks locked sessions', async () => {
    const replica = new LocalReplica(tmpHome, 'dev-1');
    await replica.init();

    const sessDir = path.join(tmpHome, 'sessions', 'proj1', 'sess1');
    fs.mkdirSync(sessDir, { recursive: true });

    const buf = encodeSessionLog(
      { type: 'session', version: 4, id: 'sess1' },
      [{ seq: 0, text: 'hello' }]
    );
    fs.writeFileSync(path.join(sessDir, 'session.v4.jsonl.zstd'), buf);

    // Create session.lock
    fs.writeFileSync(path.join(sessDir, 'session.lock'), '');

    const manifest = await replica.getManifest();
    assert.ok(manifest.sessions['proj1/sess1']);
    assert.equal(manifest.sessions['proj1/sess1'].locked, true);
    assert.equal(manifest.sessions['proj1/sess1'].seq, 0);
  });

  it('stashes conflicting config on LWW loss', async () => {
    const replica = new LocalReplica(tmpHome, 'dev-1');
    await replica.init();

    const configPath = path.join(tmpHome, 'datastore', 'settings.preferences_pb');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'local-version-1');

    // Remote updates config
    const remoteBuf = Buffer.from('remote-version-2');
    const remoteSha = crypto.createHash('sha256').update(remoteBuf).digest('hex');

    await replica.applyConfig({
      relPath: 'datastore/settings.preferences_pb',
      version: '000000002000000000000000:dev-2',
      contentBase64: remoteBuf.toString('base64'),
      sha: remoteSha,
      stash: true,
    });

    // Verify current content updated
    assert.equal(fs.readFileSync(configPath, 'utf8'), 'remote-version-2');

    // Verify conflict file created in sync-state/conflicts/
    const conflictDir = path.join(tmpHome, 'sync-state', 'conflicts');
    assert.ok(fs.existsSync(conflictDir));
    const conflictFiles = fs.readdirSync(conflictDir);
    assert.equal(conflictFiles.length, 1);
    assert.ok(conflictFiles[0].startsWith('datastore_settings.preferences_pb'));
    assert.equal(
      fs.readFileSync(path.join(conflictDir, conflictFiles[0]), 'utf8'),
      'local-version-1'
    );
  });

  it('rejects corrupt payload with sha mismatch and leaves local file untouched', async () => {
    const replica = new LocalReplica(tmpHome, 'dev-1');
    await replica.init();

    const configPath = path.join(tmpHome, 'datastore', 'settings.preferences_pb');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'original-content');

    await assert.rejects(
      replica.applyConfig({
        relPath: 'datastore/settings.preferences_pb',
        version: '000000002000000000000000:dev-2',
        contentBase64: Buffer.from('new-content').toString('base64'),
        sha: 'fake-invalid-sha',
      }),
      (err) => err.message.includes('sha mismatch')
    );

    assert.equal(fs.readFileSync(configPath, 'utf8'), 'original-content');
  });
});
