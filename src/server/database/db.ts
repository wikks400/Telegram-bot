import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {
  WalletGroup,
  TrackedWallet,
  CollectionMetadata,
  ConsolidatedAlert,
  SystemLog,
  DashboardStats,
} from '../../types.ts';
import { validateWalletAddress } from '../services/walletValidation.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string = '';

export function getDatabasePath(): string {
  const envPath = process.env.DATABASE_PATH;
  if (!envPath || /^\d+$/.test(envPath.trim())) {
    return './data/nft_bot.sqlite';
  }
  return envPath;
}

export function initDatabase(dbPath?: string): DatabaseSync {
  const targetPath = dbPath || getDatabasePath();

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ':memory:') {
    const dir = path.dirname(path.resolve(targetPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  currentDbPath = targetPath;
  dbInstance = db;

  if (targetPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    } catch {}
  }

  // Run migrations
  migrateDatabase(db);
  seedInitialData(db);

  return db;
}

function migrateDatabase(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      is_enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      label TEXT,
      chain_type TEXT DEFAULT 'evm',
      created_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS wallet_group_members (
      wallet_address TEXT NOT NULL,
      group_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (wallet_address, group_id),
      FOREIGN KEY (wallet_address) REFERENCES wallets(address) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      chain TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      counterparty_address TEXT,
      tx_hash TEXT,
      quantity INTEGER DEFAULT 1,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_wallet ON processed_events(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_events_collection ON processed_events(collection_slug, chain);
    CREATE INDEX IF NOT EXISTS idx_events_time ON processed_events(timestamp);

    CREATE TABLE IF NOT EXISTS collections_cache (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      chain TEXT NOT NULL,
      opensea_url TEXT NOT NULL,
      twitter_url TEXT,
      discord_url TEXT,
      website_url TEXT,
      telegram_url TEXT,
      image_url TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      chain TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      message_text TEXT NOT NULL,
      group_summaries TEXT NOT NULL,
      total_wallets INTEGER NOT NULL,
      total_nfts INTEGER NOT NULL,
      events_count INTEGER NOT NULL,
      milestone INTEGER,
      next_milestone INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_alert_milestones (
      collection_slug TEXT NOT NULL,
      chain TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      milestone INTEGER NOT NULL,
      alerted_at INTEGER NOT NULL,
      PRIMARY KEY (collection_slug, chain, activity_type, milestone)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  try {
    db.exec('ALTER TABLE alert_history ADD COLUMN milestone INTEGER');
  } catch {}
  try {
    db.exec('ALTER TABLE alert_history ADD COLUMN next_milestone INTEGER');
  } catch {}
}

export interface WalletsBackupPayload {
  version: 1;
  exportedAt: number;
  groups: { id: string; name: string; description?: string }[];
  wallets: { address: string; label?: string; chain_type: 'evm' | 'solana' | 'flow' | 'other'; groups: string[] }[];
}

export function exportWalletsBackup(db = initDatabase()): WalletsBackupPayload {
  const groups = getAllGroups(db).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
  }));
  const wallets = getAllWallets(db).map((w) => ({
    address: w.address,
    label: w.label,
    chain_type: w.chain_type,
    groups: w.groups || [],
  }));
  return {
    version: 1,
    exportedAt: Date.now(),
    groups,
    wallets,
  };
}

export function saveWalletsBackupToFile(db = initDatabase()): void {
  try {
    const backup = exportWalletsBackup(db);
    const jsonStr = JSON.stringify(backup, null, 2);

    const locations = [
      path.resolve('./data/wallets_backup.json'),
      path.resolve('./wallets_backup.json'),
    ];

    for (const loc of locations) {
      try {
        const dir = path.dirname(loc);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(loc, jsonStr, 'utf-8');
      } catch {
        // ignore individual write error
      }
    }
  } catch (err: any) {
    addLog('warn', 'db', 'Failed writing wallets backup file', err.message);
  }
}

export function restoreWalletsFromBackup(
  backupData?: WalletsBackupPayload,
  db = initDatabase()
): { restoredWallets: number; restoredGroups: number } {
  let data = backupData;
  if (!data) {
    const locations = [
      path.resolve('./data/wallets_backup.json'),
      path.resolve('./wallets_backup.json'),
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        try {
          const raw = fs.readFileSync(loc, 'utf-8');
          data = JSON.parse(raw);
          if (data && Array.isArray(data.wallets) && data.wallets.length > 0) {
            break;
          }
        } catch {
          // try next
        }
      }
    }
  }

  if (!data || !Array.isArray(data.wallets)) {
    return { restoredWallets: 0, restoredGroups: 0 };
  }

  let restoredGroups = 0;
  let restoredWallets = 0;

  // Restore groups
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!g.id || !g.name) continue;
      const existing = db.prepare('SELECT id FROM groups WHERE id = ? OR LOWER(name) = LOWER(?)').get(g.id, g.name);
      if (!existing) {
        db.prepare('INSERT INTO groups (id, name, description, created_at, is_enabled) VALUES (?, ?, ?, ?, 1)')
          .run(g.id, g.name, g.description || '', Date.now());
        restoredGroups++;
      }
    }
  }

  // Restore wallets
  for (const w of data.wallets) {
    if (!w.address) continue;
    const norm = w.address.trim().toLowerCase();
    const existing = db.prepare('SELECT address FROM wallets WHERE address = ? OR address = ?').get(norm, w.address.trim());
    if (!existing) {
      db.prepare('INSERT INTO wallets (address, label, chain_type, created_at, is_active) VALUES (?, ?, ?, ?, 1)')
        .run(norm, w.label || 'Tracked Wallet', w.chain_type || 'evm', Date.now());
      restoredWallets++;
    }

    // Link groups
    if (Array.isArray(w.groups)) {
      for (const grp of w.groups) {
        const resolvedId = resolveGroupId(grp, db);
        if (resolvedId) {
          try {
            db.prepare('INSERT OR IGNORE INTO wallet_group_members (wallet_address, group_id, added_at) VALUES (?, ?, ?)')
              .run(norm, resolvedId, Date.now());
          } catch {}
        }
      }
    }
  }

  if (restoredWallets > 0) {
    addLog('info', 'db', `Auto-restored ${restoredWallets} wallets and ${restoredGroups} groups from persistent backup`);
  }
  return { restoredWallets, restoredGroups };
}

