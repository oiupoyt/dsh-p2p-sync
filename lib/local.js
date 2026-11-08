import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HLC } from './hlc.js';
import {
  decodeSessionLog,
  encodeSessionLog,
  appendEventsToBuffer,
} from './sessionlog.js';
import {
  isExcludedPath,
  atomicWriteFile,
  stashConflictFile,
  hashBuffer,
} from './replica.js';

export class LocalReplica {
  constructor(homeDir, deviceId) {
    this.homeDir = path.resolve(homeDir);
    this.customDeviceId = deviceId;
    this.deviceId = null;
    this.hlc = null;
    this.versions = {};
  }

  async init() {
    const syncStateDir = path.join(this.homeDir, 'sync-state');
    fs.mkdirSync(syncStateDir, { recursive: true });

    const deviceIdFile = path.join(syncStateDir, 'device-id');
    if (this.customDeviceId) {
      this.deviceId = this.customDeviceId;
      fs.writeFileSync(deviceIdFile, this.deviceId, 'utf8');
    } else if (fs.existsSync(deviceIdFile)) {
      this.deviceId = fs.readFileSync(deviceIdFile, 'utf8').trim();
    } else {
      this.deviceId = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(deviceIdFile, this.deviceId, 'utf8');
    }

    this.hlc = new HLC(this.deviceId);

    const versionsFile = path.join(syncStateDir, 'versions.json');
    if (fs.existsSync(versionsFile)) {
      try {
        this.versions = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
      } catch {
        this.versions = {};
      }
    }
  }

  _saveVersions() {
    const versionsFile = path.join(this.homeDir, 'sync-state', 'versions.json');
    atomicWriteFile(versionsFile, Buffer.from(JSON.stringify(this.versions, null, 2), 'utf8'));
  }

  async getManifest() {
    const sessions = {};
    const configs = {};

    // 1. Scan sessions: sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd
    const sessionsDir = path.join(this.homeDir, 'sessions');
    if (fs.existsSync(sessionsDir)) {
      const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const pDir of projectDirs) {
        if (!pDir.isDirectory()) continue;
        const projectKey = pDir.name;
        const fullProjPath = path.join(sessionsDir, projectKey);
        const sessionDirs = fs.readdirSync(fullProjPath, { withFileTypes: true });

        for (const sDir of sessionDirs) {
          if (!sDir.isDirectory()) continue;
          const sessionId = sDir.name;
          const fullSessionDir = path.join(fullProjPath, sessionId);
          const logFile = path.join(fullSessionDir, 'session.v4.jsonl.zstd');
          const lockFile = path.join(fullSessionDir, 'session.lock');

          if (!fs.existsSync(logFile)) continue;

          const isLocked = fs.existsSync(lockFile);
          const key = `${projectKey}/${sessionId}`;

          try {
            const buf = fs.readFileSync(logFile);
            const decoded = decodeSessionLog(buf);
            sessions[key] = {
              seq: decoded.maxSeq,
              sha: decoded.sha256,
              size: buf.length,
              locked: isLocked,
            };
          } catch (err) {
            // If corrupt or unable to read, record with locked or skip
            sessions[key] = {
              seq: -1,
              sha: '',
              size: 0,
              locked: true,
              error: err.message,
            };
          }
        }
      }
    }

    // 2. Scan configs
    const candidateFiles = [];

    // profiles/*/package.json and cordis.patch.yml
    const profilesDir = path.join(this.homeDir, 'profiles');
    if (fs.existsSync(profilesDir)) {
      const profEntries = fs.readdirSync(profilesDir, { withFileTypes: true });
      for (const p of profEntries) {
        if (!p.isDirectory() || p.name === 'node_modules') continue;
        const pkgJson = path.join('profiles', p.name, 'package.json');
        const cordisYml = path.join('profiles', p.name, 'cordis.patch.yml');
        candidateFiles.push(pkgJson, cordisYml);
      }
    }

    candidateFiles.push(
      path.join('android', 'extensions-state.json'),
      path.join('datastore', 'settings.preferences_pb')
    );

    let versionsChanged = false;

