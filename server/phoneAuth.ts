import crypto from 'node:crypto';
import type { AppRole } from '../src/types/events.ts';
import { isResendConfigured, sendAuthOtpEmail } from './resend.ts';
import { platformRuntime } from './memoryStore.ts';

export type PhoneOtpPurpose = 'signup' | 'login' | 'recovery';

interface AuthOtpChallenge {
  phone?: string;
  email?: string;
  codeHash: string;
  purpose: PhoneOtpPurpose;
  expiresAt: number;
  issuedAt: number;
  attempts: number;
}

export interface PendingSignupRecord {
  phone: string;
  email: string;
  password: string;
  name: string;
  studio: string;
  countryGateway: string;
  appRole: Extract<AppRole, 'organizer' | 'gate_staff'>;
  createdAt: number;
  expiresAt: number;
}

const OTP_TTL_MS = 10 * 60 * 1000;
const SIGNUP_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const otpChallenges = new Map<string, AuthOtpChallenge>();
const pendingSignupsByPhone = new Map<string, PendingSignupRecord>();
const pendingSignupsByEmail = new Map<string, PendingSignupRecord>();

function normalizeEmailKey(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

function phoneChallengeKey(phone: string): string {
  return `phone:${phone.trim()}`;
}

function emailChallengeKey(email: string): string {
  return `email:${normalizeEmailKey(email)}`;
}

export function stagePendingSignup(
  record: Omit<PendingSignupRecord, 'createdAt' | 'expiresAt'>
): PendingSignupRecord {
  const now = Date.now();
  const staged: PendingSignupRecord = {
    ...record,
    email: normalizeEmailKey(record.email),
    createdAt: now,
    expiresAt: now + SIGNUP_TTL_MS,
  };
  pendingSignupsByPhone.set(staged.phone, staged);
  if (staged.email && !isSyntheticPhoneEmail(staged.email)) {
    pendingSignupsByEmail.set(staged.email, staged);
  }
  return staged;
}

export function getPendingSignup(
  identifier: string | { phone?: string; email?: string }
): PendingSignupRecord | null {
  const phone = typeof identifier === 'string' ? identifier : identifier.phone || '';
  const email = typeof identifier === 'string' ? '' : normalizeEmailKey(identifier.email);

  const rec =
    (phone ? pendingSignupsByPhone.get(phone) : undefined) ||
    (email ? pendingSignupsByEmail.get(email) : undefined);
  if (!rec) return null;
  if (Date.now() > rec.expiresAt) {
    pendingSignupsByPhone.delete(rec.phone);
    if (rec.email) pendingSignupsByEmail.delete(rec.email);
    return null;
  }
  return rec;
}

export function consumePendingSignup(
  identifier: string | { phone?: string; email?: string }
): PendingSignupRecord | null {
  const rec = getPendingSignup(identifier);
  if (rec) {
    pendingSignupsByPhone.delete(rec.phone);
    if (rec.email) pendingSignupsByEmail.delete(rec.email);
  }
  return rec;
}

export function clearPendingSignup(
  identifier: string | { phone?: string; email?: string }
): void {
  const phone = typeof identifier === 'string' ? identifier : identifier.phone || '';
  const email = typeof identifier === 'string' ? '' : normalizeEmailKey(identifier.email);
  const rec =
    (phone ? pendingSignupsByPhone.get(phone) : undefined) ||
    (email ? pendingSignupsByEmail.get(email) : undefined);

  if (phone) {
    pendingSignupsByPhone.delete(phone);
    otpChallenges.delete(phoneChallengeKey(phone));
  }
  if (email) {
    pendingSignupsByEmail.delete(email);
    otpChallenges.delete(emailChallengeKey(email));
  }
  if (rec) {
    pendingSignupsByPhone.delete(rec.phone);
    otpChallenges.delete(phoneChallengeKey(rec.phone));
    if (rec.email) {
      pendingSignupsByEmail.delete(rec.email);
      otpChallenges.delete(emailChallengeKey(rec.email));
    }
  }
}

export function isArkeselConfigured(): boolean {
  return Boolean((process.env.ARKESEL_API_KEY || '').trim());
}

export function isSyntheticPhoneEmail(email?: string | null): boolean {
  if (!email) return false;
  return /^u_[a-f0-9]+@phone\.eventsbyyou\.xyz$/i.test(email.trim());
}

export function buildSyntheticPhoneEmail(normalizedPhone: string): string {
  const digest = crypto.createHash('sha256').update(normalizedPhone.trim()).digest('hex').slice(0, 14);
  return `u_${digest}@phone.eventsbyyou.xyz`;
}

function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(`otp:${code.trim()}`).digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function deleteChallengeEntries(challenge: AuthOtpChallenge): void {
  if (challenge.phone) otpChallenges.delete(phoneChallengeKey(challenge.phone));
  if (challenge.email) otpChallenges.delete(emailChallengeKey(challenge.email));
}

export function hasActiveAuthChallenge(params: { phone?: string; email?: string }): boolean {
  const now = Date.now();
  const byPhone = params.phone ? otpChallenges.get(phoneChallengeKey(params.phone)) : undefined;
  const byEmail = params.email ? otpChallenges.get(emailChallengeKey(params.email)) : undefined;
  const challenge = byPhone || byEmail;
  if (!challenge) return false;
  if (now > challenge.expiresAt) {
    deleteChallengeEntries(challenge);
    return false;
  }
  return true;
}

export function issueAuthOtp(params: {
  phone?: string;
  email?: string;
  purpose: PhoneOtpPurpose;
}): { code: string; expiresAt: number } {
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  const cleanPhone = params.phone?.trim() || undefined;
  const cleanEmail =
    params.email && !isSyntheticPhoneEmail(params.email)
      ? normalizeEmailKey(params.email)
      : undefined;

  const challenge: AuthOtpChallenge = {
    phone: cleanPhone,
    email: cleanEmail,
    codeHash: hashOtpCode(code),
    purpose: params.purpose,
    expiresAt,
    issuedAt: now,
    attempts: 0,
  };

  if (cleanPhone) otpChallenges.set(phoneChallengeKey(cleanPhone), challenge);
  if (cleanEmail) otpChallenges.set(emailChallengeKey(cleanEmail), challenge);
  return { code, expiresAt };
}

export function issuePhoneOtp(
  normalizedPhone: string,
  purpose: PhoneOtpPurpose
): { code: string; expiresAt: number } {
  return issueAuthOtp({ phone: normalizedPhone, purpose });
}

export function verifyAuthOtp(params: {
  phone?: string;
  email?: string;
  token: string;
}): { ok: true; purpose: PhoneOtpPurpose; phone?: string; email?: string } | { ok: false; error: string } {
  const cleanCode = params.token.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Enter a valid 6-digit verification code.' };
  }

  const byPhone = params.phone?.trim()
    ? otpChallenges.get(phoneChallengeKey(params.phone.trim()))
    : undefined;
  const byEmail = params.email?.trim()
    ? otpChallenges.get(emailChallengeKey(params.email.trim()))
    : undefined;
  const challenge = byPhone || byEmail;

  if (!challenge) {
    return {
      ok: false,
      error: 'No active verification code found. Request a new 6-digit code via SMS & Email.',
    };
  }
  if (Date.now() > challenge.expiresAt) {
    deleteChallengeEntries(challenge);
    return { ok: false, error: 'Verification code has expired. Request a new 6-digit code.' };
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    deleteChallengeEntries(challenge);
    return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit code.' };
  }

  const candidateHash = hashOtpCode(cleanCode);
  if (!safeHexEqual(candidateHash, challenge.codeHash)) {
    challenge.attempts += 1;
    const remaining = MAX_OTP_ATTEMPTS - challenge.attempts;
    if (remaining <= 0) {
      deleteChallengeEntries(challenge);
      return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit code.' };
    }
    return {
      ok: false,
      error: `Invalid 6-digit verification code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`,
    };
  }

  deleteChallengeEntries(challenge);
  return {
    ok: true,
    purpose: challenge.purpose,
    phone: challenge.phone,
    email: challenge.email,
  };
}

