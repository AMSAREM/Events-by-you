import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { AppRole, OrganizerProfile } from '../src/types/events.ts';
import {
  createPublicSupabaseClient,
  createServiceSupabaseClient,
  ensureProfileRow,
  findSupabaseUserByEmail,
  isSupabaseConfigured,
} from './supabase.ts';
import { memoryStore, platformRuntime } from './memoryStore.ts';

interface GoogleOAuthStatePayload {
  mode: 'signin' | 'signup';
  studio?: string;
  appRole?: AppRole;
  redirectUri: string;
  nonce: string;
  iat: number;
  exp: number;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName?: string;
  picture?: string;
}

const EPHEMERAL_OAUTH_STATE_SECRET = crypto.randomBytes(32).toString('hex');

function cleanEnv(raw?: string): string {
  return (raw || '').trim().replace(/^['"]|['"]$/g, '').trim();
}

export function getGoogleOAuthConfig() {
  const clientId = cleanEnv(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
  };
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthConfig().configured;
}

function getStateSigningSecret(): string {
  const { clientSecret } = getGoogleOAuthConfig();
  return (
    clientSecret ||
    cleanEnv(process.env.OTP_ENCRYPTION_KEY) ||
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    EPHEMERAL_OAUTH_STATE_SECRET
  );
}

export function resolveAppBaseUrl(req: Request): string {
  const envUrl = cleanEnv(process.env.APP_URL).replace(/\/+$/, '');
  if (envUrl) return envUrl;
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'https';
  const forwardedHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host') || 'www.eventsbyyou.xyz';
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `${req.protocol || 'http'}://${host}`.replace(/\/+$/, '');
  }
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function getGoogleOAuthCallbackUrl(req: Request): string {
  return `${resolveAppBaseUrl(req)}/auth/callback`;
}

function signOAuthState(payload: GoogleOAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', `eventsbyyou-google-oauth:${getStateSigningSecret()}`)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOAuthState(rawState: string): GoogleOAuthStatePayload | null {
  try {
    const parts = rawState.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', `eventsbyyou-google-oauth:${getStateSigningSecret()}`)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as GoogleOAuthStatePayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (!parsed.redirectUri) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildGoogleAuthorizeUrl(
  req: Request,
  options?: {
    mode?: 'signin' | 'signup';
    studio?: string;
    appRole?: AppRole;
  }
): { url: string; callbackUrl: string } {
  const { clientId, configured } = getGoogleOAuthConfig();
  if (!configured) {
    throw new Error('Google OAuth is not configured on this server.');
  }
  const callbackUrl = getGoogleOAuthCallbackUrl(req);
  const now = Date.now();
  const state = signOAuthState({
    mode: options?.mode === 'signup' ? 'signup' : 'signin',
    studio: options?.studio?.trim().slice(0, 120) || undefined,
    appRole: options?.appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
    redirectUri: callbackUrl,
    nonce: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: now + 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    callbackUrl,
  };
}

async function exchangeCodeWithGoogle(code: string, redirectUri: string): Promise<GoogleUserInfo> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are missing on the server.');
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokenJson = (await tokenResp.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResp.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description || tokenJson.error || 'Failed to exchange Google authorization code.'
    );
  }

  const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  const userJson = (await userResp.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    picture?: string;
    error_description?: string;
  };

  if (!userResp.ok || !userJson.email) {
    throw new Error(userJson.error_description || 'Could not retrieve your Google email address.');
  }
  if (userJson.email_verified === false) {
    throw new Error('Your Google account email is not verified. Verify it with Google and try again.');
  }

  const cleanEmail = userJson.email.trim().toLowerCase();
  const displayName =
    (userJson.name || '').trim() ||
    (userJson.given_name || '').trim() ||
    cleanEmail.split('@')[0] ||
    'Organiser';

  return {
    sub: String(userJson.sub || cleanEmail),
    email: cleanEmail,
    emailVerified: Boolean(userJson.email_verified ?? true),
    name: displayName,
    givenName: userJson.given_name?.trim() || undefined,
    picture: userJson.picture?.trim() || undefined,
  };
}

async function provisionAndIssueSession(
  googleUser: GoogleUserInfo,
  state: GoogleOAuthStatePayload
): Promise<{
  session: { accessToken: string; refreshToken: string; expiresAt?: number };
  profile: OrganizerProfile;
  isNewUser: boolean;
}> {
  if (!isSupabaseConfigured()) {
    const result = memoryStore.signInWithGoogle({
      email: googleUser.email,
      name: googleUser.name,
      givenName: googleUser.givenName,
      avatarUrl: googleUser.picture,
      studio: state.studio,
      appRole: state.appRole,
    });
    return {
      session: {
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken,
        expiresAt: result.session.expiresAt,
      },
      profile: result.profile,
      isNewUser: result.isNewUser,
    };
  }

  const svc = createServiceSupabaseClient();
  if (!svc) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required on the server to complete direct Google OAuth.'
    );
  }

  let authUser = await findSupabaseUserByEmail(svc, googleUser.email);
  const isNewUser = !authUser;

  if (isNewUser && !platformRuntime.flags.signupsEnabled) {
    throw new Error('New organiser signups are temporarily paused by platform administrator.');
  }

  const firstWord =
    (googleUser.givenName || googleUser.name || googleUser.email.split('@')[0] || 'My')
      .trim()
      .split(/\s+/)[0] || 'My';
  const defaultStudio = state.studio?.trim() || `${firstWord}'s Events`;

  if (!authUser) {
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email: googleUser.email,
      email_confirm: true,
      user_metadata: {
        name: googleUser.name,
        full_name: googleUser.name,
        avatar_url: googleUser.picture,
        studio: defaultStudio,
        app_role: state.appRole === 'gate_staff' ? 'gate_staff' : 'organizer',
        oauth_provider: 'google',
        google_sub: googleUser.sub,
      },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message || 'Unable to provision Google user account.');
    }
    authUser = created.user;
  } else {
    const bannedUntil = (authUser as { banned_until?: string | null }).banned_until;
    if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
      throw new Error('This organiser account has been suspended. Contact support.');
    }
    const existingMeta =
      authUser.user_metadata && typeof authUser.user_metadata === 'object'
        ? { ...authUser.user_metadata }
        : {};
    let metaChanged = false;
    if (googleUser.picture && !existingMeta.avatar_url) {
      existingMeta.avatar_url = googleUser.picture;
      metaChanged = true;
    }
    if (googleUser.name && !existingMeta.name) {
      existingMeta.name = googleUser.name;
      metaChanged = true;
    }
    if (!existingMeta.oauth_provider) {
      existingMeta.oauth_provider = 'google';
      metaChanged = true;
    }
    if (metaChanged || !authUser.email_confirmed_at) {
      const { data: updatedUser } = await svc.auth.admin.updateUserById(authUser.id, {
        email_confirm: true,
        user_metadata: existingMeta,
      });
      if (updatedUser?.user) authUser = updatedUser.user;
    }
  }

  let profile = await ensureProfileRow(svc, authUser);
  if (googleUser.picture && !profile.avatarUrl) {
    try {
      await svc
        .from('profiles')
        .update({ avatar_url: googleUser.picture, updated_at: new Date().toISOString() })
        .eq('id', authUser.id);
      profile = { ...profile, avatarUrl: googleUser.picture };
    } catch {
      // Non-fatal if avatar update fails
    }
  }

  const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
    type: 'magiclink',
    email: googleUser.email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    throw new Error(linkErr?.message || 'Unable to generate session link for Google account.');
  }

  const publicClient = createPublicSupabaseClient();
  const { data: verified, error: verifyErr } = await publicClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyErr || !verified.session) {
    throw new Error(verifyErr?.message || 'Unable to verify Google OAuth session.');
  }

  return {
    session: {
      accessToken: verified.session.access_token,
      refreshToken: verified.session.refresh_token,
      expiresAt: verified.session.expires_at,
    },
    profile,
    isNewUser,
  };
}

function escapeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOAuthCallbackHtml(initialResult: {
  ok: boolean;
  session?: { accessToken: string; refreshToken: string; expiresAt?: number };
  profile?: OrganizerProfile;
  isNewUser?: boolean;
  mode?: 'signin' | 'signup';
  error?: string;
  parseUrlHashIfEmpty?: boolean;
}): string {
  const safePayloadJson = escapeJsonForInlineScript(initialResult);
  const statusHeading = initialResult.parseUrlHashIfEmpty
    ? 'Completing Google Sign-In...'
    : initialResult.ok
      ? 'Signed in with Google'
      : 'Google Sign-In Failed';
  const statusDetail = initialResult.parseUrlHashIfEmpty
    ? 'Securing your Events By You session and returning you to the studio.'
    : initialResult.ok
      ? 'Your account is verified. This window will close automatically.'
      : initialResult.error || 'Could not complete Google authentication.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Google Sign-In · Events By You</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: #F5F5F7;
      color: #0B0B0B;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: #FFFFFF;
      border-radius: 28px;
      padding: 32px 28px;
      text-align: center;
      box-shadow: 0 18px 40px -12px rgba(11, 11, 11, 0.12);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 16px;
      background: #0B0B0B;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 18px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 20px;
      font-size: 13px;
      line-height: 1.5;
      color: #52525B;
      word-break: break-word;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 20px;
      border-radius: 9999px;
      border: none;
      background: #0B0B0B;
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">G</div>
    <h1 id="status-title">${escapeHtml(statusHeading)}</h1>
    <p id="status-detail">${escapeHtml(statusDetail)}</p>
    <button type="button" class="btn" id="close-btn" onclick="window.close()">Close Window</button>
  </div>
  <script>
    (function () {
      var result = ${safePayloadJson};

      if (result.parseUrlHashIfEmpty) {
        var hash = window.location.hash || '';
        var search = window.location.search || '';
        var hashParams = new URLSearchParams(hash.replace(/^#/, ''));
        var queryParams = new URLSearchParams(search);
        var errDesc =
          hashParams.get('error_description') ||
          hashParams.get('error') ||
          queryParams.get('error_description') ||
          queryParams.get('error');

        if (errDesc) {
          result = { ok: false, error: errDesc };
        } else if (hashParams.get('access_token')) {
          var accessToken = hashParams.get('access_token');
          var refreshToken = hashParams.get('refresh_token') || '';
          var expiresIn = Number(hashParams.get('expires_in') || 3600);
          result = {
            ok: true,
            session: {
              accessToken: accessToken,
              refreshToken: refreshToken,
              expiresAt: Math.floor(Date.now() / 1000) + expiresIn
            }
          };
        } else {
          result = {
            ok: false,
            error: 'No Google authentication token was returned. Please try again.'
          };
        }
      }

      var titleEl = document.getElementById('status-title');
      var detailEl = document.getElementById('status-detail');
      if (titleEl && detailEl) {
        if (result.ok) {
          titleEl.textContent = 'Signed in with Google';
          detailEl.textContent = 'Your account is verified. Returning you to Events By You...';
        } else {
          titleEl.textContent = 'Google Sign-In Failed';
          detailEl.textContent = result.error || 'Could not complete Google sign-in.';
        }
      }

      var payload = {
        type: 'GOOGLE_OAUTH_RESULT',
        ok: Boolean(result.ok),
        session: result.session || undefined,
        profile: result.profile || undefined,
        isNewUser: Boolean(result.isNewUser),
        mode: result.mode || undefined,
        error: result.error || undefined,
        ts: Date.now()
      };

      var deliveredToParent = false;
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
          deliveredToParent = true;
        }
      } catch (e) {}

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('eventsapp_google_oauth');
          bc.postMessage(payload);
          bc.close();
        }
      } catch (e) {}

      try {
        localStorage.setItem('eventsapp_google_oauth_result', JSON.stringify(payload));
      } catch (e) {}

      if (result.ok) {
        if (deliveredToParent || window.opener) {
          setTimeout(function () {
            try { window.close(); } catch (e) {}
          }, 180);
        } else if (result.session && result.session.accessToken) {
          try {
            localStorage.setItem('eventsapp_supabase_session_v1', JSON.stringify(result.session));
          } catch (e) {}
          window.location.replace('/studio');
        }
      }
    })();
  </script>
