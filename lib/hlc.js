export class HLC {
  constructor(deviceId) {
    if (!deviceId) {
      throw new Error('HLC requires a non-empty deviceId');
    }
    this.deviceId = deviceId;
    this.millis = 0;
    this.counter = 0;
  }

  static pack(millis, counter, device) {
    const mStr = String(millis).padStart(16, '0');
    const cStr = Number(counter).toString(16).padStart(8, '0');
    return `${mStr}${cStr}:${device}`;
  }

  static unpack(versionStr) {
    if (typeof versionStr !== 'string') {
      throw new Error('Version must be a string');
    }
    const colonIdx = versionStr.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`Invalid HLC version string: ${versionStr}`);
    }
    const timePart = versionStr.slice(0, colonIdx);
    const device = versionStr.slice(colonIdx + 1);

    if (timePart.length < 24) {
      throw new Error(`Invalid HLC timestamp length: ${timePart}`);
    }
    const millis = parseInt(timePart.slice(0, 16), 10);
    const counter = parseInt(timePart.slice(16, 24), 16);

    return { millis, counter, device };
  }

  static compare(v1, v2) {
    if (v1 === v2) return 0;
    return v1 < v2 ? -1 : 1;
  }

  pack() {
    return HLC.pack(this.millis, this.counter, this.deviceId);
  }

  now() {
    const physical = Date.now();
    if (physical > this.millis) {
      this.millis = physical;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return this.pack();
  }

  observe(remoteVersionStr) {
    const remote = HLC.unpack(remoteVersionStr);
    const physical = Date.now();
    const maxMillis = Math.max(physical, this.millis, remote.millis);

    if (maxMillis === this.millis && maxMillis === remote.millis) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (maxMillis === this.millis) {
      this.counter++;
    } else if (maxMillis === remote.millis) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }
    this.millis = maxMillis;
    return this.pack();
  }
}
