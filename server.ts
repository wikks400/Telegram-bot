import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDatabase, closeDatabase, getDatabasePath, addLog } from './src/server/database/db.ts';
import { setupBot, startBotPolling, stopBotPolling } from './src/server/telegram/bot.ts';
import { monitorService } from './src/server/services/monitorService.ts';
import { apiRouter } from './src/server/routes/api.ts';

process.env.DISABLE_HMR = 'true';
dotenv.config();

// Normalize poll interval to 10 seconds
process.env.POLL_INTERVAL_SECONDS = '10';

// If DATABASE_PATH was accidentally set to a number (e.g. 10000), fix it:
if (process.env.DATABASE_PATH && /^\d+$/.test(process.env.DATABASE_PATH.trim())) {
  process.env.DATABASE_PATH = './data/bot.db';
}

// Global process error handlers to prevent unhandled rejection crashes (e.g., transient network/polling drops)
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason);
  if (msg.includes('409') || msg.includes('Conflict')) {
    console.warn('[Telegram] Safe recovery: Suppressed unhandled 409 Conflict rejection.');
    return;
  }
  console.error('[Process] Unhandled Rejection:', msg);
});

process.on('uncaughtException', (err: any) => {
  const msg = err?.message || String(err);
  if (msg.includes('409') || msg.includes('Conflict')) {
    console.warn('[Telegram] Safe recovery: Suppressed 409 Conflict uncaught exception.');
    return;
  }
  console.error('[Process] Uncaught Exception:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Initialize SQLite Database (supports ./data/bot.db and ./data/nft_bot.sqlite)
  const dbPath = getDatabasePath();
  initDatabase(dbPath);
  console.log(`[DB] Persistent SQLite database initialized at ${dbPath}`);

  // Setup Telegram Bot (Singleton)
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const bot = setupBot(token);
  app.set('telegramBot', bot);
  monitorService.setBot(bot);

  if (bot) {
    startBotPolling(bot).catch((err) => {
      console.warn('[Telegram] Polling startup encountered issue:', err.message);
    });
  } else {
    console.log('[Telegram] Running in Web Console / Simulator mode (No live bot token configured)');
  }

  // Start background monitoring service (ensures only 1 loop is running)
  monitorService.start();

  // Express middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Production static serving vs Development mode
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
  const isProd = process.env.NODE_ENV === 'production' || hasDist;

  if (isProd) {
    if (hasDist) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      console.log('[Express] Serving pre-built static assets from dist/ (Low-RAM Production Mode)');
    } else {
      // Production fallback if dist is not yet built: DO NOT load heavy Vite dev server in production
      console.warn('[Express] Pre-built dist/index.html not found. Serving lightweight fallback dashboard.');
      app.get('*', (_req, res) => {
        res.type('html').send(`<!DOCTYPE html>
<html>
<head><title>NFT Smart Money Bot</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;padding:2rem;background:#1e293b;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);}h1{color:#38bdf8;margin-bottom:0.5rem;}p{color:#94a3b8;margin:0.25rem 0;}code{background:#334155;padding:2px 6px;border-radius:4px;color:#cbd5e1;}</style></head>
<body>
<div>
  <h1>🤖 NFT Smart Money Bot Active</h1>
  <p>Server & Monitoring are running smoothly in Low-RAM Production Mode.</p>
  <p>To enable the full web dashboard, run <code>npm run build</code>.</p>
  <p>All Telegram alerts, wallet tracking, and OpenSea event monitoring are active.</p>
</div>
</body>
</html>`);
      });
    }
  } else {
    // Only in explicit non-production local development without dist
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
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Telegram NFT Smart Money Bot Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  const handleShutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down server and monitoring...`);
    monitorService.stop();
    await stopBotPolling(signal);

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
