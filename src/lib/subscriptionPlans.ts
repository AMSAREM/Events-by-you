import type { EventItem, OrganizerProfile } from '../types/events';
import { getDefaultMessageConfig } from './eventMessages';

export type SubscriptionPlanName = OrganizerProfile['plan'];
export type SubscriptionPlanId = 'starter' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';

export interface PlanEntitlements {
  plan: SubscriptionPlanName;
  maxActiveEvents: number | null;
  maxAttendeesPerEvent: number | null;
  allowCustomSenderId: boolean;
  allowCustomMessages: boolean;
  allowCsvExport: boolean;
  allowSmsBroadcast: boolean;
  whiteLabelPublicEvent: boolean;
  allowDedicatedSupport: boolean;
}

export interface SubscriptionPlanDefinition {
  id: SubscriptionPlanId;
  name: SubscriptionPlanName;
  tagline: string;
  monthlyUsd: number;
  annualUsd: number;
  monthlyGhs: number;
  annualGhs: number;
  featured?: boolean;
  features: string[];
  limitations: string[];
  entitlements: PlanEntitlements;
}

export const STARTER_MAX_ACTIVE_EVENTS = 1;
export const STARTER_MAX_ATTENDEES_PER_EVENT = 50;
export const DEFAULT_SHARED_SENDER_ID = 'EVENTSAPP';

export const SUBSCRIPTION_PLAN_CATALOG: readonly SubscriptionPlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Free Forever',
    monthlyUsd: 0,
    annualUsd: 0,
    monthlyGhs: 0,
    annualGhs: 0,
    features: [
      '1 active event (live or upcoming)',
      'Up to 50 attendees per event',
      'Shared sender ID ("EVENTSAPP") & system templates',
      'Resend Email blasts & Disposable Camera (5 shots/guest)',
      'Pay-as-you-buy Arkesel SMS bundles',
    ],
    limitations: [
      'Custom Alphanumeric Sender ID',
      'Custom SMS & Email templates',
      'CSV / TSV Attendee Export & Raw Copy',
      'Bulk SMS & Thank-You SMS broadcasts',
      'White-label public event footer',
    ],
    entitlements: {
      plan: 'Starter',
      maxActiveEvents: STARTER_MAX_ACTIVE_EVENTS,
      maxAttendeesPerEvent: STARTER_MAX_ATTENDEES_PER_EVENT,
      allowCustomSenderId: false,
      allowCustomMessages: false,
      allowCsvExport: false,
      allowSmsBroadcast: false,
      whiteLabelPublicEvent: false,
      allowDedicatedSupport: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro Organizer',
    tagline: 'For concerts, weddings, church conventions & summits',
    monthlyUsd: 19,
    annualUsd: 190,
    monthlyGhs: 250,
    annualGhs: 2500,
    featured: true,
    features: [
      'Unlimited concurrent live & upcoming events',
      'Unlimited attendees per event capacity',
      'Custom Alphanumeric Sender ID (11 chars)',
      'Custom Confirmation, Check-In & Thank-You templates',
      'Dual SMS + Resend Email bulk & thank-you broadcasts',
      'Full CSV / TSV / JSON exports & webhook auto-sync',
      'White-label public event pages (hides free badge)',
    ],
    limitations: [],
    entitlements: {
      plan: 'Pro Organizer',
      maxActiveEvents: null,
      maxAttendeesPerEvent: null,
      allowCustomSenderId: true,
      allowCustomMessages: true,
      allowCsvExport: true,
      allowSmsBroadcast: true,
      whiteLabelPublicEvent: true,
      allowDedicatedSupport: false,
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For national festivals, multi-venue teams & agencies',
    monthlyUsd: 99,
    annualUsd: 990,
    monthlyGhs: 1300,
    annualGhs: 13000,
    features: [
      'Everything in Pro Organizer',
      'Dedicated SMPP carrier SMS throughput',
      'Multi-venue gate staff coordination & priority onboarding',
      'Custom domain passbooks & SLA compliance guarantee',
    ],
    limitations: [],
    entitlements: {
      plan: 'Enterprise',
      maxActiveEvents: null,
      maxAttendeesPerEvent: null,
      allowCustomSenderId: true,
      allowCustomMessages: true,
      allowCsvExport: true,
      allowSmsBroadcast: true,
      whiteLabelPublicEvent: true,
      allowDedicatedSupport: true,
    },
  },
] as const;

export const PLAN_MRR_USD: Record<SubscriptionPlanName, number> = {
  Starter: 0,
  'Pro Organizer': 19,
  Enterprise: 99,
};

export function getPlanDefinition(planOrId?: string | null): SubscriptionPlanDefinition {
  const clean = (planOrId || '').trim().toLowerCase();
  if (clean === 'enterprise') return SUBSCRIPTION_PLAN_CATALOG[2];
  if (clean === 'pro' || clean === 'pro organizer') return SUBSCRIPTION_PLAN_CATALOG[1];
  return SUBSCRIPTION_PLAN_CATALOG[0];
}

