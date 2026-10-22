const env = process.env;
const port = Number(env.PORT) || 3000;
const production = env.NODE_ENV === 'production';

export const config = {
  port,
  production,
  publicUrl: env.PUBLIC_URL
    || env.RENDER_EXTERNAL_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`),
  jwtSecret: env.JWT_SECRET || 'nena-dev-secret-change-me',
  dbPath: env.DB_PATH || 'data/nena.db',
  uploadDir: env.UPLOAD_DIR || 'data/uploads',

  // Phones listed here are given admin access on login.
  adminPhones: (env.ADMIN_PHONES || (production ? '' : '09120000000'))
    .split(',').map((p) => p.trim()).filter(Boolean),

  // SMS: "mock" logs the code (and returns it to the client outside production); "kavenegar" sends it.
  sms: {
    provider: env.SMS_PROVIDER || 'mock',
    kavenegarKey: env.KAVENEGAR_API_KEY || '',
    kavenegarTemplate: env.KAVENEGAR_TEMPLATE || 'nena-otp',
  },
  // EXPOSE_OTP=1 shows login codes on screen even in production (demo deployments without an SMS provider).
  exposeOtp: env.EXPOSE_OTP === '1' || (!production && env.EXPOSE_OTP !== '0'),

  // Payment gateway: "mock" (built-in test page) or "zarinpal".
  payment: {
    provider: env.PAYMENT_PROVIDER || 'mock',
    zarinpalMerchant: env.ZARINPAL_MERCHANT_ID || '',
    zarinpalSandbox: env.ZARINPAL_SANDBOX === '1',
  },

  // Routing: "estimate" (straight-line × road factor), "osrm" or "neshan". Falls back to estimate on error.
  routing: {
    provider: env.ROUTING_PROVIDER || 'estimate',
    osrmUrl: env.OSRM_URL || 'https://router.project-osrm.org',
  },
  // Geocoding: "nominatim" (OpenStreetMap), "neshan" or "none".
  geocoder: env.GEOCODER || 'nominatim',
  neshanKey: env.NESHAN_API_KEY || '',

  map: {
    // Vector basemaps (OpenFreeMap, free, no key) rendered with WebGL: sharp on any screen.
    styleUrl: env.MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron',
    darkStyleUrl: env.MAP_STYLE_URL_DARK ?? 'https://tiles.openfreemap.org/styles/dark',
    styleAttribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap',
    // Raster fallback when WebGL or the style is unavailable.
    tileUrl: env.TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: env.TILE_SUBDOMAINS || 'abc',
    attribution: env.TILE_ATTRIBUTION || '&copy; OpenStreetMap',
    center: [35.6997, 51.338], // Tehran, Azadi area
    zoom: 13,
  },
};

if (production && config.jwtSecret === 'nena-dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
if (production && config.exposeOtp) {
  console.warn('[nena] EXPOSE_OTP=1: login codes are shown to users. Use only for demos.');
}
