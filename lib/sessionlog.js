import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export class SessionLogContiguityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionLogContiguityError';
  }
}

export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function validateEventContiguity(events, expectedStartSeq = 0) {
  for (let i = 0; i < events.length; i++) {
    const expected = expectedStartSeq + i;
    if (events[i].seq !== expected) {
      throw new SessionLogContiguityError(
        `Non-contiguous event seq: expected ${expected}, got ${events[i].seq}`
      );
    }
  }
}

export function encodeSessionLog(header, events = []) {
  validateEventContiguity(events, 0);
  const lines = [JSON.stringify(header)];
  for (const ev of events) {
    lines.push(JSON.stringify(ev));
  }
  const payload = Buffer.from(lines.join('\n') + '\n', 'utf8');
  return zstdCompressSync(payload);
}

export function decodeSessionLog(compressedBuffer) {
  const decompressed = zstdDecompressSync(compressedBuffer);
  const text = decompressed.toString('utf8');
  const rawLines = text.split('\n').filter((line) => line.trim().length > 0);
  if (rawLines.length === 0) {
    throw new Error('Empty session log');
  }

  const header = JSON.parse(rawLines[0]);
  const events = [];
  for (let i = 1; i < rawLines.length; i++) {
    events.push(JSON.parse(rawLines[i]));
  }

  validateEventContiguity(events, 0);

  const maxSeq = events.length > 0 ? events[events.length - 1].seq : -1;
  const sha256 = hashBuffer(compressedBuffer);

  return {
    header,
    events,
    maxSeq,
    sha256,
    uncompressedBytes: decompressed.length,
  };
}

export function appendEventsToBuffer(existingCompressedBuffer, newEvents) {
  if (!newEvents || newEvents.length === 0) {
    return {
      buffer: existingCompressedBuffer,
      maxSeq: decodeSessionLog(existingCompressedBuffer).maxSeq,
      sha256: hashBuffer(existingCompressedBuffer),
    };
  }

  const decoded = decodeSessionLog(existingCompressedBuffer);
  const expectedStart = decoded.maxSeq + 1;
  validateEventContiguity(newEvents, expectedStart);

  const combinedEvents = [...decoded.events, ...newEvents];
  const buffer = encodeSessionLog(decoded.header, combinedEvents);
  const maxSeq = combinedEvents[combinedEvents.length - 1].seq;
  const sha256 = hashBuffer(buffer);

  return {
    buffer,
    maxSeq,
    sha256,
  };
}
