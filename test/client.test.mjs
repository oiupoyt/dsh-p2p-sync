import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('P2P Sync Client Module', () => {
  it('registers settings.section, icon, and general row via __ModuleLoader__', async () => {
    let loadedModule = null;

    // Mock window environment
    globalThis.window = {
      __ModuleLoader__: {
        load(mod) {
          loadedModule = mod;
        },
      },
    };

    // Load client.js
    await import('../lib/client.js');

    assert.ok(loadedModule, 'Expected module to be registered on __ModuleLoader__');
    assert.equal(loadedModule.id, 'dsh-p2p-sync');
    assert.equal(typeof loadedModule.factory, 'function');

    // Simulate factory require
    const fakeReact = {
      createElement(tag, props, ...children) {
        return { tag, props, children };
      },
      useState(initial) {
        return [initial, () => {}];
      },
      useEffect(fn) {
        // fn();
      },
    };

    const plugin = loadedModule.factory((pkg) => {
      if (pkg === 'react') return fakeReact;
      throw new Error(`Unexpected require: ${pkg}`);
    });

    assert.deepEqual(plugin.inject, ['slots']);
    assert.equal(typeof plugin.apply, 'function');

    const registeredSlots = new Map();
    const mockCtx = {
      slots: {
        inject(slotName, callback) {
          callback();
        },
        register(options, component) {
          registeredSlots.set(options.name, { options, component });
          return () => {};
        },
      },
    };

    plugin.apply(mockCtx);

    assert.ok(registeredSlots.has('settings.section'), 'Expected settings.section registered');
    assert.ok(registeredSlots.has('settings.section.icon'), 'Expected settings.section.icon registered');
    assert.ok(registeredSlots.has('settings.general.item'), 'Expected settings.general.item registered');

    const sec = registeredSlots.get('settings.section');
    assert.equal(sec.options.id, 'p2p-sync');
    assert.equal(sec.options.label, 'P2P Sync');

    const icon = registeredSlots.get('settings.section.icon');
    assert.equal(icon.options.id, 'p2p-sync');

    const general = registeredSlots.get('settings.general.item');
    assert.equal(general.options.id, 'p2p-sync-status');
  });
});
