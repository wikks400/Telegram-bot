import { Telegraf, Markup } from 'telegraf';
import {
  getAllGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  resolveGroupId,
  getOrCreateGroup,
  getAllWallets,
  addWallet,
  removeWallet,
  clearAllWallets,
  bulkAddWalletsToGroup,
  getWalletGroups,
  addWalletToGroup,
  removeWalletFromGroup,
  getDashboardStats,
  getAlertHistory,
  addLog,
} from '../database/db.ts';
import { validateWalletAddress } from '../services/walletValidation.ts';

// Get admin IDs from env
export function getAdminIds(): number[] {
  const envVal = process.env.TELEGRAM_ADMIN_IDS || '';
  return envVal
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

export function isUserAdmin(userId?: number): boolean {
  if (!userId) return false;
  const adminIds = getAdminIds();
  // If no admin IDs are configured in environment, allow interaction but flag in dashboard
  if (adminIds.length === 0) return true;
  return adminIds.includes(userId);
}

// Global active chats to broadcast alerts to
const subscribedChatIds = new Set<number>();

// Main Menu Keyboard
export function getMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Dashboard', 'menu_dashboard'),
      Markup.button.callback('👛 Manage Wallets', 'menu_wallets'),
    ],
    [
      Markup.button.callback('📁 Wallet Groups', 'menu_groups'),
      Markup.button.callback('⚙️ Settings', 'menu_settings'),
    ],
    [
      Markup.button.callback('🔥 Recent Mint Alerts', 'menu_recent_mints'),
      Markup.button.callback('🛒 Recent Purchase Alerts', 'menu_recent_buys'),
    ],
    [
      Markup.button.callback('❓ Help', 'menu_help'),
      Markup.button.callback('🧪 Test Alert', 'menu_test_alert'),
    ],
  ]);
}

export function buildDashboardMessage(): string {
  const stats = getDashboardStats();
  const botMode = stats.botStatus.mode === 'live' ? '🟢 Live Telegram' : '🟡 Simulator / Standby';

  return `📊 *NFT SMART MONEY BOT — DASHBOARD*

💼 *Tracked Wallets:* ${stats.trackedWalletsCount} (${stats.activeWalletsCount} active)
📁 *Groups:* ${stats.groupsCount}
⛓️ *Chains Supported:* ${stats.supportedChainsCount} (${stats.monitoredChainsCount} actively monitored)
🔄 *Poll Interval:* ${stats.pollIntervalSeconds}s
🤖 *Bot Mode:* ${botMode}

🔥 *Mint Activity (Total):*
• Unique Minters: ${stats.uniqueMintersCount}
• NFTs Minted: ${stats.nftsMintedCount}
• Total Mint Events: ${stats.recentMintsCount}

🛒 *Purchase Activity (Total):*
• Unique Buyers: ${stats.uniqueBuyersCount}
• NFTs Bought: ${stats.nftsPurchasedCount}
• Total Purchase Events: ${stats.recentPurchasesCount}

${stats.recentErrors.length > 0 ? `⚠️ *Recent Errors:* ${stats.recentErrors.length} logged` : '✅ *Health:* All systems normal'}`;
}

