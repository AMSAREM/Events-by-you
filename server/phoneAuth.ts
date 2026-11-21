import crypto from 'node:crypto';
import type { AppRole } from '../src/types/events.ts';
import { isResendConfigured, sendAuthOtpEmail } from './resend.ts';
import { platformRuntime } from './memoryStore.ts';
import { createServiceSupabaseClient } from './supabase.ts';

export type PhoneOtpPurpose = 'signup' | 'login' | 'recovery' | 'test';

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

function getPendingEncryptionKey(): Buffer {
  const secret =
    (
      process.env.OTP_ENCRYPTION_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.CREATOR_PASSWORD ||
      'events-app-local-otp-key'
    ).trim();
  return crypto.createHash('sha256').update(`pending-signup:${secret}`).digest();
}

function encryptPendingPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getPendingEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPendingPassword(encoded: string): string {
  if (!encoded.startsWith('v1:')) return encoded;
  const parts = encoded.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid staged signup credential payload.');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getPendingEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function assertAuthTableError(
  error: { code?: string; message?: string } | null | undefined,
  tableName: string
): void {
  if (!error) return;
  const msg = (error.message || '').toLowerCase();
  if (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table')
  ) {
    throw new Error(
      `Supabase table public.${tableName} is missing. Run the latest supabase/schema.sql in your Supabase SQL Editor.`
    );
  }
  throw new Error(error.message || `Supabase error accessing ${tableName}.`);
}

export async function stagePendingSignup(
  record: Omit<PendingSignupRecord, 'createdAt' | 'expiresAt'>
): Promise<PendingSignupRecord> {
  const now = Date.now();
  const cleanEmail = normalizeEmailKey(record.email);
  const staged: PendingSignupRecord = {
    ...record,
    email: cleanEmail,
    createdAt: now,
    expiresAt: now + SIGNUP_TTL_MS,
  };
  pendingSignupsByPhone.set(staged.phone, staged);
  if (staged.email && !isSyntheticPhoneEmail(staged.email)) {
    pendingSignupsByEmail.set(staged.email, staged);
  }

  const svc = createServiceSupabaseClient();
  if (svc) {
    const nowIso = new Date(now).toISOString();
    await svc.from('pending_signups').delete().lt('expires_at', nowIso);
    if (cleanEmail) {
      await svc.from('pending_signups').delete().eq('email', cleanEmail).neq('phone', staged.phone);
    }
    const { error } = await svc.from('pending_signups').upsert(
      {
        phone: staged.phone,
        email: cleanEmail,
        password_enc: encryptPendingPassword(staged.password),
        name: staged.name,
        studio: staged.studio,
        country_gateway: staged.countryGateway,
        app_role: staged.appRole,
        created_at: nowIso,
        expires_at: new Date(staged.expiresAt).toISOString(),
      },
      { onConflict: 'phone' }
    );
    assertAuthTableError(error, 'pending_signups');
  }

  return staged;
}

export async function getPendingSignup(
  identifier: string | { phone?: string; email?: string }
): Promise<PendingSignupRecord | null> {
  const phone = typeof identifier === 'string' ? identifier.trim() : (identifier.phone || '').trim();
  const email = typeof identifier === 'string' ? '' : normalizeEmailKey(identifier.email);

  const svc = createServiceSupabaseClient();
  if (svc) {
    let row: Record<string, unknown> | null = null;
    if (phone) {
      const { data, error } = await svc
        .from('pending_signups')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      assertAuthTableError(error, 'pending_signups');
      row = (data as Record<string, unknown> | null) ?? null;
    }
    if (!row && email) {
      const { data, error } = await svc
        .from('pending_signups')
        .select('*')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertAuthTableError(error, 'pending_signups');
      row = (data as Record<string, unknown> | null) ?? null;
    }
    if (!row) return null;

    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await svc.from('pending_signups').delete().eq('phone', String(row.phone));
      return null;
    }

    return {
      phone: String(row.phone),
      email: String(row.email),
      password: decryptPendingPassword(String(row.password_enc)),
      name: String(row.name),
      studio: String(row.studio),
      countryGateway: String(row.country_gateway || 'GH'),
      appRole: row.app_role === 'gate_staff' ? 'gate_staff' : 'organizer',
      createdAt: new Date(String(row.created_at)).getTime(),
      expiresAt,
    };
  }

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

