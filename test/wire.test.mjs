import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { Channel, WireError, MAX_FRAME_SIZE } from '../lib/wire.js';

describe('wire protocol and channel', () => {
  it('sends and receives JSON frames with 4-byte BE length prefix', async () => {
    const s1 = new PassThrough();
    const s2 = new PassThrough();

    // Wire s1 -> s2 and s2 -> s1
    const chA = new Channel(s1, { timeoutMs: 5000 });
    const chB = new Channel(s2, { timeoutMs: 5000 });

    // Link output of A to input of B
    s1.pipe(s2);

    await chA.send({ type: 'hello', protocol: 'dsh-p2p-v1', deviceId: 'dev-1' });
    const msg = await chB.receive('hello');

    assert.equal(msg.type, 'hello');
    assert.equal(msg.protocol, 'dsh-p2p-v1');
    assert.equal(msg.deviceId, 'dev-1');
  });

  it('rejects frame exceeding 64 MiB limit with WireError', async () => {
    const s = new PassThrough();
    const ch = new Channel(s);

    // Write a fake 4-byte length indicating 65 MiB
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_SIZE + 1024, 0);

    const receivePromise = ch.receive();
    s.write(header);

    await assert.rejects(receivePromise, WireError);
  });

  it('rejects when receive times out', async () => {
    const s = new PassThrough();
    const ch = new Channel(s, { timeoutMs: 50 });

    await assert.rejects(
      ch.receive('never-arrives', 50),
      (err) => err instanceof WireError && /timed out/i.test(err.message)
    );
  });

  it('rejects when received type does not match expectedType', async () => {
    const s1 = new PassThrough();
    const s2 = new PassThrough();
    const chA = new Channel(s1);
    const chB = new Channel(s2);
    s1.pipe(s2);

    await chA.send({ type: 'bye' });
    await assert.rejects(
      chB.receive('hello'),
      (err) => err instanceof WireError && err.message.includes('Unexpected frame type')
    );
  });
});
