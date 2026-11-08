import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HLC } from '../lib/hlc.js';

describe('Hybrid Logical Clock (HLC)', () => {
  it('generates strictly monotonic versions locally', () => {
    const hlc = new HLC('dev-a');
    const v1 = hlc.now();
    const v2 = hlc.now();

    assert.ok(v1.endsWith(':dev-a'));
    assert.ok(v2.endsWith(':dev-a'));
    assert.ok(v1 < v2, `expected ${v1} < ${v2}`);
  });

  it('unpacks and packs consistently', () => {
    const hlc = new HLC('laptop');
    const v = hlc.now();
    const unpacked = HLC.unpack(v);
    assert.equal(unpacked.device, 'laptop');
    assert.equal(typeof unpacked.millis, 'number');
    assert.equal(typeof unpacked.counter, 'number');
    assert.equal(HLC.pack(unpacked.millis, unpacked.counter, unpacked.device), v);
  });

  it('advances clock when observing a higher remote version', () => {
    const hlcA = new HLC('dev-a');
    const hlcB = new HLC('dev-b');

    // Remote has higher millis in the future
    const remoteFuture = HLC.pack(Date.now() + 10000, 5, 'dev-b');
    hlcA.observe(remoteFuture);

    const nextLocal = hlcA.now();
    assert.ok(nextLocal > remoteFuture, `expected ${nextLocal} > ${remoteFuture}`);
  });

  it('compares correctly with static compare', () => {
    const v1 = HLC.pack(1000, 0, 'dev-a');
    const v2 = HLC.pack(1000, 1, 'dev-a');
    const v3 = HLC.pack(2000, 0, 'dev-a');

    assert.equal(HLC.compare(v1, v2), -1);
    assert.equal(HLC.compare(v2, v1), 1);
    assert.equal(HLC.compare(v1, v1), 0);
    assert.equal(HLC.compare(v2, v3), -1);
  });
});