</body>
</html>`;
}

export async function handleGoogleOAuthCallback(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const queryError =
    typeof req.query.error_description === 'string'
      ? req.query.error_description
      : typeof req.query.error === 'string'
        ? req.query.error
        : '';
  if (queryError) {
    const readable =
      queryError === 'access_denied'
        ? 'Google sign-in was cancelled.'
        : queryError;
    return res.status(200).send(renderOAuthCallbackHtml({ ok: false, error: readable }));
  }

  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  const rawState = typeof req.query.state === 'string' ? req.query.state.trim() : '';

  // When Supabase Implicit OAuth redirects back to /auth/callback#access_token=...
  // the fragment isn't visible on the server, so let the inline script parse window.location.hash.
  if (!code) {
    return res.status(200).send(
      renderOAuthCallbackHtml({
        ok: false,
        parseUrlHashIfEmpty: true,
      })
    );
  }

  if (!rawState) {
    return res.status(400).send(
      renderOAuthCallbackHtml({
        ok: false,
        error: 'Missing OAuth state parameter. Please restart Google sign-in.',
      })
    );
  }

  const state = verifyOAuthState(rawState);
  if (!state) {
    return res.status(400).send(
      renderOAuthCallbackHtml({
        ok: false,
        error: 'Google sign-in session expired or failed state verification. Please try again.',
      })
    );
  }

  try {
    const googleUser = await exchangeCodeWithGoogle(code, state.redirectUri);
    const issued = await provisionAndIssueSession(googleUser, state);
    return res.status(200).send(
      renderOAuthCallbackHtml({
        ok: true,
        session: issued.session,
        profile: issued.profile,
        isNewUser: issued.isNewUser,
        mode: state.mode,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to complete Google sign-in.';
    return res.status(200).send(renderOAuthCallbackHtml({ ok: false, error: message }));
  }
}
