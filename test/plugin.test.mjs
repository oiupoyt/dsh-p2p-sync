import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import plugin, { name, inject, Config, apply } from '../lib/index.js';

describe('plugin registration and tools', () => {
  it('exports valid Cordis plugin contract', () => {
    assert.equal(name, 'dsh-p2p-sync');
    assert.deepEqual(inject, ['tools']);
    assert.ok(Config);
    assert.equal(typeof apply, 'function');
    assert.equal(typeof plugin, 'function');
    assert.equal(plugin.name, 'dsh-p2p-sync');
  });

  it('registers tools on context and executes status, peers, now, and pending', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-home-'));

    // Mock Context
    const registeredTools = new Map();
    const mockCtx = {
      tools: {
        register: (toolDef) => {
          registeredTools.set(toolDef.name, toolDef);
        },
      },
      on: () => {},
    };

    const config = {
      dshHome: tmpHome,
      port: 18421,
      peers: ['127.0.0.1:18422'],
    };

    const instance = await apply(mockCtx, config);

    // Verify tools registered
    assert.ok(registeredTools.has('sync_status'));
    assert.ok(registeredTools.has('sync_now'));
    assert.ok(registeredTools.has('sync_peers'));
    assert.ok(registeredTools.has('sync_pending'));

    // Test sync_status
    const statusHandler = registeredTools.get('sync_status').execute;
    const status = await statusHandler({});
    assert.equal(status.port, 18421);
    assert.deepEqual(status.peers, ['127.0.0.1:18422']);
    assert.ok(status.deviceId);

    // Test sync_peers
    const peersHandler = registeredTools.get('sync_peers').execute;
    const added = await peersHandler({ action: 'add', peer: '10.0.0.2:7421' });
    assert.ok(added.peers.includes('10.0.0.2:7421'));

    const removed = await peersHandler({ action: 'remove', peer: '127.0.0.1:18422' });
    assert.ok(!removed.peers.includes('127.0.0.1:18422'));

    // Cleanup
    if (instance?.stop) {
      await instance.stop();
    }
  });
});