    for (const rel of candidateFiles) {
      if (isExcludedPath(rel)) continue;
      const fullPath = path.join(this.homeDir, rel);
      if (!fs.existsSync(fullPath)) continue;

      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      const buf = fs.readFileSync(fullPath);
      const sha = hashBuffer(buf);

      let version = this.versions[rel]?.version;
      if (!version || this.versions[rel]?.sha !== sha) {
        version = this.hlc.now();
        this.versions[rel] = { version, sha };
        versionsChanged = true;
      }

      configs[rel.replace(/\\/g, '/')] = {
        version,
        sha,
        size: buf.length,
      };
    }

    if (versionsChanged) {
      this._saveVersions();
    }

    return { sessions, configs };
  }

  async serveSession(key, fromSeq = 0) {
    const logFile = path.join(this.homeDir, 'sessions', key, 'session.v4.jsonl.zstd');
    const lockFile = path.join(this.homeDir, 'sessions', key, 'session.lock');

    if (fs.existsSync(lockFile)) {
      return { key, locked: true };
    }

    if (!fs.existsSync(logFile)) {
      throw new Error(`Session log not found: ${key}`);
    }

    const buf = fs.readFileSync(logFile);
    const decoded = decodeSessionLog(buf);

    if (fromSeq === 0) {
      return {
        key,
        header: decoded.header,
        events: decoded.events,
        sha: decoded.sha256,
      };
    }

    return {
      key,
      events: decoded.events.filter((e) => e.seq >= fromSeq),
      sha: decoded.sha256,
    };
  }

  async serveConfig(relPath) {
    if (isExcludedPath(relPath)) {
      throw new Error(`Attempt to serve excluded config: ${relPath}`);
    }
    const fullPath = path.join(this.homeDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Config file not found: ${relPath}`);
    }

    const buf = fs.readFileSync(fullPath);
    const sha = hashBuffer(buf);
    const version = this.versions[relPath]?.version || this.hlc.now();

    return {
      relPath: relPath.replace(/\\/g, '/'),
      version,
      contentBase64: buf.toString('base64'),
      sha,
    };
  }

  async applyFork(key, forkedKey) {
    const oldLog = path.join(this.homeDir, 'sessions', key, 'session.v4.jsonl.zstd');
    const newDir = path.join(this.homeDir, 'sessions', forkedKey);
    const newLog = path.join(newDir, 'session.v4.jsonl.zstd');

    if (fs.existsSync(oldLog)) {
      fs.mkdirSync(newDir, { recursive: true });
      fs.renameSync(oldLog, newLog);
    }
  }

  async applySession(item) {
    const sessionDir = path.join(this.homeDir, 'sessions', item.key);
    const lockFile = path.join(sessionDir, 'session.lock');
    if (fs.existsSync(lockFile)) {
      return; // Skip locked session
    }

    const logFile = path.join(sessionDir, 'session.v4.jsonl.zstd');

    if (item.header) {
      // Full log
      const buf = encodeSessionLog(item.header, item.events || []);
      atomicWriteFile(logFile, buf);
    } else if (item.events && item.events.length > 0) {
      // Incremental append
      if (!fs.existsSync(logFile)) {
        throw new Error(`Cannot append to non-existent session ${item.key}`);
      }
      const existingBuf = fs.readFileSync(logFile);
      const res = appendEventsToBuffer(existingBuf, item.events);
      atomicWriteFile(logFile, res.buffer);
    }
  }

  async applyConfig(item) {
    if (isExcludedPath(item.relPath)) {
      throw new Error(`Attempt to apply excluded path: ${item.relPath}`);
    }

    const fullPath = path.join(this.homeDir, item.relPath);
    const buf = Buffer.from(item.contentBase64, 'base64');
    const computedSha = hashBuffer(buf);

    if (computedSha !== item.sha) {
      throw new Error(`Corrupt payload: sha mismatch for ${item.relPath}`);
    }

    if (item.stash && fs.existsSync(fullPath)) {
      const device = HLC.unpack(item.version).device;
      stashConflictFile(this.homeDir, item.relPath, device, Date.now());
    }

    atomicWriteFile(fullPath, buf);
    this.versions[item.relPath] = { version: item.version, sha: item.sha };
    this.hlc.observe(item.version);
    this._saveVersions();
  }
}
