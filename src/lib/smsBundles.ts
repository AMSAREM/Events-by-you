export interface SmsBundleDefinition {
  id: 'starter' | 'growth' | 'summit';
  name: string;
  credits: number;
  amountGhs: number;
  unitRateGhs: number;
  approxUsd: string;
  savings?: string;
  desc: string;
  featured: boolean;
}

export const SMS_BUNDLE_CATALOG: readonly SmsBundleDefinition[] = [
  {
    id: 'starter',
    name: 'Starter Pack',
    credits: 250,
    amountGhs: 50,
    unitRateGhs: 0.2,
    approxUsd: '(~$3.80)',
    desc: 'Ideal for intimate weddings, church fellowships, memorials, or boutique meetups.',
    featured: false,
  },
  {
    id: 'growth',
    name: 'Growth Pack',
    credits: 1000,
    amountGhs: 175,
    unitRateGhs: 0.175,
    approxUsd: '(~$13.20)',
    savings: '12.5% savings',
    desc: 'Recommended for concerts, church conventions, corporate galas, and morning guest reminders.',
    featured: true,
  },
  {
    id: 'summit',
    name: 'Enterprise Pack',
    credits: 5000,
    amountGhs: 750,
    unitRateGhs: 0.15,
    approxUsd: '(~$56.50)',
    savings: '25% savings',
    desc: 'For large festivals, multi-day conventions, automated turnstile entrance pings, and high-volume rosters.',
    featured: false,
  },
] as const;

export const CUSTOM_BUNDLE_MIN_CREDITS = 100;
export const CUSTOM_BUNDLE_MAX_CREDITS = 10000;
export const CUSTOM_BUNDLE_STEP_CREDITS = 100;

export function getCustomBundleUnitRate(credits: number): number {
  if (credits >= 5000) return 0.15;
  if (credits >= 1000) return 0.175;
  return 0.2;
}

export function calculateCustomBundleQuote(credits: number): {
  bundleId: 'custom';
  bundleName: string;
  credits: number;
  amountGhs: number;
  unitRateGhs: number;
} {
  const cleanCredits = Math.round(Number(credits));
  if (
    !Number.isFinite(cleanCredits) ||
    cleanCredits < CUSTOM_BUNDLE_MIN_CREDITS ||
    cleanCredits > CUSTOM_BUNDLE_MAX_CREDITS ||
    cleanCredits % CUSTOM_BUNDLE_STEP_CREDITS !== 0
  ) {
    throw new Error(
      `Custom SMS bundle must be between ${CUSTOM_BUNDLE_MIN_CREDITS.toLocaleString()} and ${CUSTOM_BUNDLE_MAX_CREDITS.toLocaleString()} SMS in increments of ${CUSTOM_BUNDLE_STEP_CREDITS}.`
    );
  }
  const unitRateGhs = getCustomBundleUnitRate(cleanCredits);
  const amountGhs = Number((cleanCredits * unitRateGhs).toFixed(2));
  return {
    bundleId: 'custom',
    bundleName: `Custom ${cleanCredits.toLocaleString()} SMS Bundle`,
    credits: cleanCredits,
    amountGhs,
    unitRateGhs,
  };
}

export interface AuthoritativeSmsBundleQuote {
  bundleId: string;
  bundleName: string;
  credits: number;
  amountGhs: number;
  unitRateGhs: number;
}

export function resolveAuthoritativeSmsBundle(input: {
  bundleId?: string;
  credits?: number;
  expectedAmountGhs?: number;
}): AuthoritativeSmsBundleQuote {
  const rawId = (input.bundleId || '').trim().toLowerCase();
  const matchedPack = SMS_BUNDLE_CATALOG.find((pack) => pack.id === rawId);

  let quote: AuthoritativeSmsBundleQuote;
  if (matchedPack) {
    if (
      input.credits !== undefined &&
      Math.round(Number(input.credits)) !== matchedPack.credits
    ) {
      throw new Error(
        `Bundle "${matchedPack.name}" is fixed at ${matchedPack.credits.toLocaleString()} SMS credits.`
      );
    }
    quote = {
      bundleId: matchedPack.id,
      bundleName: matchedPack.name,
      credits: matchedPack.credits,
      amountGhs: matchedPack.amountGhs,
      unitRateGhs: matchedPack.unitRateGhs,
    };
  } else {
    if (rawId && rawId !== 'custom') {
      throw new Error(`Unknown SMS bundle "${input.bundleId}". Select a valid bundle pack.`);
    }
    quote = calculateCustomBundleQuote(Number(input.credits ?? 0));
  }

  if (input.expectedAmountGhs !== undefined && Number.isFinite(Number(input.expectedAmountGhs))) {
    const diff = Math.abs(Number(input.expectedAmountGhs) - quote.amountGhs);
    if (diff > 0.01) {
      throw new Error(
        `Price mismatch for ${quote.bundleName}: expected GH₵ ${quote.amountGhs.toFixed(2)}, got GH₵ ${Number(input.expectedAmountGhs).toFixed(2)}.`
      );
    }
  }

  return quote;
}

export function validateReceiptReference(reference?: string): {
  ok: true;
  normalized: string;
} | {
  ok: false;
  error: string;
} {
  const normalized = (reference || '').trim();
  if (normalized.length < 6 || normalized.length > 80) {
    return {
      ok: false,
      error: 'Enter a valid payment/receipt transaction reference (6–80 characters).',
    };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    return {
      ok: false,
      error: 'Transaction reference can only contain letters, numbers, dots, underscores, or hyphens.',
    };
  }
  return { ok: true, normalized };
}
