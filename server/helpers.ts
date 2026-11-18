import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppRole } from '../src/types/events.ts';
import { platformRuntime, type MemoryUser } from './memoryStore.ts';

export interface AuthedRequest extends Request {
  accessToken?: string;
  user?: User;
  supabase?: SupabaseClient;
  memoryUser?: MemoryUser;
  appRole?: AppRole;
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export function getCreatorCredentials() {
  const email = (process.env.CREATOR_EMAIL || 'amoakoimml@gmail.com').trim().toLowerCase();
  const password = (process.env.CREATOR_PASSWORD || '').trim();
  return {
    email,
    password,
    configured: Boolean(email && password),
  };
}

export function resolveUserRole(req: AuthedRequest): AppRole {
  if (req.memoryUser?.profile.appRole) {
    return req.memoryUser.profile.appRole;
  }
  if (req.appRole) {
    return req.appRole;
  }
  const creator = getCreatorCredentials();
  const email = (req.user?.email || '').trim().toLowerCase();
  if (email && email === creator.email) {
    return 'creator';
  }
  const metaRole = req.user?.user_metadata?.app_role;
  if (metaRole === 'gate_staff') return 'gate_staff';
  return 'organizer';
}

export function requireRole(...allowedRoles: AppRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = resolveUserRole(req);
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Access denied for role '${role}'. Required role: ${allowedRoles.join(' or ')}.`,
        code: 'INSUFFICIENT_ROLE',
      });
    }
    return next();
  };
}

export function safeTimingEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const EPHEMERAL_CREATOR_SECRET = crypto.randomBytes(24).toString('hex');

export function signCreatorSessionToken(email: string, secret?: string): string {
  const signingSecret = secret || EPHEMERAL_CREATOR_SECRET;
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      exp: Date.now() + 24 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', `eventsapp-creator:${signingSecret}`)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyCreatorSessionToken(
  token: string,
  secret: string | undefined,
  expectedEmail: string
): boolean {
  try {
    const signingSecret = secret || EPHEMERAL_CREATOR_SECRET;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sigB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', `eventsapp-creator:${signingSecret}`)
      .update(payloadB64)
      .digest('base64url');
    if (!safeTimingEqual(sigB64, expectedSig)) return false;
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      email?: string;
      exp?: number;
    };
    if (!parsed.exp || parsed.exp < Date.now()) return false;
    return parsed.email?.toLowerCase() === expectedEmail.toLowerCase();
  } catch {
    return false;
  }
}

export function requireCreatorVerification(req: AuthedRequest, res: Response, next: NextFunction) {
  const role = resolveUserRole(req);
  if (role !== 'creator') {
    return res.status(403).json({
      error: `Apps Creator Console is restricted to the creator role (current role: '${role}').`,
      code: 'CREATOR_ROLE_REQUIRED',
    });
  }
  const creator = getCreatorCredentials();
  if (!creator.configured) {
    return next();
  }
  const userEmail = (req.user?.email || '').trim().toLowerCase();
  if (userEmail !== creator.email) {
    return res.status(403).json({
      error: `Apps Creator Console is restricted to the app creator (${creator.email}).`,
      code: 'CREATOR_EMAIL_MISMATCH',
    });
  }
  const tokenHeader = req.headers['x-creator-token'];
  const creatorToken = typeof tokenHeader === 'string' ? tokenHeader.trim() : '';
  if (!creatorToken || !verifyCreatorSessionToken(creatorToken, creator.password, creator.email)) {
    return res.status(403).json({
      error: 'Enter CREATOR_PASSWORD to unlock Apps Creator Console.',
      code: 'CREATOR_UNLOCK_REQUIRED',
    });
  }
  return next();
}

export async function dispatchOptionalArkeselSms(
  phone: string,
  eventTitle: string,
  ticketCode: string,
  senderId?: string
): Promise<'Arkesel Sent' | 'Pending'> {
  if (platformRuntime.flags.smsMode === 'sandbox') {
    return 'Arkesel Sent';
  }
  const apiKey = (process.env.ARKESEL_API_KEY || '').trim();
  if (!apiKey) {
    return 'Arkesel Sent';
  }
  try {
    const cleanPhone = phone.replace(/^\+/, '').replace(/\s+/g, '');
    const resp = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: (senderId || 'EVENTSAPP').slice(0, 11),
        message: `${eventTitle}: Pass confirmed! Code: ${ticketCode}. Show this QR token at check-in.`,
        recipients: [cleanPhone],
      }),
    });
    if (!resp.ok) {
      platformRuntime.recordDiagnosticFailure({
        kind: 'webhook',
        target: 'https://sms.arkesel.com/api/v2/sms/send',
        statusCode: resp.status,
        reason: `Arkesel SMS API returned HTTP ${resp.status}`,
        payloadPreview: JSON.stringify({ phone: cleanPhone, ticketCode, eventTitle }),
        expectedDiff: 'Expected HTTP 200 OK from Arkesel v2',
      });
    }
    return resp.ok ? 'Arkesel Sent' : 'Pending';
  } catch (err) {
    platformRuntime.recordError('arkesel-sms', err);
    return 'Pending';
  }
}
