import {
  NFTEvent,
  ConsolidatedAlert,
  ConsolidatedGroupSummary,
  CollectionMetadata,
} from '../../types.ts';
import {
  getAllGroups,
  getAllWallets,
  initDatabase,
  getAchievedMilestones,
  recordMilestoneAlerted,
} from '../database/db.ts';

export class AlertConsolidator {
  /**
   * Consolidates qualifying events by (activity_type, chain, collection_slug)
   * into clean, deduplicated alert payloads with milestone threshold enforcement:
   * Only alerts at 3, 6, 10, 15 unique wallets.
   */
  public consolidateEvents(
    events: NFTEvent[],
    collectionMetadataMap: Record<string, CollectionMetadata> = {},
    optionsOrDb: any = {}
  ): ConsolidatedAlert[] {
    if (!events || events.length === 0) return [];

    const isDb = Boolean(optionsOrDb && typeof optionsOrDb.prepare === 'function');
    const options = isDb ? { db: optionsOrDb } : optionsOrDb;
    const db = options.db || initDatabase();
    const bypassThreshold = Boolean(options.bypassThreshold);
    const isSimulation = Boolean(options.isSimulation);

    const allGroups = getAllGroups(db);
    const allWallets = getAllWallets(db);

    // Map wallet address -> list of group IDs it belongs to
    const walletToGroupMap: Record<string, { id: string; name: string }[]> = {};
    for (const w of allWallets) {
      const lower = w.address.toLowerCase();
      const groupsForWallet = allGroups.filter((g) => w.groups?.includes(g.id));
      walletToGroupMap[lower] = groupsForWallet.map((g) => ({ id: g.id, name: g.name }));
    }

    // Group events by key: `${eventType}:${chain}:${collection_slug}`
    const clusters: Record<string, NFTEvent[]> = {};
    for (const ev of events) {
      const key = `${ev.event_type}:${ev.chain.toLowerCase()}:${ev.collection_slug.toLowerCase()}`;
      if (!clusters[key]) {
        clusters[key] = [];
      }
      clusters[key].push(ev);
    }

    const consolidatedAlerts: ConsolidatedAlert[] = [];

    for (const [key, clusterEvents] of Object.entries(clusters)) {
      const firstEvent = clusterEvents[0];
      const alertType: 'mint' | 'buy' = firstEvent.event_type === 'mint' ? 'mint' : 'buy';
      const chain = firstEvent.chain;
      const collectionSlug = firstEvent.collection_slug;

      const meta = collectionMetadataMap[collectionSlug] || {
        slug: collectionSlug,
        name: firstEvent.collection_name || collectionSlug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        chain,
        opensea_url: `https://opensea.io/collection/${collectionSlug}`,
        updated_at: Date.now(),
      };

      // 1. Group-level calculation:
      const groupParticipation: Record<
        string,
        {
          name: string;
          uniqueWallets: Set<string>;
          nftsCount: number;
        }
      > = {};

      for (const ev of clusterEvents) {
        const walletLower = ev.wallet_address.toLowerCase();
        const memberGroups = walletToGroupMap[walletLower] || [];

        for (const grp of memberGroups) {
          if (!groupParticipation[grp.id]) {
            groupParticipation[grp.id] = {
              name: grp.name,
              uniqueWallets: new Set(),
              nftsCount: 0,
            };
          }
          groupParticipation[grp.id].uniqueWallets.add(walletLower);
          groupParticipation[grp.id].nftsCount += ev.quantity;
        }
      }

      // Convert to summary array
      const groupSummaries: ConsolidatedGroupSummary[] = Object.entries(groupParticipation)
        .map(([gId, p]) => ({
          groupId: gId,
          groupName: p.name,
          uniqueCount: p.uniqueWallets.size,
          nftsCount: p.nftsCount,
        }))
        .filter((g) => g.uniqueCount > 0);

      // If no tracked group members participated, skip alert
      if (groupSummaries.length === 0) {
        continue;
      }

      // 2. Accurate Overall Deduplication:
      const allDistinctWallets = new Set<string>();
      for (const p of Object.values(groupParticipation)) {
        for (const w of p.uniqueWallets) {
          allDistinctWallets.add(w);
        }
      }
      const totalUniqueWallets = allDistinctWallets.size;

      // Threshold Enforcement:
      // "don’t give alert when one wallet buy or mint only send alert when 3 unique wallet mint or buy the nft,
      // another alert when total of 6 unique minters from any of the group minted or bought.
      // another alert when total of 10 unique minters from any of the group minted or bought, 15"
      let currentMilestone: number | undefined = undefined;
      let nextMilestone: number | null = null;

      if (!bypassThreshold) {
        if (totalUniqueWallets < 3) {
          // Suppress alert: does not meet minimum 3 unique wallets threshold
          continue;
        }

        const achieved = getAchievedMilestones(collectionSlug, chain, alertType, totalUniqueWallets, db);
        if (achieved.eligibleMilestones.length === 0) {
          // Already notified for current milestone, waiting for next threshold
          continue;
        }

        currentMilestone = Math.max(...achieved.eligibleMilestones);
        nextMilestone = achieved.nextMilestone;
        recordMilestoneAlerted(collectionSlug, chain, alertType, currentMilestone, db);
      } else {
        const achieved = getAchievedMilestones(collectionSlug, chain, alertType, totalUniqueWallets, db);
        currentMilestone = totalUniqueWallets >= 3 ? Math.max(...(achieved.eligibleMilestones.length > 0 ? achieved.eligibleMilestones : [3])) : undefined;
        nextMilestone = achieved.nextMilestone;
      }

      const qualifyingEventIds = new Set<string>();
      let totalNFTs = 0;
      for (const ev of clusterEvents) {
        if (allDistinctWallets.has(ev.wallet_address.toLowerCase())) {
          if (!qualifyingEventIds.has(ev.event_id)) {
            qualifyingEventIds.add(ev.event_id);
            totalNFTs += ev.quantity;
          }
        }
      }

      // Format Telegram message
      const formattedMessage = this.formatTelegramMessage({
        alertType,
        collectionName: meta.name,
        chain,
        groupSummaries,
        totalUniqueWallets,
        totalNFTs,
        openseaUrl: meta.opensea_url,
        socials: {
          twitter: meta.twitter_url,
          discord: meta.discord_url,
          website: meta.website_url,
          telegram: meta.telegram_url,
        },
        milestone: currentMilestone,
        nextMilestone,
        isSimulation,
      });

      const alertId = `alert_${alertType}_${chain}_${collectionSlug}_${Date.now()}`;

      consolidatedAlerts.push({
        id: alertId,
        alertType,
        chain,
        collectionSlug,
        collectionName: meta.name,
        groups: groupSummaries,
        totalUniqueWallets,
        totalNFTs,
        openseaUrl: meta.opensea_url,
        socials: {
          twitter: meta.twitter_url,
          discord: meta.discord_url,
          website: meta.website_url,
          telegram: meta.telegram_url,
        },
        formattedMessage,
        timestamp: Date.now(),
        eventsCount: qualifyingEventIds.size,
        milestone: currentMilestone,
        nextMilestone,
      });
    }

    return consolidatedAlerts;
  }

