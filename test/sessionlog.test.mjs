import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSessionLog,
  encodeSessionLog,
  validateEventContiguity,
  appendEventsToBuffer,
  SessionLogContiguityError,
} from '../lib/sessionlog.js';

describe('sessionlog codec', () => {
  const header = { type: 'session', version: 4, id: 'sess-1', createdAt: 1000 };
  const events = [
    { seq: 0, type: 'user_prompt', content: 'hello' },
    { seq: 1, type: 'assistant_response', content: 'hi' },
  ];

  it('encodes and decodes session log buffer correctly', () => {
    const buf = encodeSessionLog(header, events);
    assert.ok(Buffer.isBuffer(buf));
    const decoded = decodeSessionLog(buf);
    assert.deepEqual(decoded.header, header);
    assert.deepEqual(decoded.events, events);
    assert.equal(decoded.maxSeq, 1);
    assert.equal(typeof decoded.sha256, 'string');
    assert.equal(decoded.sha256.length, 64);
  });

  it('validates event contiguity and detects gaps', () => {
    validateEventContiguity(events, 0); // should not throw

    const gapEvents = [
      { seq: 0, type: 'a' },
      { seq: 2, type: 'b' },
    ];
    assert.throws(
      () => validateEventContiguity(gapEvents, 0),
      SessionLogContiguityError
    );
  });

  it('appends events to existing session log buffer', () => {
    const buf = encodeSessionLog(header, events);
    const newEvents = [{ seq: 2, type: 'user_prompt', content: 'what next?' }];
    const appended = appendEventsToBuffer(buf, newEvents);
    assert.equal(appended.maxSeq, 2);
    const decoded = decodeSessionLog(appended.buffer);
    assert.equal(decoded.events.length, 3);
    assert.equal(decoded.maxSeq, 2);
  });

  it('refuses appending non-contiguous events to existing buffer', () => {
    const buf = encodeSessionLog(header, events);
    const gapEvents = [{ seq: 3, type: 'user_prompt', content: 'gap' }];
    assert.throws(
      () => appendEventsToBuffer(buf, gapEvents),
      SessionLogContiguityError
    );
  });
});
