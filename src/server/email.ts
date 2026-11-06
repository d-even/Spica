import 'server-only';

/**
 * Sign-in email through Resend's HTTP API. When RESEND_API_KEY is unset,
 * sign-in falls back to Supabase sending the email itself.
 * https://resend.com/docs/api-reference/emails/send-email
 */
const RESEND_URL = 'https://api.resend.com/emails';

export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendSignInCode(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and EMAIL_FROM must both be set.');

  // Codes are digits from Supabase, but nothing reaches HTML unescaped.
  const safeCode = code.replace(/[^0-9A-Za-z]/g, '');
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your PayGate sign-in code: ${safeCode}`,
      text: `Your PayGate sign-in code is ${safeCode}\n\nEnter it on the sign-in page. If you did not ask for this, you can ignore this email.`,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <p style="margin:0 0 16px">Your PayGate sign-in code is</p>
  <p style="margin:0 0 16px;font-size:28px;font-weight:600;letter-spacing:6px">${safeCode}</p>
  <p style="margin:0;color:#555;font-size:14px">Enter it on the sign-in page. If you did not ask for this, you can ignore this email.</p>
</div>`,
    }),
  });

  if (!response.ok) {
    // Resend's error body names the problem (unverified domain, bad key) and holds no secrets.
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
}
