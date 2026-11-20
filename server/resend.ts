import crypto from 'node:crypto';
import { platformRuntime } from './memoryStore.ts';
import type { EmailDeliverabilityDiagnostics } from '../src/types/events.ts';

export const DEFAULT_APP_URL = (
  process.env.APP_URL || 'https://www.eventsbyyou.xyz'
).replace(/\/+$/, '');
export const DEFAULT_DOMAIN_FROM = 'Events App <hello@eventsbyyou.xyz>';
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
  defaultReplyTo?: string;
}

interface ResendDomainRecord {
  id: string;
  name: string;
  status: string;
}

let cachedResendDomains: { fetchedAt: number; domains: ResendDomainRecord[]; error?: string } | null =
  null;
const DOMAIN_CACHE_TTL_MS = 60 * 1000;

export function extractEmailAddress(input: string): string | null {
  const angleMatch = input.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const trimmed = input.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

export function extractEmailDomain(input: string): string {
  const addr = extractEmailAddress(input);
  if (!addr) return '';
  return (addr.split('@')[1] || '').toLowerCase();
}

function getHostnameFromUrl(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isFreeWebmailSender(fromValue: string): boolean {
  const domain = extractEmailDomain(fromValue);
  if (!domain) return false;
  return FREE_WEBMAIL_DOMAINS.has(domain);
}

export function getResendConfig(): ResendConfig {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const configuredFrom = (process.env.RESEND_FROM_EMAIL || '').trim();
  const shouldUseDefaultDomain = !configuredFrom || isFreeWebmailSender(configuredFrom);
  const explicitReplyTo = (process.env.RESEND_REPLY_TO || '').trim();
  const creatorEmail = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim();
  const defaultReplyTo =
    explicitReplyTo && explicitReplyTo.includes('@')
      ? explicitReplyTo
      : creatorEmail && creatorEmail.includes('@')
        ? creatorEmail
        : undefined;

  return {
    apiKey,
    fromEmail: shouldUseDefaultDomain ? DEFAULT_DOMAIN_FROM : configuredFrom,
    configuredFromEmail: configuredFrom,
    usesFallbackSender: Boolean(configuredFrom && shouldUseDefaultDomain),
    configured: Boolean(apiKey),
    defaultReplyTo,
  };
}

export function isResendConfigured(): boolean {
  return getResendConfig().configured;
}

async function listResendDomainsCached(
  apiKey: string,
  forceRefresh = false
): Promise<{ domains: ResendDomainRecord[]; error?: string }> {
  const now = Date.now();
  if (!forceRefresh && cachedResendDomains && now - cachedResendDomains.fetchedAt < DOMAIN_CACHE_TTL_MS) {
    return { domains: cachedResendDomains.domains, error: cachedResendDomains.error };
  }
  try {
    const resp = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const raw = await resp.text();
    let parsed: { data?: ResendDomainRecord[]; message?: string } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as { data?: ResendDomainRecord[]; message?: string }) : {};
    } catch {
      parsed = { message: raw };
    }
    if (!resp.ok) {
      const result = {
        domains: [] as ResendDomainRecord[],
        error: parsed.message || `Resend domains check HTTP ${resp.status}`,
      };
      cachedResendDomains = { fetchedAt: now, ...result };
      return result;
    }
    const domains = Array.isArray(parsed.data) ? parsed.data : [];
    const result = { domains };
    cachedResendDomains = { fetchedAt: now, ...result };
    return result;
  } catch (err) {
    const result = {
      domains: [] as ResendDomainRecord[],
      error: err instanceof Error ? err.message : 'Unable to reach Resend domains API',
    };
    cachedResendDomains = { fetchedAt: now, ...result };
    return result;
  }
}