export async function consumePendingSignup(
  identifier: string | { phone?: string; email?: string }
): Promise<PendingSignupRecord | null> {
  const rec = await getPendingSignup(identifier);
  if (rec) {
    pendingSignupsByPhone.delete(rec.phone);
    if (rec.email) pendingSignupsByEmail.delete(rec.email);
    const svc = createServiceSupabaseClient();
    if (svc) {
      await svc.from('pending_signups').delete().eq('phone', rec.phone);
    }
  }
  return rec;
}

export async function clearPendingSignup(
  identifier: string | { phone?: string; email?: string }
): Promise<void> {
  const phone = typeof identifier === 'string' ? identifier.trim() : (identifier.phone || '').trim();
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

  const svc = createServiceSupabaseClient();
  if (svc) {
    if (phone) {
      await svc.from('pending_signups').delete().eq('phone', phone);
      await svc.from('auth_otp_challenges').delete().eq('phone', phone);
    }
    if (email) {
      await svc.from('pending_signups').delete().eq('email', email);
      await svc.from('auth_otp_challenges').delete().eq('email', email);
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

export async function hasActiveAuthChallenge(params: {
  phone?: string;
  email?: string;
}): Promise<boolean> {
  const cleanPhone = params.phone?.trim() || '';
  const cleanEmail = params.email?.trim() ? normalizeEmailKey(params.email) : '';

  const svc = createServiceSupabaseClient();
  if (svc) {
    let row: Record<string, unknown> | null = null;
    if (cleanPhone) {
      const { data, error } = await svc
        .from('auth_otp_challenges')
        .select('id, expires_at')
        .eq('phone', cleanPhone)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertAuthTableError(error, 'auth_otp_challenges');
      row = (data as Record<string, unknown> | null) ?? null;
    }
    if (!row && cleanEmail) {
      const { data, error } = await svc
        .from('auth_otp_challenges')
        .select('id, expires_at')
        .eq('email', cleanEmail)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertAuthTableError(error, 'auth_otp_challenges');
      row = (data as Record<string, unknown> | null) ?? null;
    }
    if (!row) return false;
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await svc.from('auth_otp_challenges').delete().eq('id', String(row.id));
      return false;
    }
    return true;
  }

  const now = Date.now();
  const byPhone = cleanPhone ? otpChallenges.get(phoneChallengeKey(cleanPhone)) : undefined;
  const byEmail = cleanEmail ? otpChallenges.get(emailChallengeKey(cleanEmail)) : undefined;
  const challenge = byPhone || byEmail;
  if (!challenge) return false;
  if (now > challenge.expiresAt) {
    deleteChallengeEntries(challenge);
    return false;
  }
  return true;
}

export async function issueAuthOtp(params: {
  phone?: string;
  email?: string;
  purpose: PhoneOtpPurpose;
}): Promise<{ code: string; expiresAt: number }> {
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  const cleanPhone = params.phone?.trim() || undefined;
  const cleanEmail =
    params.email && !isSyntheticPhoneEmail(params.email)
      ? normalizeEmailKey(params.email)
      : undefined;
  const codeHash = hashOtpCode(code);

  const challenge: AuthOtpChallenge = {
    phone: cleanPhone,
    email: cleanEmail,
    codeHash,
    purpose: params.purpose,
    expiresAt,
    issuedAt: now,
    attempts: 0,
  };

  if (cleanPhone) otpChallenges.set(phoneChallengeKey(cleanPhone), challenge);
  if (cleanEmail) otpChallenges.set(emailChallengeKey(cleanEmail), challenge);

  const svc = createServiceSupabaseClient();
  if (svc) {
    const nowIso = new Date(now).toISOString();
    await svc.from('auth_otp_challenges').delete().lt('expires_at', nowIso);
    if (cleanPhone) {
      await svc.from('auth_otp_challenges').delete().eq('phone', cleanPhone);
    }
    if (cleanEmail) {
      await svc.from('auth_otp_challenges').delete().eq('email', cleanEmail);
    }
    const { error } = await svc.from('auth_otp_challenges').insert({
      id: `otp-${crypto.randomUUID()}`,
      phone: cleanPhone || null,
      email: cleanEmail || null,
      code_hash: codeHash,
      purpose: params.purpose,
      attempts: 0,
      issued_at: nowIso,
      expires_at: new Date(expiresAt).toISOString(),
    });
    assertAuthTableError(error, 'auth_otp_challenges');
  }

  return { code, expiresAt };
}

export async function issuePhoneOtp(
  normalizedPhone: string,
  purpose: PhoneOtpPurpose
): Promise<{ code: string; expiresAt: number }> {
  return issueAuthOtp({ phone: normalizedPhone, purpose });
}

export async function verifyAuthOtp(params: {
  phone?: string;
  email?: string;
  token: string;
}): Promise<
  { ok: true; purpose: PhoneOtpPurpose; phone?: string; email?: string } | { ok: false; error: string }
> {
  const cleanCode = params.token.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: 'Enter a valid 6-digit verification code.' };
  }

  const cleanPhone = params.phone?.trim() || '';
  const cleanEmail = params.email?.trim() ? normalizeEmailKey(params.email) : '';
  const candidateHash = hashOtpCode(cleanCode);

  const svc = createServiceSupabaseClient();
  if (svc) {
    let row: Record<string, unknown> | null = null;
    if (cleanPhone) {
      const { data, error } = await svc
        .from('auth_otp_challenges')
        .select('*')
        .eq('phone', cleanPhone)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertAuthTableError(error, 'auth_otp_challenges');
      row = (data as Record<string, unknown> | null) ?? null;
    }
    if (!row && cleanEmail) {
      const { data, error } = await svc
        .from('auth_otp_challenges')
        .select('*')
        .eq('email', cleanEmail)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assertAuthTableError(error, 'auth_otp_challenges');
      row = (data as Record<string, unknown> | null) ?? null;
    }

    if (!row) {
      return {
        ok: false,
        error: 'No active verification code found. Request a new 6-digit code via SMS & Email.',
      };
    }

    const rowId = String(row.id);
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await svc.from('auth_otp_challenges').delete().eq('id', rowId);
      return { ok: false, error: 'Verification code has expired. Request a new 6-digit code.' };
    }

    const attempts = Number(row.attempts ?? 0);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await svc.from('auth_otp_challenges').delete().eq('id', rowId);
      return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit code.' };
    }

    if (!safeHexEqual(candidateHash, String(row.code_hash))) {
      const nextAttempts = attempts + 1;
      const remaining = MAX_OTP_ATTEMPTS - nextAttempts;
      if (remaining <= 0) {
        await svc.from('auth_otp_challenges').delete().eq('id', rowId);
        return { ok: false, error: 'Too many incorrect attempts. Request a new 6-digit code.' };
      }
      await svc.from('auth_otp_challenges').update({ attempts: nextAttempts }).eq('id', rowId);
      return {
        ok: false,
        error: `Invalid 6-digit verification code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`,
      };
    }

    await svc.from('auth_otp_challenges').delete().eq('id', rowId);
    return {
      ok: true,
      purpose: (row.purpose as PhoneOtpPurpose) || 'login',
      phone: row.phone ? String(row.phone) : undefined,
      email: row.email ? String(row.email) : undefined,
    };
  }

  const byPhone = cleanPhone ? otpChallenges.get(phoneChallengeKey(cleanPhone)) : undefined;
  const byEmail = cleanEmail ? otpChallenges.get(emailChallengeKey(cleanEmail)) : undefined;
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

