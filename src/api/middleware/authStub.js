// ============================================================================
// TEMPORARY AUTH STUB — read this before deploying anywhere but a private
// dev/UI-building environment.
//
// Per the Identity, Compliance & API Access Notes doc: every merchant-facing
// endpoint should ultimately require a valid Shopify session token, verified
// and resolved into a normalized auth context: { shopId, scopes }. That
// requires an OAuth install flow to exist first, which it doesn't yet — no
// shop has ever installed this app (Phase 2 work, not started).
//
// This stub trusts the :brand path param directly, with NO verification
// that the caller is actually authorized for that brand. That's fine for
// Charles building/testing UI screens against real Phase 1 pool data. It is
// NOT safe to expose this API publicly as-is — anyone could query any
// brand's data.
//
// TODO (Phase 2, blocks production use): replace this with real Shopify
// session token verification. The route handlers below already read from
// req.authContext rather than trusting query params directly where it
// matters (see routes/brands.js) — swapping this file out is meant to be
// the only change needed, per the "normalized auth context" design
// principle in the Access Notes doc.
// ============================================================================

export function stubAuthContext(req, res, next) {
  req.authContext = {
    shopId: null,
    scopes: ['read:inclusion', 'read:competitors', 'read:gaps', 'read:leaderboard', 'read:questions'],
  };
  next();
}