function seedInitialData(db: DatabaseSync) {
  // Check if groups already exist
  const existingGroups = db.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
  const now = Date.now();

  if (!existingGroups || existingGroups.count === 0) {
    const insertGroup = db.prepare(
      'INSERT INTO groups (id, name, description, created_at, is_enabled) VALUES (?, ?, ?, ?, 1)'
    );
    insertGroup.run('grp_alpha', 'Alpha', 'Top performing NFT traders and early discoverers', now);
    insertGroup.run('grp_whales', 'Whales', 'High-volume high-capital liquidity holders', now);
    insertGroup.run('grp_smart_money', 'Smart Money', 'Algorithmic snipers and consistently profitable collectors', now);
  }

  // Auto-restore wallets from persistent backup file if database was wiped or freshly mounted
  try {
    const walletCountRow = db.prepare('SELECT COUNT(*) as count FROM wallets').get() as { count: number };
    if (!walletCountRow || Number(walletCountRow.count) === 0) {
      restoreWalletsFromBackup(undefined, db);
    }
  } catch (err: any) {
    // Ignore transient restore error
  }
}

// Group Operations
export function getAllGroups(db = initDatabase()): WalletGroup[] {
  const rows = db.prepare(`
    SELECT g.*, COUNT(m.wallet_address) as wallet_count
    FROM groups g
    LEFT JOIN wallet_group_members m ON g.id = m.group_id
    GROUP BY g.id
    ORDER BY g.created_at ASC
  `).all() as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    created_at: Number(r.created_at),
    is_enabled: Number(r.is_enabled),
    wallet_count: Number(r.wallet_count || 0),
  }));
}

