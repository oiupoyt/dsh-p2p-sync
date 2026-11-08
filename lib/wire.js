export const MAX_FRAME_SIZE = 64 * 1024 * 1024; // 64 MiB

export class WireError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WireError';
  }
}

export function encodeFrame(message) {
  const jsonStr = JSON.stringify(message);
  const payload = Buffer.from(jsonStr, 'utf8');
  if (payload.length > MAX_FRAME_SIZE) {
    throw new WireError(`Frame size ${payload.length} exceeds maximum cap of ${MAX_FRAME_SIZE} bytes`);
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class Channel {
  constructor(stream, opts = {}) {
    this.stream = stream;
    this.defaultTimeoutMs = opts.timeoutMs ?? 120000;
    this.incomingBuffer = Buffer.alloc(0);
    this.frameQueue = [];
    this.receivers = [];
    this.closed = false;
    this.fatalError = null;

    this._onData = (chunk) => this._handleData(chunk);
    this._onError = (err) => this._fatal(err);
    this._onEnd = () => this._handleClose();
    this._onClose = () => this._handleClose();

    this.stream.on('data', this._onData);
    this.stream.on('error', this._onError);
    this.stream.on('end', this._onEnd);
    this.stream.on('close', this._onClose);
  }

  _handleData(chunk) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length >= 4) {
      const frameLen = this.incomingBuffer.readUInt32BE(0);
      if (frameLen > MAX_FRAME_SIZE) {
        this._fatal(new WireError(`Frame size ${frameLen} exceeds maximum cap of ${MAX_FRAME_SIZE} bytes`));
        return;
      }

      if (this.incomingBuffer.length < 4 + frameLen) {
        // Need more bytes
        break;
      }

      const payload = this.incomingBuffer.subarray(4, 4 + frameLen);
      this.incomingBuffer = this.incomingBuffer.subarray(4 + frameLen);

      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch (err) {
        this._fatal(new WireError(`Failed to parse JSON frame: ${err.message}`));
        return;
      }

      this._dispatchMessage(message);
    }
  }

  _dispatchMessage(message) {
    if (this.receivers.length > 0) {
      const receiver = this.receivers.shift();
      clearTimeout(receiver.timer);
      if (receiver.expectedType && message.type !== receiver.expectedType) {
        receiver.reject(new WireError(
          `Unexpected frame type: got ${message.type}, expected ${receiver.expectedType}`
        ));
      } else {
        receiver.resolve(message);
      }
    } else {
      this.frameQueue.push(message);
    }
  }

  _fatal(err) {
    this.fatalError = err instanceof WireError ? err : new WireError(err.message);
    this.close();
  }

  _handleClose() {
    this.closed = true;
    const err = this.fatalError || new WireError('Channel closed');
    while (this.receivers.length > 0) {
      const receiver = this.receivers.shift();
      clearTimeout(receiver.timer);
      receiver.reject(err);
    }
  }

  async send(message) {
    if (this.closed) {
      throw this.fatalError || new WireError('Cannot send on closed channel');
    }
    const frame = encodeFrame(message);
    if (!this.stream.write(frame)) {
      await new Promise((resolve, reject) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          this.stream.removeListener('drain', onDrain);
          this.stream.removeListener('error', onError);
        };
        this.stream.once('drain', onDrain);
        this.stream.once('error', onError);
      });
    }
  }

  receive(expectedType, timeoutMs) {
    if (this.fatalError) {
      return Promise.reject(this.fatalError);
    }

    // Check if frame already queued
    if (this.frameQueue.length > 0) {
      const message = this.frameQueue.shift();
      if (expectedType && message.type !== expectedType) {
        return Promise.reject(new WireError(
          `Unexpected frame type: got ${message.type}, expected ${expectedType}`
        ));
      }
      return Promise.resolve(message);
    }

    if (this.closed) {
      return Promise.reject(new WireError('Channel closed'));
    }

    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      let timer = null;
      if (effectiveTimeout > 0) {
        timer = setTimeout(() => {
          const idx = this.receivers.findIndex((r) => r.resolve === resolve);
          if (idx !== -1) {
            this.receivers.splice(idx, 1);
          }
          reject(new WireError(`Timed out waiting for frame (${expectedType ?? 'any'}) after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
      }

      this.receivers.push({
        resolve,
        reject,
        expectedType,
        timer,
      });
    });
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.stream.removeListener('data', this._onData);
      this.stream.removeListener('error', this._onError);
      this.stream.removeListener('end', this._onEnd);
      this.stream.removeListener('close', this._onClose);
      if (typeof this.stream.destroy === 'function') {
        this.stream.destroy();
      }
      this._handleClose();
    }
  }
}