export function isPlanExpired(profile?: Pick<OrganizerProfile, 'plan' | 'planExpiresAt'> | null): boolean {
  if (!profile || profile.plan === 'Starter') return false;
  if (!profile.planExpiresAt) return false;
  const ts = Date.parse(profile.planExpiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts < Date.now();
}

export function getEffectivePlan(
  profile?: Pick<OrganizerProfile, 'plan' | 'planExpiresAt'> | null
): SubscriptionPlanName {
  if (!profile) return 'Starter';
  if (isPlanExpired(profile)) return 'Starter';
  return getPlanDefinition(profile.plan).name;
}

export function getPlanEntitlements(
  planOrProfile?:
    | SubscriptionPlanName
    | Pick<OrganizerProfile, 'plan' | 'planExpiresAt'>
    | null
): PlanEntitlements {
  if (!planOrProfile) return SUBSCRIPTION_PLAN_CATALOG[0].entitlements;
  const planName =
    typeof planOrProfile === 'string'
      ? getPlanDefinition(planOrProfile).name
      : getEffectivePlan(planOrProfile);
  return getPlanDefinition(planName).entitlements;
}

export interface AuthoritativeSubscriptionQuote {
  planId: Exclude<SubscriptionPlanId, 'starter'>;
  planName: Exclude<SubscriptionPlanName, 'Starter'>;
  billingCycle: BillingCycle;
  amountUsd: number;
  amountGhs: number;
  durationDays: number;
}

export function resolveAuthoritativeSubscriptionQuote(input: {
  planId?: string;
  planName?: string;
  billingCycle?: string;
  expectedAmountGhs?: number;
}): AuthoritativeSubscriptionQuote {
  const rawPlan = (input.planId || input.planName || '').trim().toLowerCase();
  const def = getPlanDefinition(rawPlan);
  if (def.id === 'starter') {
    throw new Error('Starter is a free tier and does not require subscription checkout. Use downgrade instead.');
  }
  const billingCycle: BillingCycle = input.billingCycle === 'annual' ? 'annual' : 'monthly';
  const amountUsd = billingCycle === 'annual' ? def.annualUsd : def.monthlyUsd;
  const amountGhs = billingCycle === 'annual' ? def.annualGhs : def.monthlyGhs;
  const durationDays = billingCycle === 'annual' ? 365 : 30;

  if (input.expectedAmountGhs !== undefined && Number.isFinite(Number(input.expectedAmountGhs))) {
    const diff = Math.abs(Number(input.expectedAmountGhs) - amountGhs);
    if (diff > 0.01) {
      throw new Error(
        `Subscription amount mismatch for ${def.name} (${billingCycle}): expected GH₵ ${amountGhs.toFixed(2)}, got GH₵ ${Number(input.expectedAmountGhs).toFixed(2)}.`
      );
    }
  }

  return {
    planId: def.id,
    planName: def.name as Exclude<SubscriptionPlanName, 'Starter'>,
    billingCycle,
    amountUsd,
    amountGhs,
    durationDays,
  };
}

export function computePlanExpiresAtIso(billingCycle: BillingCycle, baseDate = new Date()): string {
  const days = billingCycle === 'annual' ? 365 : 30;
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function isActiveEventStatus(status?: string): boolean {
  return status === 'live' || status === 'upcoming';
}

export function getEffectiveEventCapacity(
  eventCapacity: number,
  ownerPlanOrProfile?: SubscriptionPlanName | Pick<OrganizerProfile, 'plan' | 'planExpiresAt'> | null
): number {
  const ent = getPlanEntitlements(ownerPlanOrProfile);
  const rawCap = Math.max(1, Number(eventCapacity) || 50);
  if (ent.maxAttendeesPerEvent != null) {
    return Math.min(rawCap, ent.maxAttendeesPerEvent);
  }
  return rawCap;
}

export function hasCustomSenderIdValue(senderId?: string | null): boolean {
  const clean = (senderId || '').trim();
  if (!clean) return false;
  return clean.toUpperCase() !== DEFAULT_SHARED_SENDER_ID;
}

export function hasCustomMessageOverrides(
  incoming?: EventItem['messageConfig'],
  existing?: EventItem['messageConfig']
): boolean {
  if (!incoming) return false;
  const defaults = getDefaultMessageConfig();
  const keys: Array<'confirmationMessage' | 'reminderMessage' | 'checkInMessage' | 'thankYouMessage'> = [
    'confirmationMessage',
    'reminderMessage',
    'checkInMessage',
    'thankYouMessage',
  ];
  for (const k of keys) {
    const val = (incoming[k] || '').trim();
    if (!val) continue;
    const prev = (existing?.[k] || '').trim();
    if (val !== defaults[k] && val !== prev) {
      return true;
    }
  }
  return false;
}
