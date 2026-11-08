# @local/dsh-p2p-sync

Direct, serverless peer-to-peer TCP synchronization for [DeepSeek Harness (DSH)](https://deepseek-ai.github.io/dsh/).

## Installation

### From GitHub (Local)
1. Clone the repository: `git clone https://github.com/oiupoyt/dsh-p2p-sync.git`
2. Install dependencies: `pnpm install`
3. Add to your DSH configuration (`cordis.patch.yml`):
   ```yaml
   insert:
     - id: p2p-sync
       name: '<path-to-local-clone>'
       config:
         sharedSecret: 'your-strong-secret'
         port: 7421
   ```

### From NPM
`pnpm add @oiupoyt/dsh-p2p-sync` (replace with your published package name).

## Usage

Once installed, use the following DSH tools:

- `sync_status`: View current connections and HLC status.
- `sync_peers { action: "add", peer: "10.0.0.2:7421" }`: Register a peer.
- `sync_now`: Force a sync round.

## Security
- **HMAC-SHA256**: Authenticated connections using a shared secret.
- **Exclusions**: `.credentials.yaml`, `node_modules/`, and system logs are never replicated.
- **Forking**: True divergent edits are automatically preserved in branched files rather than overwritten.