export function verifyPhoneOtp(
  normalizedPhone: string,
  token: string
): { ok: true; purpose: PhoneOtpPurpose } | { ok: false; error: string } {
  const res = verifyAuthOtp({ phone: normalizedPhone, token });
  if (!res.ok) return res;
  return { ok: true, purpose: res.purpose };
}

export async function sendArkeselSmsOtp(params: {
  phone: string;
  code: string;
  purpose: PhoneOtpPurpose;
  senderId?: string;
}): Promise<{ ok: boolean; configured: boolean; error?: string }> {
  const apiKey = (process.env.ARKESEL_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      error: 'ARKESEL_API_KEY is not configured in environment Secrets.',
    };
  }

  const purposeText =
    params.purpose === 'signup'
      ? 'account verification'
      : params.purpose === 'recovery'
        ? 'password recovery'
        : 'workspace sign-in';

  const cleanPhone = params.phone.replace(/^\+/, '').replace(/\s+/g, '');
  const sender = (params.senderId || 'EVENTSAPP').slice(0, 11);
  const message = `Events App ${purposeText} code: ${params.code}. Valid for 10 minutes. Do not share this code.`;

  try {
    const resp = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender,
        message,
        recipients: [cleanPhone],
      }),
    });

    const rawText = await resp.text();
    let parsed: { status?: string; message?: string; code?: string } | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as { status?: string; message?: string; code?: string }) : null;
    } catch {
      parsed = null;
    }

    if (!resp.ok || parsed?.status === 'error') {
      const errMsg = parsed?.message || `Arkesel SMS API returned HTTP ${resp.status}`;
      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://sms.arkesel.com/api/v2/sms/send',
        statusCode: resp.status,
        reason: errMsg,
        payloadPreview: JSON.stringify({ phone: cleanPhone, purpose: params.purpose }),
        expectedDiff: 'Expected HTTP 200 OK from Arkesel v2 OTP dispatch',
      });
      return { ok: false, configured: true, error: errMsg };
    }

    return { ok: true, configured: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unable to reach Arkesel SMS gateway.';
    platformRuntime.recordError('arkesel-otp-sms', err);
    return { ok: false, configured: true, error: errMsg };
  }
}

