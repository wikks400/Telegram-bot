import {
  OpenSeaChain,
  CollectionMetadata,
  NFTEvent,
} from '../../types.ts';
import {
  getCollectionCache,
  saveCollectionCache,
  addLog,
  isEventProcessed,
} from '../database/db.ts';

const OPENSEA_API_BASE = 'https://api.opensea.io/api/v2';

// Known verified chains supported on OpenSea API v2
const FALLBACK_CHAINS: OpenSeaChain[] = [
  { name: 'Ethereum', chain: 'ethereum', identifier: 'ethereum', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Base', chain: 'base', identifier: 'base', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Polygon', chain: 'polygon', identifier: 'matic', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Arbitrum', chain: 'arbitrum', identifier: 'arbitrum', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Optimism', chain: 'optimism', identifier: 'optimism', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Blast', chain: 'blast', identifier: 'blast', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Zora', chain: 'zora', identifier: 'zora', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Avalanche', chain: 'avalanche', identifier: 'avalanche', is_monitored: true, status: 'active', network_type: 'evm' },
  { name: 'Sei', chain: 'sei', identifier: 'sei', is_monitored: false, status: 'supported', network_type: 'evm' },
  { name: 'Ronin', chain: 'ronin', identifier: 'ronin', is_monitored: false, status: 'supported', network_type: 'evm' },
  { name: 'Solana', chain: 'solana', identifier: 'solana', is_monitored: false, status: 'supported', network_type: 'solana', notes: 'Limited v2 activity support via accounts endpoint' },
  { name: 'ApeChain', chain: 'ape_chain', identifier: 'apechain', is_monitored: false, status: 'supported', network_type: 'evm' },
  { name: 'Flow', chain: 'flow', identifier: 'flow', is_monitored: false, status: 'supported', network_type: 'other', notes: 'Cadence / Flow EVM support' },
  { name: 'Abstract', chain: 'abstract', identifier: 'abstract', is_monitored: false, status: 'supported', network_type: 'evm' },
];

let cachedChains: OpenSeaChain[] = FALLBACK_CHAINS;
let lastChainFetchTime = 0;

export class OpenSeaService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENSEA_API_KEY || '';
  }

  public setApiKey(key: string) {
    this.apiKey = key;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'SmartMoneyBot/1.0',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Discovers supported chains dynamically from the official OpenSea API v2
   */
  public async getSupportedChains(): Promise<OpenSeaChain[]> {
    const now = Date.now();
    // Cache chain list for 1 hour
    if (cachedChains.length > 0 && now - lastChainFetchTime < 3600000) {
      return cachedChains;
    }

    try {
      const response = await this.fetchWithRetry(`${OPENSEA_API_BASE}/chains`);
      if (response && Array.isArray(response.chains)) {
        const chainsList: OpenSeaChain[] = response.chains.map((c: any) => {
          const chainKey = (c.chain || c.name || '').toLowerCase();
          const isEvm = !chainKey.includes('solana') && !chainKey.includes('flow');
          return {
            name: c.label || c.name || chainKey,
            chain: chainKey,
            identifier: c.identifier || chainKey,
            is_monitored: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'blast', 'zora'].includes(chainKey),
            status: 'active',
            network_type: isEvm ? 'evm' : (chainKey.includes('solana') ? 'solana' : 'other'),
            notes: c.notes || undefined,
          };
        });
        cachedChains = chainsList;
        lastChainFetchTime = now;
        addLog('info', 'opensea', `Discovered ${chainsList.length} supported chains from OpenSea API v2`);
        return cachedChains;
      }
    } catch (err: any) {
      addLog('warn', 'opensea', 'Failed to fetch live chains from OpenSea API, using verified fallback list', err.message);
    }

    return cachedChains;
  }

  /**
   * Fetch account activity events from OpenSea API v2 with rate limit backoff
   */
  public async getAccountEvents(
    address: string,
    options: {
      eventType?: 'sale' | 'transfer' | 'mint';
      afterTimestamp?: number;
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<{ events: any[]; nextCursor?: string }> {
    const params = new URLSearchParams();
    if (options.eventType) params.append('event_type', options.eventType);
    if (options.afterTimestamp) params.append('after', Math.floor(options.afterTimestamp / 1000).toString());
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.cursor) params.append('next', options.cursor);

    const url = `${OPENSEA_API_BASE}/events/accounts/${address}?${params.toString()}`;

    try {
      const data = await this.fetchWithRetry(url);
      const events = data?.asset_events || data?.events || [];
      return {
        events,
        nextCursor: data?.next || undefined,
      };
    } catch (err: any) {
      addLog('error', 'opensea', `Failed fetching events for address ${address}`, err.message);
      return { events: [] };
    }
  }

  /**
   * Retrieves collection metadata and social links, using cached data if available
   */
  public async getCollectionMetadata(slug: string): Promise<CollectionMetadata> {
    if (!slug) {
      return {
        slug: 'unknown',
        name: 'Unknown Collection',
        chain: 'ethereum',
        opensea_url: 'https://opensea.io',
        updated_at: Date.now(),
      };
    }

    const cached = getCollectionCache(slug);
    // Cache valid for 24 hours
    if (cached && Date.now() - cached.updated_at < 86400000) {
      return cached;
    }

    const defaultMeta: CollectionMetadata = {
      slug,
      name: slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      chain: 'ethereum',
      opensea_url: `https://opensea.io/collection/${slug}`,
      updated_at: Date.now(),
    };

    try {
      const data = await this.fetchWithRetry(`${OPENSEA_API_BASE}/collections/${slug}`);
      if (data) {
        const twitterUser = data.twitter_username || (data.social_media_accounts?.twitter);
        const twitterUrl = twitterUser ? (twitterUser.startsWith('http') ? twitterUser : `https://x.com/${twitterUser}`) : undefined;

        const meta: CollectionMetadata = {
          slug,
          name: data.name || defaultMeta.name,
          chain: data.chain || 'ethereum',
          opensea_url: data.opensea_url || `https://opensea.io/collection/${slug}`,
          twitter_url: twitterUrl,
          discord_url: data.discord_url || (data.social_media_accounts?.discord) || undefined,
          website_url: data.project_url || data.external_url || undefined,
          telegram_url: data.telegram_url || (data.social_media_accounts?.telegram) || undefined,
          image_url: data.image_url || undefined,
          updated_at: Date.now(),
        };

        saveCollectionCache(meta);
        return meta;
      }
    } catch (err: any) {
      // Don't fail if OpenSea collection endpoint fails or rate limits; return fallback
      addLog('warn', 'opensea', `Could not fetch collection details for "${slug}", using derived slug`, err.message);
    }

    // Save fallback to cache
    saveCollectionCache(defaultMeta);
    return defaultMeta;
  }

  /**
   * Process raw event and determine if it qualifies as a genuine Mint or Purchase
   */
  public classifyEvent(rawEvent: any, trackedWallet: string): NFTEvent | null {
    const walletLower = trackedWallet.toLowerCase();
    const eventType = rawEvent.event_type?.toLowerCase() || '';

    // Extract event details
    const chain = (rawEvent.chain || rawEvent.nft?.chain || 'ethereum').toLowerCase();
    const collectionSlug = rawEvent.nft?.collection || rawEvent.collection || 'unknown-collection';
    const txHash = rawEvent.transaction || rawEvent.tx_hash || rawEvent.order_hash || '';
    const quantity = Number(rawEvent.quantity || 1);
    const timestamp = rawEvent.event_timestamp
      ? (typeof rawEvent.event_timestamp === 'number' && rawEvent.event_timestamp < 10000000000 ? rawEvent.event_timestamp * 1000 : Number(rawEvent.event_timestamp))
      : Date.now();

    const eventId = rawEvent.event_id || rawEvent.id || `${txHash}_${rawEvent.nft?.identifier || 'token'}_${timestamp}`;

    // Skip if already processed in database
    if (isEventProcessed(eventId)) {
      return null;
    }

    const fromAddress = (rawEvent.from_address || rawEvent.seller || '').toLowerCase();
    const toAddress = (rawEvent.to_address || rawEvent.buyer || '').toLowerCase();
    const buyerAddress = (rawEvent.buyer || rawEvent.winner_account?.address || '').toLowerCase();

    const isZeroAddress = (addr: string) =>
      !addr ||
      addr === '0x0000000000000000000000000000000000000000' ||
      addr === '0x0' ||
      addr === '11111111111111111111111111111111';

    // 1. GENUINE MINT DETECTION
    // Conditions:
    // - event_type is explicitly 'mint'
    // - OR event_type is 'transfer' where from_address is the zero address (minting contract creates token)
    // - AND recipient (to_address) is our tracked wallet
    const isMintType = eventType === 'mint' || (eventType === 'transfer' && isZeroAddress(fromAddress));
    const isMinter = toAddress === walletLower;

    if (isMintType && isMinter) {
      return {
        event_id: eventId,
        event_type: 'mint',
        chain,
        collection_slug: collectionSlug,
        collection_name: rawEvent.nft?.collection_name || collectionSlug,
        wallet_address: walletLower,
        counterparty_address: fromAddress || '0x0000000000000000000000000000000000000000',
        tx_hash: txHash,
        quantity: Math.max(1, quantity),
        timestamp,
        raw_data: { tokenId: rawEvent.nft?.identifier || rawEvent.token_id },
      };
    }

    // 2. GENUINE PURCHASE DETECTION
    // Conditions:
    // - event_type is 'sale'
    // - tracked wallet is the BUYER (not seller!)
    // - Not a listing, offer, bid, cancellation, or transfer
    if (eventType === 'sale') {
      const isActualBuyer = (buyerAddress && buyerAddress === walletLower) || (toAddress === walletLower && fromAddress !== walletLower);

      if (isActualBuyer) {
        return {
          event_id: eventId,
          event_type: 'sale',
          chain,
          collection_slug: collectionSlug,
          collection_name: rawEvent.nft?.collection_name || collectionSlug,
          wallet_address: walletLower,
          counterparty_address: fromAddress,
          tx_hash: txHash,
          quantity: Math.max(1, quantity),
          price_amount: rawEvent.payment?.quantity,
          price_symbol: rawEvent.payment?.symbol,
          timestamp,
          raw_data: { tokenId: rawEvent.nft?.identifier || rawEvent.token_id },
        };
      }
    }

    // Transfers between normal non-zero wallets, sales where tracked wallet is seller,
    // listings, offers, cancellations are NOT mints or purchases.
    return null;
  }

  /**
   * Resilient HTTP fetcher with exponential backoff, rate limit handling, and timeout
   */
  private async fetchWithRetry(url: string, retries: number = 3, delayMs: number = 1000): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(8000), // 8-second bounded timeout prevents leaking hung sockets
        });

        // Handle Rate Limits (HTTP 429)
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          const waitTime = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : delayMs * Math.pow(2, attempt);
          addLog('warn', 'opensea', `Rate limited by OpenSea (429). Retrying after ${waitTime}ms`, url);
          if (attempt === retries) throw new Error(`OpenSea API rate limit exceeded (429)`);
          await new Promise((r) => setTimeout(r, waitTime));
          continue;
        }

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          if (attempt === retries) {
            throw new Error(`OpenSea HTTP ${response.status}: ${errText.slice(0, 200)}`);
          }
          await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
          continue;
        }

        return await response.json();
      } catch (err: any) {
        if (attempt === retries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
      }
    }
    return null;
  }
}

export const openseaService = new OpenSeaService();