async function resolveOptimalVerifiedFrom(config: ResendConfig): Promise<{
  fromEmail: string;
  verifiedDomains: string[];
  domainVerified: boolean;
  usingSharedSandboxSender: boolean;
  dnsError?: string;
}> {
  if (!config.apiKey) {
    return {
      fromEmail: config.fromEmail,
      verifiedDomains: [],
      domainVerified: false,
      usingSharedSandboxSender: false,
    };
  }

  const { domains, error } = await listResendDomainsCached(config.apiKey);
  const verifiedDomains = domains
    .filter((d) => String(d.status).toLowerCase() === 'verified')
    .map((d) => d.name.toLowerCase());

  if (error) {
    // If Resend key lacks domain-read permissions (send-only restricted key), try configured/default From cleanly
    return {
      fromEmail: config.fromEmail,
      verifiedDomains,
      domainVerified: !isFreeWebmailSender(config.fromEmail),
      usingSharedSandboxSender: extractEmailDomain(config.fromEmail) === 'resend.dev',
      dnsError: error,
    };
  }

  const desiredDomain = extractEmailDomain(config.fromEmail);
  if (desiredDomain && verifiedDomains.includes(desiredDomain)) {
    return {
      fromEmail: config.fromEmail,
      verifiedDomains,
      domainVerified: true,
      usingSharedSandboxSender: false,
    };
  }

  // If desired domain (e.g. eventsbyyou.xyz) isn't verified yet, automatically pick another verified custom domain on this Resend account instead of falling back to shared onboarding@resend.dev
  if (verifiedDomains.length > 0) {
    const chosenDomain = verifiedDomains[0];
    return {
      fromEmail: `Events App <hello@${chosenDomain}>`,
      verifiedDomains,
      domainVerified: true,
      usingSharedSandboxSender: false,
    };
  }

  // Only fall back to shared sandbox if zero custom domains are verified on Resend
  return {
    fromEmail: config.fromEmail,
    verifiedDomains: [],
    domainVerified: false,
    usingSharedSandboxSender: extractEmailDomain(config.fromEmail) === 'resend.dev',
  };
}

export async function getEmailDeliverabilityDiagnostics(
  forceRefresh = false
): Promise<EmailDeliverabilityDiagnostics> {
  const cfg = getResendConfig();
  if (!cfg.configured) {
    return {
      resendConfigured: false,
      activeFrom: 'Supabase Default Shared SMTP (noreply@mail.app.supabase.io)',
      replyTo: cfg.defaultReplyTo,
      domainName: getHostnameFromUrl(DEFAULT_APP_URL) || 'eventsbyyou.xyz',
      domainVerified: false,
      usingSharedSandboxSender: true,
      usingSupabaseFallback: true,
      verifiedDomains: [],
      dnsStatus: 'unconfigured',
      recommendation:
        'RESEND_API_KEY is missing. Emails currently route via Supabase default shared SMTP or fail, which causes Gmail/Outlook Spam filtering. Add RESEND_API_KEY and verify SPF + DKIM + DMARC on your sending domain in Resend.',
    };
  }

  const { domains, error } = await listResendDomainsCached(cfg.apiKey, forceRefresh);
  const verifiedDomains = domains
    .filter((d) => String(d.status).toLowerCase() === 'verified')
    .map((d) => d.name.toLowerCase());
  const configuredDomain = extractEmailDomain(cfg.fromEmail) || 'eventsbyyou.xyz';

  const hasVerifiedCustom = verifiedDomains.length > 0;
  const targetVerified = verifiedDomains.includes(configuredDomain) || hasVerifiedCustom;
  const activeDomain = verifiedDomains.includes(configuredDomain)
    ? configuredDomain
    : verifiedDomains[0] || configuredDomain;
  const activeFrom = verifiedDomains.includes(configuredDomain)
    ? cfg.fromEmail
    : verifiedDomains[0]
      ? `Events App <hello@${verifiedDomains[0]}>`
      : DEFAULT_RESEND_FROM;

  let recommendation = 'Custom domain SPF + DKIM verified in Resend with transactional headers active.';
  let dnsStatus: EmailDeliverabilityDiagnostics['dnsStatus'] = 'verified';

  if (error) {
    dnsStatus = 'pending';
    recommendation = `Resend API key active, but domain status check returned: ${error}. Ensure SPF, DKIM, and DMARC records are verified for ${configuredDomain} at https://resend.com/domains and set RESEND_FROM_EMAIL.`;
  } else if (!targetVerified) {
    dnsStatus = 'pending';
    recommendation = `Domain "${configuredDomain}" is not verified in Resend yet (${domains.length} domain(s) listed). Verify SPF + DKIM + DMARC DNS records at https://resend.com/domains to stop emails landing in Spam and lift onboarding@resend.dev recipient restrictions.`;
  }

  return {
    resendConfigured: true,
    activeFrom,
    replyTo: cfg.defaultReplyTo,
    domainName: activeDomain,
    domainVerified: targetVerified,
    usingSharedSandboxSender: !targetVerified,
    usingSupabaseFallback: false,
    verifiedDomains,
    dnsStatus,
    recommendation,
  };
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
  fromUsed?: string;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
}