export interface DualAuthDispatchResult {
  ok: boolean;
  provider?: string;
  channel?: 'both' | 'sms' | 'email';
  channels: Array<'sms' | 'email'>;
  smsSent: boolean;
  emailSent: boolean;
  smsError?: string;
  emailError?: string;
  error?: string;
}

export async function dispatchDualAuthChallenge(params: {
  phone?: string;
  email?: string;
  purpose: PhoneOtpPurpose;
  name?: string;
  senderId?: string;
  actionLink?: string;
  requireBoth?: boolean;
  allowSandboxFallback?: boolean;
}): Promise<DualAuthDispatchResult> {
  const targetPhone = params.phone?.trim() || undefined;
  const targetEmail =
    params.email && !isSyntheticPhoneEmail(params.email)
      ? normalizeEmailKey(params.email)
      : undefined;

  if (!targetPhone && !targetEmail) {
    return {
      ok: false,
      channels: [],
      smsSent: false,
      emailSent: false,
      error: 'A valid mobile phone number and/or email address is required.',
    };
  }

  const { code } = issueAuthOtp({
    phone: targetPhone,
    email: targetEmail,
    purpose: params.purpose,
  });

  const arkeselReady = Boolean(targetPhone) && isArkeselConfigured();
  const resendReady = Boolean(targetEmail) && isResendConfigured();

  const [smsRes, emailRes] = await Promise.all([
    targetPhone
      ? arkeselReady
        ? sendArkeselSmsOtp({
            phone: targetPhone,
            code,
            purpose: params.purpose,
            senderId: params.senderId,
          })
        : Promise.resolve({
            ok: false,
            configured: false,
            error: 'ARKESEL_API_KEY is not configured on the server.',
          })
      : Promise.resolve(null),
    targetEmail
      ? resendReady
        ? sendAuthOtpEmail({
            to: targetEmail,
            code,
            actionLink: params.actionLink,
            purpose: params.purpose,
            name: params.name,
            dualChannelSms: Boolean(targetPhone),
          })
        : Promise.resolve({
            ok: false,
            skipped: true,
            error: 'RESEND_API_KEY is not configured on the server.',
          })
      : Promise.resolve(null),
  ]);

  const smsSent = Boolean(smsRes?.ok);
  const emailSent = Boolean(emailRes?.ok);
  const channels: Array<'sms' | 'email'> = [];
  const providers: Array<'arkesel' | 'resend'> = [];

  if (smsSent) {
    channels.push('sms');
    providers.push('arkesel');
  }
  if (emailSent) {
    channels.push('email');
    providers.push('resend');
  }

  const smsError = smsRes && !smsRes.ok ? smsRes.error : undefined;
  const emailError = emailRes && !emailRes.ok ? emailRes.error : undefined;

  const mustSendBoth = Boolean(params.requireBoth && targetPhone && targetEmail);

  if (mustSendBoth) {
    if (smsSent && emailSent) {
      return {
        ok: true,
        provider: 'arkesel+resend',
        channel: 'both',
        channels,
        smsSent: true,
        emailSent: true,
      };
    }

    if (params.allowSandboxFallback && !isArkeselConfigured() && !isResendConfigured()) {
      return {
        ok: true,
        provider: 'sandbox',
        channel: 'both',
        channels: ['sms', 'email'],
        smsSent: true,
        emailSent: true,
      };
    }

    const failures: string[] = [];
    if (!smsSent) failures.push(`SMS (Arkesel): ${smsError || 'Failed to send SMS'}`);
    if (!emailSent) failures.push(`Email (Resend): ${emailError || 'Failed to send email'}`);
    clearPendingSignup({ phone: targetPhone, email: targetEmail });

    return {
      ok: false,
      channels,
      smsSent,
      emailSent,
      smsError,
      emailError,
      error: `Authentication verification requires both SMS and Email delivery. ${failures.join(' | ')}`,
    };
  }

  if (channels.length > 0) {
    return {
      ok: true,
      provider: providers.join('+'),
      channel: channels.length === 2 ? 'both' : channels[0],
      channels,
      smsSent,
      emailSent,
      smsError,
      emailError,
    };
  }

  if (params.allowSandboxFallback) {
    return {
      ok: true,
      provider: 'sandbox',
      channel: targetPhone && targetEmail ? 'both' : targetPhone ? 'sms' : 'email',
      channels: [
        ...(targetPhone ? (['sms'] as const) : []),
        ...(targetEmail ? (['email'] as const) : []),
      ],
      smsSent: Boolean(targetPhone),
      emailSent: Boolean(targetEmail),
    };
  }

  const failures: string[] = [];
  if (targetPhone && smsError) failures.push(`SMS: ${smsError}`);
  if (targetEmail && emailError) failures.push(`Email: ${emailError}`);

  return {
    ok: false,
    channels: [],
    smsSent: false,
    emailSent: false,
    smsError,
    emailError,
    error:
      failures.join(' | ') ||
      'Neither Arkesel SMS nor Resend email verification could be dispatched.',
  };
}

export async function dispatchPhoneVerificationChallenge(params: {
  phone: string;
  email?: string;
  purpose: PhoneOtpPurpose;
  name?: string;
  senderId?: string;
  allowSandboxFallback?: boolean;
}) {
  return dispatchDualAuthChallenge({
    ...params,
    requireBoth: Boolean(params.phone && params.email && !isSyntheticPhoneEmail(params.email)),
  });
}