export function createGroup(name: string, description: string = '', db = initDatabase()): WalletGroup {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Group name cannot be empty');

  const id = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO groups (id, name, description, created_at, is_enabled)
    VALUES (?, ?, ?, ?, 1)
  `).run(id, trimmed, description.trim(), now);

  saveWalletsBackupToFile(db);

  return {
    id,
    name: trimmed,
    description: description.trim(),
    created_at: now,
    is_enabled: 1,
    wallet_count: 0,
  };
}

export function renameGroup(id: string, newName: string, db = initDatabase()): boolean {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Group name cannot be empty');

  const res = db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(trimmed, id);
  return (res as any).changes > 0;
}

export function deleteGroup(id: string, db = initDatabase()): boolean {
  // Cascading deletes remove memberships automatically
  const res = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  return (res as any).changes > 0;
}

/**
 * Resolves a group ID, Group Name, or sanitized slug to a valid group ID in SQLite.
 */
export function resolveGroupId(groupIdOrName: string, db = initDatabase()): string | null {
  if (!groupIdOrName) return null;
  const target = groupIdOrName.trim();
  if (!target) return null;

  // 1. Direct ID match
  const byId = db.prepare('SELECT id FROM groups WHERE id = ?').get(target) as any;
  if (byId) return byId.id;

  // 2. Case-insensitive name match
  const byName = db.prepare('SELECT id FROM groups WHERE LOWER(name) = LOWER(?)').get(target) as any;
  if (byName) return byName.id;

  // 3. Sanitized id match (e.g. "grp_" + name)
  const sanitizedId = `grp_${target.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
  const bySanitized = db.prepare('SELECT id FROM groups WHERE id = ?').get(sanitizedId) as any;
  if (bySanitized) return bySanitized.id;

  // 4. Case-insensitive ID match
  const byIdLower = db.prepare('SELECT id FROM groups WHERE LOWER(id) = LOWER(?)').get(target) as any;
  if (byIdLower) return byIdLower.id;

  return null;
}

/**
 * Safely resolves an existing group or auto-creates it so foreign key constraints are always satisfied.
 */
export function getOrCreateGroup(groupIdOrName: string, db = initDatabase()): WalletGroup {
  const existingId = resolveGroupId(groupIdOrName, db);
  if (existingId) {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(existingId) as any;
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      created_at: Number(row.created_at),
      is_enabled: Number(row.is_enabled),
      wallet_count: 0,
    };
  }

  // Fallback to default group if input is empty or looks like an address
  const cleanName = groupIdOrName.trim();
  if (!cleanName || validateWalletAddress(cleanName).isValid) {
    const alphaGroup = db.prepare("SELECT * FROM groups WHERE id = 'grp_alpha' OR LOWER(name) = 'alpha'").get() as any;
    if (alphaGroup) {
      return {
        id: alphaGroup.id,
        name: alphaGroup.name,
        description: alphaGroup.description || '',
        created_at: Number(alphaGroup.created_at),
        is_enabled: Number(alphaGroup.is_enabled),
        wallet_count: 0,
      };
    }
  }

  return createGroup(cleanName || 'Alpha', 'Auto-created group for tracked wallets', db);
}

// Wallet Operations
export function getAllWallets(db = initDatabase()): TrackedWallet[] {
  const wallets = db.prepare('SELECT * FROM wallets ORDER BY created_at DESC').all() as any[];
  const memberships = db.prepare(`
    SELECT m.wallet_address, m.group_id, g.name as group_name
    FROM wallet_group_members m
    JOIN groups g ON m.group_id = g.id
  `).all() as any[];

  const groupMap: Record<string, { ids: string[]; names: string[] }> = {};
  for (const m of memberships) {
    if (!groupMap[m.wallet_address]) {
      groupMap[m.wallet_address] = { ids: [], names: [] };
    }
    groupMap[m.wallet_address].ids.push(m.group_id);
    groupMap[m.wallet_address].names.push(m.group_name);
  }

  return wallets.map((w) => ({
    address: w.address,
    label: w.label || '',
    chain_type: w.chain_type || 'evm',
    created_at: Number(w.created_at),
    is_active: Number(w.is_active),
    groups: groupMap[w.address]?.ids || [],
    group_names: groupMap[w.address]?.names || [],
  }));
}