function shouldIncludeAppUrlLink(fromAddress: string): boolean {
  const fromDomain = extractEmailDomain(fromAddress);
  const appDomain = getHostnameFromUrl(DEFAULT_APP_URL);
  if (!fromDomain || fromDomain === 'resend.dev') return false;
  if (!appDomain) return true;
  return fromDomain === appDomain || fromDomain.endsWith(`.${appDomain}`) || appDomain.endsWith(`.${fromDomain}`);
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
    headers: {
      'X-Entity-Ref-ID': crypto.randomUUID(),
      'Auto-Submitted': 'auto-generated',
    },
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
  params: SendResendEmailParams,
  renderWithEffectiveFrom?: (effectiveFrom: string) => { html: string; text?: string }
): Promise<SendResendEmailResult> {
  const cfg = getResendConfig();
  if (!cfg.configured) {
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

  const resolvedDomain = await resolveOptimalVerifiedFrom(cfg);
  const initialFrom = resolvedDomain.fromEmail;
  const fallbackReplyTo =
    (cfg.usesFallbackSender ? extractEmailAddress(cfg.configuredFromEmail) || undefined : undefined) ||
    cfg.defaultReplyTo;

  const initialRendered = renderWithEffectiveFrom ? renderWithEffectiveFrom(initialFrom) : null;
  const firstParams: SendResendEmailParams = initialRendered
    ? { ...params, html: initialRendered.html, text: initialRendered.text ?? params.text }
    : params;

  try {
    let usedFrom = initialFrom;
    let attempt = await sendResendRequest(cfg.apiKey, initialFrom, recipients, firstParams, fallbackReplyTo);

    // If custom domain isn't verified in Resend yet, retry once via onboarding@resend.dev WITHOUT domain-mismatched body links
    if (
      !attempt.ok &&
      initialFrom !== DEFAULT_RESEND_FROM &&
      (attempt.message || '').toLowerCase().includes('domain is not verified')
    ) {
      usedFrom = DEFAULT_RESEND_FROM;
      const customReplyTo = fallbackReplyTo || extractEmailAddress(initialFrom) || undefined;
      const sandboxRendered = renderWithEffectiveFrom
        ? renderWithEffectiveFrom(DEFAULT_RESEND_FROM)
        : null;
      const retryParams: SendResendEmailParams = sandboxRendered
        ? { ...params, html: sandboxRendered.html, text: sandboxRendered.text ?? params.text }
        : params;
      attempt = await sendResendRequest(
        cfg.apiKey,
        DEFAULT_RESEND_FROM,
        recipients,
        retryParams,
        customReplyTo
      );
    }

    if (!attempt.ok) {
      const rawReason = attempt.message || `Resend API returned HTTP ${attempt.status}`;
      const lower = rawReason.toLowerCase();
      let friendlyReason = rawReason;

      if (lower.includes('only send testing emails to your own email address')) {
        friendlyReason =
          'Resend domain is not verified yet and is in onboarding@resend.dev testing mode (which only delivers to your own Resend account email). Add and verify your sending domain at https://resend.com/domains to email any recipient without landing in Spam.';
      } else if (lower.includes('domain is not verified')) {
        friendlyReason =
          `${rawReason} Add and verify your sending domain (SPF, DKIM, DMARC) at https://resend.com/domains and set RESEND_FROM_EMAIL.`;
      }

      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://api.resend.com/emails',
        statusCode: attempt.status,
        reason: friendlyReason,
        payloadPreview: JSON.stringify({ to: recipients, subject: params.subject, from: usedFrom }),
        expectedDiff: 'Expected HTTP 200 OK from Resend Emails API',
      });

      return {
        ok: false,
        fromUsed: usedFrom,
        statusCode: attempt.status,
        error: friendlyReason,
      };
    }

    return {
      ok: true,
      id: attempt.id,
      fromUsed: usedFrom,
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
  dualChannelSms?: boolean;
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
      ? 'Verify your Events App account'
      : params.purpose === 'recovery'
        ? 'Reset your Events App password'
        : 'Your Events App sign-in code';

  const intro =
    params.purpose === 'signup'
      ? params.dualChannelSms
        ? 'Use the 6-digit verification code below (also sent to your mobile phone via SMS) to confirm your Events App account.'
        : 'Use the 6-digit verification code below to confirm your Events App account.'
      : params.purpose === 'recovery'
        ? params.dualChannelSms
          ? 'Use the 6-digit recovery code below (also sent via SMS) or your recovery link to regain access to your Events App account.'
          : 'Use the recovery link or 6-digit verification code below to regain access to your Events App account.'
        : params.dualChannelSms
          ? 'Enter this 6-digit verification code (also sent to your mobile phone via SMS) to sign in to Events App.'
          : 'Enter this 6-digit verification code to sign in to Events App.';

  const preheaderText = params.code
    ? `Your Events App 6-digit code is ${params.code}. It expires in 10 minutes.`
    : heading;

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

  const renderContent = (effectiveFrom: string) => {
    const includeBrandUrl = shouldIncludeAppUrlLink(effectiveFrom);
    const appHost = getHostnameFromUrl(DEFAULT_APP_URL) || 'eventsbyyou.xyz';
    const actionButtonHtml =
      params.actionLink && includeBrandUrl
        ? `
      <div style="margin:20px 0 8px 0;">
        <a href="${escapeHtml(params.actionLink)}" style="display:inline-block;padding:12px 24px;background:#0B0B0B;color:#FFFFFF;text-decoration:none;border-radius:9999px;font-size:13px;font-weight:600;">
          ${buttonLabel}
        </a>
      </div>
    `
        : '';

    const footerLine = includeBrandUrl
      ? `This code expires in 10 minutes. If you did not request this email, you can safely ignore it. Sent by Events App (<a href="${escapeHtml(DEFAULT_APP_URL)}" style="color:#0B0B0B;text-decoration:underline;">${escapeHtml(appHost)}</a>).`
      : 'This code expires in 10 minutes. If you did not request this email, you can safely ignore it. Sent by Events App.';

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0B0B0B;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheaderText)}</span>
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
        ${footerLine}
      </p>
    </div>
  </body>
</html>`.trim();

    const textParts = [
      recipientName,
      '',
      intro,
      params.code ? `\nVerification code: ${params.code}` : '',
      '\nThis code expires in 10 minutes.',
      params.actionLink && includeBrandUrl ? `\nDirect link: ${params.actionLink}` : '',
      `\nIf you did not request this code, please ignore this email.`,
      includeBrandUrl ? `Events App · ${DEFAULT_APP_URL}` : 'Events App',
    ].filter(Boolean);

    return { html, text: textParts.join('\n') };
  };

  const initial = renderContent(getResendConfig().fromEmail);
  return dispatchResendEmail(
    {
      to: params.to,
      subject,
      html: initial.html,
      text: initial.text,
      tags: [{ name: 'category', value: `auth_${params.purpose}` }],
    },
    renderContent
  );
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
  customMessage?: string;
  cameraUrl?: string;
}): Promise<SendResendEmailResult> {
  const subject = `Your pass for ${params.eventTitle} (${params.ticketCode})`;
  const preheaderText = `${params.tier} Pass ${params.ticketCode} for ${params.eventTitle} · ${params.eventDate}`;

  const renderContent = (effectiveFrom: string) => {
    const includeBrandUrl = shouldIncludeAppUrlLink(effectiveFrom);
    const appHost = getHostnameFromUrl(DEFAULT_APP_URL) || 'eventsbyyou.xyz';
    const poweredByHtml = includeBrandUrl
      ? ` · Events App (<a href="${escapeHtml(DEFAULT_APP_URL)}" style="color:#0B0B0B;text-decoration:underline;">${escapeHtml(appHost)}</a>)`
      : ' · Events App';

    const cameraBlockHtml = params.cameraUrl
      ? `
      <div style="margin:20px 0 0 0;padding:18px 20px;background:#F5F5F7;border:1px solid #E5E5EA;border-radius:16px;">
        <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#0B0B0B;">
          35mm Event Disposable Camera (5 Photos Per Guest)
        </p>
        <p style="margin:0 0 14px 0;font-size:12px;line-height:1.5;color:#444748;">
          Capture up to 5 candid shots on the shared event roll and turn pictures into a downloadable collage.
        </p>
        <a href="${escapeHtml(params.cameraUrl)}" style="display:inline-block;padding:10px 18px;background:#0B0B0B;color:#FFFFFF;text-decoration:none;border-radius:9999px;font-size:12px;font-weight:700;">
          Open Disposable Camera
        </a>
      </div>`
      : '';

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0B0B0B;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheaderText)}</span>
    <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border-radius:24px;padding:32px;border:1px solid #E5E5EA;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#0B0B0B;color:#FFFFFF;border-radius:9999px;font-weight:700;font-size:13px;vertical-align:middle;">E</span>
        <span style="margin-left:8px;font-weight:700;font-size:15px;vertical-align:middle;color:#0B0B0B;">Events App · Digital Pass</span>
      </div>
      <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;font-weight:700;color:#0B0B0B;">
        You&apos;re confirmed for ${escapeHtml(params.eventTitle)}
      </h1>
      <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#444748;">
        ${escapeHtml(params.customMessage?.trim() || `Hi ${params.attendeeName}, present the QR token code below at gate check-in.`)}
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
      ${cameraBlockHtml}
      <p style="margin:20px 0 0 0;padding-top:16px;border-top:1px solid #E5E5EA;font-size:12px;line-height:1.5;color:#71717A;">
        Need help? Reply directly to reach ${escapeHtml(params.organizerName)}${poweredByHtml}.
      </p>
    </div>
  </body>
</html>`.trim();

    const text = [
      `You're confirmed for ${params.eventTitle}!`,
      params.customMessage?.trim() ? `\n${params.customMessage.trim()}` : '',
      `Attendee: ${params.attendeeName}`,
      `Pass Tier: ${params.tier}`,
      `Gate Token Code: ${params.ticketCode}`,
      `Date & Time: ${params.eventDate} · ${params.eventTime}`,
      `Venue: ${params.eventVenue}, ${params.eventCity}`,
      `Hosted by: ${params.organizerName}`,
      params.cameraUrl ? `\nDisposable Camera (5 photos + collage): ${params.cameraUrl}` : '',
      ``,
      includeBrandUrl ? `Events App · ${DEFAULT_APP_URL}` : 'Events App',
    ]
      .filter(Boolean)
      .join('\n');

    return { html, text };
  };

  const initial = renderContent(getResendConfig().fromEmail);
  return dispatchResendEmail(
    {
      to: params.to,
      subject,
      html: initial.html,
      text: initial.text,
      replyTo: params.replyTo,
      tags: [{ name: 'category', value: 'event_pass' }],
    },
    renderContent
  );
}

