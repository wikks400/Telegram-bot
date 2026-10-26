# Telegram NFT Smart Money Alert Bot

A production-ready Telegram bot and web console that tracks NFT minting and purchase activity by wallets organized into user-defined groups, using OpenSea API v2 as the primary data source and SQLite for local, persistent storage.

Built with **Node.js 22 LTS**, **TypeScript**, **Telegraf**, and **Express/React**. Designed for instant deployment on **Botkeep Cloud**.

---

## 🌟 Key Features

1. **Accurate NFT Activity Detection**
   - **Genuine Mints**: Filters for events where `from_address` is the zero address (`0x0000000000000000000000000000000000000000`) or explicit `event_type === 'mint'`, with the recipient being a tracked wallet. Excludes ordinary transfers between non-zero addresses.
   - **Confirmed Purchases**: Detects sales where the tracked wallet is the confirmed **buyer**. Excludes sales where the wallet was the seller, and excludes listings, offers, bids, cancellations, or ordinary transfers.
   - **Deduplication Engine**: Records unique event identifiers in SQLite to eliminate duplicate alerts across retrieval cycles.

2. **Accurate Multi-Group Statistics & Deduplication**
   - Tracked wallets can belong to **multiple groups** (e.g. *Alpha*, *Whales*, *Smart Money*).
   - If wallets from multiple groups participate in minting/buying from the same collection on the same chain, they are consolidated into **one clean, unified alert**.
   - **No Double-Counting**: If Wallet A belongs to both *Alpha* and *Whales*, it is counted only **once** in `Total: Unique Wallets`, and its minted NFTs are counted only **once** in `Total: NFTs Minted`.

3. **Required Alert Formats**

   **Mint Alert:**
   ```
   🔥 SMART MONEY MINT

   📦 Collection: Pudgy Penguins
   ⛓️ Chain: Ethereum

   📊 Group Activity
   📁 Alpha — 3 Minters | 12 NFTs
   📁 Whales — 2 Minters | 7 NFTs
   📁 Smart Money — 4 Minters | 15 NFTs

   🔢 Total: 8 Unique Wallets | 34 NFTs Minted

   ⚡ Activity: NFT Mint
   🔗 OpenSea: https://opensea.io/collection/pudgypenguins
   🌐 Socials: [X/Twitter](https://x.com/pudgypenguins) • [Discord](https://discord.gg/pudgypenguins)
   ```

   **Purchase Alert:**
   ```
   🔥 SMART MONEY BUY

   📦 Collection: Milady Maker
   ⛓️ Chain: Ethereum

   📊 Group Activity
   📁 Alpha — 3 Buyers | 12 NFTs
   📁 Whales — 2 Buyers | 7 NFTs

   🔢 Total: 5 Unique Wallets | 19 NFTs Bought

   ⚡ Activity: NFT Purchase
   🔗 OpenSea: https://opensea.io/collection/milady
   🌐 Socials: [X/Twitter](https://x.com/miladymaker) • [Website](https://miladymaker.net)
   ```

4. **Interactive Telegram Bot Commands & Menus**
   - Inline keyboard with: `📊 Dashboard`, `👛 Manage Wallets`, `📁 Wallet Groups`, `🔥 Recent Mint Alerts`, `🛒 Recent Purchase Alerts`, `⚙️ Settings`, `❓ Help`.
   - **Bulk Wallet Import**: `/addwallets <group> <addr1> <addr2>...` to add multiple wallets to a group in a single command.
   - **Clear All Wallets**: `/clearwallets` to delete and remove all tracked wallets.
   - Multi-chain address validation: EVM (0x + 40 hex) and Solana (32-44 Base58).
   - Admin authorization: commands restricted to `TELEGRAM_ADMIN_IDS`.

---

## ⛓️ Supported Chains & OpenSea API v2 Limitations

Chains are discovered dynamically using the official endpoint:
`GET https://api.opensea.io/api/v2/chains`

### Supported & Actively Monitored Chains:
| Chain | Slug | Identifier | Account Activity Endpoint | Status |
|---|---|---|---|---|
| **Ethereum** | `ethereum` | `ethereum` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Base** | `base` | `base` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Polygon** | `polygon` | `matic` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Arbitrum** | `arbitrum` | `arbitrum` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Optimism** | `optimism` | `optimism` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Blast** | `blast` | `blast` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Zora** | `zora` | `zora` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Avalanche** | `avalanche` | `avalanche` | Supported (`/events/accounts/{address}`) | 🟢 Actively Monitored |
| **Sei** | `sei` | `sei` | Supported | ⚪ Supported |
| **Ronin** | `ronin` | `ronin` | Supported | ⚪ Supported |
| **Solana** | `solana` | `solana` | Partial v2 activity support | ⚠️ Limited (EVM prioritized) |
| **Flow** | `flow` | `flow` | Cadence / Flow EVM | ⚪ Supported |

