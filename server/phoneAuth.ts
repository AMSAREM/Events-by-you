import crypto from 'node:crypto';
import type { AppRole } from '../src/types/events.ts';
import { isResendConfigured, sendAuthOtpEmail } from './resend.ts';
import { platformRuntime } from './memoryStore.ts';

export type PhoneOtpPurpose = 'signup' | 'login' | 'recovery';

interface PhoneOtpChallenge {
  phone: string;
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
const otpChallenges = new Map<string, PhoneOtpChallenge>();
const pendingSignupsByPhone = new Map<string, PendingSignupRecord>();

export function stagePendingSignup(record: Omit<PendingSignupRecord, 'createdAt' | 'expiresAt'>): PendingSignupRecord {
  const now = Date.now();
  const staged: PendingSignupRecord = {
    ...record,
    createdAt: now,
    expiresAt: now + SIGNUP_TTL_MS,
  };
  pendingSignupsByPhone.set(record.phone, staged);
  return staged;
}

export function getPendingSignup(normalizedPhone: string): PendingSignupRecord | null {
  const rec = pendingSignupsByPhone.get(normalizedPhone);
  if (!rec) return null;
  if (Date.now() > rec.expiresAt) {
    pendingSignupsByPhone.delete(normalizedPhone);
    return null;
  }
  return rec;
}

export function consumePendingSignup(normalizedPhone: string): PendingSignupRecord | null {
  const rec = getPendingSignup(normalizedPhone);
  if (rec) {
    pendingSignupsByPhone.delete(normalizedPhone);
  }
  return rec;
}

export function clearPendingSignup(normalizedPhone: string): void {
  pendingSignupsByPhone.delete(normalizedPhone);
  otpChallenges.delete(normalizedPhone);
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

function hashOtpCode(phone: string, code: string): string {
  return crypto.createHash('sha256').update(`${phone.trim()}:${code.trim()}`).digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function issuePhoneOtp(
  normalizedPhone: string,
  purpose: PhoneOtpPurpose
): { code: string; expiresAt: number } {
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  otpChallenges.set(normalizedPhone, {
    phone: normalizedPhone,
    codeHash: hashOtpCode(normalizedPhone, code),
    purpose,
    expiresAt,
    issuedAt: now,
    attempts: 0,
  });
  return { code, expiresAt };
}

export function verifyPhoneOtp(
  normalizedPhone: string,
  token: string
): { ok: true; purpose: PhoneOtpPurpose } | { ok: false; error: string } {
  const cleanCode = token.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Enter a valid 6-digit verification code.' };
  }
  const challenge = otpChallenges.get(normalizedPhone);
  if (!challenge) {
    return {
      ok: false,
      error: 'No active SMS verification code found for this number. Request a new 6-digit code.',
    };
  }
  if (Date.now() > challenge.expiresAt) {
    otpChallenges.delete(normalizedPhone);
    return { ok: false, error: 'Verification code has expired. Request a new 6-digit SMS code.' };
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    otpChallenges.delete(normalizedPhone);
    return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit SMS code.' };
  }

  const candidateHash = hashOtpCode(normalizedPhone, cleanCode);
  if (!safeHexEqual(candidateHash, challenge.codeHash)) {
    challenge.attempts += 1;
    const remaining = MAX_OTP_ATTEMPTS - challenge.attempts;
    if (remaining <= 0) {
      otpChallenges.delete(normalizedPhone);
      return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit SMS code.' };
    }
    return {
      ok: false,
      error: `Invalid 6-digit verification code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`,
    };
  }

  otpChallenges.delete(normalizedPhone);
  return { ok: true, purpose: challenge.purpose };
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

export async function dispatchPhoneVerificationChallenge(params: {
  phone: string;
  email?: string;
  purpose: PhoneOtpPurpose;
  name?: string;
  senderId?: string;
  allowSandboxFallback?: boolean;
}): Promise<{
  ok: boolean;
  provider?: 'arkesel' | 'resend' | 'sandbox';
  channel?: 'sms' | 'email';
  error?: string;
}> {
  const { code } = issuePhoneOtp(params.phone, params.purpose);

  if (isArkeselConfigured()) {
    const smsResult = await sendArkeselSmsOtp({
      phone: params.phone,
      code,
      purpose: params.purpose,
      senderId: params.senderId,
    });
    if (smsResult.ok) {
      return { ok: true, provider: 'arkesel', channel: 'sms' };
    }
    if (params.email && !isSyntheticPhoneEmail(params.email) && isResendConfigured()) {
      const emailRes = await sendAuthOtpEmail({
        to: params.email,
        code,
        purpose: params.purpose,
        name: params.name,
      });
      if (emailRes.ok) {
        return { ok: true, provider: 'resend', channel: 'email' };
      }
    }
    return {
      ok: false,
      error: `Arkesel could not send SMS verification code: ${smsResult.error || 'Unknown gateway error'}`,
    };
  }

  if (params.email && !isSyntheticPhoneEmail(params.email) && isResendConfigured()) {
    const emailRes = await sendAuthOtpEmail({
      to: params.email,
      code,
      purpose: params.purpose,
      name: params.name,
    });
    if (emailRes.ok) {
      return { ok: true, provider: 'resend', channel: 'email' };
    }
    return {
      ok: false,
      error: `Could not dispatch verification code via SMS (ARKESEL_API_KEY missing) or Resend (${emailRes.error || 'Unknown error'}).`,
    };
  }

  if (params.allowSandboxFallback) {
    return { ok: true, provider: 'sandbox', channel: 'sms' };
  }

  return {
    ok: false,
    error:
      'SMS verification gateway (ARKESEL_API_KEY) is not configured yet. Add ARKESEL_API_KEY in environment Secrets to send phone OTPs.',
  };
}
