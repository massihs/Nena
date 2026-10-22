import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { closeDb } from './db.js';
import { HttpError } from './util.js';
import { initRealtime, closeRealtime } from './realtime.js';
import { resumeDispatch, stopAllDispatch } from './services/matching.js';
import authRoutes from './routes/auth.js';
import riderRoutes from './routes/rider.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import commonRoutes from './routes/common.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  // Document uploads have their own, larger body limit.
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/driver/documents' ? next() : json(req, res, next)));

  app.use('/api', authRoutes);
  app.use('/api', commonRoutes);
  app.use('/api/rider', riderRoutes);
  app.use('/api', driverRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'مسیر یافت نشد')));

  app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules/leaflet/dist'), { maxAge: '7d' }));
  app.use('/vendor/maplibre', express.static(path.join(root, 'node_modules/maplibre-gl/dist'), { maxAge: '7d' }));
  app.use('/vendor/maplibre-leaflet', express.static(path.join(root, 'node_modules/@maplibre/maplibre-gl-leaflet'), { maxAge: '7d' }));
  app.use('/vendor/rtl-text', express.static(path.join(root, 'node_modules/@mapbox/mapbox-gl-rtl-text/dist'), { maxAge: '30d' }));
  app.use('/vendor/vazirmatn', express.static(path.join(root, 'node_modules/vazirmatn'), { maxAge: '30d' }));
  app.get('/track/:token', (_req, res) => res.sendFile(path.join(root, 'public/track/index.html')));
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = err instanceof HttpError || status < 500
      ? (err.type === 'entity.too.large' ? 'حجم درخواست بیش از حد مجاز است' : err.message)
      : 'خطای سرور؛ لطفاً دوباره تلاش کنید';
    res.status(status).json({ error: message, code: err.code });
  });
  return app;
}

export function startServer(port = config.port) {
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  resumeDispatch();
  return new Promise((resolve) => {
    server.listen(port, () => {
      const close = async () => {
        stopAllDispatch();
        await closeRealtime();
        await new Promise((r) => server.close(() => r()));
      };
      resolve({ app, server, port: server.address().port, close });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, close } = await startServer();
  // Hosts stop the old instance with SIGTERM on every deploy: finish requests and flush the
  // SQLite write-ahead log so nothing is lost.
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      console.log(`${signal}: shutting down`);
      const timer = setTimeout(() => process.exit(1), 10000);
      try { await close(); } finally {
        closeDb();
        clearTimeout(timer);
        process.exit(0);
      }
    });
  }
  console.log(`data: ${config.dbPath}${config.persistentStorage ? '' : ' (default local path; set DB_PATH to a persistent disk in production)'}`);
  console.log(`نِنا روی ${config.publicUrl} اجرا شد (port ${port})`);
  console.log(`  مسافر:  ${config.publicUrl}/rider/`);
  console.log(`  راننده: ${config.publicUrl}/driver/`);
  console.log(`  مدیریت: ${config.publicUrl}/admin/`);
}
