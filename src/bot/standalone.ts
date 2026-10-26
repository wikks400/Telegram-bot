import dotenv from 'dotenv';
dotenv.config();

import { initDatabase, closeDatabase, addLog } from '../server/database/db.ts';
import { setupBot } from '../server/telegram/bot.ts';
import { monitorService } from '../server/services/monitorService.ts';

async function bootstrap() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 Starting Telegram NFT Smart Money Alert Bot...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const dbPath = process.env.DATABASE_PATH || './data/nft_bot.sqlite';
  console.log(`📁 Initializing persistent SQLite database at: ${dbPath}`);
  initDatabase(dbPath);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('example')) {
    console.warn('⚠️ WARNING: TELEGRAM_BOT_TOKEN is not configured or is a placeholder.');
    console.warn('   Set your Telegram bot token in environment variables to receive live alerts.');
  }

  const bot = setupBot(token);
  monitorService.setBot(bot);

  if (bot) {
    try {
      console.log('🚀 Connecting to Telegram via Long Polling...');
      await bot.launch(() => {
        console.log('✅ Telegram bot successfully connected and listening for commands!');
      });
      addLog('info', 'telegram', 'Telegram bot launched successfully in long-polling mode');
    } catch (err: any) {
      console.error('❌ Failed to launch Telegram bot:', err.message);
      addLog('error', 'telegram', 'Telegram bot launch failed', err.message);
    }
  } else {
    console.log('ℹ️ Running in simulation / background monitoring mode without active Telegram token.');
  }

  // Start the background monitoring loop
  console.log('🔄 Starting OpenSea API v2 activity monitoring service...');
  monitorService.start();

  // Graceful shutdown handlers
  const handleShutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    monitorService.stop();
    if (bot) {
      try {
        bot.stop(signal);
      } catch (err) {
        // ignore
      }
    }
    closeDatabase();
    console.log('👋 Bot process terminated cleanly. Goodbye.');
    process.exit(0);
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