  /**
   * Formats the consolidated alert with milestone notifications
   */
  public formatTelegramMessage(params: {
    alertType: 'mint' | 'buy';
    collectionName: string;
    chain: string;
    groupSummaries: ConsolidatedGroupSummary[];
    totalUniqueWallets: number;
    totalNFTs: number;
    openseaUrl: string;
    socials: {
      twitter?: string;
      discord?: string;
      website?: string;
      telegram?: string;
    };
    milestone?: number;
    nextMilestone?: number | null;
    isSimulation?: boolean;
  }): string {
    const isMint = params.alertType === 'mint';
    const activityName = isMint ? 'NFT Mint' : 'NFT Purchase';
    const nounPlural = isMint ? 'Minters' : 'Buyers';
    const verbAction = isMint ? 'Minted' : 'Bought';

    // Milestone Badge
    let milestoneBadge = '';
    if (params.milestone === 3) {
      milestoneBadge = `🚨 *THRESHOLD REACHED: 3 UNIQUE WALLETS!* [Milestone 1/4]\n`;
    } else if (params.milestone === 6) {
      milestoneBadge = `🚨 *SURGE ALERT: 6 UNIQUE WALLETS!* [Milestone 2/4]\n`;
    } else if (params.milestone === 10) {
      milestoneBadge = `🚨 *MEGA SURGE: 10 UNIQUE WALLETS!* [Milestone 3/4]\n`;
    } else if (params.milestone === 15) {
      milestoneBadge = `🚨 *WHALE FRENZY: 15 UNIQUE WALLETS!* [Milestone 4/4]\n`;
    }

    const headerTitle = isMint ? '🔥 SMART MONEY MINT' : '🔥 SMART MONEY BUY';
    const formattedChain = params.chain.charAt(0).toUpperCase() + params.chain.slice(1).toLowerCase();

    const groupRows = params.groupSummaries
      .map((g) => `📁 ${g.groupName} — ${g.uniqueCount} ${nounPlural} | ${g.nftsCount} NFTs`)
      .join('\n');

    const socialLinks: string[] = [];
    if (params.socials.twitter) socialLinks.push(`[X/Twitter](${params.socials.twitter})`);
    if (params.socials.discord) socialLinks.push(`[Discord](${params.socials.discord})`);
    if (params.socials.website) socialLinks.push(`[Website](${params.socials.website})`);
    if (params.socials.telegram) socialLinks.push(`[Telegram](${params.socials.telegram})`);

    const socialsLine = socialLinks.length > 0 ? socialLinks.join(' • ') : 'None listed';

    const nextText = params.nextMilestone ? ` (Next alert at ${params.nextMilestone} wallets)` : ` (Max milestone reached)`;
    const milestoneSummary = params.milestone
      ? `🎯 Milestone: *${params.milestone} Unique Wallets*${nextText}\n`
      : '';

    const simNotice = params.isSimulation ? `🧪 *SIMULATED TEST ALERT*\n\n` : '';

    return `${simNotice}${milestoneBadge}${headerTitle}

📦 Collection: ${params.collectionName}
⛓️ Chain: ${formattedChain}

📊 Group Activity
${groupRows}

🔢 Total: ${params.totalUniqueWallets} Unique Wallets | ${params.totalNFTs} NFTs ${verbAction}
${milestoneSummary}⚡ Activity: ${activityName}
🔗 OpenSea: ${params.openseaUrl}
🌐 Socials: ${socialsLine}`;
  }
}

export const alertConsolidator = new AlertConsolidator();