export async function sendCheckInWelcomeEmail(params: {
  to: string;
  attendeeName: string;
  eventTitle: string;
  eventDate: string;
  eventVenue: string;
  eventCity: string;
  ticketCode: string;
  organizerName: string;
  welcomeMessage: string;
  cameraUrl: string;
  replyTo?: string;
}): Promise<SendResendEmailResult> {
  const subject = `Checked In: Welcome to ${params.eventTitle}`;
  const preheaderText = `You're checked in! Open the shared disposable camera (5 shots + collage) for ${params.eventTitle}.`;

  const renderContent = (effectiveFrom: string) => {
    const includeBrandUrl = shouldIncludeAppUrlLink(effectiveFrom);
    const appHost = getHostnameFromUrl(DEFAULT_APP_URL) || 'eventsbyyou.xyz';
    const poweredByHtml = includeBrandUrl
      ? ` · Events App (<a href="${escapeHtml(DEFAULT_APP_URL)}" style="color:#0B0B0B;text-decoration:underline;">${escapeHtml(appHost)}</a>)`
      : ' · Events App';

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0B0B0B;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheaderText)}</span>
    <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border-radius:24px;padding:32px;border:1px solid #E5E5EA;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#0B0B0B;color:#FFFFFF;border-radius:9999px;font-weight:700;font-size:13px;vertical-align:middle;">E</span>
        <span style="margin-left:8px;font-weight:700;font-size:15px;vertical-align:middle;color:#0B0B0B;">Events App · Gate Check-In</span>
      </div>
      <h1 style="margin:0 0 10px 0;font-size:22px;line-height:1.25;font-weight:700;color:#0B0B0B;">
        Welcome to ${escapeHtml(params.eventTitle)}, ${escapeHtml(params.attendeeName)}!
      </h1>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.65;color:#1A1C1D;background:#F5F5F7;padding:16px 18px;border-radius:16px;">
        ${escapeHtml(params.welcomeMessage)}
      </p>
      <div style="margin:20px 0;padding:24px;background:#0B0B0B;color:#FFFFFF;border-radius:20px;text-align:center;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#A1A1AA;">
          Shared Disposable Camera · 5 Photos Per Guest
        </p>
        <p style="margin:0 0 18px 0;font-size:13px;line-height:1.5;color:#E4E4E7;">
          Snap up to 5 analog moments and turn them into a photo collage from ${escapeHtml(params.eventTitle)}.
        </p>
        <a href="${escapeHtml(params.cameraUrl)}" style="display:inline-block;padding:12px 24px;background:#FFFFFF;color:#0B0B0B;text-decoration:none;border-radius:9999px;font-size:13px;font-weight:700;">
          Open Disposable Camera
        </a>
      </div>
      <div style="font-size:12px;line-height:1.7;color:#71717A;">
        <div><strong>Pass Code:</strong> ${escapeHtml(params.ticketCode)}</div>
        <div><strong>Venue:</strong> ${escapeHtml(params.eventVenue)}, ${escapeHtml(params.eventCity)} · ${escapeHtml(params.eventDate)}</div>
      </div>
      <p style="margin:20px 0 0 0;padding-top:16px;border-top:1px solid #E5E5EA;font-size:12px;line-height:1.5;color:#71717A;">
        Hosted by ${escapeHtml(params.organizerName)}${poweredByHtml}.
      </p>
    </div>
  </body>
</html>`.trim();

    const text = [
      `Welcome to ${params.eventTitle}, ${params.attendeeName}!`,
      ``,
      params.welcomeMessage,
      ``,
      `Open Disposable Camera (5 shots + collage): ${params.cameraUrl}`,
      `Pass Code: ${params.ticketCode}`,
      `Venue: ${params.eventVenue}, ${params.eventCity} · ${params.eventDate}`,
      includeBrandUrl ? `Events App · ${DEFAULT_APP_URL}` : 'Events App',
    ].join('\n');

    return { html, text };
  };

  const initial = renderContent(getResendConfig().fromEmail);
  return dispatchResendEmail(
    {
      to: params.to,
      subject,
      html: initial.html,
      text: initial.text,
      replyTo: params.replyTo,
      tags: [{ name: 'category', value: 'event_checkin' }],
    },
    renderContent
  );
}