export function addWallet(
  address: string,
  label: string = '',
  chainType: 'evm' | 'solana' | 'flow' | 'other' = 'evm',
  groupIds: string[] = [],
  db = initDatabase()
): TrackedWallet {
  const normAddress = chainType === 'evm' ? address.toLowerCase().trim() : address.trim();
  const now = Date.now();

  db.prepare(`
    INSERT INTO wallets (address, label, chain_type, created_at, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(address) DO UPDATE SET
      label = CASE WHEN excluded.label != '' THEN excluded.label ELSE wallets.label END,
      chain_type = excluded.chain_type,
      is_active = 1
  `).run(normAddress, label.trim(), chainType, now);

  // Add to groups safely with resolved foreign keys
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO wallet_group_members (wallet_address, group_id, added_at)
    VALUES (?, ?, ?)
  `);

  for (const gInput of groupIds) {
    if (!gInput || !gInput.trim()) continue;
    // Don't treat another wallet address as a group ID
    if (validateWalletAddress(gInput.trim()).isValid) continue;

    const resolvedId = resolveGroupId(gInput, db) || getOrCreateGroup(gInput, db).id;
    if (resolvedId) {
      try {
        insertMember.run(normAddress, resolvedId, now);
      } catch (err: any) {
        addLog('warn', 'db', `Could not link wallet ${normAddress} to group ${resolvedId}`, err.message);
      }
    }
  }

  saveWalletsBackupToFile(db);
  const updatedWallets = getAllWallets(db);
  return updatedWallets.find((w) => w.address === normAddress) || {
    address: normAddress,
    label: label.trim(),
    chain_type: chainType,
    created_at: now,
    is_active: 1,
    groups: [],
    group_names: [],
  };
}

export function removeWallet(address: string, db = initDatabase()): boolean {
  const normAddress = address.trim();
  const res = db.prepare('DELETE FROM wallets WHERE address = ? OR address = ?').run(
    normAddress,
    normAddress.toLowerCase()
  );
  const ok = (res as any).changes > 0;
  if (ok) saveWalletsBackupToFile(db);
  return ok;
}

export function addWalletToGroup(address: string, groupIdOrName: string, db = initDatabase()): boolean {
  const normAddress = address.trim();
  // Ensure wallet exists
  const existing = db.prepare('SELECT address FROM wallets WHERE address = ? OR address = ?').get(
    normAddress,
    normAddress.toLowerCase()
  ) as any;
  const actualAddress = existing ? existing.address : normAddress;

  const resolvedGroupId = resolveGroupId(groupIdOrName, db) || getOrCreateGroup(groupIdOrName, db).id;

  try {
    const res = db.prepare(`
      INSERT OR IGNORE INTO wallet_group_members (wallet_address, group_id, added_at)
      VALUES (?, ?, ?)
    `).run(actualAddress, resolvedGroupId, Date.now());
    return (res as any).changes > 0;
  } catch (err: any) {
    addLog('warn', 'db', `Failed adding wallet ${actualAddress} to group ${groupIdOrName}`, err.message);
    return false;
  }
}

export function removeWalletFromGroup(address: string, groupId: string, db = initDatabase()): boolean {
  const normAddress = address.trim();
  const res = db.prepare(`
    DELETE FROM wallet_group_members
    WHERE (wallet_address = ? OR wallet_address = ?) AND group_id = ?
  `).run(normAddress, normAddress.toLowerCase(), groupId);

  return (res as any).changes > 0;
}

export function getWalletGroups(address: string, db = initDatabase()): WalletGroup[] {
  const normAddress = address.trim();
  const rows = db.prepare(`
    SELECT g.*
    FROM groups g
    JOIN wallet_group_members m ON g.id = m.group_id
    WHERE m.wallet_address = ? OR m.wallet_address = ?
  `).all(normAddress, normAddress.toLowerCase()) as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    created_at: Number(r.created_at),
    is_enabled: Number(r.is_enabled),
  }));
}

export function clearAllWallets(db = initDatabase()): number {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM wallets').get() as any;
  const count = Number(countRow?.count || 0);

  db.exec(`
    DELETE FROM wallet_group_members;
    DELETE FROM wallets;
  `);

  addLog('info', 'db', `Cleared all tracked wallets (${count} removed)`);
  return count;
}

export function bulkAddWalletsToGroup(
  groupIdOrName: string,
  walletInputs: { address: string; label?: string }[],
  db = initDatabase()
): {
  group: WalletGroup;
  addedCount: number;
  skippedCount: number;
  errors: string[];
  wallets: TrackedWallet[];
} {
  const trimmedTarget = (groupIdOrName || '').trim();
  const isTargetAnAddress = trimmedTarget ? validateWalletAddress(trimmedTarget).isValid : false;
  const effectiveTarget = (!trimmedTarget || isTargetAnAddress) ? 'Alpha' : trimmedTarget;

  // 1. Locate or safely create target group
  const group = getOrCreateGroup(effectiveTarget, db);
  const targetGroupId = group.id;
  const now = Date.now();
  let addedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const insertWallet = db.prepare(`
    INSERT INTO wallets (address, label, chain_type, created_at, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(address) DO UPDATE SET
      label = CASE WHEN excluded.label != '' THEN excluded.label ELSE wallets.label END,
      chain_type = excluded.chain_type,
      is_active = 1
  `);

  const insertMembership = db.prepare(`
    INSERT OR IGNORE INTO wallet_group_members (wallet_address, group_id, added_at)
    VALUES (?, ?, ?)
  `);

  const allItems = [...walletInputs];
  if (isTargetAnAddress) {
    allItems.unshift({ address: trimmedTarget });
  }

  for (const item of allItems) {
    const rawAddr = (item.address || '').trim();
    if (!rawAddr) continue;

    const validation = validateWalletAddress(rawAddr);
    if (!validation.isValid) {
      errors.push(`${rawAddr}: ${validation.error}`);
      skippedCount++;
      continue;
    }

    const normAddr = validation.normalizedAddress;
    const label = (item.label || '').trim() || `Wallet_${normAddr.slice(0, 6)}`;

    try {
      insertWallet.run(normAddr, label, validation.chainType, now);
      const memberRes = insertMembership.run(normAddr, targetGroupId, now);
      if ((memberRes as any).changes > 0) {
        addedCount++;
      }
    } catch (err: any) {
      errors.push(`${rawAddr}: ${err.message}`);
      skippedCount++;
    }
  }

  addLog('info', 'db', `Bulk added ${addedCount} wallets to group "${group.name}" (${errors.length} errors)`);
  if (addedCount > 0) {
    saveWalletsBackupToFile(db);
  }

  const updatedGroups = getAllGroups(db);
  const matchedGroup = updatedGroups.find((g) => g.id === targetGroupId) || {
    id: group.id,
    name: group.name,
    description: '',
    created_at: now,
    is_enabled: 1,
    wallet_count: addedCount,
  };

  return {
    group: matchedGroup,
    addedCount,
    skippedCount,
    errors,
    wallets: getAllWallets(db),
  };
}

// Event deduplication
export function isEventProcessed(eventId: string, db = initDatabase()): boolean {
  const row = db.prepare('SELECT event_id FROM processed_events WHERE event_id = ?').get(eventId);
  return Boolean(row);
}

export function recordProcessedEvent(
  event: {
    eventId: string;
    eventType: string;
    chain: string;
    collectionSlug: string;
    walletAddress: string;
    counterpartyAddress?: string;
    txHash?: string;
    quantity: number;
    timestamp: number;
  },
  db = initDatabase()
): void {
  db.prepare(`
    INSERT OR IGNORE INTO processed_events
    (event_id, event_type, chain, collection_slug, wallet_address, counterparty_address, tx_hash, quantity, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.eventId,
    event.eventType,
    event.chain,
    event.collectionSlug,
    event.walletAddress.toLowerCase(),
    event.counterpartyAddress ? event.counterpartyAddress.toLowerCase() : null,
    event.txHash || null,
    event.quantity || 1,
    event.timestamp,
    Date.now()
  );
}

// Collection cache
export function getCollectionCache(slug: string, db = initDatabase()): CollectionMetadata | null {
  const row = db.prepare('SELECT * FROM collections_cache WHERE slug = ?').get(slug) as any;
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    chain: row.chain,
    opensea_url: row.opensea_url,
    twitter_url: row.twitter_url || undefined,
    discord_url: row.discord_url || undefined,
    website_url: row.website_url || undefined,
    telegram_url: row.telegram_url || undefined,
    image_url: row.image_url || undefined,
    updated_at: Number(row.updated_at),
  };
}