export function buildWalletsListMessage(page: number = 0, limit: number = 5): { text: string; keyboard: any } {
  const wallets = getAllWallets();
  if (wallets.length === 0) {
    return {
      text: `👛 *Tracked Wallets (0)*\n\nNo wallets are currently tracked.\n\nUse \`/addwallet <address> <label> [group1,group2]\` to add a wallet.`,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    };
  }

  const totalPages = Math.ceil(wallets.length / limit);
  const curPage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = wallets.slice(curPage * limit, (curPage + 1) * limit);

  let text = `👛 *Tracked Wallets (${wallets.length})* — Page ${curPage + 1}/${totalPages}\n\n`;

  slice.forEach((w, idx) => {
    const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
    const groupNames = w.group_names && w.group_names.length > 0 ? w.group_names.join(', ') : 'None';
    text += `${curPage * limit + idx + 1}. *${w.label || 'Unnamed'}* (${w.chain_type.toUpperCase()})\n`;
    text += `   \`${w.address}\`\n`;
    text += `   📁 Groups: _${groupNames}_\n\n`;
  });

  text += `💡 *Commands:*\n• \`/addwallet <addr> <label> [groups]\`\n• \`/delwallet <addr>\`\n• \`/walletinfo <addr>\``;

  const buttons: any[] = [];
  const navRow: any[] = [];
  if (curPage > 0) {
    navRow.push(Markup.button.callback('⬅️ Prev', `wallets_page_${curPage - 1}`));
  }
  if (curPage < totalPages - 1) {
    navRow.push(Markup.button.callback('Next ➡️', `wallets_page_${curPage + 1}`));
  }
  if (navRow.length > 0) buttons.push(navRow);
  buttons.push([Markup.button.callback('« Back to Menu', 'menu_main')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

export function buildGroupsListMessage(): { text: string; keyboard: any } {
  const groups = getAllGroups();
  let text = `📁 *Wallet Groups (${groups.length})*\n\n`;

  if (groups.length === 0) {
    text += 'No groups found. Use `/creategroup <name> [description]` to create one.';
  } else {
    groups.forEach((g, idx) => {
      text += `${idx + 1}. *${g.name}* (ID: \`${g.id}\`)\n`;
      text += `   👛 Wallets: ${g.wallet_count || 0}\n`;
      if (g.description) text += `   📝 _${g.description}_\n`;
      text += '\n';
    });
  }

  text += `💡 *Commands:*\n• \`/creategroup <name> [desc]\`\n• \`/renamegroup <id> <newName>\`\n• \`/delgroup <id>\`\n• \`/groupwallets <groupId>\``;

  return {
    text,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('« Back to Menu', 'menu_main')],
    ]),
  };
}

export function buildRecentAlertsMessage(type: 'mint' | 'buy'): string {
  const alerts = getAlertHistory(type, 3);
  if (alerts.length === 0) {
    return `ℹ️ *No recent ${type === 'mint' ? 'Mint' : 'Purchase'} alerts recorded yet.*\n\nAlerts will appear here automatically when tracked smart money wallets mint or buy NFTs.`;
  }

  let text = `🔔 *Recent ${type === 'mint' ? 'Mint' : 'Purchase'} Alerts (Latest ${alerts.length})*\n\n`;
  alerts.forEach((a, i) => {
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += a.formattedMessage + `\n\n`;
  });
  return text;
}

export function buildSettingsMessage(): string {
  const adminIds = getAdminIds();
  const pollInterval = process.env.POLL_INTERVAL_SECONDS ? (Number(process.env.POLL_INTERVAL_SECONDS) >= 1000 ? Math.round(Number(process.env.POLL_INTERVAL_SECONDS) / 1000) : process.env.POLL_INTERVAL_SECONDS) : '10';
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('example'));
  const hasApiKey = Boolean(process.env.OPENSEA_API_KEY && !process.env.OPENSEA_API_KEY.includes('your_'));
  const dbPath = process.env.DATABASE_PATH || './data/nft_bot.sqlite';

  return `⚙️ *SYSTEM CONFIGURATION & SETTINGS*

🔑 *Telegram Bot:* ${hasToken ? '✅ Configured' : '⚠️ Missing / Placeholder'}
🔑 *OpenSea API Key:* ${hasApiKey ? '✅ Configured' : '⚠️ Unset (Limited rate limit)'}
👮 *Authorized Admins:* ${adminIds.length > 0 ? adminIds.join(', ') : '⚠️ None set (Open access)'}
📁 *Database Path:* \`${dbPath}\`
⏱️ *Polling Interval:* ${pollInterval}s

🛡️ *Security Rules:*
• Private keys / seed phrases are never stored or requested.
• All addresses validated against EVM & Solana rules.
• Deduplicated across overlapping group memberships.`;
}

