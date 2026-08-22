// Receiver for Railway's own deploy-status webhook (Project Settings ->
// Webhooks in the Railway dashboard). Railway sends a JSON POST on
// deployment status changes — but doesn't email directly, so this converts
// a failure event into an alert email via Resend.
//
// Protected by a shared secret in the URL query string (?secret=...), not
// a signature — no evidence found that Railway signs these webhooks the
// way Shopify does, so this is a lighter-weight protection: set
// RAILWAY_WEBHOOK_SECRET and use that same value in the webhook URL
// configured in Railway's dashboard.
//
// STATUS: UNVERIFIED payload shape. Railway's docs confirm a JSON payload
// on deployment status changes, but not the exact field names — the
// detection logic below checks several plausible field names and logs the
// full raw payload either way, so the first real event received can be
// used to tighten this up if the field names guessed here are wrong.

import { Router } from 'express';
import { sendAlertEmail } from '../../lib/email.js';

export const railwayWebhookRouter = Router();

const FAILURE_STATUSES = ['FAILED', 'CRASHED', 'REMOVED'];

railwayWebhookRouter.post('/', async (req, res) => {
  if (!process.env.RAILWAY_WEBHOOK_SECRET || req.query.secret !== process.env.RAILWAY_WEBHOOK_SECRET) {
    return res.status(401).send('unauthorized');
  }

  const payload = req.body || {};
  console.log('[railway-webhook] received:', JSON.stringify(payload).slice(0, 800));

  // Guessing at likely field names since the exact schema isn't confirmed
  // — checked against the raw payload logged above once a real event
  // arrives, and this list can be tightened then.
  const status = payload.status || payload.deploymentStatus || payload.type || payload.event;
  const serviceName = payload.service?.name || payload.serviceName || payload.project?.name || 'unknown service';

  if (status && FAILURE_STATUSES.includes(String(status).toUpperCase())) {
    await sendAlertEmail(
      `CitationalAI: Railway deploy ${status} — ${serviceName}`,
      `Railway reported a ${status} event for ${serviceName}.\n\nFull payload:\n${JSON.stringify(payload, null, 2)}`
    );
  }

  // Always 200 — Railway doesn't need to know or care whether this was a
  // failure event we alerted on; it just needs confirmation the webhook
  // was received.
  res.sendStatus(200);
});
