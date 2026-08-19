// Express 4 doesn't natively catch a rejected promise inside an async route
// handler — it becomes an unhandled rejection, which (without a
// process-level handler) crashes the entire Node process, not just the one
// request. Caught in testing: a single DB connection error took down the
// whole server. Wrap every async route handler in this so errors are
// forwarded to Express's error middleware (server.js) instead.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
