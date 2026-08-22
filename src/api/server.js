// API service (Railway service #3, alongside worker + scheduler). Standalone
// from Charles's Remix UI on purpose — see the "where should endpoints
// live" discussion: the schema has already changed 3 times in a few days,
// and a standalone API absorbs that churn so the UI keeps calling the same
// stable endpoint shapes underneath. Deploy with `npm run api` as the start
// command.

import express from 'express';
import 'dotenv/config';
import { webhooksRouter } from './routes/webhooks.js';
import { brandsRouter } from './routes/brands.js';
import { categoriesRouter } from './routes/categories.js';
import { railwayWebhookRouter } from './routes/railwayWebhook.js';
import { stubAuthContext } from './middleware/authStub.js';

const app = express();

// Compliance webhooks need raw-body access for HMAC verification — mounted
// before the global JSON parser below, and independent of it (see
// webhooksRouter's own express.raw() call).
app.use('/webhooks', webhooksRouter);

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Internal ops endpoint — Railway's own deploy-failure webhook posts here,
// converted into an email alert. Not part of the CitationalAI product API
// (deliberately not in docs/openapi.yaml) — separate concern from the
// brand/category endpoints below.
app.use('/internal/railway-webhook', railwayWebhookRouter);

// /categories/*/leaderboard is public (no auth) per the design doc — the
// stub applies to all of /brands and /categories/*/questions uniformly for
// now since there's no real tier distinction to enforce yet either. Once
// real auth exists, only the brand-scoped routes should require it.
app.use('/brands', stubAuthContext, brandsRouter);
app.use('/categories', stubAuthContext, categoriesRouter);

app.use((err, req, res, next) => {
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT}`);
});