export async function verifyPhoneOtp(
  normalizedPhone: string,
  token: string
): Promise<{ ok: true; purpose: PhoneOtpPurpose } | { ok: false; error: string }> {
  const res = await verifyAuthOtp({ phone: normalizedPhone, token });
  if (!res.ok) return res;
  return { ok: true, purpose: res.purpose };
}

export function resolveArkeselCallbackUrl(): string | undefined {
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!appUrl || !/^https:\/\//i.test(appUrl)) return undefined;
  if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) return undefined;
  return `${appUrl}/api/webhooks/arkesel-dlr`;
}

export function cleanArkeselRecipientDigits(phone: string): string {
  return phone
    .replace(/^\+/, '')
    .replace(/\D+/g, '')
    .replace(/^(233|234|254|250)0+(\d+)$/, '$1$2');
}

interface ArkeselSendResponse {
  status?: string;
  message?: string;
  code?: string;
  data?: Array<{ id?: string; recipient?: string; status?: string }> | { id?: string; recipient?: string };
}

export async function sendArkeselSmsOtp(params: {
  phone: string;
  code: string;
  purpose: PhoneOtpPurpose;
  senderId?: string;
}): Promise<{
  ok: boolean;
  configured: boolean;
  sandbox?: boolean;
  messageId?: string;
  senderIdUsed?: string;
  warning?: string;
  error?: string;
}> {
  const { senderId: sender, isDefaultUnverifiedWarning } = platformRuntime.getEffectiveArkeselSenderId(
    params.senderId
  );
  const cleanPhone = cleanArkeselRecipientDigits(params.phone);

  if (platformRuntime.flags.smsMode === 'sandbox') {
    platformRuntime.recordSmsDispatch({
      recipient: `+${cleanPhone}`,
      senderId: sender,
      senderIdIsDefaultWarning: isDefaultUnverifiedWarning,
      purpose: params.purpose,
      mode: 'sandbox',
      gatewayStatus: 'SANDBOX_DRY_RUN',
      dlrStatus: 'SANDBOX_SKIPPED',
      errorReason: 'Sandbox mode active — live Arkesel API not called so zero SMS credits were deducted.',
    });
    return {
      ok: true,
      configured: isArkeselConfigured(),
      sandbox: true,
      senderIdUsed: sender,
      warning: 'SMS mode is set to Sandbox Dry-Run in Builder Console (no live carrier SMS sent).',
    };
  }

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
        : params.purpose === 'test'
          ? 'gateway diagnostics'
          : 'workspace sign-in';

  const message =
    params.purpose === 'test'
      ? `Events App gateway test (${sender}). Confirmation code: ${params.code}.`
      : `Your Events App ${purposeText} code is ${params.code}. Valid for 10 minutes.`;

  const callbackUrl = resolveArkeselCallbackUrl();
  const payload: Record<string, unknown> = {
    sender,
    message,
    recipients: [cleanPhone],
  };
  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  try {
    const resp = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await resp.text();
    let parsed: ArkeselSendResponse | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as ArkeselSendResponse) : null;
    } catch {
      parsed = null;
    }

    if (!resp.ok || parsed?.status === 'error') {
      const errMsg = parsed?.message || `Arkesel SMS API returned HTTP ${resp.status}`;
      platformRuntime.recordSmsDispatch({
        recipient: `+${cleanPhone}`,
        senderId: sender,
        senderIdIsDefaultWarning: isDefaultUnverifiedWarning,
        purpose: params.purpose,
        mode: 'live',
        gatewayStatus: `HTTP_${resp.status}`,
        dlrStatus: 'GATEWAY_ERROR',
        errorReason: errMsg,
      });
      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://sms.arkesel.com/api/v2/sms/send',
        statusCode: resp.status,
        reason: errMsg,
        payloadPreview: JSON.stringify({ phone: cleanPhone, sender, purpose: params.purpose }),
        expectedDiff: 'Expected HTTP 200 OK with registered ARKESEL_SENDER_ID',
      });
      return { ok: false, configured: true, senderIdUsed: sender, error: errMsg };
    }

    const firstRecipient = Array.isArray(parsed?.data) ? parsed?.data[0] : parsed?.data;
    const messageId = firstRecipient?.id ? String(firstRecipient.id) : undefined;
    const senderWarning = isDefaultUnverifiedWarning
      ? `Dispatched with default Sender ID "${sender}" because ARKESEL_SENDER_ID is not configured. If credits are deducted without handset delivery, MTN/Telecel/AT are dropping unapproved Sender IDs — set your Arkesel-approved ARKESEL_SENDER_ID.`
      : undefined;

    platformRuntime.recordSmsDispatch({
      messageId,
      recipient: `+${cleanPhone}`,
      senderId: sender,
      senderIdIsDefaultWarning: isDefaultUnverifiedWarning,
      purpose: params.purpose,
      mode: 'live',
      gatewayStatus: parsed?.message || 'Accepted (Credits Deducted)',
      dlrStatus: messageId ? 'SUBMITTED_TO_CARRIER' : 'QUEUED_NO_MSG_ID',
      errorReason: senderWarning,
    });

    if (isDefaultUnverifiedWarning) {
      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://sms.arkesel.com/api/v2/sms/send',
        statusCode: resp.status,
        reason: senderWarning!,
        payloadPreview: JSON.stringify({ messageId, phone: cleanPhone, sender }),
        expectedDiff: 'Configure approved ARKESEL_SENDER_ID (max 11 chars) in server environment',
      });
    }

    return {
      ok: true,
      configured: true,
      messageId,
      senderIdUsed: sender,
      warning: senderWarning,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unable to reach Arkesel SMS gateway.';
    platformRuntime.recordError('arkesel-otp-sms', err);
    return { ok: false, configured: true, senderIdUsed: sender, error: errMsg };
  }
}