export function saveCollectionCache(meta: CollectionMetadata, db = initDatabase()): void {
  db.prepare(`
    INSERT INTO collections_cache
    (slug, name, chain, opensea_url, twitter_url, discord_url, website_url, telegram_url, image_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      chain = excluded.chain,
      opensea_url = excluded.opensea_url,
      twitter_url = excluded.twitter_url,
      discord_url = excluded.discord_url,
      website_url = excluded.website_url,
      telegram_url = excluded.telegram_url,
      image_url = excluded.image_url,
      updated_at = excluded.updated_at
  `).run(
    meta.slug,
    meta.name,
    meta.chain,
    meta.opensea_url,
    meta.twitter_url || null,
    meta.discord_url || null,
    meta.website_url || null,
    meta.telegram_url || null,
    meta.image_url || null,
    Date.now()
  );
}

// Alert Thresholds: 3, 6, 10, 15 unique minters/buyers
export const ALERT_THRESHOLDS = [3, 6, 10, 15] as const;

export function getAchievedMilestones(
  collectionSlug: string,
  chain: string,
  activityType: 'mint' | 'buy',
  uniqueCount: number,
  db = initDatabase()
): { eligibleMilestones: number[]; nextMilestone: number | null } {
  const eligible: number[] = [];
  const rows = db.prepare(`
    SELECT milestone FROM collection_alert_milestones
    WHERE LOWER(collection_slug) = LOWER(?)
      AND LOWER(chain) = LOWER(?)
      AND activity_type = ?
  `).all(collectionSlug, chain, activityType) as any[];

  const alertedSet = new Set<number>(rows.map((r) => Number(r.milestone)));

  for (const t of ALERT_THRESHOLDS) {
    if (uniqueCount >= t && !alertedSet.has(t)) {
      eligible.push(t);
    }
  }

  // Calculate next milestone
  const next = ALERT_THRESHOLDS.find((t) => t > uniqueCount) || null;

  return { eligibleMilestones: eligible, nextMilestone: next };
}

