import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDashboardStats,
  getAllWallets,
  addWallet,
  removeWallet,
  clearAllWallets,
  bulkAddWalletsToGroup,
  getAllGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  addWalletToGroup,
  removeWalletFromGroup,
  getAlertHistory,
  saveAlertHistory,
  getRecentLogs,
  addLog,
  recordProcessedEvent,
  clearAllAlerts,
} from '../database/db.ts';
import { validateWalletAddress } from '../services/walletValidation.ts';
import { openseaService } from '../services/openseaService.ts';
import { alertConsolidator } from '../services/alertConsolidator.ts';
import { simulateTelegramMessage, broadcastTelegramAlert, getAdminIds } from '../telegram/bot.ts';
import { monitorService } from '../services/monitorService.ts';
import { runAllTests } from '../../../test/run_all_tests.ts';
import { generateProjectZip } from '../../../scripts/create_zip.ts';
import { NFTEvent } from '../../types.ts';

export const apiRouter = Router();

// Dashboard Summary
apiRouter.get('/dashboard', (req: Request, res: Response) => {
  try {
    const stats = getDashboardStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Wallets
apiRouter.get('/wallets', (req: Request, res: Response) => {
  try {
    const wallets = getAllWallets();
    res.json(wallets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/wallets', (req: Request, res: Response) => {
  try {
    const { address, label, chainType, groupIds } = req.body;
    const validation = validateWalletAddress(address, chainType);
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    const wallet = addWallet(
      validation.normalizedAddress,
      label || 'Tracked Wallet',
      validation.chainType,
      Array.isArray(groupIds) ? groupIds : []
    );
    addLog('info', 'db', `Added wallet ${wallet.address} (${wallet.label})`);
    res.json(wallet);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/wallets/:address', (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const removed = removeWallet(address);
    if (removed) {
      addLog('info', 'db', `Removed wallet ${address}`);
      res.json({ success: true, message: 'Wallet removed' });
    } else {
      res.status(404).json({ error: 'Wallet not found' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk add wallets to group
apiRouter.post('/wallets/bulk', (req: Request, res: Response) => {
  try {
    const { groupId, addresses, rawText, wallets, text } = req.body;
    const effectiveGroupId = (groupId && typeof groupId === 'string' && groupId.trim()) ? groupId.trim() : 'Alpha';

    const items: { address: string; label?: string }[] = [];
    const addrList = Array.isArray(addresses) ? addresses : Array.isArray(wallets) ? wallets : null;
    const rawInput = typeof rawText === 'string' ? rawText : typeof wallets === 'string' ? wallets : typeof text === 'string' ? text : '';

    // Parse array of strings or raw text
    if (addrList) {
      for (const a of addrList) {
        if (typeof a === 'string') {
          items.push({ address: a.trim() });
        } else if (a && typeof a === 'object' && a.address) {
          items.push({ address: a.address.trim(), label: a.label });
        }
      }
    } else if (rawInput) {
      const lines = rawInput.split('\n').map((l: string) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const tokens = line.split(/[,\s]+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i].trim();
          if (!t) continue;
          if (t.startsWith('0x') || t.length >= 30) {
            let label: string | undefined = undefined;
            const next = tokens[i + 1]?.trim();
            if (next && !next.startsWith('0x') && next.length < 25) {
              label = next;
              i++;
            }
            items.push({ address: t, label });
          } else {
            items.push({ address: t });
          }
        }
      }
    }

    if (items.length === 0) {
      return res.status(400).json({ error: 'No wallet addresses were found in the request' });
    }

    const result = bulkAddWalletsToGroup(effectiveGroupId, items);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all tracked wallets
apiRouter.post('/wallets/clear', (_req: Request, res: Response) => {
  try {
    const count = clearAllWallets();
    res.json({ success: true, removedCount: count, message: `Removed all ${count} tracked wallets` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Groups
apiRouter.get('/groups', (req: Request, res: Response) => {
  try {
    const groups = getAllGroups();
    res.json(groups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/groups', (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const group = createGroup(name.trim(), description || '');
    addLog('info', 'db', `Created group "${group.name}"`);
    res.json(group);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/groups/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const updated = renameGroup(id, name.trim());
    if (updated) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Group not found' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/groups/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = deleteGroup(id);
    if (deleted) {
      addLog('info', 'db', `Deleted group ${id}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Group not found' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Memberships
apiRouter.post('/memberships', (req: Request, res: Response) => {
  try {
    const { walletAddress, groupId } = req.body;
    if (!walletAddress || !groupId) {
      return res.status(400).json({ error: 'walletAddress and groupId required' });
    }
    const success = addWalletToGroup(walletAddress, groupId);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/memberships', (req: Request, res: Response) => {
  try {
    const { walletAddress, groupId } = req.body;
    if (!walletAddress || !groupId) {
      return res.status(400).json({ error: 'walletAddress and groupId required' });
    }
    const success = removeWalletFromGroup(walletAddress, groupId);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Alerts History
apiRouter.get('/alerts', (req: Request, res: Response) => {
  try {
    const type = req.query.type as 'mint' | 'buy' | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const alerts = getAlertHistory(type, limit);
    res.json(alerts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all alert history
apiRouter.post('/alerts/clear', (_req: Request, res: Response) => {
  try {
    clearAllAlerts();
    res.json({ success: true, message: 'Alert history, milestones, and processed events successfully cleared' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Simulate Alert (Mint or Buy) with milestone thresholds (3, 6, 10, 15)
apiRouter.post('/alerts/simulate', async (req: Request, res: Response) => {
  try {
    const {
      type = 'mint',
      collectionSlug = 'pudgypenguins',
      collectionName = 'Pudgy Penguins',
      chain = 'ethereum',
      walletAddresses = [],
      quantities = [],
      targetWalletsCount = 3,
    } = req.body;

    const wallets = getAllWallets();
    if (wallets.length === 0 && walletAddresses.length === 0) {
      return res.status(400).json({
        error: 'No tracked wallets exist in the database. Please add tracked wallets first using "+ Add Single Wallet" or "📋 Import Multiple Wallets".',
      });
    }

    const count = Math.max(1, parseInt(targetWalletsCount, 10) || 3);
    const selectedWallets = walletAddresses.length > 0
      ? walletAddresses
      : wallets.slice(0, count).map((w) => w.address);

    const events: NFTEvent[] = selectedWallets.map((addr: string, i: number) => {
      const q = quantities[i] || (i + 1) * 2;
      const evId = `sim_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const ev: NFTEvent = {
        event_id: evId,
        event_type: type as 'mint' | 'sale',
        chain,
        collection_slug: collectionSlug,
        collection_name: collectionName,
        wallet_address: addr,
        counterparty_address: type === 'mint' ? '0x0000000000000000000000000000000000000000' : '0xseller123',
        quantity: q,
        timestamp: Date.now(),
      };

      recordProcessedEvent({
        eventId: evId,
        eventType: type,
        chain,
        collectionSlug,
        walletAddress: addr,
        counterpartyAddress: ev.counterparty_address,
        quantity: q,
        timestamp: ev.timestamp,
      });

      return ev;
    });

    const meta = await openseaService.getCollectionMetadata(collectionSlug);
    // Allow simulation to test threshold suppression or milestones
    const isSingleSuppressed = selectedWallets.length < 3;
    const consolidated = alertConsolidator.consolidateEvents(
      events,
      { [collectionSlug]: meta },
      { bypassThreshold: false, isSimulation: true }
    );

    if (consolidated.length > 0) {
      for (const alert of consolidated) {
        saveAlertHistory(alert);
        const botInstance = (req.app as any).get('telegramBot');
        await broadcastTelegramAlert(botInstance, alert.formattedMessage);
      }
      res.json({
        success: true,
        alerts: consolidated,
        milestone: consolidated[0]?.milestone,
        message: `🚨 Milestone ${consolidated[0]?.milestone} Alert Triggered (${selectedWallets.length} unique wallets)!`,
      });
    } else {
      res.json({
        success: false,
        suppressed: true,
        message: isSingleSuppressed
          ? `🔕 Alert Suppressed: Only ${selectedWallets.length} wallet(s) active. Rules require at least 3 unique wallets before sending an alert.`
          : `ℹ️ No new alert: Milestone for ${selectedWallets.length} wallets was already alerted. Next alert triggers at milestone 6, 10, or 15.`,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Supported Chains
apiRouter.get('/chains', async (req: Request, res: Response) => {
  try {
    const chains = await openseaService.getSupportedChains();
    res.json(chains);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// System Logs
apiRouter.get('/logs', (req: Request, res: Response) => {
  try {
    const logs = getRecentLogs(50);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Polling Interval dynamically
apiRouter.post('/settings/interval', (req: Request, res: Response) => {
  try {
    const { intervalSeconds } = req.body;
    const sec = parseInt(intervalSeconds, 10);
    if (isNaN(sec) || sec < 5) {
      return res.status(400).json({ error: 'Interval must be a number of at least 5 seconds' });
    }
    const updated = monitorService.setIntervalSeconds(sec);
    res.json({ success: true, pollIntervalSeconds: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Interactive Telegram Bot Simulator
apiRouter.post('/telegram/simulate', (req: Request, res: Response) => {
  try {
    const adminIds = getAdminIds();
    const defaultUserId = adminIds.length > 0 ? adminIds[0] : 123456789;
    const { userId = defaultUserId, command = req.body.text || '/start' } = req.body;
    const response = simulateTelegramMessage(userId, command);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Automated Tests Runner
apiRouter.post('/tests/run', async (req: Request, res: Response) => {
  try {
    const testResults = await runAllTests();
    res.json(testResults);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Project ZIP Download
apiRouter.get('/download-zip', async (req: Request, res: Response) => {
  try {
    const zipPath = path.resolve('./telegram-nft-smart-money-bot.zip');
    await generateProjectZip(zipPath);

    if (fs.existsSync(zipPath)) {
      res.download(zipPath, 'telegram-nft-smart-money-bot.zip');
    } else {
      res.status(500).json({ error: 'Archive could not be generated' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