export async function fetchArkeselGatewayBalance(): Promise<{
  ok: boolean;
  credits?: number;
  mainBalance?: number;
  error?: string;
}> {
  const apiKey = (process.env.ARKESEL_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'ARKESEL_API_KEY not configured' };
  }
  try {
    const resp = await fetch('https://sms.arkesel.com/api/v2/clients/balance-details', {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        Accept: 'application/json',
      },
    });
    const raw = await resp.text();
    const parsed = raw
      ? (JSON.parse(raw) as {
          status?: string;
          message?: string;
          data?: { sms_balance?: number | string; main_balance?: number | string };
        })
      : {};
    if (!resp.ok || parsed.status === 'error') {
      const msg = parsed.message || `HTTP ${resp.status}`;
      platformRuntime.gatewayBalanceLive = false;
      platformRuntime.gatewayBalanceError = msg;
      return { ok: false, error: msg };
    }
    const rawSmsBal = Number(parsed.data?.sms_balance ?? 0);
    const rawMainBal = Number(parsed.data?.main_balance);
    if (Number.isFinite(rawSmsBal)) {
      platformRuntime.gatewayBalanceCredits = rawSmsBal;
      platformRuntime.gatewayBalanceLive = true;
      platformRuntime.gatewayBalanceError = undefined;
      return {
        ok: true,
        credits: rawSmsBal,
        mainBalance: Number.isFinite(rawMainBal) ? rawMainBal : undefined,
      };
    }
    return { ok: false, error: 'Arkesel returned invalid balance format' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach Arkesel balance API';
    platformRuntime.gatewayBalanceLive = false;
    platformRuntime.gatewayBalanceError = msg;
    return { ok: false, error: msg };
  }
}