export function buildHelpMessage(): string {
  return `❓ *NFT SMART MONEY BOT — HELP & COMMANDS*

🤖 *Main Commands:*
• \`/start\` or \`/menu\` — Open interactive main menu
• \`/dashboard\` — View system metrics and monitoring status
• \`/wallets\` — List all tracked smart money wallets
• \`/groups\` — List wallet groups (Alpha, Whales, etc.)
• \`/mints\` — View recent NFT mint alerts
• \`/buys\` — View recent NFT purchase alerts
• \`/settings\` — View bot settings & admin list
• \`/testalert\` — Generate and broadcast a sample consolidated alert

👛 *Wallet Management:*
• \`/addwallet <address> <label> [group1,group2]\`
  _Example:_ \`/addwallet 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 Vitalik grp_alpha\`
• \`/addwallets <groupId|groupName> <addr1> [addr2]...\` — Add multiple wallets at once
  _Example:_ \`/addwallets Alpha 0x111... 0x222... 0x333...\`
• \`/delwallet <address>\`
• \`/clearwallets\` — Delete all tracked wallets from the bot
• \`/walletinfo <address>\` — See groups containing this wallet
• \`/addtogroup <address> <groupId>\`
• \`/removefromgroup <address> <groupId>\`

📁 *Group Management:*
• \`/creategroup <name> [description]\`
• \`/renamegroup <groupId> <newName>\`
• \`/delgroup <groupId>\`
• \`/groupwallets <groupId>\` — List wallets in group`;
}

/**
 * Parses user input for bulk wallet addition (supports single line, multi-line, comma-separated, with optional labels)
 */
export function parseBulkWalletsInput(rawText: string): { groupId: string; items: { address: string; label?: string }[] } {
  const withoutCmd = rawText.replace(/^\/(addwallets|bulkadd|addwallet)\s*/i, '').trim();
  if (!withoutCmd) return { groupId: 'Alpha', items: [] };

  const lines = withoutCmd.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { groupId: 'Alpha', items: [] };

  let groupId = '';
  let addressTokens: string[] = [];

  if (lines.length === 1) {
    const parts = lines[0].split(/[,\s]+/).filter(Boolean);
    groupId = parts[0] || '';
    addressTokens = parts.slice(1);
  } else {
    const firstLineParts = lines[0].split(/[,\s]+/).filter(Boolean);
    groupId = firstLineParts[0] || '';
    if (firstLineParts.length > 1) {
      addressTokens.push(...firstLineParts.slice(1));
    }
    for (let i = 1; i < lines.length; i++) {
      const lineTokens = lines[i].split(/[,\s]+/).filter(Boolean);
      addressTokens.push(...lineTokens);
    }
  }

  // If groupId is actually a wallet address, it is NOT a group name!
  // Put it back in addressTokens and default group to 'Alpha'
  if (groupId && (validateWalletAddress(groupId).isValid || groupId.startsWith('0x') || groupId.length >= 32)) {
    addressTokens.unshift(groupId);
    groupId = 'Alpha';
  } else if (!groupId) {
    groupId = 'Alpha';
  }

  const items: { address: string; label?: string }[] = [];
  for (let i = 0; i < addressTokens.length; i++) {
    const token = addressTokens[i].replace(/[,;]/g, '').trim();
    if (!token) continue;

    if (token.startsWith('0x') || token.length >= 30) {
      let label: string | undefined = undefined;
      const nextToken = addressTokens[i + 1]?.replace(/[,;]/g, '').trim();
      if (nextToken && !nextToken.startsWith('0x') && nextToken.length < 25 && !validateWalletAddress(nextToken).isValid) {
        label = nextToken;
        i++;
      }
      items.push({ address: token, label });
    } else if (validateWalletAddress(token).isValid) {
      items.push({ address: token });
    }
  }

  return { groupId, items };
}

/**
 * Initializes and configures the Telegraf bot instance
 */
