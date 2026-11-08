# `@local/dsh-p2p-sync`

Direct peer-to-peer TCP replication plugin for DeepSeek Harness (DSH).

Keeps two DSH instances (such as a laptop and an Android device) continuously synchronized without any cloud server, coordinator, or third-party relay.

---

## Key Characteristics

- **Full Replica**: Both devices hold an authoritative, complete replica.
- **Offline Tolerance**: Either device may stay offline for days or weeks. On reconnection, replicas catch up from the local high-water mark without tombstones or drained queues.
- **Deterministic Conflict Resolution**: Identical pure merge rules run on both sides. No central coordinator or interactive prompts are needed.
- **Append-only Session Integrity**: DeepSeek Harness v4 session logs (`session.v4.jsonl.zstd`) are append-only. Contiguity is strictly verified on every event insertion; gaps are rejected immediately.
- **Deterministic Forking on True Divergence**: If two offline replicas independently advance the same session (equal sequence count but different content hash), the replica with the greater device ID renames its session to `<id>-fork-<device8>`, while the other retains the canonical ID. Both sessions survive and converge on the subsequent round.
- **Hybrid Logical Clock (HLC)**: Configuration files (`profiles/*/package.json`, `profiles/*/cordis.patch.yml`, `android/extensions-state.json`, `datastore/settings.preferences_pb`) are reconciled using fixed-width HLC timestamps (`000000001791180000000000abc123:device`), ensuring strict causality regardless of physical clock drift. Superseded configurations are stashed under `sync-state/conflicts/`, never deleted.
- **Zero-Secret Wire Guarantee**: Explicitly excludes credentials and ephemeral system files.

---

## Directory Layout & Exclusions

Replicated targets:
- `sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd`
- `profiles/<profile>/package.json`
- `profiles/<profile>/cordis.patch.yml`
- `android/extensions-state.json`
- `datastore/settings.preferences_pb`

Deliberate exclusions (never transmitted or written):
- `.credentials.yaml`: Contains API tokens and private account credentials. Kept strictly local.
- `node_modules/`: Architecture-specific binaries. Native modules must be installed per host via `pnpm`.
- `android/app-layer.patch.yml`: Regenerated locally by the host runtime.
- `android/budget.json`, `android/boot-journal.json`, `android/pnpm-report.jsonl`: Ephemeral runtime telemetry and local boot records.
- `logs/`: Machine-local diagnostic outputs.
- `storages/session_projcache/`: Locally derived session caches.
- `sessions/**/session.lock`: Engine concurrency lock marker indicating an active session.

---

## Wire Protocol

Replication is conducted directly over TCP using 4-byte big-endian length-prefixed UTF-8 JSON frames. Frames exceeding 64 MiB are refused (`WireError`).

Each symmetric sync round executes in lockstep:
1. `hello { protocol: "dsh-p2p-v1", deviceId, label }` ⇄ `hello`
2. `manifest { sessions, configs }` ⇄ `manifest`
3. `wants { sessions: [{ key, from }], configs: [rel] }` ⇄ `wants`
4. Symmetric data transfer:
   - Server writes $N$ `serve-session` and $M$ `serve-config` frames, followed by `serve-end`.
   - Receiver reads exactly $N$ sessions and $M$ configs as requested in step 3, preventing socket deadlocks.
5. Apply updates atomically, observe HLC timestamps, exchange `bye`.

### Network & Transport

Connect peers directly via LAN IP or a WireGuard/Tailscale mesh IP (recommended, zero-relay peer-to-peer data plane).

Peers authenticate using a shared secret via an HMAC-SHA256 challenge-response handshake over exchanged nonces.

---

## Configuration & Tools

Registered tools:
- `sync_status`: Inspect local device ID, peers, active connections, and pending conflict backups.
- `sync_now { peer?, dryRun? }`: Trigger an immediate sync round (optionally dry-run to preview changes).
- `sync_peers { action: "list"|"add"|"remove", peer? }`: Manage configured peer addresses.
- `sync_pending { peer? }`: Inspect differing sessions and configurations without writing changes.

Configuration schema (`Config`):
- `port` (number, default: `7421`): TCP listen port.
- `peers` (string array, default: `[]`): Known peer addresses (`host:port` or `host`).
- `sharedSecret` (string, default: `""`): Authentication secret.
- `intervalMs` (number, default: `0`): Background auto-sync interval in milliseconds (`0` to disable).
- `dshHome` (string, default: `""`): Explicit DSH home directory override (defaults to `process.env.DSH_HOME`).
- `syncProjectDir` (boolean, default: `false`): Sync working project directory flag.