### Known OpenSea API Limitations & Safeguards:
1. **Rate Limits (HTTP 429)**: Free/public OpenSea tiers enforce request limits. The service handles rate limits with exponential backoff and automatically respects the `Retry-After` header.
2. **Account Events Latency**: OpenSea indexes on-chain transactions with a 15–45 second delay. The polling cycle is configured to 30 seconds by default (`POLL_INTERVAL_SECONDS`).
3. **Missing Social Metadata**: If a collection has not linked Twitter, Discord, or Website on OpenSea, the bot gracefully falls back to `🌐 Socials: None listed` without failing alert delivery.

---

## 🚀 Step-by-Step Botkeep Cloud Deployment

Botkeep Cloud is designed for 24/7 background bots. Follow these steps to deploy:

### Step 1: Environment Variables Configuration
In the Botkeep dashboard, set the following environment variables:

```bash
# Telegram bot token from @BotFather
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_example

# Authorized admin user IDs (comma-separated; message @userinfobot to get your ID)
TELEGRAM_ADMIN_IDS=123456789

# OpenSea API v2 Key (from https://docs.opensea.io)
OPENSEA_API_KEY=your_opensea_api_key_here

# Persistent SQLite database location on Botkeep persistent storage
DATABASE_PATH=/data/nft_bot.sqlite

# Polling frequency in seconds (default: 30)
POLL_INTERVAL_SECONDS=30
```

### Step 2: Persistent Volume Mount
1. Go to your Botkeep service settings under **Volumes / Storage**.
2. Mount a persistent disk volume to `/data`.
3. Set `DATABASE_PATH=/data/nft_bot.sqlite`. This ensures that all wallets, groups, event deduplication history, and collection caches survive container redeployments and restarts.

### Step 3: Deployment Options
- **Option A (Pure Background Bot - Telegraf Long Polling)**:
  - Command: `npm run start:bot`
  - Runs Telegraf long polling and background OpenSea monitoring. Does not require opening any public web ports.
- **Option B (Full-Stack Bot + Web Operator Console)**:
  - Command: `npm start`
  - Runs the Web Console on port 3000 alongside the background Telegram bot and monitor service.

---

## 🧪 Automated Test Suite (16 Tests)

All project requirements are implemented and tested in `/test/run_all_tests.ts`.

Run tests locally with:
```bash
npm test
```

### Verified Test Results:
```
======================================================
TEST SUITE RESULTS: 16/16 PASSED
======================================================
✅ [Groups] Create, rename, and delete groups
✅ [Wallets] Adding and removing wallets
✅ [Memberships] Wallets belonging to multiple groups
✅ [Memberships] Removing a wallet from one group preserves membership in others
✅ [Activity Detection] Detecting genuine mints (zero-address sender or mint event)
✅ [Activity Detection] Detecting genuine purchases (tracked wallet is buyer)
✅ [Activity Detection] Excluding ordinary transfers between non-zero addresses
✅ [Activity Detection] Excluding sales initiated by tracked wallets (wallet is seller, not buyer)
✅ [Statistics & Alerts] Consolidating multi-group alerts without double-counting wallets or NFTs
✅ [Alert Formatting] Formatting NFT Purchase alerts correctly (🔥 SMART MONEY BUY)
✅ [Socials & Links] Handling missing social links without failing alert delivery
✅ [Deduplication] Preventing duplicate events across retrieval cycles
✅ [Validation] Address format validation for EVM and Solana
✅ [Persistence] Preserving data across restarts in SQLite persistent disk
✅ [Bulk Operations] Adding multiple wallets to a group at once
✅ [Bulk Operations] Deleting and removing all tracked wallets
Summary: 16 passed, 0 failed
```

---

## 📁 Project Structure

```
├── .env.example                     # Production environment variable templates
├── README.md                        # Documentation and Botkeep deployment guide
├── package.json                     # Node.js dependencies & scripts
├── tsconfig.json                    # TypeScript compiler configuration
├── vite.config.ts                   # Vite bundler configuration
├── server.ts                        # Express entry point (Vite middleware + API)
├── src/
│   ├── types.ts                     # TypeScript data interfaces
│   ├── App.tsx                      # Web Operator Console & Telegram Simulator
│   ├── main.tsx                     # React DOM entry point
│   ├── bot/
│   │   └── standalone.ts            # Standalone Botkeep Cloud production runner
│   └── server/
│       ├── database/
│       │   └── db.ts                # SQLite database migrations & schema
│       ├── services/
│       │   ├── walletValidation.ts  # EVM & Solana address validation
│       │   ├── openseaService.ts    # OpenSea API v2 client & rate limit backoff
│       │   ├── alertConsolidator.ts # Consolidation & deduplication engine
│       │   └── monitorService.ts    # Background activity polling service
│       ├── telegram/
│       │   └── bot.ts               # Telegraf commands, keyboards & auth
│       └── routes/
│           └── api.ts               # REST API endpoints
├── test/
│   └── run_all_tests.ts             # 14 requirement automated test suite
└── scripts/
    └── create_zip.ts                # Standalone project packager
```
