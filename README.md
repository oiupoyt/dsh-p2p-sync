# dsh-p2p-sync

Direct, serverless peer-to-peer TCP synchronization plugin for [DeepSeek Harness (DSH)](https://deepseek-ai.github.io/dsh/).

Keeps two DSH installs (such as an Android phone and a laptop) in sync directly over TCP without cloud storage, coordinators, or relays.

---

## Installation

### From NPM

```bash
pnpm add dsh-p2p-sync
# or
npm install dsh-p2p-sync
```

### Local Development / npm link

To link and develop locally:

```bash
cd dsh-p2p-sync
npm link
# in your DSH profile directory:
npm link dsh-p2p-sync
```

---

## DSH Bundle Configuration

Add the plugin to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: p2p-sync
      name: 'dsh-p2p-sync'
      config:
        port: 7421
        sharedSecret: 'your-shared-secret'
        peers:
          - '100.64.0.2:7421' # e.g. Tailscale or LAN IP
        intervalMs: 300000     # auto-sync every 5 mins (0 to disable)
```

---

## Tools

Once loaded, the plugin registers four tools on your DSH agent:

| Tool | Parameters | Description |
|---|---|---|
| `sync_status` | *(none)* | View local device ID, peers, sync status, and pending conflict backups. |
| `sync_now` | `{ peer?: string, dryRun?: boolean }` | Trigger an immediate sync round (use `dryRun: true` to preview changes). |
| `sync_peers` | `{ action: "list"\|"add"\|"remove", peer?: string }` | List, add, or remove peer addresses at runtime. |
| `sync_pending` | `{ peer?: string }` | Inspect sessions and configs that differ right now without applying changes. |

---

## How It Works

- **Sessions (`session.v4.jsonl.zstd`)**: Append-only replication tracking high-water sequence marks. Strict contiguity checking prevents gaps. If both devices edit the same session offline, the higher device ID automatically renames its copy to `<id>-fork-<device8>` so zero data is lost.
- **Config & Preferences**: Reconciled using a Hybrid Logical Clock (HLC) with Last-Write-Wins (LWW). Overwritten local configs are backed up under `sync-state/conflicts/`.
- **Wire Security**: Peer connections authenticate via an HMAC-SHA256 handshake over exchanged random nonces.
- **Exclusions**: Secrets (`.credentials.yaml`), machine binaries (`node_modules/`), and runtime state logs are never transmitted.

---

## Testing

```bash
node --test test/*.mjs
```
