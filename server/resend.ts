import { platformRuntime } from './memoryStore.ts';

export const DEFAULT_RESEND_FROM = 'Events App <onboarding@resend.dev>';

const FREE_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
  configuredFromEmail: string;
  usesFallbackSender: boolean;
  configured: boolean;
}

function extractEmailAddress(input: string): string | null {
  const angleMatch = input.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const trimmed = input.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function isFreeWebmailSender(fromValue: string): boolean {
  const addr = extractEmailAddress(fromValue);
  if (!addr) return false;
  const domain = addr.split('@')[1]?.toLowerCase() || '';
  return FREE_WEBMAIL_DOMAINS.has(domain);
}

export function getResendConfig(): ResendConfig {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const configuredFrom = (process.env.RESEND_FROM_EMAIL || '').trim();
  const shouldFallback = !configuredFrom || isFreeWebmailSender(configuredFrom);

  return {
    apiKey,
    fromEmail: shouldFallback ? DEFAULT_RESEND_FROM : configuredFrom,
    configuredFromEmail: configuredFrom,
    usesFallbackSender: Boolean(configuredFrom && shouldFallback),
    configured: Boolean(apiKey),
  };
}

export function isResendConfigured(): boolean {
  return getResendConfig().configured;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SendResendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendResendEmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
}

async function sendResendRequest(
  apiKey: string,
  from: string,
  recipients: string[],
  params: SendResendEmailParams,
  fallbackReplyTo?: string
): Promise<{ ok: boolean; status: number; id?: string; message?: string }> {
  const payload: Record<string, unknown> = {
    from,
    to: recipients,
    subject: params.subject,
    html: params.html,
  };

  if (params.text) {
    payload.text = params.text;
  }

  const effectiveReplyTo =
    params.replyTo && params.replyTo.includes('@')
      ? params.replyTo.trim()
      : fallbackReplyTo && fallbackReplyTo.includes('@')
        ? fallbackReplyTo.trim()
        : undefined;

  if (effectiveReplyTo) {
    payload.reply_to = effectiveReplyTo;
  }

  if (params.tags && params.tags.length > 0) {
    payload.tags = params.tags;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await resp.text();
  let parsed: { id?: string; message?: string; name?: string } = {};
  try {
    parsed = JSON.parse(rawText) as { id?: string; message?: string; name?: string };
  } catch {
    parsed = { message: rawText };
  }

  return {
    ok: resp.ok,
    status: resp.status,
    id: parsed.id,
    message: parsed.message,
  };
}

export async function dispatchResendEmail(
  params: SendResendEmailParams
): Promise<SendResendEmailResult> {
  const { apiKey, fromEmail, configuredFromEmail, usesFallbackSender, configured } = getResendConfig();
  if (!configured) {
    return {
      ok: false,
      skipped: true,
      error: 'RESEND_API_KEY is not configured on the server.',
    };
  }

  const recipients = (Array.isArray(params.to) ? params.to : [params.to])
    .map((addr) => addr.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    return { ok: false, error: 'Recipient email address is required.' };
  }

  const fallbackReplyTo = usesFallbackSender
    ? extractEmailAddress(configuredFromEmail) || undefined
    : undefined;

  try {
    let attempt = await sendResendRequest(apiKey, fromEmail, recipients, params, fallbackReplyTo);

    // If a custom domain isn't verified yet in Resend, automatically retry with onboarding@resend.dev
    if (
      !attempt.ok &&
      fromEmail !== DEFAULT_RESEND_FROM &&
      (attempt.message || '').toLowerCase().includes('domain is not verified')
    ) {
      const customReplyTo = extractEmailAddress(fromEmail) || undefined;
      attempt = await sendResendRequest(
        apiKey,
        DEFAULT_RESEND_FROM,
        recipients,
        params,
        customReplyTo
      );
    }

    if (!attempt.ok) {
      const rawReason = attempt.message || `Resend API returned HTTP ${attempt.status}`;
      const lower = rawReason.toLowerCase();
      let friendlyReason = rawReason;

      if (lower.includes('only send testing emails to your own email address')) {
        friendlyReason =
          'Resend is in testing mode (using onboarding@resend.dev), which only delivers to your own Resend account email. To email other addresses, verify a custom domain at https://resend.com/domains and set RESEND_FROM_EMAIL to an address on that domain (free @gmail.com addresses cannot be verified).';
      } else if (lower.includes('domain is not verified')) {
        friendlyReason =
          `${rawReason} Note: free webmail domains like gmail.com cannot be verified—remove RESEND_FROM_EMAIL to test with onboarding@resend.dev, or verify a custom domain at https://resend.com/domains.`;
      }

      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://api.resend.com/emails',
        statusCode: attempt.status,
        reason: friendlyReason,
        payloadPreview: JSON.stringify({ to: recipients, subject: params.subject, from: fromEmail }),
        expectedDiff: 'Expected HTTP 200 OK from Resend Emails API',
      });

      return {
        ok: false,
        statusCode: attempt.status,
        error: friendlyReason,
      };
    }

    return {
      ok: true,
      id: attempt.id,
      statusCode: attempt.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error calling Resend API.';
    platformRuntime.recordError('resend-email', err);
    return {
      ok: false,
      error: message,
    };
  }
}

export async function sendAuthOtpEmail(params: {
  to: string;
  code?: string;
  actionLink?: string;
  purpose: 'signup' | 'login' | 'recovery';
  name?: string;
}): Promise<SendResendEmailResult> {
  const recipientName = params.name?.trim() ? `Hi ${escapeHtml(params.name.trim())},` : 'Hello,';
  const heading =
    params.purpose === 'signup'
      ? 'Verify your Events App account'
      : params.purpose === 'recovery'
        ? 'Reset your Events App password'
        : 'Your Events App sign-in code';

  const subject =
    params.purpose === 'signup'
      ? params.code
        ? `Your Events App verification code: ${params.code}`
        : 'Verify your Events App account'
      : params.purpose === 'recovery'
        ? 'Reset your Events App password'
        : params.code
          ? `Your Events App sign-in code: ${params.code}`
          : 'Sign in to Events App';

  const intro =
    params.purpose === 'signup'
      ? 'Use the 6-digit verification code below to confirm your email and open your event creator studio.'
      : params.purpose === 'recovery'
        ? 'Use the recovery link or 6-digit verification code below to regain access to your Events App account.'
        : 'Enter this 6-digit verification code to sign in to Events App.';

  const codeBlockHtml = params.code
    ? `
      <div style="margin:24px 0;padding:20px;background:#F5F5F7;border-radius:16px;text-align:center;">
        <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#71717A;">
          6-Digit Verification Code
        </p>
        <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:0.22em;color:#0B0B0B;">
          ${escapeHtml(params.code)}
        </p>
      </div>
    `
    : '';

  const buttonLabel =
    params.purpose === 'recovery'
      ? 'Reset Password'
      : params.purpose === 'signup'
        ? 'Confirm Account'
        : 'Sign In';

  const actionButtonHtml = params.actionLink
    ? `
      <div style="margin:20px 0 8px 0;">
        <a href="${escapeHtml(params.actionLink)}" style="display:inline-block;padding:12px 24px;background:#0B0B0B;color:#FFFFFF;text-decoration:none;border-radius:9999px;font-size:13px;font-weight:600;">
          ${buttonLabel}
        </a>
      </div>
    `
    : '';

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0B0B0B;">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:24px;padding:32px;border:1px solid #E5E5EA;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#0B0B0B;color:#FFFFFF;border-radius:9999px;font-weight:700;font-size:13px;vertical-align:middle;">E</span>
        <span style="margin-left:8px;font-weight:700;font-size:15px;vertical-align:middle;color:#0B0B0B;">Events App</span>
      </div>
      <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.25;font-weight:700;color:#0B0B0B;">${heading}</h1>
      <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#444748;">${recipientName}</p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#444748;">${intro}</p>
      ${codeBlockHtml}
      ${actionButtonHtml}
      <p style="margin:24px 0 0 0;padding-top:16px;border-top:1px solid #E5E5EA;font-size:12px;line-height:1.5;color:#71717A;">
        This code expires in 15 minutes. If you did not request this email, you can safely ignore it.
      </p>
    </div>
  </body>
</html>`.trim();

  const textParts = [
    recipientName,
    '',
    intro,
    params.code ? `\nVerification code: ${params.code}` : '',
    params.actionLink ? `\nDirect link: ${params.actionLink}` : '',
    '\nIf you did not request this email, you can safely ignore it.',
  ].filter(Boolean);

  return dispatchResendEmail({
    to: params.to,
    subject,
    html,
    text: textParts.join('\n'),
    tags: [{ name: 'category', value: `auth_${params.purpose}` }],
  });
}

export async function sendEventPassEmail(params: {
  to: string;
  attendeeName: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
  eventCity: string;
  ticketCode: string;
  tier: string;
  organizerName: string;
  replyTo?: string;
}): Promise<SendResendEmailResult> {
  const subject = `Your pass for ${params.eventTitle} (${params.ticketCode})`;
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0B0B0B;">
    <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border-radius:24px;padding:32px;border:1px solid #E5E5EA;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#0B0B0B;color:#FFFFFF;border-radius:9999px;font-weight:700;font-size:13px;vertical-align:middle;">E</span>
        <span style="margin-left:8px;font-weight:700;font-size:15px;vertical-align:middle;color:#0B0B0B;">Events App · Digital Pass</span>
      </div>
      <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;font-weight:700;color:#0B0B0B;">
        You&apos;re confirmed for ${escapeHtml(params.eventTitle)}
      </h1>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#444748;">
        Hi ${escapeHtml(params.attendeeName)}, present the QR token code below at gate check-in.
      </p>
      <div style="margin:20px 0;padding:22px;background:#0B0B0B;color:#FFFFFF;border-radius:18px;text-align:center;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#A1A1AA;">
          ${escapeHtml(params.tier)} Pass · Gate Token
        </p>
        <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;color:#FFFFFF;">
          ${escapeHtml(params.ticketCode)}
        </p>
      </div>
      <div style="background:#F5F5F7;border-radius:16px;padding:16px 20px;font-size:13px;line-height:1.7;color:#1A1C1D;">
        <div><strong>Date:</strong> ${escapeHtml(params.eventDate)} · ${escapeHtml(params.eventTime)}</div>
        <div><strong>Venue:</strong> ${escapeHtml(params.eventVenue)}, ${escapeHtml(params.eventCity)}</div>
        <div><strong>Hosted by:</strong> ${escapeHtml(params.organizerName)}</div>
      </div>
      <p style="margin:20px 0 0 0;padding-top:16px;border-top:1px solid #E5E5EA;font-size:12px;line-height:1.5;color:#71717A;">
        Need help? Reply to this email to reach ${escapeHtml(params.organizerName)}.
      </p>
    </div>
  </body>
</html>`.trim();

  const text = [
    `You're confirmed for ${params.eventTitle}!`,
    `Attendee: ${params.attendeeName}`,
    `Pass Tier: ${params.tier}`,
    `Gate Token Code: ${params.ticketCode}`,
    `Date & Time: ${params.eventDate} · ${params.eventTime}`,
    `Venue: ${params.eventVenue}, ${params.eventCity}`,
    `Hosted by: ${params.organizerName}`,
  ].join('\n');

  return dispatchResendEmail({
    to: params.to,
    subject,
    html,
    text,
    replyTo: params.replyTo,
    tags: [{ name: 'category', value: 'event_pass' }],
  });
}
