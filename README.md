# dsh-p2p-sync

Direct, serverless peer-to-peer TCP synchronization plugin for [DeepSeek Harness (DSH)](https://deepseek-ai.github.io/dsh/).

Keeps two DSH installs (such as an Android phone and a laptop) in sync directly over TCP without cloud storage, coordinators, or relays.

---

## Features

- **Settings Page & Web GUI**: Dedicated **P2P Sync** page in DSH Settings with live status, connection indicator, peer list manager, and manual sync controls.
- **Connection Indicator**: Real-time status badge (Emerald square when connected/synced, Gray when listening, Red on error).
- **Full P2P Replica**: Direct TCP replication with zero cloud or central server dependencies.
- **Deterministic Conflict Resolution**:
  - **Chats & Sessions**: Monotonic sequence progression. Automatic deterministic forking on offline divergence (`<id>-fork-<device8>`).
  - **Configs & Preferences**: Hybrid Logical Clock (HLC) with Last-Write-Wins (LWW). Overwritten versions are safely archived under `sync-state/conflicts/`.
- **Wire Security**: HMAC-SHA256 handshake authentication with a shared secret.

---

## Installation

### From NPM

```bash
pnpm add dsh-p2p-sync
# or
npm install dsh-p2p-sync
```

### Local Development / npm link

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

## Web GUI & Settings

Open DSH **Settings** in your browser:
- **P2P Sync Section**: A dedicated tab in the settings sidebar with the P2P sync icon.
- **Connection Indicator**: View whether peers are actively connected or listening for connections.
- **Device ID**: Inspect and copy your device's unique P2P identity.
- **Peer Management**: Add and remove peer addresses directly from the interface.
- **Instant Actions**: Trigger **Sync Now** or **Dry Run Preview** with immediate visual feedback.
- **General Settings**: A status row in General Settings displays the current listener port and sync state.

---

## Tools

| Tool | Parameters | Description |
|---|---|---|
| `sync_status` | *(none)* | View local device ID, peers, sync status, and pending conflict backups. |
| `sync_now` | `{ peer?: string, dryRun?: boolean }` | Trigger an immediate sync round (use `dryRun: true` to preview changes). |
| `sync_peers` | `{ action: "list"\|"add"\|"remove", peer?: string }` | List, add, or remove peer addresses at runtime. |
| `sync_pending` | `{ peer?: string }` | Inspect sessions and configs that differ right now without applying changes. |

---

## Testing

```bash
node --test test/*.mjs
```
