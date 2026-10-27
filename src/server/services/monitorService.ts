import { Telegraf } from 'telegraf';
import {
  getAllWallets,
  recordProcessedEvent,
  saveAlertHistory,
  addLog,
} from '../database/db.ts';
import { openseaService } from './openseaService.ts';
import { alertConsolidator } from './alertConsolidator.ts';
import { broadcastTelegramAlert } from '../telegram/bot.ts';
import { CollectionMetadata, NFTEvent } from '../../types.ts';

export function getPollIntervalSeconds(): number {
  const envVal = process.env.POLL_INTERVAL_SECONDS;
  if (!envVal) return 10;
  let num = parseInt(envVal, 10);
  if (isNaN(num) || num <= 0) return 10;
  if (num >= 1000) {
    num = Math.round(num / 1000);
  }
  return num;
}

export class MonitorService {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private bot: Telegraf | null = null;
  private pollIntervalMs: number = 10000;
  private lastPollTimestamp: number = Date.now() - 60000;

  constructor() {
    const sec = getPollIntervalSeconds();
    this.pollIntervalMs = Math.max(5000, sec * 1000);
  }

  public setIntervalSeconds(seconds: number): number {
    const safeSec = Math.max(5, seconds);
    this.pollIntervalMs = safeSec * 1000;
    process.env.POLL_INTERVAL_SECONDS = String(safeSec);
    if (this.isRunning && this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.runPollCycle();
      }, this.pollIntervalMs);
    }
    addLog('info', 'monitor', `Poll interval updated to ${safeSec}s`);
    return safeSec;
  }

  public setBot(bot: Telegraf | null) {
    this.bot = bot;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    addLog('info', 'monitor', `Monitoring started with interval ${this.pollIntervalMs / 1000}s`);

    // Run first cycle shortly after start
    setTimeout(() => this.runPollCycle(), 2000);

    this.timer = setInterval(() => {
      this.runPollCycle();
    }, this.pollIntervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    addLog('info', 'monitor', 'Monitoring stopped');
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      pollIntervalMs: this.pollIntervalMs,
      lastPollTimestamp: this.lastPollTimestamp,
    };
  }

  /**
   * Single polling execution cycle
   */
  public async runPollCycle(): Promise<{ eventsProcessed: number; alertsGenerated: number }> {
    const activeWallets = getAllWallets().filter((w) => w.is_active === 1);
    if (activeWallets.length === 0) {
      return { eventsProcessed: 0, alertsGenerated: 0 };
    }

    const currentPollTime = Date.now();
    const qualifyingEvents: NFTEvent[] = [];
    const collectionMetadataMap: Record<string, CollectionMetadata> = {};

    for (const wallet of activeWallets) {
      try {
        // Fetch recent account events from OpenSea
        const { events } = await openseaService.getAccountEvents(wallet.address, {
          afterTimestamp: this.lastPollTimestamp,
          limit: 25,
        });

        for (const raw of events) {
          const classified = openseaService.classifyEvent(raw, wallet.address);
          if (classified) {
            qualifyingEvents.push(classified);

            // Fetch collection metadata if not yet cached in this cycle
            if (!collectionMetadataMap[classified.collection_slug]) {
              const meta = await openseaService.getCollectionMetadata(classified.collection_slug);
              collectionMetadataMap[classified.collection_slug] = meta;
            }

            // Immediately mark event as processed to prevent duplicates across cycles
            recordProcessedEvent({
              eventId: classified.event_id,
              eventType: classified.event_type,
              chain: classified.chain,
              collectionSlug: classified.collection_slug,
              walletAddress: classified.wallet_address,
              counterpartyAddress: classified.counterparty_address,
              txHash: classified.tx_hash,
              quantity: classified.quantity,
              timestamp: classified.timestamp,
            });
          }
        }
      } catch (err: any) {
        addLog('error', 'monitor', `Error polling events for wallet ${wallet.address}`, err.message);
      }
    }

    this.lastPollTimestamp = currentPollTime;

    // If any genuine mints or buys were detected, consolidate into multi-group alerts
    let alertsGenerated = 0;
    if (qualifyingEvents.length > 0) {
      const consolidatedAlerts = alertConsolidator.consolidateEvents(qualifyingEvents, collectionMetadataMap);

      for (const alert of consolidatedAlerts) {
        saveAlertHistory(alert);
        alertsGenerated++;

        // Broadcast to Telegram
        await broadcastTelegramAlert(this.bot, alert.formattedMessage);
        addLog('info', 'monitor', `Generated ${alert.alertType.toUpperCase()} alert for "${alert.collectionName}" (${alert.totalNFTs} NFTs)`);
      }
    }

    return {
      eventsProcessed: qualifyingEvents.length,
      alertsGenerated,
    };
  }
}

export const monitorService = new MonitorService();
