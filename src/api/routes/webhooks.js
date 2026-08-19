import { Router } from 'express';
import crypto from 'node:crypto';
import express from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';

export const webhooksRouter = Router();

// Every webhook needs the RAW request body (not JSON-parsed) to verify the
// HMAC signature correctly — parsing first and re-stringifying can produce
// a byte-for-byte different string than what Shopify signed, which would
// make every signature check fail. express.raw() here, scoped to just this
// router, keeps this independent of whatever body parser the rest of the
// API uses.
webhooksRouter.use(express.raw({ type: 'application/json' }));

function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!secret || !hmacHeader) return false;

  const digest = crypto.createHmac('sha256', secret).update(req.body).digest('base64');

  // Constant-time comparison — a plain === here would leak timing
  // information about how much of the signature matched, which is exactly
  // the kind of thing a real security boundary shouldn't do.
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireValidHmac(req, res, next) {
  if (!verifyShopifyHmac(req)) {
    return res.status(401).send('Invalid HMAC signature');
  }
  // Parse now that the signature's confirmed — req.body was the raw Buffer
  // up to this point, needed intact for the HMAC check above.
  try {
    req.body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON body');
  }
  next();
}

// ----------------------------------------------------------------------------
// customers/data_request, customers/redact: near-no-op. Per the Identity,
// Compliance & API Access Notes doc, these only fire if the app has been
// granted customer/order data access scopes — CitationalAI reads product
// catalogs and submits GMC feeds, with no product reason to ever request
// those scopes. Still registered (Shopify requires the subscription to
// exist) and still HMAC-verified, but there's genuinely nothing to redact.
// ----------------------------------------------------------------------------
webhooksRouter.post('/customers/data_request', requireValidHmac, (req, res) => {
  console.log('[webhook] customers/data_request received (near-no-op — no customer-scoped data held):', req.body);
  res.sendStatus(200);
});

webhooksRouter.post('/customers/redact', requireValidHmac, (req, res) => {
  console.log('[webhook] customers/redact received (near-no-op — no customer-scoped data held):', req.body);
  res.sendStatus(200);
});

// ----------------------------------------------------------------------------
// shop/redact: the one that needs real logic. Fires 48 hours after
// uninstall; deadline to act is 30 days from receipt. Deletes the shop row
// — existing on-delete-cascade FKs (scans, subscriptions -> shops) handle
// the rest structurally. Currently a near-op in practice too, since no real
// shop has ever installed the app (Phase 2 work) — but the deletion logic
// itself is real and correct for when that changes.
// ----------------------------------------------------------------------------
webhooksRouter.post('/shop/redact', requireValidHmac, asyncHandler(async (req, res) => {
  const { shop_domain } = req.body;
  console.log(`[webhook] shop/redact received for ${shop_domain}`);

  const { query } = await import('../../lib/db.js');
  const result = await query(`delete from shops where shopify_domain = $1`, [shop_domain]);
  console.log(`[webhook] shop/redact: deleted ${result.rowCount} shop row(s) for ${shop_domain}`);

  res.sendStatus(200);
}));
