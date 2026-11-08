import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planSessions, planConfigs } from '../lib/merge.js';

describe('merge / reconciliation logic', () => {
  describe('planSessions', () => {
    it('handles cold start: pulls full log when absent locally', () => {
      const local = {};
      const remote = {
        'proj/s1': { seq: 5, sha: 'abc', size: 100 },
      };
      const plan = planSessions(local, remote, 'dev-a', 'dev-b');
      assert.deepEqual(plan.wants, [{ key: 'proj/s1', from: 0 }]);
      assert.deepEqual(plan.forks, []);
    });

    it('handles incremental: pulls seq > local when remote has higher seq', () => {
      const local = {
        'proj/s1': { seq: 3, sha: 'abc', size: 100 },
      };
      const remote = {
        'proj/s1': { seq: 5, sha: 'def', size: 150 },
      };
      const plan = planSessions(local, remote, 'dev-a', 'dev-b');
      assert.deepEqual(plan.wants, [{ key: 'proj/s1', from: 4 }]);
      assert.deepEqual(plan.forks, []);
    });

    it('handles in-sync: does nothing when equal seq and same sha', () => {
      const local = {
        'proj/s1': { seq: 5, sha: 'abc', size: 100 },
      };
      const remote = {
        'proj/s1': { seq: 5, sha: 'abc', size: 100 },
      };
      const plan = planSessions(local, remote, 'dev-a', 'dev-b');
      assert.deepEqual(plan.wants, []);
      assert.deepEqual(plan.forks, []);
    });

    it('handles divergence: greater device ID renames locally and defers pull', () => {
      const local = {
        'proj/s1': { seq: 5, sha: 'local-sha', size: 100 },
      };
      const remote = {
        'proj/s1': { seq: 5, sha: 'remote-sha', size: 100 },
      };
      // local dev-z > remote dev-a
      const planZ = planSessions(local, remote, 'dev-z', 'dev-a');
      assert.equal(planZ.forks.length, 1);
      assert.equal(planZ.forks[0].key, 'proj/s1');
      assert.equal(planZ.forks[0].forkedKey, 'proj/s1-fork-dev-z');
      // Must NOT pull peer's original in the same round
      assert.deepEqual(planZ.wants, []);

      // lesser device ID keeps canonical, does not fork locally
      const planA = planSessions(local, remote, 'dev-a', 'dev-z');
      assert.deepEqual(planA.forks, []);
      assert.deepEqual(planA.wants, []);
    });

    it('skips locked sessions', () => {
      const local = {
        'proj/s1': { seq: 2, sha: 'a', size: 50, locked: true },
      };
      const remote = {
        'proj/s1': { seq: 5, sha: 'b', size: 100 },
      };
      const plan = planSessions(local, remote, 'dev-a', 'dev-b');
      assert.deepEqual(plan.wants, []);
      assert.deepEqual(plan.forks, []);
    });
  });

  describe('planConfigs', () => {
    it('pulls remote config when absent locally', () => {
      const local = {};
      const remote = {
        'profiles/default/package.json': { version: '000000001000000000000001:dev-b', sha: 'def' },
      };
      const plan = planConfigs(local, remote);
      assert.deepEqual(plan.wants, ['profiles/default/package.json']);
      assert.deepEqual(plan.stashes, []);
    });

    it('applies LWW: remote higher version wins and stashes local', () => {
      const local = {
        'profiles/default/package.json': { version: '000000001000000000000001:dev-a', sha: 'abc' },
      };
      const remote = {
        'profiles/default/package.json': { version: '000000002000000000000001:dev-b', sha: 'def' },
      };
      const plan = planConfigs(local, remote);
      assert.deepEqual(plan.wants, ['profiles/default/package.json']);
      assert.deepEqual(plan.stashes, [
        {
          relPath: 'profiles/default/package.json',
          remoteVersion: '000000002000000000000001:dev-b',
          remoteSha: 'def',
        },
      ]);
    });

    it('breaks ties on sha deterministically when versions are equal', () => {
      const local = {
        'datastore/settings.preferences_pb': { version: '000000001000000000000001:dev-a', sha: '111' },
      };
      const remoteHigherSha = {
        'datastore/settings.preferences_pb': { version: '000000001000000000000001:dev-a', sha: '222' },
      };
      const plan1 = planConfigs(local, remoteHigherSha);
      assert.deepEqual(plan1.wants, ['datastore/settings.preferences_pb']);

      const remoteLowerSha = {
        'datastore/settings.preferences_pb': { version: '000000001000000000000001:dev-a', sha: '000' },
      };
      const plan2 = planConfigs(local, remoteLowerSha);
      assert.deepEqual(plan2.wants, []);
    });
  });
});
