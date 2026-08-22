// Thin wrapper around Resend's API for sending alert emails. Fails safe:
// if credentials aren't configured, logs a warning and does nothing,
// rather than throwing and potentially taking down whatever called it
// (an alert failing to send shouldn't crash the health check or the
// webhook receiver that triggered it).
//
// STATUS: UNVERIFIED — not run against a live Resend account in this
// build session (no real API key available here). Confirm with one real
// test send after deploying, same as any other unverified integration in
// this project.

import 'dotenv/config';

const RESEND_URL = 'https://api.resend.com/emails';

export async function sendAlertEmail(subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.ALERT_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // onboarding@resend.dev works immediately with zero setup, per Resend's
  // own quickstart — no domain verification needed to start. Verifying
  // citational.ai as the sending domain is a nice-to-have for later (so
  // alerts don't look like they came from a random resend.dev address),
  // not required to get this working today.
  const from = process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev';

  if (!apiKey || to.length === 0) {
    console.warn(`[email] RESEND_API_KEY or ALERT_EMAIL_TO not set — skipping alert email: "${subject}"`);
    return;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });

    if (!res.ok) {
      console.error(`[email] Resend API error ${res.status}: ${await res.text()}`);
    } else {
      console.log(`[email] alert sent: "${subject}"`);
    }
  } catch (err) {
    // Network failure sending the alert itself — log it, don't throw.
    // A failed alert-send is not a reason to crash whatever triggered it.
    console.error('[email] failed to send alert:', err.message);
  }
}
