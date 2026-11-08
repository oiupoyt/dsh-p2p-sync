import { planSessions, planConfigs } from './merge.js';

export async function executeSyncRound(channel, localReplica, opts = {}) {
  // 1. Hello
  await channel.send({
    type: 'hello',
    protocol: 'dsh-p2p-v1',
    deviceId: localReplica.deviceId,
    label: opts.label || '',
  });

  const remoteHello = await channel.receive('hello');
  if (remoteHello.protocol !== 'dsh-p2p-v1') {
    throw new Error(`Protocol mismatch: expected dsh-p2p-v1, got ${remoteHello.protocol}`);
  }
  if (remoteHello.deviceId === localReplica.deviceId) {
    throw new Error('Cannot sync with self: identical deviceId');
  }

  // 2. Manifest
  const localManifest = await localReplica.getManifest();
  await channel.send({
    type: 'manifest',
    sessions: localManifest.sessions,
    configs: localManifest.configs,
  });

  const remoteManifest = await channel.receive('manifest');

  // 3. Wants
  const sessionPlan = planSessions(
    localManifest.sessions,
    remoteManifest.sessions,
    localReplica.deviceId,
    remoteHello.deviceId
  );
  const configPlan = planConfigs(localManifest.configs, remoteManifest.configs);

  // Apply any planned forks before data transfer
  for (const fork of sessionPlan.forks) {
    await localReplica.applyFork(fork.key, fork.forkedKey);
  }

  if (opts.dryRun) {
    await channel.send({ type: 'bye' });
    await channel.receive('bye');
    return {
      dryRun: true,
      remoteDeviceId: remoteHello.deviceId,
      sessionWants: sessionPlan.wants,
      configWants: configPlan.wants,
      forks: sessionPlan.forks,
    };
  }

  await channel.send({
    type: 'wants',
    sessions: sessionPlan.wants,
    configs: configPlan.wants,
  });

  const remoteWants = await channel.receive('wants');

  // 4. Serve & Receive
  const numSessionsToReceive = sessionPlan.wants.length;
  const numConfigsToReceive = configPlan.wants.length;

  const serveTask = async () => {
    for (const sWant of remoteWants.sessions || []) {
      const item = await localReplica.serveSession(sWant.key, sWant.from);
      await channel.send({ type: 'serve-session', item });
    }
    for (const cWant of remoteWants.configs || []) {
      const item = await localReplica.serveConfig(cWant);
      await channel.send({ type: 'serve-config', item });
    }
    await channel.send({ type: 'serve-end' });
  };

  const receiveTask = async () => {
    const receivedSessions = [];
    for (let i = 0; i < numSessionsToReceive; i++) {
      const msg = await channel.receive('serve-session');
      receivedSessions.push(msg.item);
    }
    const receivedConfigs = [];
    for (let i = 0; i < numConfigsToReceive; i++) {
      const msg = await channel.receive('serve-config');
      receivedConfigs.push(msg.item);
    }
    await channel.receive('serve-end');
    return { receivedSessions, receivedConfigs };
  };

  const [, { receivedSessions, receivedConfigs }] = await Promise.all([
    serveTask(),
    receiveTask(),
  ]);

  // 5. Apply, save state, bye
  for (const item of receivedSessions) {
    await localReplica.applySession(item);
  }

  for (const item of receivedConfigs) {
    const shouldStash = configPlan.stashes.some((s) => s.relPath === item.relPath);
    await localReplica.applyConfig({ ...item, stash: shouldStash });
  }

  await channel.send({ type: 'bye' });
  await channel.receive('bye');

  return {
    remoteDeviceId: remoteHello.deviceId,
    sessionsReceived: receivedSessions.length,
    configsReceived: receivedConfigs.length,
    forks: sessionPlan.forks.length,
  };
}
