// Shared Basic Auth header for DataForSEO — used by both the Google AI Mode
// channel (src/lib/channels/googleAiMode.js) and the search volume fetch
// (src/lib/searchVolume.js). Same account, two different DataForSEO
// products (AI Mode SERP API vs. Keyword Data API), same credentials.

export function dataforseoAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set');
  }
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${token}`;
}
