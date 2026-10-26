export interface WalletGroup {
  id: string;
  name: string;
  description: string;
  created_at: number;
  is_enabled: number;
  wallet_count?: number;
}

export interface TrackedWallet {
  address: string;
  label: string;
  chain_type: 'evm' | 'solana' | 'flow' | 'other';
  created_at: number;
  is_active: number;
  groups?: string[]; // group IDs
  group_names?: string[]; // group names
}

export interface WalletGroupMember {
  wallet_address: string;
  group_id: string;
  added_at: number;
}

export interface OpenSeaChain {
  name: string;
  chain: string;
  identifier: string;
  is_monitored: boolean;
  status: 'active' | 'supported' | 'unsupported';
  network_type: 'evm' | 'solana' | 'other';
  notes?: string;
}

export interface CollectionMetadata {
  slug: string;
  name: string;
  chain: string;
  opensea_url: string;
  twitter_url?: string;
  discord_url?: string;
  website_url?: string;
  telegram_url?: string;
  image_url?: string;
  updated_at: number;
}

export interface NFTEvent {
  event_id: string;
  event_type: 'mint' | 'sale' | 'transfer' | 'listing' | 'offer' | 'cancel';
  chain: string;
  collection_slug: string;
  collection_name?: string;
  wallet_address: string;
  counterparty_address?: string; // from or seller
  tx_hash?: string;
  quantity: number;
  price_symbol?: string;
  price_amount?: string;
  nft_id?: string;
  nft_name?: string;
  timestamp: number;
  raw_data?: any;
}

export interface ConsolidatedGroupSummary {
  groupId: string;
  groupName: string;
  uniqueCount: number; // unique minters or buyers
  nftsCount: number; // total NFTs minted or bought by this group
}

export interface ConsolidatedAlert {
  id: string;
  alertType: 'mint' | 'buy';
  chain: string;
  collectionSlug: string;
  collectionName: string;
  groups: ConsolidatedGroupSummary[];
  totalUniqueWallets: number;
  totalNFTs: number;
  openseaUrl: string;
  socials: {
    twitter?: string;
    discord?: string;
    website?: string;
    telegram?: string;
  };
  formattedMessage: string;
  timestamp: number;
  eventsCount: number;
}

export interface SystemLog {
  id?: number;
  level: 'info' | 'warn' | 'error';
  category: 'opensea' | 'telegram' | 'db' | 'monitor';
  message: string;
  details?: string;
  created_at: number;
}

export interface DashboardStats {
  trackedWalletsCount: number;
  activeWalletsCount: number;
  groupsCount: number;
  supportedChainsCount: number;
  monitoredChainsCount: number;
  recentMintsCount: number;
  recentPurchasesCount: number;
  uniqueMintersCount: number;
  nftsMintedCount: number;
  uniqueBuyersCount: number;
  nftsPurchasedCount: number;
  isMonitoring: boolean;
  pollIntervalSeconds: number;
  recentErrors: SystemLog[];
  botStatus: {
    tokenConfigured: boolean;
    isAdminConfigured: boolean;
    isRunning: boolean;
    mode: 'live' | 'simulator';
  };
}
