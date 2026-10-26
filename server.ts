import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, closeDatabase, addLog } from './src/server/database/db.ts';
import { setupBot } from './src/server/telegram/bot.ts';
import { monitorService } from './src/server/services/monitorService.ts';
import { apiRouter } from './src/server/routes/api.ts';

process.env.DISABLE_HMR = 'true';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Initialize SQLite Database
  const dbPath = process.env.DATABASE_PATH || './data/nft_bot.sqlite';
  initDatabase(dbPath);
  console.log(`[DB] Persistent SQLite database initialized at ${dbPath}`);

  // Setup Telegram Bot
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = setupBot(token);
  app.set('telegramBot', bot);
  monitorService.setBot(bot);

  if (bot) {
    bot.launch(() => {
      console.log('[Telegram] Bot started in polling mode');
    }).catch((err) => {
      console.warn('[Telegram] Could not start polling:', err.message);
    });
  } else {
    console.log('[Telegram] Running in Web Console / Simulator mode (No live bot token configured)');
  }

  // Start background monitoring service
  monitorService.start();

  // Express middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Dev mode with Vite middleware vs Production static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Vite] Middleware mounted in development mode');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[Express] Serving static files from dist');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Telegram NFT Smart Money Bot Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  const handleShutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down server and monitoring...`);
    monitorService.stop();
    if (bot) {
      try {
        bot.stop(signal);
      } catch {
        // ignore
      }
    }
    server.close(() => {
      closeDatabase();
      console.log('✅ Server and database closed. Bye!');
      process.exit(0);
    });
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
