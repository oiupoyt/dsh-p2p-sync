import { HLC } from './hlc.js';

export function planSessions(localSessions = {}, remoteSessions = {}, localDeviceId, remoteDeviceId) {
  const wants = [];
  const forks = [];
  const allKeys = new Set([...Object.keys(localSessions), ...Object.keys(remoteSessions)]);

  for (const key of allKeys) {
    const local = localSessions[key];
    const remote = remoteSessions[key];

    // Concurrency safety: check session.lock before touching a session
    if (local?.locked || remote?.locked) {
      continue;
    }

    if (!local && remote) {
      // Absent locally -> pull full log from 0
      wants.push({ key, from: 0 });
      continue;
    }

    if (local && !remote) {
      // Present locally, absent remotely -> peer will pull
      continue;
    }

    // Both present
    if (local.seq === remote.seq) {
      if (local.sha === remote.sha) {
        // In sync
        continue;
      }

      // Equal seq, different sha -> true divergence -> fork
      if (localDeviceId > remoteDeviceId) {
        const device8 = localDeviceId.slice(0, 8);
        const slashIdx = key.indexOf('/');
        const projectKey = slashIdx !== -1 ? key.slice(0, slashIdx) : '.';
        const sessionId = slashIdx !== -1 ? key.slice(slashIdx + 1) : key;
        const forkedKey = `${projectKey}/${sessionId}-fork-${device8}`;

        forks.push({ key, forkedKey });
        // Do not pull peer's original in the same round you rename
      }
      // If remote has greater device ID, remote renames its copy, we keep canonical, no pull this round
      continue;
    }

    if (local.seq < remote.seq) {
      // Pull seq > local
      wants.push({ key, from: local.seq + 1 });
      continue;
    }

    if (local.seq > remote.seq) {
      // Peer will pull
      continue;
    }
  }

  return { wants, forks };
}

export function planConfigs(localConfigs = {}, remoteConfigs = {}) {
  const wants = [];
  const stashes = [];
  const metadataUpdates = [];
  const allKeys = new Set([...Object.keys(localConfigs), ...Object.keys(remoteConfigs)]);

  for (const relPath of allKeys) {
    const local = localConfigs[relPath];
    const remote = remoteConfigs[relPath];

    if (!local && remote) {
      wants.push(relPath);
      continue;
    }

    if (local && !remote) {
      // Peer will pull
      continue;
    }

    // Both present
    const comp = HLC.compare(remote.version, local.version);

    if (comp > 0) {
      // Remote version is higher (LWW)
      if (remote.sha !== local.sha) {
        wants.push(relPath);
        stashes.push({
          relPath,
          remoteVersion: remote.version,
          remoteSha: remote.sha,
        });
      } else {
        metadataUpdates.push({ relPath, version: remote.version });
      }
      continue;
    }

    if (comp < 0) {
      // Local version is higher -> peer will pull
      continue;
    }

    // comp === 0: equal versions
    if (remote.sha === local.sha) {
      // Identical
      continue;
    }

    // Equal versions with different content: break tie on sha
    if (remote.sha > local.sha) {
      wants.push(relPath);
      stashes.push({
        relPath,
        remoteVersion: remote.version,
        remoteSha: remote.sha,
      });
    }
  }

  return { wants, stashes, metadataUpdates };
}