export async function syncArkeselDeliveryReports(): Promise<{
  checked: number;
  updated: number;
  error?: string;
}> {
  const apiKey = (process.env.ARKESEL_API_KEY || '').trim();
  if (!apiKey) {
    return { checked: 0, updated: 0, error: 'ARKESEL_API_KEY not configured' };
  }

  const pendingIds = platformRuntime.smsDispatches
    .filter(
      (d) =>
        Boolean(d.messageId) &&
        d.mode === 'live' &&
        !['DELIVERED', 'FAILED', 'REJECTED', 'PROHIBITED', 'EXPIRED'].includes(
          d.dlrStatus.toUpperCase()
        )
    )
    .map((d) => d.messageId!)
    .slice(0, 20);

  if (pendingIds.length === 0) {
    return { checked: 0, updated: 0 };
  }

  let updated = 0;
  for (const msgId of pendingIds) {
    try {
      const resp = await fetch('https://sms.arkesel.com/api/v2/sms/message-reports', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ message_id: msgId }),
      });
      if (!resp.ok) continue;
      const parsed = (await resp.json()) as {
        data?: { status?: string; reason?: string } | Array<{ status?: string; reason?: string }>;
      };
      const item = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
      if (item?.status) {
        const nextStatus = String(item.status).toUpperCase();
        const reason = item.reason ? String(item.reason) : undefined;
        if (platformRuntime.updateSmsDispatchByMessageId(msgId, nextStatus, reason)) {
          updated += 1;
        }
      }
    } catch {
      // Continue checking remaining IDs
    }
  }
  return { checked: pendingIds.length, updated };
}

