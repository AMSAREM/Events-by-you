export function getPaystackSecretKey(): string {
  return (process.env.PAYSTACK_SECRET_KEY || '').trim();
}

export function isPaystackConfigured(): boolean {
  return Boolean(getPaystackSecretKey());
}

export interface PaystackInitializeResult {
  ok: boolean;
  authorizationUrl?: string;
  accessCode?: string;
  reference: string;
  error?: string;
}

export async function initializePaystackTransaction(params: {
  email: string;
  amountGhs: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackInitializeResult> {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    return {
      ok: false,
      reference: params.reference,
      error: 'PAYSTACK_SECRET_KEY is not configured on the server.',
    };
  }

  const amountPesewas = Math.round(params.amountGhs * 100);
  if (!Number.isFinite(amountPesewas) || amountPesewas < 100) {
    return {
      ok: false,
      reference: params.reference,
      error: 'Invalid Paystack transaction amount.',
    };
  }

  try {
    const resp = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: params.email,
        amount: amountPesewas,
        currency: 'GHS',
        reference: params.reference,
        callback_url: params.callbackUrl,
        channels: ['mobile_money', 'card', 'bank_transfer'],
        metadata: params.metadata ?? {},
      }),
    });
    const raw = (await resp.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    };

    if (!resp.ok || !raw.status || !raw.data?.authorization_url) {
      return {
        ok: false,
        reference: params.reference,
        error: raw.message || `Paystack initialization failed (HTTP ${resp.status}).`,
      };
    }

    return {
      ok: true,
      authorizationUrl: raw.data.authorization_url,
      accessCode: raw.data.access_code,
      reference: raw.data.reference || params.reference,
    };
  } catch (err) {
    return {
      ok: false,
      reference: params.reference,
      error: err instanceof Error ? err.message : 'Unable to reach Paystack gateway.',
    };
  }
}

export interface PaystackVerifyResult {
  ok: boolean;
  paid: boolean;
  gatewayStatus: string;
  reference: string;
  amountPesewas: number;
  currency: string;
  channel?: string;
  customerEmail?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResult> {
  const secretKey = getPaystackSecretKey();
  const cleanRef = reference.trim();
  if (!secretKey) {
    return {
      ok: false,
      paid: false,
      gatewayStatus: 'unconfigured',
      reference: cleanRef,
      amountPesewas: 0,
      currency: 'GHS',
      error: 'PAYSTACK_SECRET_KEY is not configured on the server.',
    };
  }
  if (!cleanRef) {
    return {
      ok: false,
      paid: false,
      gatewayStatus: 'invalid_reference',
      reference: cleanRef,
      amountPesewas: 0,
      currency: 'GHS',
      error: 'Payment reference is required.',
    };
  }

  try {
    const resp = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(cleanRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
      }
    );
    const raw = (await resp.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        reference?: string;
        amount?: number;
        currency?: string;
        channel?: string;
        customer?: { email?: string };
        metadata?: Record<string, unknown>;
      };
    };

    if (!resp.ok || !raw.status || !raw.data) {
      return {
        ok: false,
        paid: false,
        gatewayStatus: 'error',
        reference: cleanRef,
        amountPesewas: 0,
        currency: 'GHS',
        error: raw.message || `Paystack verification failed (HTTP ${resp.status}).`,
      };
    }

    const tx = raw.data;
    const gatewayStatus = String(tx.status || 'unknown').toLowerCase();
    return {
      ok: true,
      paid: gatewayStatus === 'success',
      gatewayStatus,
      reference: String(tx.reference || cleanRef),
      amountPesewas: Number(tx.amount ?? 0),
      currency: String(tx.currency || 'GHS').toUpperCase(),
      channel: tx.channel ? String(tx.channel) : undefined,
      customerEmail: tx.customer?.email ? String(tx.customer.email) : undefined,
      metadata: tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      paid: false,
      gatewayStatus: 'network_error',
      reference: cleanRef,
      amountPesewas: 0,
      currency: 'GHS',
      error: err instanceof Error ? err.message : 'Unable to reach Paystack verification API.',
    };
  }
}