export function setupBot(botToken?: string): Telegraf | null {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token.includes('example') || token.trim() === '') {
    addLog('info', 'telegram', 'Telegram bot token is not configured or is a placeholder. Bot simulator is enabled for web UI.');
    return null;
  }

  const bot = new Telegraf(token);

  // Authorization middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (ctx.chat?.id) {
      subscribedChatIds.add(ctx.chat.id);
    }
    if (!isUserAdmin(userId)) {
      await ctx.reply('⛔ Unauthorized: Your Telegram user ID is not registered in TELEGRAM_ADMIN_IDS.');
      return;
    }
    return next();
  });

  // Commands
  bot.command(['start', 'menu'], async (ctx) => {
    await ctx.reply(
      `👋 *Welcome to NFT Smart Money Alert Bot!*\n\nReal-time monitoring of NFT mints and purchases across chains using OpenSea API v2.`,
      { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
    );
  });

  bot.command('dashboard', async (ctx) => {
    await ctx.reply(buildDashboardMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.command('wallets', async (ctx) => {
    const { text, keyboard } = buildWalletsListMessage(0);
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.command('groups', async (ctx) => {
    const { text, keyboard } = buildGroupsListMessage();
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.command('mints', async (ctx) => {
    await ctx.reply(buildRecentAlertsMessage('mint'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.command('buys', async (ctx) => {
    await ctx.reply(buildRecentAlertsMessage('buy'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.command('settings', async (ctx) => {
    await ctx.reply(buildSettingsMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(buildHelpMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  // Wallet add command: /addwallet <address> [label|group] [group]
  bot.command('addwallet', async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/).slice(1);

    if (parts.length === 0) {
      await ctx.reply('⚠️ Usage: `/addwallet <address> [label] [group]`\n\n_To import multiple wallets at once:_\n`/addwallets <group> <addr1> <addr2>...`', { parse_mode: 'Markdown' });
      return;
    }

    // Detect if user provided multiple addresses under /addwallet
    const bulkParsed = parseBulkWalletsInput(text);
    if (bulkParsed.items.length > 1) {
      try {
        const res = bulkAddWalletsToGroup(bulkParsed.groupId || 'Alpha', bulkParsed.items);
        let replyMsg = `✅ *Multiple Wallets Added!*\n\n📁 Group: *${res.group.name}* (\`${res.group.id}\`)\n🔢 Added: *${res.addedCount}* wallet(s)\n👥 Total in Group: *${res.group.wallet_count || res.addedCount}*`;

        if (res.errors.length > 0) {
          replyMsg += `\n\n⚠️ *Skipped/Invalid (${res.errors.length}):*\n`;
          res.errors.slice(0, 5).forEach((e) => {
            replyMsg += `• ${e}\n`;
          });
          if (res.errors.length > 5) {
            replyMsg += `• ...and ${res.errors.length - 5} more\n`;
          }
        }

        await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
        return;
      } catch (err: any) {
        await ctx.reply(`❌ Error adding wallets: ${err.message}`);
        return;
      }
    }

    const address = parts[0];
    let label = 'Tracked Wallet';
    let groupIds: string[] = [];

    if (parts.length === 2) {
      const resolved = resolveGroupId(parts[1]);
      if (resolved) {
        groupIds = [parts[1]];
        label = `Wallet_${address.slice(0, 6)}`;
      } else {
        label = parts[1];
      }
    } else if (parts.length >= 3) {
      label = parts[1];
      groupIds = parts[2].split(',').map((g) => g.trim()).filter(Boolean);
    }

    const validation = validateWalletAddress(address);
    if (!validation.isValid) {
      await ctx.reply(`❌ ${validation.error}`);
      return;
    }

    try {
      const wallet = addWallet(validation.normalizedAddress, label, validation.chainType, groupIds);
      await ctx.reply(
        `✅ *Wallet Added Successfully!*\n\n• Address: \`${wallet.address}\`\n• Format: ${validation.detectedFormat}\n• Label: ${wallet.label}\n• Groups: ${wallet.group_names?.join(', ') || 'Alpha'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err: any) {
      await ctx.reply(`❌ Error adding wallet: ${err.message}`);
    }
  });

  // Bulk add wallets: /addwallets <groupId|groupName> <address1> [address2]...
  bot.command(['addwallets', 'bulkadd'], async (ctx) => {
    const text = ctx.message.text.trim();
    const { groupId, items } = parseBulkWalletsInput(text);

    if (!groupId || items.length === 0) {
      await ctx.reply(
        '⚠️ Usage: `/addwallets <groupId|groupName> <address1> [address2]...`\n\n_Examples:_\n`/addwallets Alpha 0xd8da6... 0xce90a...`\n\nOr paste multiple addresses on separate lines.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      const res = bulkAddWalletsToGroup(groupId, items);
      let replyMsg = `✅ *Bulk Wallets Added!*\n\n📁 Group: *${res.group.name}* (\`${res.group.id}\`)\n🔢 Added: *${res.addedCount}* wallet(s)\n👥 Total in Group: *${res.group.wallet_count || res.addedCount}*`;

      if (res.errors.length > 0) {
        replyMsg += `\n\n⚠️ *Skipped/Invalid (${res.errors.length}):*\n`;
        res.errors.slice(0, 5).forEach((e) => {
          replyMsg += `• ${e}\n`;
        });
        if (res.errors.length > 5) {
          replyMsg += `• ...and ${res.errors.length - 5} more\n`;
        }
      }

      await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await ctx.reply(`❌ Error adding wallets: ${err.message}`);
    }
  });

  // Clear all wallets: /clearwallets
  bot.command('clearwallets', async (ctx) => {
    try {
      const count = clearAllWallets();
      await ctx.reply(
        `🗑️ *All Wallets Cleared!*\n\nRemoved *${count}* tracked wallet(s) from monitoring. All pre-programmed and custom wallets have been deleted.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err: any) {
      await ctx.reply(`❌ Error clearing wallets: ${err.message}`);
    }
  });

  // Delete wallet: /delwallet <address>
  bot.command('delwallet', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('⚠️ Usage: `/delwallet <address>`', { parse_mode: 'Markdown' });
      return;
    }
    const address = parts[0];
    const removed = removeWallet(address);
    if (removed) {
      await ctx.reply(`✅ Wallet \`${address}\` removed from monitoring.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`⚠️ Wallet \`${address}\` was not found.`, { parse_mode: 'Markdown' });
    }
  });

  // Wallet info: /walletinfo <address>
  bot.command('walletinfo', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('⚠️ Usage: `/walletinfo <address>`', { parse_mode: 'Markdown' });
      return;
    }
    const address = parts[0];
    const groups = getWalletGroups(address);
    if (groups.length === 0) {
      await ctx.reply(`Wallet \`${address}\` does not belong to any groups.`, { parse_mode: 'Markdown' });
    } else {
      const names = groups.map((g) => `• *${g.name}* (\`${g.id}\`)`).join('\n');
      await ctx.reply(`📁 *Groups for wallet* \`${address}\`:\n\n${names}`, { parse_mode: 'Markdown' });
    }
  });

  // Create group: /creategroup <name> [description]
  bot.command('creategroup', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('⚠️ Usage: `/creategroup <name> [description]`', { parse_mode: 'Markdown' });
      return;
    }
    const name = parts[0];
    const desc = parts.slice(1).join(' ');
    try {
      const g = createGroup(name, desc);
      await ctx.reply(`✅ *Group Created!*\n• Name: *${g.name}*\n• ID: \`${g.id}\`\n• Description: _${g.description}_`, {
        parse_mode: 'Markdown',
      });
    } catch (err: any) {
      await ctx.reply(`❌ Error creating group: ${err.message}`);
    }
  });

  // Rename group: /renamegroup <id> <newName>
  bot.command('renamegroup', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      await ctx.reply('⚠️ Usage: `/renamegroup <groupId> <newName>`', { parse_mode: 'Markdown' });
      return;
    }
    const [id, newName] = parts;
    const ok = renameGroup(id, newName);
    if (ok) {
      await ctx.reply(`✅ Group \`${id}\` renamed to *${newName}*.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`⚠️ Group \`${id}\` not found.`);
    }
  });

  // Delete group: /delgroup <id>
  bot.command('delgroup', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      await ctx.reply('⚠️ Usage: `/delgroup <groupId>`', { parse_mode: 'Markdown' });
      return;
    }
    const id = parts[0];
    const ok = deleteGroup(id);
    if (ok) {
      await ctx.reply(`✅ Group \`${id}\` deleted.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`⚠️ Group \`${id}\` not found.`);
    }
  });

  // Add wallet to group: /addtogroup <address> <groupId>
  bot.command('addtogroup', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      await ctx.reply('⚠️ Usage: `/addtogroup <address> <groupId>`', { parse_mode: 'Markdown' });
      return;
    }
    const [addr, grpId] = parts;
    const ok = addWalletToGroup(addr, grpId);
    if (ok) {
      await ctx.reply(`✅ Wallet added to group \`${grpId}\`.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`⚠️ Failed to add wallet to group. Verify address and group ID.`);
    }
  });

  // Remove wallet from group: /removefromgroup <address> <groupId>
  bot.command('removefromgroup', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      await ctx.reply('⚠️ Usage: `/removefromgroup <address> <groupId>`', { parse_mode: 'Markdown' });
      return;
    }
    const [addr, grpId] = parts;
    const ok = removeWalletFromGroup(addr, grpId);
    if (ok) {
      await ctx.reply(`✅ Wallet removed from group \`${grpId}\` (other group memberships preserved).`, {
        parse_mode: 'Markdown',
      });
    } else {
      await ctx.reply(`⚠️ Membership not found for wallet in group \`${grpId}\`.`);
    }
  });

  // Test alert command: /testalert
  bot.command('testalert', async (ctx) => {
    const sampleMessage = `🔥 SMART MONEY MINT

📦 Collection: Pudgy Penguins
⛓️ Chain: Ethereum

📊 Group Activity
📁 Alpha — 3 Minters | 12 NFTs
📁 Whales — 2 Minters | 7 NFTs
📁 Smart Money — 4 Minters | 15 NFTs

🔢 Total: 8 Unique Wallets | 34 NFTs Minted

⚡ Activity: NFT Mint
🔗 OpenSea: https://opensea.io/collection/pudgypenguins
🌐 Socials: [X/Twitter](https://x.com/pudgypenguins) • [Discord](https://discord.gg/pudgypenguins) • [Website](https://pudgypenguins.com)`;

    await ctx.reply(sampleMessage, { parse_mode: 'Markdown' });
  });

  // Action / Callback Query Handlers
  bot.action('menu_main', async (ctx) => {
    await ctx.editMessageText('👋 *Main Menu*', { parse_mode: 'Markdown', ...getMainMenuKeyboard() });
  });

  bot.action('menu_dashboard', async (ctx) => {
    await ctx.editMessageText(buildDashboardMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.action('menu_wallets', async (ctx) => {
    const { text, keyboard } = buildWalletsListMessage(0);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(/^wallets_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    const { text, keyboard } = buildWalletsListMessage(page);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('menu_groups', async (ctx) => {
    const { text, keyboard } = buildGroupsListMessage();
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('menu_recent_mints', async (ctx) => {
    await ctx.editMessageText(buildRecentAlertsMessage('mint'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.action('menu_recent_buys', async (ctx) => {
    await ctx.editMessageText(buildRecentAlertsMessage('buy'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.action('menu_settings', async (ctx) => {
    await ctx.editMessageText(buildSettingsMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.action('menu_help', async (ctx) => {
    await ctx.editMessageText(buildHelpMessage(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'menu_main')]]),
    });
  });

  bot.action('menu_test_alert', async (ctx) => {
    const sampleMessage = `🔥 SMART MONEY MINT

📦 Collection: CyberKongz
⛓️ Chain: Ethereum

📊 Group Activity
📁 Alpha — 2 Minters | 5 NFTs
📁 Smart Money — 3 Minters | 9 NFTs

🔢 Total: 4 Unique Wallets | 14 NFTs Minted

⚡ Activity: NFT Mint
🔗 OpenSea: https://opensea.io/collection/cyberkongz
🌐 Socials: [X/Twitter](https://x.com/cyberkongz) • [Website](https://cyberkongz.com)`;

    await ctx.reply(sampleMessage, { parse_mode: 'Markdown' });
  });

  return bot;
}

/**
 * Broadcasts an alert message to all subscribed Telegram chat channels
 */
export async function broadcastTelegramAlert(bot: Telegraf | null, message: string): Promise<number> {
  let sentCount = 0;
  if (!bot) {
    addLog('info', 'telegram', 'Simulator: Broadcast alert generated', message.slice(0, 100));
    return 0;
  }

  // Also send to configured admin IDs as direct messages
  const adminIds = getAdminIds();
  const targetIds = new Set<number>([...subscribedChatIds, ...adminIds]);

  for (const chatId of targetIds) {
    try {
      await bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: false },
      });
      sentCount++;
    } catch (err: any) {
      addLog('warn', 'telegram', `Failed sending alert to chat ID ${chatId}`, err.message);
    }
  }

  return sentCount;
}

/**
 * Direct simulator executor for web console
 */
export function simulateTelegramMessage(userId: number, commandText: string): { text: string; buttons?: string[] } {
  const trimmed = commandText.trim();
  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  const parts = trimmed.split(/\s+/).slice(1);

  if (!isUserAdmin(userId)) {
    return { text: '⛔ Unauthorized: Telegram user ID is not registered in TELEGRAM_ADMIN_IDS.' };
  }

  if (cmd === '/start' || cmd === '/menu') {
    return {
      text: `👋 *Welcome to NFT Smart Money Alert Bot!*\n\nReal-time monitoring of NFT mints and purchases across chains using OpenSea API v2.`,
      buttons: ['📊 Dashboard', '👛 Manage Wallets', '📁 Wallet Groups', '🔥 Recent Mint Alerts', '🛒 Recent Purchase Alerts', '⚙️ Settings', '❓ Help'],
    };
  }

  if (cmd === '/dashboard') {
    return { text: buildDashboardMessage() };
  }

  if (cmd === '/wallets') {
    const { text } = buildWalletsListMessage(0);
    return { text };
  }

  if (cmd === '/groups') {
    const { text } = buildGroupsListMessage();
    return { text };
  }

  if (cmd === '/mints') {
    return { text: buildRecentAlertsMessage('mint') };
  }

  if (cmd === '/buys') {
    return { text: buildRecentAlertsMessage('buy') };
  }

  if (cmd === '/settings') {
    return { text: buildSettingsMessage() };
  }

  if (cmd === '/help') {
    return { text: buildHelpMessage() };
  }

  if (cmd === '/testalert') {
    return {
      text: `🔥 SMART MONEY MINT

📦 Collection: Pudgy Penguins
⛓️ Chain: Ethereum

📊 Group Activity
📁 Alpha — 3 Minters | 12 NFTs
📁 Whales — 2 Minters | 7 NFTs
📁 Smart Money — 4 Minters | 15 NFTs

🔢 Total: 8 Unique Wallets | 34 NFTs Minted

⚡ Activity: NFT Mint
🔗 OpenSea: https://opensea.io/collection/pudgypenguins
🌐 Socials: [X/Twitter](https://x.com/pudgypenguins) • [Discord](https://discord.gg/pudgypenguins) • [Website](https://pudgypenguins.com)`,
    };
  }

  if (cmd === '/addwallet') {
    if (parts.length === 0) return { text: '⚠️ Usage: `/addwallet <address> [label] [group]`' };

    const bulkParsed = parseBulkWalletsInput(trimmed);
    if (bulkParsed.items.length > 1) {
      const res = bulkAddWalletsToGroup(bulkParsed.groupId || 'Alpha', bulkParsed.items);
      let replyMsg = `✅ *Multiple Wallets Added!*\n\n📁 Group: *${res.group.name}* (\`${res.group.id}\`)\n🔢 Added: *${res.addedCount}* wallet(s)\n👥 Total in Group: *${res.group.wallet_count || res.addedCount}*`;
      if (res.errors.length > 0) {
        replyMsg += `\n\n⚠️ *Skipped (${res.errors.length}):*\n` + res.errors.slice(0, 3).map((e) => `• ${e}`).join('\n');
      }
      return { text: replyMsg };
    }

    const address = parts[0];
    let label = 'Tracked Wallet';
    let groupIds: string[] = [];

    if (parts.length === 2) {
      const resolved = resolveGroupId(parts[1]);
      if (resolved) {
        groupIds = [parts[1]];
        label = `Wallet_${address.slice(0, 6)}`;
      } else {
        label = parts[1];
      }
    } else if (parts.length >= 3) {
      label = parts[1];
      groupIds = parts[2].split(',').map((g) => g.trim()).filter(Boolean);
    }

    const validation = validateWalletAddress(address);
    if (!validation.isValid) return { text: `❌ ${validation.error}` };
    const wallet = addWallet(validation.normalizedAddress, label, validation.chainType, groupIds);
    return {
      text: `✅ *Wallet Added Successfully!*\n\n• Address: \`${wallet.address}\`\n• Format: ${validation.detectedFormat}\n• Label: ${wallet.label}\n• Groups: ${wallet.group_names?.join(', ') || 'Alpha'}`,
    };
  }

  if (cmd === '/delwallet') {
    if (parts.length === 0) return { text: '⚠️ Usage: `/delwallet <address>`' };
    const ok = removeWallet(parts[0]);
    return { text: ok ? `✅ Wallet \`${parts[0]}\` removed.` : `⚠️ Wallet \`${parts[0]}\` not found.` };
  }

  if (cmd === '/addwallets' || cmd === '/bulkadd') {
    const { groupId, items } = parseBulkWalletsInput(trimmed);
    if (!groupId || items.length === 0) {
      return { text: '⚠️ Usage: `/addwallets <groupId|groupName> <address1> [address2]...`\n\n_Example:_\n`/addwallets Alpha 0xd8da6... 0xce90a...`' };
    }
    const res = bulkAddWalletsToGroup(groupId, items);
    let replyMsg = `✅ *Bulk Wallets Added!*\n\n📁 Group: *${res.group.name}* (\`${res.group.id}\`)\n🔢 Added: *${res.addedCount}* wallet(s)\n👥 Total in Group: *${res.group.wallet_count || res.addedCount}*`;
    if (res.errors.length > 0) {
      replyMsg += `\n\n⚠️ *Skipped/Invalid (${res.errors.length}):*\n` + res.errors.slice(0, 3).map((e) => `• ${e}`).join('\n');
    }
    return { text: replyMsg };
  }

  if (cmd === '/clearwallets') {
    const count = clearAllWallets();
    return { text: `🗑️ *All Wallets Cleared!*\n\nRemoved *${count}* tracked wallet(s) from monitoring. All pre-programmed and custom wallets have been deleted.` };
  }

  if (cmd === '/creategroup') {
    if (parts.length === 0) return { text: '⚠️ Usage: `/creategroup <name> [description]`' };
    const g = createGroup(parts[0], parts.slice(1).join(' '));
    return { text: `✅ *Group Created!*\n• Name: *${g.name}*\n• ID: \`${g.id}\`\n• Description: _${g.description}_` };
  }

  return { text: `Unknown command "${cmd}". Type /help to see all available commands.` };
}