export function handleArkeselDlrPayload(rawPayload: Record<string, unknown>) {
  const msgId = String(
    rawPayload.sms_id || rawPayload.id || rawPayload.message_id || rawPayload.messageId || ''
  ).trim();
  const status = String(rawPayload.status || rawPayload.dlr_status || 'UNKNOWN')
    .trim()
    .toUpperCase();
  const reason = rawPayload.reason
    ? String(rawPayload.reason)
    : rawPayload.error
      ? String(rawPayload.error)
      : undefined;

  if (!msgId) {
    return { matched: false, error: 'Missing sms_id/id in Arkesel DLR webhook payload.' };
  }

  const isFailed = ['FAILED', 'NOT_DELIVERED', 'REJECTED', 'PROHIBITED', 'EXPIRED', 'DND'].includes(
    status
  );
  const failureNote = isFailed
    ? reason ||
      `Carrier reported ${status}. This happens after Arkesel deducted credits when the Sender ID is not approved for MTN/Telecel/AT or the recipient is on DND.`
    : reason;

  const updated = platformRuntime.updateSmsDispatchByMessageId(msgId, status, failureNote);
  if (isFailed) {
    platformRuntime.recordDiagnosticFailure({
      kind: 'webhook',
      target: '/api/webhooks/arkesel-dlr',
      statusCode: 422,
      reason: failureNote || `Carrier DLR ${status}`,
      payloadPreview: JSON.stringify(rawPayload),
      expectedDiff: 'Expected DELIVERED from MTN / Telecel / AT carrier DLR',
    });
  }
  return { matched: Boolean(updated), status, messageId: msgId };
}

export interface DualAuthDispatchResult {
  ok: boolean;
  provider?: string;
  channel?: 'both' | 'sms' | 'email';
  channels: Array<'sms' | 'email'>;
  smsSent: boolean;
  emailSent: boolean;
  smsSenderId?: string;
  smsMessageId?: string;
  smsWarning?: string;
  smsError?: string;
  emailError?: string;
  error?: string;
}

export async function dispatchDualAuthChallenge(params: {
  phone?: string;
  email?: string;
  purpose: Exclude<PhoneOtpPurpose, 'test'>;
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

  const { code } = await issueAuthOtp({
    phone: targetPhone,
    email: targetEmail,
    purpose: params.purpose,
  });

  const arkeselReady =
    Boolean(targetPhone) &&
    (isArkeselConfigured() || platformRuntime.flags.smsMode === 'sandbox');
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
            sandbox: false,
            messageId: undefined,
            senderIdUsed: undefined,
            warning: undefined,
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
        provider: smsRes?.sandbox ? 'sandbox+resend' : 'arkesel+resend',
        channel: 'both',
        channels,
        smsSent: true,
        emailSent: true,
        smsSenderId: smsRes?.senderIdUsed,
        smsMessageId: smsRes?.messageId,
        smsWarning: smsRes?.warning,
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
    await clearPendingSignup({ phone: targetPhone, email: targetEmail });

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
      smsSenderId: smsRes?.senderIdUsed,
      smsMessageId: smsRes?.messageId,
      smsWarning: smsRes?.warning,
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
  purpose: Exclude<PhoneOtpPurpose, 'test'>;
  name?: string;
  senderId?: string;
  allowSandboxFallback?: boolean;
}) {
  return dispatchDualAuthChallenge({
    ...params,
    requireBoth: Boolean(params.phone && params.email && !isSyntheticPhoneEmail(params.email)),
  });
}