export function recordMilestoneAlerted(
  collectionSlug: string,
  chain: string,
  activityType: 'mint' | 'buy',
  milestone: number,
  db = initDatabase()
): void {
  db.prepare(`
    INSERT OR REPLACE INTO collection_alert_milestones
    (collection_slug, chain, activity_type, milestone, alerted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(collectionSlug.toLowerCase(), chain.toLowerCase(), activityType, milestone, Date.now());
}

export function clearAllAlerts(db = initDatabase()): number {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM alert_history').get() as any;
  const count = Number(countRow?.count || 0);

  db.exec(`
    DELETE FROM alert_history;
    DELETE FROM collection_alert_milestones;
    DELETE FROM processed_events;
  `);
  addLog('info', 'db', `Cleared all alert history, collection milestones, and processed events (${count} purged)`);
  return count;
}

// Alert history
export function saveAlertHistory(alert: ConsolidatedAlert, db = initDatabase()): void {
  const groupsJson = JSON.stringify(alert.groups || (alert as any).groupBreakdown || []);
  db.prepare(`
    INSERT OR REPLACE INTO alert_history
    (id, alert_type, chain, collection_slug, collection_name, message_text, group_summaries, total_wallets, total_nfts, events_count, milestone, next_milestone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.id,
    alert.alertType,
    alert.chain,
    alert.collectionSlug,
    alert.collectionName,
    alert.formattedMessage,
    groupsJson,
    alert.totalUniqueWallets,
    alert.totalNFTs,
    alert.eventsCount,
    alert.milestone || null,
    alert.nextMilestone || null,
    alert.timestamp || Date.now()
  );
}

export function getAlertHistory(type?: 'mint' | 'buy', limit: number = 20, db = initDatabase()): ConsolidatedAlert[] {
  let query = 'SELECT * FROM alert_history';
  const params: any[] = [];
  if (type) {
    query += ' WHERE alert_type = ?';
    params.push(type);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map((r) => {
    let groups: any[] = [];
    try {
      groups = JSON.parse(r.group_summaries);
    } catch {
      // ignore
    }
    return {
      id: r.id,
      alertType: r.alert_type as 'mint' | 'buy',
      chain: r.chain,
      collectionSlug: r.collection_slug,
      collectionName: r.collection_name,
      groups,
      totalUniqueWallets: Number(r.total_wallets),
      totalNFTs: Number(r.total_nfts),
      openseaUrl: `https://opensea.io/collection/${r.collection_slug}`,
      socials: {},
      formattedMessage: r.message_text,
      timestamp: Number(r.created_at),
      eventsCount: Number(r.events_count || 1),
      milestone: r.milestone ? Number(r.milestone) : undefined,
      nextMilestone: r.next_milestone ? Number(r.next_milestone) : null,
    };
  });
}

// System Logs
export function addLog(
  level: 'info' | 'warn' | 'error',
  category: 'opensea' | 'telegram' | 'db' | 'monitor',
  message: string,
  details?: string,
  db = initDatabase()
): void {
  try {
    db.prepare(`
      INSERT INTO system_logs (level, category, message, details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(level, category, message, details || null, Date.now());
  } catch (err) {
    console.error('Failed to write log to db:', err);
  }
}

export function getRecentLogs(limit: number = 50, db = initDatabase()): SystemLog[] {
  const rows = db.prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    level: r.level as any,
    category: r.category as any,
    message: r.message,
    details: r.details || undefined,
    created_at: Number(r.created_at),
  }));
}

// Dashboard statistics
export function getDashboardStats(db = initDatabase()): DashboardStats {
  const totalWallets = (db.prepare('SELECT COUNT(*) as c FROM wallets').get() as any)?.c || 0;
  const activeWallets = (db.prepare('SELECT COUNT(*) as c FROM wallets WHERE is_active = 1').get() as any)?.c || 0;
  const totalGroups = (db.prepare('SELECT COUNT(*) as c FROM groups').get() as any)?.c || 0;

  // Stats from processed events
  const mintsStats = (db.prepare(`
    SELECT
      COUNT(DISTINCT wallet_address) as unique_minters,
      SUM(quantity) as total_nfts,
      COUNT(*) as events_count
    FROM processed_events
    WHERE event_type = 'mint'
  `).get() as any) || { unique_minters: 0, total_nfts: 0, events_count: 0 };

  const salesStats = (db.prepare(`
    SELECT
      COUNT(DISTINCT wallet_address) as unique_buyers,
      SUM(quantity) as total_nfts,
      COUNT(*) as events_count
    FROM processed_events
    WHERE event_type = 'sale'
  `).get() as any) || { unique_buyers: 0, total_nfts: 0, events_count: 0 };

  // Recent errors
  const errors = (db.prepare(`
    SELECT * FROM system_logs
    WHERE level = 'error'
    ORDER BY created_at DESC LIMIT 10
  `).all() as any[]).map((r) => ({
    id: r.id,
    level: r.level as any,
    category: r.category as any,
    message: r.message,
    details: r.details || undefined,
    created_at: Number(r.created_at),
  }));

  const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('example'));
  const adminConfigured = Boolean(process.env.TELEGRAM_ADMIN_IDS && process.env.TELEGRAM_ADMIN_IDS.trim() !== '');

  return {
    trackedWalletsCount: Number(totalWallets),
    activeWalletsCount: Number(activeWallets),
    groupsCount: Number(totalGroups),
    supportedChainsCount: 14,
    monitoredChainsCount: 8,
    recentMintsCount: Number(mintsStats.events_count || 0),
    recentPurchasesCount: Number(salesStats.events_count || 0),
    uniqueMintersCount: Number(mintsStats.unique_minters || 0),
    nftsMintedCount: Number(mintsStats.total_nfts || 0),
    uniqueBuyersCount: Number(salesStats.unique_buyers || 0),
    nftsPurchasedCount: Number(salesStats.total_nfts || 0),
    isMonitoring: true,
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ? (Number(process.env.POLL_INTERVAL_SECONDS) >= 1000 ? Math.round(Number(process.env.POLL_INTERVAL_SECONDS) / 1000) : process.env.POLL_INTERVAL_SECONDS) : 10),
    recentErrors: errors,
    botStatus: {
      tokenConfigured,
      isAdminConfigured: adminConfigured,
      isRunning: true,
      mode: tokenConfigured ? 'live' : 'simulator',
    },
  };
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
