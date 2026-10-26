import {
  initDatabase,
  createGroup,
  renameGroup,
  deleteGroup,
  getAllGroups,
  addWallet,
  removeWallet,
  getAllWallets,
  clearAllWallets,
  bulkAddWalletsToGroup,
  addWalletToGroup,
  removeWalletFromGroup,
  getWalletGroups,
  recordProcessedEvent,
  isEventProcessed,
  saveAlertHistory,
  getAlertHistory,
  closeDatabase,
} from '../src/server/database/db.ts';
import { validateWalletAddress } from '../src/server/services/walletValidation.ts';
import { OpenSeaService } from '../src/server/services/openseaService.ts';
import { AlertConsolidator } from '../src/server/services/alertConsolidator.ts';
import fs from 'node:fs';
import path from 'node:path';

export interface TestResult {
  title: string;
  category: string;
  passed: boolean;
  message?: string;
  durationMs: number;
}

export async function runAllTests(): Promise<{ results: TestResult[]; summary: { total: number; passed: number; failed: number } }> {
  const results: TestResult[] = [];
  const testDbPath = './data/test_nft_bot.sqlite';

  // Ensure test db starts fresh
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = initDatabase(testDbPath);
  const consolidator = new AlertConsolidator();
  const opensea = new OpenSeaService('test_mock_key');

  const record = (title: string, category: string, fn: () => void | Promise<void>) => {
    const start = Date.now();
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            results.push({ title, category, passed: true, durationMs: Date.now() - start });
          })
          .catch((err) => {
            results.push({ title, category, passed: false, message: err.message, durationMs: Date.now() - start });
          });
      }
      results.push({ title, category, passed: true, durationMs: Date.now() - start });
    } catch (err: any) {
      results.push({ title, category, passed: false, message: err.message, durationMs: Date.now() - start });
    }
    return Promise.resolve();
  };

  // 1. Group Management: Create, Rename, Delete
  await record('Create, rename, and delete groups', 'Groups', () => {
    const groupName = 'DeFi Snipers';
    const group = createGroup(groupName, 'High-conviction snipers', db);
    if (!group.id || group.name !== groupName) throw new Error('Group creation failed');

    const renamed = renameGroup(group.id, 'Alpha Snipers', db);
    if (!renamed) throw new Error('Group rename failed');

    const groups = getAllGroups(db);
    const found = groups.find((g) => g.id === group.id);
    if (!found || found.name !== 'Alpha Snipers') throw new Error('Renamed group not found in DB');

    const deleted = deleteGroup(group.id, db);
    if (!deleted) throw new Error('Group delete failed');

    const afterDelete = getAllGroups(db).find((g) => g.id === group.id);
    if (afterDelete) throw new Error('Deleted group still exists');
  });

  // 2. Wallets: Add and Remove
  await record('Adding and removing wallets', 'Wallets', () => {
    const testAddr = '0x1111111111111111111111111111111111111111';
    addWallet(testAddr, 'Test Minter', 'evm', [], db);

    const wallets = getAllWallets(db);
    const added = wallets.find((w) => w.address === testAddr.toLowerCase());
    if (!added) throw new Error('Wallet was not found after addition');

    const removed = removeWallet(testAddr, db);
    if (!removed) throw new Error('Wallet removal failed');

    const afterRemove = getAllWallets(db).find((w) => w.address === testAddr.toLowerCase());
    if (afterRemove) throw new Error('Removed wallet still present');
  });

  // 3. Wallets Belonging to Multiple Groups
  await record('Wallets belonging to multiple groups', 'Memberships', () => {
    const multiAddr = '0x2222222222222222222222222222222222222222';
    const g1 = createGroup('Test Group A', 'Group A', db);
    const g2 = createGroup('Test Group B', 'Group B', db);

    addWallet(multiAddr, 'Multi Holder', 'evm', [g1.id, g2.id], db);

    const userGroups = getWalletGroups(multiAddr, db);
    if (userGroups.length !== 2) throw new Error(`Expected 2 groups, got ${userGroups.length}`);

    const hasG1 = userGroups.some((g) => g.id === g1.id);
    const hasG2 = userGroups.some((g) => g.id === g2.id);
    if (!hasG1 || !hasG2) throw new Error('Wallet does not contain both groups');
  });

  // 4. Removing wallet from one group preserves membership in others
  await record('Removing a wallet from one group preserves membership in others', 'Memberships', () => {
    const addr = '0x3333333333333333333333333333333333333333';
    const g1 = createGroup('Preserve G1', '', db);
    const g2 = createGroup('Preserve G2', '', db);

    addWallet(addr, 'Preserve Test', 'evm', [g1.id, g2.id], db);
    removeWalletFromGroup(addr, g1.id, db);

    const remainingGroups = getWalletGroups(addr, db);
    if (remainingGroups.length !== 1 || remainingGroups[0].id !== g2.id) {
      throw new Error(`Expected only G2 to remain, found: ${remainingGroups.map((g) => g.name).join(', ')}`);
    }
  });

  // 5. Detecting Genuine Mints
  await record('Detecting genuine mints (zero-address sender or mint event)', 'Activity Detection', () => {
    const trackedAddr = '0x4444444444444444444444444444444444444444';

    // Transfer from 0x0 is a mint
    const rawMintEvent1 = {
      event_id: 'mint_test_1',
      event_type: 'transfer',
      from_address: '0x0000000000000000000000000000000000000000',
      to_address: trackedAddr,
      chain: 'ethereum',
      collection: 'azuki',
      quantity: 2,
    };
    const classified1 = opensea.classifyEvent(rawMintEvent1, trackedAddr);
    if (!classified1 || classified1.event_type !== 'mint') {
      throw new Error('Failed to classify transfer from 0x0 address as mint');
    }
    if (classified1.quantity !== 2) throw new Error('Incorrect quantity on mint event');

    // Explicit event_type: mint
    const rawMintEvent2 = {
      event_id: 'mint_test_2',
      event_type: 'mint',
      to_address: trackedAddr,
      chain: 'base',
      collection: 'base-apes',
      quantity: 1,
    };
    const classified2 = opensea.classifyEvent(rawMintEvent2, trackedAddr);
    if (!classified2 || classified2.event_type !== 'mint') {
      throw new Error('Failed to classify explicit mint event');
    }
  });

  // 6. Detecting Genuine Purchases
  await record('Detecting genuine purchases (tracked wallet is buyer)', 'Activity Detection', () => {
    const trackedAddr = '0x5555555555555555555555555555555555555555';

    const saleEvent = {
      event_id: 'sale_test_1',
      event_type: 'sale',
      buyer: trackedAddr,
      seller: '0x9999999999999999999999999999999999999999',
      chain: 'ethereum',
      collection: 'pudgypenguins',
      quantity: 1,
    };

    const classified = opensea.classifyEvent(saleEvent, trackedAddr);
    if (!classified || classified.event_type !== 'sale') {
      throw new Error('Failed to classify genuine purchase where tracked wallet is buyer');
    }
  });

  // 7. Excluding Ordinary Transfers
  await record('Excluding ordinary transfers between non-zero addresses', 'Activity Detection', () => {
    const trackedAddr = '0x6666666666666666666666666666666666666666';

    const ordinaryTransfer = {
      event_id: 'transfer_test_1',
      event_type: 'transfer',
      from_address: '0x8888888888888888888888888888888888888888',
      to_address: trackedAddr,
      chain: 'ethereum',
      collection: 'doodles',
      quantity: 1,
    };

    const classified = opensea.classifyEvent(ordinaryTransfer, trackedAddr);
    if (classified !== null) {
      throw new Error('Ordinary transfer between non-zero addresses was incorrectly classified!');
    }
  });

  // 8. Excluding sales initiated by tracked wallets (tracked wallet is seller)
  await record('Excluding sales initiated by tracked wallets (wallet is seller, not buyer)', 'Activity Detection', () => {
    const trackedAddr = '0x7777777777777777777777777777777777777777';

    const sellEvent = {
      event_id: 'sell_test_1',
      event_type: 'sale',
      seller: trackedAddr,
      buyer: '0x1234123412341234123412341234123412341234',
      chain: 'ethereum',
      collection: 'coolcats',
      quantity: 1,
    };

    const classified = opensea.classifyEvent(sellEvent, trackedAddr);
    if (classified !== null) {
      throw new Error('Sale initiated by tracked wallet was incorrectly treated as a purchase!');
    }
  });

  // 9. Multi-Group Deduplication & Statistics Accuracy (Core Requirement 4 & 5)
  await record('Consolidating multi-group alerts without double-counting wallets or NFTs', 'Statistics & Alerts', () => {
    // Setup test:
    // Group Alpha: Wallet A, Wallet B, Wallet C
    // Group Whales: Wallet C, Wallet D
    // Notice Wallet C belongs to BOTH Alpha and Whales!
    const gAlpha = createGroup('Stats Alpha', '', db);
    const gWhales = createGroup('Stats Whales', '', db);

    const wA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const wB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const wC = '0xcccccccccccccccccccccccccccccccccccccccc'; // overlap!
    const wD = '0xdddddddddddddddddddddddddddddddddddddddd';

    addWallet(wA, 'A', 'evm', [gAlpha.id], db);
    addWallet(wB, 'B', 'evm', [gAlpha.id], db);
    addWallet(wC, 'C', 'evm', [gAlpha.id, gWhales.id], db);
    addWallet(wD, 'D', 'evm', [gWhales.id], db);

    // Activity:
    // wA mints 5 NFTs (1 event)
    // wB mints 4 NFTs (1 event)
    // wC mints 3 NFTs (1 event)
    // wD mints 2 NFTs (1 event)
    // Group Alpha should see: 3 Minters (A, B, C) | 12 NFTs (5 + 4 + 3)
    // Group Whales should see: 2 Minters (C, D) | 5 NFTs (3 + 2)
    // Total Unique Wallets across both = 4 (A, B, C, D) -- NOT 5!
    // Total NFTs Minted = 14 (5 + 4 + 3 + 2) -- NOT 17 (which would double count C's 3 NFTs)!

    const events = [
      {
        event_id: 'ev_a',
        event_type: 'mint' as const,
        chain: 'ethereum',
        collection_slug: 'quantum-cats',
        wallet_address: wA,
        quantity: 5,
        timestamp: Date.now(),
      },
      {
        event_id: 'ev_b',
        event_type: 'mint' as const,
        chain: 'ethereum',
        collection_slug: 'quantum-cats',
        wallet_address: wB,
        quantity: 4,
        timestamp: Date.now(),
      },
      {
        event_id: 'ev_c',
        event_type: 'mint' as const,
        chain: 'ethereum',
        collection_slug: 'quantum-cats',
        wallet_address: wC,
        quantity: 3,
        timestamp: Date.now(),
      },
      {
        event_id: 'ev_d',
        event_type: 'mint' as const,
        chain: 'ethereum',
        collection_slug: 'quantum-cats',
        wallet_address: wD,
        quantity: 2,
        timestamp: Date.now(),
      },
    ];

    const alerts = consolidator.consolidateEvents(
      events,
      {
        'quantum-cats': {
          slug: 'quantum-cats',
          name: 'Quantum Cats',
          chain: 'ethereum',
          opensea_url: 'https://opensea.io/collection/quantum-cats',
          twitter_url: 'https://x.com/QuantumCatsXYZ',
          discord_url: 'https://discord.gg/quantumcats',
          updated_at: Date.now(),
        },
      },
      db
    );

    if (alerts.length !== 1) throw new Error(`Expected 1 consolidated alert, got ${alerts.length}`);
    const alert = alerts[0];

    // Check unique wallets
    if (alert.totalUniqueWallets !== 4) {
      throw new Error(`Total unique wallets was ${alert.totalUniqueWallets}, expected 4 (deduplicated)`);
    }

    // Check total NFTs
    if (alert.totalNFTs !== 14) {
      throw new Error(`Total NFTs was ${alert.totalNFTs}, expected 14 (avoiding double count of overlapping wallet)`);
    }

    // Check individual groups
    const alphaSummary = alert.groups.find((g) => g.groupId === gAlpha.id);
    const whalesSummary = alert.groups.find((g) => g.groupId === gWhales.id);

    if (!alphaSummary || alphaSummary.uniqueCount !== 3 || alphaSummary.nftsCount !== 12) {
      throw new Error(`Alpha group stats incorrect: ${JSON.stringify(alphaSummary)}`);
    }

    if (!whalesSummary || whalesSummary.uniqueCount !== 2 || whalesSummary.nftsCount !== 5) {
      throw new Error(`Whales group stats incorrect: ${JSON.stringify(whalesSummary)}`);
    }

    // Check exact required message formatting
    if (!alert.formattedMessage.includes('🔥 SMART MONEY MINT')) {
      throw new Error('Header title missing 🔥 SMART MONEY MINT');
    }
    if (!alert.formattedMessage.includes('4 Unique Wallets | 14 NFTs Minted')) {
      throw new Error('Total line format incorrect: ' + alert.formattedMessage);
    }
    if (!alert.formattedMessage.includes('📁 Stats Alpha — 3 Minters | 12 NFTs')) {
      throw new Error('Alpha group line format incorrect: ' + alert.formattedMessage);
    }
    if (!alert.formattedMessage.includes('📁 Stats Whales — 2 Minters | 5 NFTs')) {
      throw new Error('Whales group line format incorrect: ' + alert.formattedMessage);
    }
    if (!alert.formattedMessage.includes('🔗 OpenSea: https://opensea.io/collection/quantum-cats')) {
      throw new Error('OpenSea link missing or incorrect');
    }
    if (!alert.formattedMessage.includes('[X/Twitter](https://x.com/QuantumCatsXYZ)')) {
      throw new Error('Socials link missing or incorrect');
    }
  });

  // 10. Purchase Alert Formatting (Section 6)
  await record('Formatting NFT Purchase alerts correctly (🔥 SMART MONEY BUY)', 'Alert Formatting', () => {
    const gAlpha = getAllGroups(db)[0];
    const testBuyer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    addWallet(testBuyer, 'Test Alpha Buyer', 'evm', [gAlpha.id], db);

    const events = [
      {
        event_id: 'buy_ev_1',
        event_type: 'sale' as const,
        chain: 'ethereum',
        collection_slug: 'milady',
        wallet_address: testBuyer,
        quantity: 2,
        timestamp: Date.now(),
      },
    ];

    const alerts = consolidator.consolidateEvents(
      events,
      {
        milady: {
          slug: 'milady',
          name: 'Milady Maker',
          chain: 'ethereum',
          opensea_url: 'https://opensea.io/collection/milady',
          updated_at: Date.now(),
        },
      },
      db
    );

    if (alerts.length !== 1) throw new Error('Expected 1 buy alert');
    const msg = alerts[0].formattedMessage;

    if (!msg.includes('🔥 SMART MONEY BUY')) throw new Error('Buy header missing');
    if (!msg.includes('Buyers')) throw new Error('Expected "Buyers" in group row');
    if (!msg.includes('NFTs Bought')) throw new Error('Expected "NFTs Bought" in total line');
    if (!msg.includes('⚡ Activity: NFT Purchase')) throw new Error('Expected Activity: NFT Purchase');
  });

  // 11. Handling Missing Socials Gracefully
  await record('Handling missing social links without failing alert delivery', 'Socials & Links', () => {
    const formatted = consolidator.formatTelegramMessage({
      alertType: 'mint',
      collectionName: 'No Socials Project',
      chain: 'base',
      groupSummaries: [{ groupId: 'g1', groupName: 'Alpha', uniqueCount: 1, nftsCount: 1 }],
      totalUniqueWallets: 1,
      totalNFTs: 1,
      openseaUrl: 'https://opensea.io/collection/no-socials',
      socials: {}, // empty socials
    });

    if (!formatted.includes('🌐 Socials: None listed')) {
      throw new Error('Expected graceful "None listed" fallback when socials are missing');
    }
    if (!formatted.includes('⛓️ Chain: Base')) {
      throw new Error('Expected properly capitalized chain "Base"');
    }
  });

  // 12. Preventing Duplicate Events across retrieval cycles
  await record('Preventing duplicate events across retrieval cycles', 'Deduplication', () => {
    const eventId = 'unique_tx_001_1';
    if (isEventProcessed(eventId, db)) throw new Error('Event should not be processed yet');

    recordProcessedEvent(
      {
        eventId,
        eventType: 'mint',
        chain: 'ethereum',
        collectionSlug: 'cryptopunks',
        walletAddress: '0x1234567890123456789012345678901234567890',
        quantity: 1,
        timestamp: Date.now(),
      },
      db
    );

    if (!isEventProcessed(eventId, db)) {
      throw new Error('Recorded event was not marked as processed');
    }

    // Second check to ensure it returns true and avoids duplicate processing
    const duplicate = isEventProcessed(eventId, db);
    if (!duplicate) throw new Error('Duplicate check failed');
  });

  // 13. Address Format Validation (EVM & Solana)
  await record('Address format validation for EVM and Solana', 'Validation', () => {
    // Valid EVM
    const evmValid = validateWalletAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    if (!evmValid.isValid || evmValid.chainType !== 'evm') throw new Error('Valid EVM was rejected');

    // Invalid EVM (bad length)
    const evmInvalid = validateWalletAddress('0x12345');
    if (evmInvalid.isValid) throw new Error('Invalid EVM address was accepted');

    // Valid Solana
    const solValid = validateWalletAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    if (!solValid.isValid || solValid.chainType !== 'solana') throw new Error('Valid Solana address was rejected');

    // Empty
    const empty = validateWalletAddress('');
    if (empty.isValid) throw new Error('Empty address was accepted');
  });

  // 14. Preserving Data Across Restarts (SQLite persistence)
  await record('Preserving data across restarts in SQLite persistent disk', 'Persistence', () => {
    const testKey = '0x9999999999999999999999999999999999999999';
    addWallet(testKey, 'Persistence Check', 'evm', [], db);

    // Close and reopen database
    closeDatabase();
    const reopenedDb = initDatabase(testDbPath);

    const wallets = getAllWallets(reopenedDb);
    const persisted = wallets.find((w) => w.address === testKey);
    if (!persisted || persisted.label !== 'Persistence Check') {
      throw new Error('Data did not survive database close and reopen');
    }
  });

  // 15. Adding multiple wallets to a group at once (Bulk add)
  await record('Adding multiple wallets to a group at once', 'Bulk Operations', () => {
    const bulkGroup = createGroup('Bulk Alpha', 'Bulk testing', db);
    const inputs = [
      { address: '0x1212121212121212121212121212121212121212', label: 'Bulk 1' },
      { address: '0x3434343434343434343434343434343434343434', label: 'Bulk 2' },
      { address: '0x5656565656565656565656565656565656565656', label: 'Bulk 3' },
      { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', label: 'Solana Whale' },
      { address: 'invalid_address_format', label: 'Bad' },
    ];

    const bulkResult = bulkAddWalletsToGroup(bulkGroup.id, inputs, db);
    if (bulkResult.addedCount !== 4) {
      throw new Error(`Expected 4 valid wallets added, got ${bulkResult.addedCount}`);
    }
    if (bulkResult.errors.length !== 1) {
      throw new Error(`Expected 1 invalid address error, got ${bulkResult.errors.length}`);
    }

    const groupWallets = getAllWallets(db).filter((w) => w.groups?.includes(bulkGroup.id));
    if (groupWallets.length !== 4) {
      throw new Error(`Expected 4 wallets in bulkGroup, got ${groupWallets.length}`);
    }
  });

  // 16. Deleting and removing all wallets (Clear all wallets)
  await record('Deleting and removing all tracked wallets', 'Bulk Operations', () => {
    const initialCount = getAllWallets(db).length;
    if (initialCount === 0) throw new Error('Expected wallets to exist before clear');

    const clearedCount = clearAllWallets(db);
    if (clearedCount !== initialCount) {
      throw new Error(`Expected ${initialCount} cleared, got ${clearedCount}`);
    }

    const afterWallets = getAllWallets(db);
    if (afterWallets.length !== 0) {
      throw new Error(`Expected 0 wallets after clearAllWallets, found ${afterWallets.length}`);
    }
  });

  // 17. Foreign Key Safety: Adding wallets with group names, case-insensitive names, and multi-address inputs
  await record('Preventing FOREIGN KEY constraint failures when adding wallets', 'Database Safety', () => {
    // 1. Add wallet specifying group NAME ('Alpha') instead of group ID ('grp_alpha')
    const w1 = addWallet('0x9999999999999999999999999999999999999999', 'FK Test 1', 'evm', ['Alpha'], db);
    if (!w1.groups?.includes('grp_alpha')) {
      throw new Error('Expected wallet to resolve "Alpha" name to "grp_alpha" group ID');
    }

    // 2. Add wallet to group using addWalletToGroup with group name
    const addedToWhales = addWalletToGroup('0x9999999999999999999999999999999999999999', 'Whales', db);
    if (!addedToWhales) throw new Error('Failed adding wallet to group via name');

    // 3. Bulk add with address passed as target group without specifying group name
    const bulkRes = bulkAddWalletsToGroup(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [{ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
      db
    );
    if (bulkRes.addedCount < 2) {
      throw new Error(`Expected at least 2 wallets added, got ${bulkRes.addedCount}`);
    }

    // 4. Add wallet with address passed in groupIds (accidental multi-address passed to /addwallet)
    const wMulti = addWallet(
      '0xcccccccccccccccccccccccccccccccccccccccc',
      'Multi Accidental',
      'evm',
      ['0xdddddddddddddddddddddddddddddddddddddddd'],
      db
    );
    if (!wMulti) throw new Error('addWallet failed with address in groupIds');
  });

  // Clean up test db file
  closeDatabase();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {
    // ignore
  }

  // Restore main DB
  initDatabase();

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  return { results, summary: { total, passed, failed } };
}

// If run directly from CLI
if (process.argv[1]?.includes('run_all_tests')) {
  runAllTests().then(({ results, summary }) => {
    console.log(`\n======================================================`);
    console.log(`TEST SUITE RESULTS: ${summary.passed}/${summary.total} PASSED`);
    console.log(`======================================================\n`);
    results.forEach((r, idx) => {
      const icon = r.passed ? '✅' : '❌';
      console.log(`${icon} [${r.category}] ${r.title} (${r.durationMs}ms)`);
      if (!r.passed) {
        console.error(`   Error: ${r.message}`);
      }
    });
    console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed\n`);
    if (summary.failed > 0) process.exit(1);
  });
}
