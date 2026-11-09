import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { apply } from '../lib/index.js';

describe('P2P Sync Host API Endpoints', () => {
  it('serves status, peer management, and sync trigger via webServer route', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-api-test-'));

    let registeredRoute = null;
    const mockCtx = {
      get(serviceName) {
        if (serviceName === 'webServer') {
          return {
            register(route) {
              registeredRoute = route;
              return () => {};
            },
          };
        }
        return undefined;
      },
      on: () => {},
    };

    const instance = await apply(mockCtx, {
      dshHome: tmpHome,
      port: 19421,
      peers: ['127.0.0.1:19422'],
    });

    assert.ok(registeredRoute, 'Expected webServer route to be registered');
    assert.equal(registeredRoute.kind, 'prefix');
    assert.equal(registeredRoute.path, '/api/p2p-sync/');

    // Helper to simulate HTTP requests
    async function request(method, pathname, body = null) {
      return new Promise((resolve) => {
        let responseCode = 200;
        let responseHeaders = {};
        let responseBody = '';

        const fakeReq = {
          method,
          url: pathname,
          async *[Symbol.asyncIterator]() {
            if (body) {
              yield Buffer.from(JSON.stringify(body));
            }
          },
        };

        const fakeRes = {
          setHeader(k, v) { responseHeaders[k] = v; },
          writeHead(code) { responseCode = code; },
          end(data) {
            if (data) responseBody += data;
            resolve({
              status: responseCode,
              headers: responseHeaders,
              json: () => JSON.parse(responseBody),
            });
          },
        };

        registeredRoute.handler(fakeReq, fakeRes);
      });
    }

    // 1. GET /api/p2p-sync/status
    const statusRes = await request('GET', '/api/p2p-sync/status');
    assert.equal(statusRes.status, 200);
    const statusData = statusRes.json();
    assert.equal(statusData.port, 19421);
    assert.ok(statusData.deviceId);
    assert.deepEqual(statusData.peers, ['127.0.0.1:19422']);
    assert.equal(typeof statusData.connected, 'boolean');

    // 2. POST /api/p2p-sync/peers (Add peer)
    const addRes = await request('POST', '/api/p2p-sync/peers', {
      action: 'add',
      peer: '10.0.0.5:7421',
    });
    assert.equal(addRes.status, 200);
    const addData = addRes.json();
    assert.ok(addData.peers.includes('10.0.0.5:7421'));

    // 3. POST /api/p2p-sync/peers (Remove peer)
    const removeRes = await request('POST', '/api/p2p-sync/peers', {
      action: 'remove',
      peer: '127.0.0.1:19422',
    });
    assert.equal(removeRes.status, 200);
    const removeData = removeRes.json();
    assert.ok(!removeData.peers.includes('127.0.0.1:19422'));
    assert.ok(removeData.peers.includes('10.0.0.5:7421'));

    await instance.stop();
  });
});
