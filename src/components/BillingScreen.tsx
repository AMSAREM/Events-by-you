import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  CreditCard,
  ExternalLink,
  Infinity as InfinityIcon,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { api, type ArkeselStatusResponse } from '../lib/api';
import {
  calculateCustomBundleQuote,
  SMS_BUNDLE_CATALOG,
} from '../lib/smsBundles';
import {
  getPlanEntitlements,
  isPlanExpired,
  resolveAuthoritativeSubscriptionQuote,
  STARTER_MAX_ACTIVE_EVENTS,
  STARTER_MAX_ATTENDEES_PER_EVENT,
  SUBSCRIPTION_PLAN_CATALOG,
  type BillingCycle,
} from '../lib/subscriptionPlans';
import {
  EventItem,
  OrganizerProfile,
  SmsBundlePurchase,
  SubscriptionPayment,
} from '../types/events';

interface BillingScreenProps {
  profile: OrganizerProfile;
  events: EventItem[];
  onUpdateProfile: (profile: OrganizerProfile) => void;
  onSyncProfile?: (profile: OrganizerProfile) => void;
  initialCheckoutBundleId?: string | null;
  onConsumeInitialBundle?: () => void;
  pendingPaystackRef?: string | null;
  onConsumePaystackRef?: () => void;
  pendingSubscriptionRef?: string | null;
  onConsumeSubscriptionRef?: () => void;
}

const SPEC_ROWS = [
  {
    capability: 'Concurrent Active Events',
    free: '1 Active Event Max',
    pro: 'Unlimited concurrent',
    layer: 'plan_limits',
  },
  {
    capability: 'Attendee Headcount Limit',
    free: '50 Registrations / event',
    pro: 'Unlimited registrations',
    layer: 'check_attendee_cap()',
  },
  {
    capability: 'Arkesel SMS Balance Model',
    free: '0 starter (pay-as-you-buy)',
    pro: 'Purchased SMS bundles only',
    layer: 'sms_bundle_ledger',
  },
  {
    capability: 'Alphanumeric Sender ID',
    free: 'Generic "EVENTSAPP"',
    pro: 'Custom (11 Alphanumeric)',
    layer: 'Arkesel Carrier Registry',
  },
  {
    capability: 'Dynamic Message Templates',
    free: 'System default only',
    pro: 'Full Custom Variables',
    layer: 'Template Engine Validator',
  },
  {
    capability: 'Attendee CSV Data Export',
    free: 'Locked',
    pro: 'Full Unlocked',
    layer: 'can_export_attendees',
  },
  {
    capability: 'Multi-Channel Thank-You Blasts',
    free: 'Email only',
    pro: 'Dual SMS + Resend Email',
    layer: 'Queue Worker Dispatcher',
  },
  {
    capability: 'Public Registration Page Branding',
    free: 'Events By You Footer Badge',
    pro: 'Zero Branding / White-label',
    layer: 'SSR Template Renderer',
  },
];

export const BillingScreen: React.FC<BillingScreenProps> = ({
  profile,
  events,
  onUpdateProfile,
  onSyncProfile,
  initialCheckoutBundleId,
  onConsumeInitialBundle,
  pendingPaystackRef,
  onConsumePaystackRef,
  pendingSubscriptionRef,
  onConsumeSubscriptionRef,
}) => {
  const [isAnnual, setIsAnnual] = useState(false);
  const [customCredits, setCustomCredits] = useState(2500);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [arkeselStatus, setArkeselStatus] = useState<ArkeselStatusResponse | null>(null);
  const [arkeselLoading, setArkeselLoading] = useState(false);
  const [purchases, setPurchases] = useState<SmsBundlePurchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [subPayments, setSubPayments] = useState<SubscriptionPayment[]>([]);
  const [subPaymentsLoading, setSubPaymentsLoading] = useState(false);
  const [checkoutDraft, setCheckoutDraft] = useState<{
    bundleId: string;
    bundleName: string;
    credits: number;
    amountGhs: number;
  } | null>(null);
  const [paymentChannel, setPaymentChannel] = useState('Arkesel Portal Wallet');
  const [arkeselReference, setArkeselReference] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [paystackInitializing, setPaystackInitializing] = useState(false);
  const [verifyingRef, setVerifyingRef] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [planCheckoutDraft, setPlanCheckoutDraft] = useState<{
    planId: 'pro' | 'enterprise';
    planName: 'Pro Organizer' | 'Enterprise';
    billingCycle: BillingCycle;
    amountUsd: number;
    amountGhs: number;
  } | null>(null);
  const [subPaymentChannel, setSubPaymentChannel] = useState('Paystack MoMo / Card');
  const [subReceiptReference, setSubReceiptReference] = useState('');
  const [subPurchasing, setSubPurchasing] = useState(false);
  const [subPaystackInitializing, setSubPaystackInitializing] = useState(false);
  const [verifyingSubRef, setVerifyingSubRef] = useState<string | null>(null);
  const [subCheckoutError, setSubCheckoutError] = useState<string | null>(null);
  const [downgradeConfirmOpen, setDowngradeConfirmOpen] = useState(false);
  const [downgrading, setDowngrading] = useState(false);

  const entitlements = getPlanEntitlements(profile);
  const effectivePlan = entitlements.plan;
  const planExpired = isPlanExpired(profile);
  const isPro = effectivePlan !== 'Starter';
  const activeEventsCount = events.filter((e) => e.status === 'live' || e.status === 'upcoming').length;
  const topEvent = events.find((e) => e.status === 'live' || e.status === 'upcoming') ?? events[0];
  const topRegistered = topEvent?.registered ?? 0;
  const topEffectiveCap = topEvent
    ? Math.min(topEvent.capacity, entitlements.maxAttendeesPerEvent ?? topEvent.capacity)
    : STARTER_MAX_ATTENDEES_PER_EVENT;
  const topFillPct = topEvent
    ? Math.min(100, Math.round((topRegistered / Math.max(1, topEffectiveCap)) * 100))
    : 0;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4500);
  }, []);

  const syncProfileState = useCallback(
    (nextProfile: OrganizerProfile) => {
      if (onSyncProfile) {
        onSyncProfile(nextProfile);
      } else {
        onUpdateProfile(nextProfile);
      }
    },
    [onSyncProfile, onUpdateProfile]
  );

  const refreshBillingTelemetry = useCallback(async () => {
    setArkeselLoading(true);
    setPurchasesLoading(true);
    setSubPaymentsLoading(true);
    try {
      const [status, ledger, subLedger] = await Promise.all([
        api.studio.getArkeselStatus(),
        api.studio.getSmsPurchases().catch(() => null),
        api.studio.getSubscriptionPayments().catch(() => null),
      ]);
      setArkeselStatus(status);
      if (ledger && Array.isArray(ledger.purchases)) {
        setPurchases(ledger.purchases);
      }
      if (subLedger && Array.isArray(subLedger.payments)) {
        setSubPayments(subLedger.payments);
      }
    } catch {
      // Keep previous status if network fails
    } finally {
      setArkeselLoading(false);
      setPurchasesLoading(false);
      setSubPaymentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBillingTelemetry();
  }, [refreshBillingTelemetry]);

  const handleVerifyPaystack = useCallback(
    async (reference: string) => {
      const clean = reference.trim();
      if (!clean) return;
      setVerifyingRef(clean);
      setCheckoutError(null);
      try {
        const res = await api.studio.verifyPaystackBundle(clean);
        syncProfileState(res.profile);
        setArkeselStatus(res.arkeselStatus);
        showToast(res.message);
        await refreshBillingTelemetry();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to verify Paystack transaction.';
        setCheckoutError(msg);
        showToast(msg);
      } finally {
        setVerifyingRef(null);
      }
    },
    [refreshBillingTelemetry, showToast, syncProfileState]
  );

  const handleVerifySubscriptionPaystack = useCallback(
    async (reference: string) => {
      const clean = reference.trim();
      if (!clean) return;
      setVerifyingSubRef(clean);
      setSubCheckoutError(null);
      try {
        const res = await api.studio.verifySubscriptionPaystack(clean);
        syncProfileState(res.profile);
        showToast(res.message);
        await refreshBillingTelemetry();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to verify subscription payment.';
        setSubCheckoutError(msg);
        showToast(msg);
      } finally {
        setVerifyingSubRef(null);
      }
    },
    [refreshBillingTelemetry, showToast, syncProfileState]
  );

  useEffect(() => {
    if (!pendingPaystackRef) return;
    const ref = pendingPaystackRef;
    onConsumePaystackRef?.();
    void handleVerifyPaystack(ref);
  }, [pendingPaystackRef, onConsumePaystackRef, handleVerifyPaystack]);

  useEffect(() => {
    if (!pendingSubscriptionRef) return;
    const ref = pendingSubscriptionRef;
    onConsumeSubscriptionRef?.();
    void handleVerifySubscriptionPaystack(ref);
  }, [pendingSubscriptionRef, onConsumeSubscriptionRef, handleVerifySubscriptionPaystack]);

  const openBundleCheckout = useCallback(
    (bundle: {
      bundleId: string;
      bundleName: string;
      credits: number;
      amountGhs: number;
    }) => {
      setCheckoutError(null);
      setArkeselReference('');
      setCheckoutDraft(bundle);
    },
    []
  );

  useEffect(() => {
    if (!initialCheckoutBundleId) return;
    const match = SMS_BUNDLE_CATALOG.find((p) => p.id === initialCheckoutBundleId);
    onConsumeInitialBundle?.();
    if (match) {
      openBundleCheckout({
        bundleId: match.id,
        bundleName: match.name,
        credits: match.credits,
        amountGhs: match.amountGhs,
      });
      setTimeout(() => {
        document.getElementById('carrier-bundles')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [initialCheckoutBundleId, onConsumeInitialBundle, openBundleCheckout]);

  const handlePayWithPaystack = async () => {
    if (!checkoutDraft || paystackInitializing) return;
    setPaystackInitializing(true);
    setCheckoutError(null);
    try {
      const callbackUrl = `${window.location.origin}/`;
      const res = await api.studio.initializePaystackBundle({
        bundleId: checkoutDraft.bundleId,
        credits: checkoutDraft.credits,
        amountGhs: checkoutDraft.amountGhs,
        callbackUrl,
      });
      await refreshBillingTelemetry();
      showToast(`Redirecting to Paystack checkout (${res.reference})...`);
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : 'Failed to start Paystack payment checkout.'
      );
      setPaystackInitializing(false);
    }
  };

  const handleConfirmBundlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutDraft || purchasing) return;
    const trimmedRef = arkeselReference.trim();
    if (trimmedRef.length < 6) {
      setCheckoutError(
        'Enter your real Arkesel or Mobile Money transaction reference (at least 6 characters).'
      );
      return;
    }
    setPurchasing(true);
    setCheckoutError(null);
    try {
      const res = await api.studio.purchaseSmsBundle({
        ...checkoutDraft,
        paymentChannel,
        arkeselReference: trimmedRef,
      });
      if (onSyncProfile) {
        onSyncProfile(res.profile);
      } else {
        onUpdateProfile(res.profile);
      }
      setArkeselStatus(res.arkeselStatus);
      setCheckoutDraft(null);
      showToast(res.message);
      await refreshBillingTelemetry();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to submit SMS bundle receipt.');
    } finally {
      setPurchasing(false);
    }
  };

  const openPlanCheckout = (planId: 'pro' | 'enterprise', billingCycle: BillingCycle) => {
    const quote = resolveAuthoritativeSubscriptionQuote({ planId, billingCycle });
    setSubCheckoutError(null);
    setSubReceiptReference('');
    setDowngradeConfirmOpen(false);
    setPlanCheckoutDraft({
      planId: quote.planId,
      planName: quote.planName,
      billingCycle: quote.billingCycle,
      amountUsd: quote.amountUsd,
      amountGhs: quote.amountGhs,
    });
    setTimeout(() => {
      document.getElementById('subscription-checkout-drawer')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
  };

  const handlePaySubscriptionWithPaystack = async () => {
    if (!planCheckoutDraft || subPaystackInitializing) return;
    setSubPaystackInitializing(true);
    setSubCheckoutError(null);
    try {
      const callbackUrl = `${window.location.origin}/`;
      const res = await api.studio.initializeSubscriptionPaystack({
        planId: planCheckoutDraft.planId,
        planName: planCheckoutDraft.planName,
        billingCycle: planCheckoutDraft.billingCycle,
        amountGhs: planCheckoutDraft.amountGhs,
        callbackUrl,
      });
      await refreshBillingTelemetry();
      showToast(`Redirecting to Paystack subscription checkout (${res.reference})...`);
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      setSubCheckoutError(
        err instanceof Error ? err.message : 'Failed to initialize Paystack subscription checkout.'
      );
      setSubPaystackInitializing(false);
    }
  };

  const handleConfirmSubscriptionPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planCheckoutDraft || subPurchasing) return;
    const trimmedRef = subReceiptReference.trim();
    if (trimmedRef.length < 6) {
      setSubCheckoutError(
        'Enter your real Paystack, Mobile Money, or bank transfer reference (at least 6 characters).'
      );
      return;
    }
    setSubPurchasing(true);
    setSubCheckoutError(null);
    try {
      const res = await api.studio.purchaseSubscription({
        planId: planCheckoutDraft.planId,
        planName: planCheckoutDraft.planName,
        billingCycle: planCheckoutDraft.billingCycle,
        amountGhs: planCheckoutDraft.amountGhs,
        paymentChannel: subPaymentChannel,
        receiptReference: trimmedRef,
      });
      syncProfileState(res.profile);
      setPlanCheckoutDraft(null);
      showToast(res.message);
      await refreshBillingTelemetry();
    } catch (err) {
      setSubCheckoutError(
        err instanceof Error ? err.message : 'Unable to submit subscription payment receipt.'
      );
    } finally {
      setSubPurchasing(false);
    }
  };

  const handleDowngradeToStarter = async () => {
    if (downgrading) return;
    setDowngrading(true);
    try {
      const res = await api.studio.downgradeSubscription();
      syncProfileState(res.profile);
      setDowngradeConfirmOpen(false);
      showToast(res.message);
      await refreshBillingTelemetry();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to downgrade subscription.');
    } finally {
      setDowngrading(false);
    }
  };

  const customQuote = calculateCustomBundleQuote(customCredits);
  const customTotalGhs = customQuote.amountGhs;

  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-8">
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-xl inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP BAR: Page Title & Quick Sandbox Test Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] sm:text-[34px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Plan &amp; Credits
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5">
            Manage organizer subscription tiers, capacity limits, and direct-carrier Arkesel SMS balances.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('carrier-bundles');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Buy SMS Bundle</span>
          </button>
        </div>
      </div>

      {/* SECTION: ORGANISER ACCOUNT STATUS BANNER */}
      <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
              Organiser Account Status
            </span>
            <span
              className={`px-3 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                isPro ? 'bg-[#0B0B0B] text-white' : 'bg-[#E2E2E4] text-[#0B0B0B]'
              }`}
            >
              {isPro ? `${effectivePlan} Active` : 'Starter Free Tier'}
            </span>
            {planExpired && (
              <span className="px-2.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold">
                Subscription Expired · Starter Limits Enforced
              </span>
            )}
            {isPro && profile.planExpiresAt && (
              <span className="text-[11px] font-mono text-[#71717A]">
                {profile.planBillingCycle === 'annual' ? 'Annual' : 'Monthly'} · renews{' '}
                {new Date(profile.planExpiresAt).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center font-semibold text-sm shrink-0">
              {initials}
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#0B0B0B]">{profile.name}</h2>
              <p className="text-xs text-[#71717A]">{profile.email}</p>
            </div>
          </div>
        </div>

        {/* Live Telemetry Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 flex-1 lg:max-w-2xl">
          <div className="bg-white rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
              SMS Balance
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] tabular-nums">
                {profile.smsCredits.toLocaleString()}
              </span>
              <span className="text-xs text-[#71717A]">credits</span>
            </div>
            <span className="text-[11px] text-[#71717A] mt-2">
              {profile.smsCredits <= 0
                ? '0 credits — purchase an SMS bundle to send SMS'
                : profile.smsCredits < 100
                  ? 'Low bundle balance alert'
                  : 'Direct Arkesel bundle credits'}
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
              Active Events
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] tabular-nums">
                {isPro
                  ? activeEventsCount
                  : `${Math.min(activeEventsCount, STARTER_MAX_ACTIVE_EVENTS)}/${STARTER_MAX_ACTIVE_EVENTS}`}
              </span>
              <span className="text-xs text-[#71717A]">{isPro ? 'unlimited' : 'cap'}</span>
            </div>
            <div className="w-full bg-[#EEEEF0] h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-[#0B0B0B] h-full rounded-full transition-all duration-300"
                style={{
                  width: isPro
                    ? `${Math.min(100, Math.max(18, activeEventsCount * 15))}%`
                    : `${Math.min(100, Math.round((activeEventsCount / STARTER_MAX_ACTIVE_EVENTS) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 col-span-2 sm:col-span-1 flex flex-col justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
              Attendee Cap
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] tabular-nums">
                {entitlements.maxAttendeesPerEvent === null ? '∞' : topRegistered}
              </span>
              <span className="text-xs text-[#71717A] tabular-nums">
                {entitlements.maxAttendeesPerEvent === null
                  ? 'uncapped'
                  : `/ ${topEffectiveCap.toLocaleString()} limit`}
              </span>
            </div>
            <span className="text-[11px] text-[#71717A] mt-2 truncate tabular-nums">
              {profile.planAttendeeCapacity !== undefined && (
                <span className="font-semibold text-[#0B0B0B]">
                  {entitlements.maxAttendeesPerEvent === null
                    ? 'Creator Unlimited · '
                    : `Creator Cap (${entitlements.maxAttendeesPerEvent.toLocaleString()}) · `}
                </span>
              )}
              {topEvent ? `${topEvent.title}: ${topFillPct}% full` : 'Ready'}
            </span>
          </div>
        </div>
      </section>

      {/* SECTION: SUBSCRIPTION TIERS */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
              Subscription Tiers
            </h2>
            <p className="text-xs text-[#71717A]">
              Strictly enforced server-side &amp; in Postgres RLS triggers — upgrades require verified payment activation.
            </p>
          </div>

          <div className="inline-flex items-center p-1 bg-[#F5F5F7] rounded-full self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setIsAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                !isAnnual ? 'bg-white text-[#0B0B0B] shadow-sm' : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setIsAnnual(true)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-1.5 ${
                isAnnual ? 'bg-white text-[#0B0B0B] shadow-sm' : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <span>Annual</span>
              <span className="px-1.5 py-0.5 rounded-full bg-[#E2E2E4] text-[#0B0B0B] text-[10px] font-semibold">
                2 mos free
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
          {SUBSCRIPTION_PLAN_CATALOG.map((tier) => {
            const isCurrent = effectivePlan === tier.name;
            const cycle: BillingCycle = isAnnual ? 'annual' : 'monthly';
            const priceUsd = isAnnual ? tier.annualUsd : tier.monthlyUsd;
            const priceGhs = isAnnual ? tier.annualGhs : tier.monthlyGhs;
            const isStarter = tier.id === 'starter';
            const starterEventsPct = Math.min(
              100,
              Math.round((activeEventsCount / STARTER_MAX_ACTIVE_EVENTS) * 100)
            );
            const isSelectedDraft =
              planCheckoutDraft?.planId === tier.id && planCheckoutDraft?.billingCycle === cycle;

            return (
              <div
                key={tier.id}
                className={`rounded-3xl p-6 sm:p-7 flex flex-col justify-between gap-6 transition-all ${
                  isStarter
                    ? 'bg-[#F5F5F7]'
                    : tier.featured
                      ? 'bg-white border-2 border-[#0B0B0B] shadow-sm'
                      : 'bg-white border border-[#E5E5EA] shadow-sm'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-base font-bold text-[#0B0B0B]">
                      <span>{tier.name}</span>
                      {!isStarter && <Sparkles className="w-4 h-4" />}
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                        isCurrent
                          ? 'bg-[#0B0B0B] text-white'
                          : tier.featured
                            ? 'bg-[#F5F5F7] text-[#0B0B0B]'
                            : 'bg-white text-[#71717A] border border-[#E5E5EA]'
                      }`}
                    >
                      {isCurrent
                        ? 'Current Tier'
                        : isStarter
                          ? 'Community'
                          : tier.featured
                            ? 'Most Popular'
                            : 'Multi-Venue'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-[34px] leading-none font-bold text-[#0B0B0B] tabular-nums">
                        ${priceUsd.toLocaleString()}
                      </span>
                      <span className="text-sm text-[#71717A]">
                        {isStarter ? '/ forever' : isAnnual ? '/ year' : '/ month'}
                      </span>
                    </div>
                    {!isStarter && (
                      <p className="text-xs font-mono font-semibold text-[#0B0B0B] mt-1 tabular-nums">
                        GH₵ {priceGhs.toLocaleString()} {isAnnual ? 'per year' : 'per month'}
                      </p>
                    )}
                    <p className="text-xs text-[#71717A] mt-1">{tier.tagline}</p>
                  </div>

                  {isStarter ? (
                    <div className="space-y-2.5">
                      <div className="bg-white rounded-2xl p-3.5 space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span>Active Events Limit</span>
                          <span className="tabular-nums">
                            {Math.min(activeEventsCount, STARTER_MAX_ACTIVE_EVENTS)} / {STARTER_MAX_ACTIVE_EVENTS} (Cap)
                          </span>
                        </div>
                        <div className="w-full bg-[#E8E8EA] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[#0B0B0B] h-full rounded-full transition-all"
                            style={{ width: `${starterEventsPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl p-3.5 space-y-1.5">
                        {(() => {
                          const tierSeatCap = isCurrent
                            ? entitlements.maxAttendeesPerEvent
                            : STARTER_MAX_ATTENDEES_PER_EVENT;
                          const starterSeatPct =
                            tierSeatCap === null
                              ? 0
                              : Math.min(
                                  100,
                                  Math.round((topRegistered / Math.max(1, tierSeatCap)) * 100)
                                );
                          return (
                            <>
                              <div className="flex justify-between text-xs font-semibold">
                                <span>Top Event Seat Cap</span>
                                <span className="tabular-nums">
                                  {tierSeatCap === null
                                    ? 'Unlimited (Creator Boost)'
                                    : `${Math.min(topRegistered, tierSeatCap)} / ${tierSeatCap.toLocaleString()} (${starterSeatPct}%)`}
                                </span>
                              </div>
                              <div className="w-full bg-[#E8E8EA] h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    tierSeatCap !== null && starterSeatPct >= 85
                                      ? 'bg-[#EF4444]'
                                      : 'bg-[#0B0B0B]'
                                  }`}
                                  style={{
                                    width: tierSeatCap === null ? '100%' : `${starterSeatPct}%`,
                                  }}
                                />
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-3 rounded-2xl bg-[#F5F5F7] flex items-center gap-2">
                        <InfinityIcon className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                        <div>
                          <span className="text-xs font-bold text-[#0B0B0B] block">Unlimited</span>
                          <span className="text-[10px] text-[#71717A]">Active Events</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-2xl bg-[#F5F5F7] flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                        <div>
                          <span className="text-xs font-bold text-[#0B0B0B] block">Uncapped</span>
                          <span className="text-[10px] text-[#71717A]">Attendees</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 pt-1 text-xs">
                    {tier.features.map((feat) => (
                      <div key={feat} className="flex items-start gap-2 text-[#0B0B0B]">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </div>
                    ))}
                    {tier.limitations.map((lim) => (
                      <div key={lim} className="flex items-start gap-2 text-[#71717A]">
                        <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{lim} (Locked)</span>
                      </div>
                    ))}
                  </div>
                </div>

                {isStarter ? (
                  !isPro ? (
                    <button
                      type="button"
                      disabled
                      className="w-full py-3 px-4 rounded-full bg-[#E8E8EA] text-[#71717A] text-xs font-semibold cursor-not-allowed"
                    >
                      Active Tier • Starter
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDowngradeConfirmOpen(true)}
                      className="w-full py-3 px-4 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold transition-colors"
                    >
                      Downgrade to Starter Free Tier
                    </button>
                  )
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isCurrent}
                      onClick={() =>
                        openPlanCheckout(tier.id === 'enterprise' ? 'enterprise' : 'pro', cycle)
                      }
                      className={`w-full py-3 px-4 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all ${
                        isCurrent
                          ? 'bg-[#F5F5F7] text-[#71717A] cursor-not-allowed'
                          : isSelectedDraft
                            ? 'bg-emerald-700 text-white shadow-sm'
                            : 'bg-[#0B0B0B] hover:bg-zinc-800 text-white shadow-sm'
                      }`}
                    >
                      {isCurrent ? (
                        <>
                          <Check className="w-4 h-4 text-[#0B0B0B]" />
                          <span>{tier.name} Active</span>
                        </>
                      ) : (
                        <>
                          <span>
                            {effectivePlan === 'Pro Organizer' && tier.id === 'enterprise'
                              ? `Upgrade to Enterprise (GH₵ ${priceGhs.toLocaleString()})`
                              : `Subscribe to ${tier.name} (GH₵ ${priceGhs.toLocaleString()})`}
                          </span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                    <p className="text-[11px] text-[#71717A] text-center">
                      Paystack instant verification or manual receipt review
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Confirmed Downgrade Prompt */}
        {downgradeConfirmOpen && isPro && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[#0B0B0B]">
                Confirm Downgrade to Starter Free Tier
              </h3>
              <p className="text-xs text-[#52525B] max-w-2xl">
                Downgrading immediately re-enforces Starter limits (max 1 active event, 50 attendees/event, &ldquo;EVENTSAPP&rdquo; shared Sender ID, and Email-only broadcasts). Your purchased SMS bundle credits remain untouched.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={downgrading}
                onClick={() => setDowngradeConfirmOpen(false)}
                className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
              >
                Keep {effectivePlan}
              </button>
              <button
                type="button"
                disabled={downgrading}
                onClick={() => void handleDowngradeToStarter()}
                className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 disabled:opacity-50"
              >
                {downgrading ? 'Downgrading...' : 'Confirm Downgrade'}
              </button>
            </div>
          </div>
        )}

        {/* Verified Subscription Checkout Drawer */}
        {planCheckoutDraft && (
          <form
            id="subscription-checkout-drawer"
            onSubmit={handleConfirmSubscriptionPurchase}
            className="bg-white border-2 border-[#0B0B0B] rounded-3xl p-6 shadow-md space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                  Verified Subscription Plan Checkout
                </span>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B] mt-0.5">
                  {planCheckoutDraft.planName} ({planCheckoutDraft.billingCycle === 'annual' ? 'Annual' : 'Monthly'}) — GH₵{' '}
                  {planCheckoutDraft.amountGhs.toLocaleString()} (${planCheckoutDraft.amountUsd})
                </h3>
                <p className="text-xs text-[#71717A] mt-1 leading-relaxed max-w-2xl">
                  Plans activate automatically once Paystack confirms settlement, or submit a verified MoMo/Bank receipt for Creator Console approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanCheckoutDraft(null)}
                aria-label="Close subscription checkout"
                className="p-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#0B0B0B]" />
                  <span className="text-xs font-bold text-[#0B0B0B]">
                    Instant MoMo &amp; Card Activation (Paystack)
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      arkeselStatus?.paystackConfigured
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-white text-[#71717A] border border-[#E5E5EA]'
                    }`}
                  >
                    {arkeselStatus?.paystackConfigured ? 'Auto-Activates on Payment' : 'Not Configured'}
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  {arkeselStatus?.paystackConfigured
                    ? 'Verified server-side with Paystack before activating your tier atomically.'
                    : 'Set PAYSTACK_SECRET_KEY on the server for automated Paystack settlement, or submit a manual transfer receipt below.'}
                </p>
              </div>
              <button
                type="button"
                disabled={!arkeselStatus?.paystackConfigured || subPaystackInitializing}
                onClick={() => void handlePaySubscriptionWithPaystack()}
                className="px-4 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>
                  {subPaystackInitializing
                    ? 'Starting Paystack...'
                    : `Pay GH₵ ${planCheckoutDraft.amountGhs.toLocaleString()} Online`}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">Payment Channel</label>
                <select
                  value={subPaymentChannel}
                  onChange={(e) => setSubPaymentChannel(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#F5F5F7] border border-transparent focus:border-[#0B0B0B] text-xs font-medium text-[#0B0B0B] outline-none"
                >
                  <option value="Paystack MoMo / Card">Paystack / Card Transfer Receipt</option>
                  <option value="MTN Mobile Money">MTN Mobile Money Merchant</option>
                  <option value="Telecel Cash">Telecel Cash</option>
                  <option value="Ghana Interbank Transfer">Ghana Interbank / SWIFT Transfer</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">
                  Payment Receipt Reference <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  maxLength={80}
                  value={subReceiptReference}
                  onChange={(e) => setSubReceiptReference(e.target.value)}
                  placeholder="Required (6+ chars, e.g. SUB-MOMO-88412)"
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#F5F5F7] border border-transparent focus:border-[#0B0B0B] text-xs font-mono text-[#0B0B0B] outline-none"
                />
              </div>
            </div>

            {subCheckoutError && (
              <div className="px-4 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700">
                {subCheckoutError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EEEEF0]">
              <span className="text-[11px] text-[#71717A] inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#0B0B0B]" />
                Server checks amount (GH₵ {planCheckoutDraft.amountGhs.toLocaleString()}) &amp; deduplicates references.
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setPlanCheckoutDraft(null)}
                  className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={subPurchasing || subReceiptReference.trim().length < 6}
                  className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {subPurchasing
                      ? 'Submitting Receipt...'
                      : `Submit ${planCheckoutDraft.planName} Receipt`}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Subscription Payment & Activation Ledger */}
        <div className="bg-[#F5F5F7] rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-bold text-[#0B0B0B]">
                Subscription Payment &amp; Activation Ledger
              </h3>
              <p className="text-xs text-[#71717A]">
                All paid tier activations are backed by verified Paystack callbacks or approved manual payment receipts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshBillingTelemetry()}
              disabled={subPaymentsLoading}
              className="px-3.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${subPaymentsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {subPayments.length === 0 ? (
            <p className="text-xs text-[#71717A] bg-white rounded-2xl px-4 py-3 border border-[#E5E5EA]">
              No subscription payment records yet. Select Pro Organizer or Enterprise above to subscribe.
            </p>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E5E5EA] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Plan &amp; Cycle</th>
                    <th className="py-2.5 px-4">Amount</th>
                    <th className="py-2.5 px-4">Reference</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {subPayments.map((sp) => {
                    const badgeClass =
                      sp.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : sp.status === 'pending_verification' || sp.status === 'pending_payment'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-red-50 text-red-700 border-red-200';
                    const statusLabel =
                      sp.status === 'active'
                        ? 'Activated'
                        : sp.status === 'pending_verification'
                          ? 'Pending Verification'
                          : sp.status === 'pending_payment'
                            ? 'Awaiting Paystack'
                            : sp.status === 'rejected'
                              ? 'Rejected'
                              : 'Failed';
                    return (
                      <tr key={sp.id} className="hover:bg-[#F5F5F7]/50">
                        <td className="py-2.5 px-4 text-[#71717A] whitespace-nowrap tabular-nums">
                          {new Date(sp.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-[#0B0B0B]">
                          <div>
                            {sp.planName} ({sp.billingCycle})
                          </div>
                          <div className="text-[11px] font-normal text-[#71717A]">
                            {sp.paymentChannel}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#0B0B0B] tabular-nums">
                          GH₵ {sp.amountGhs.toLocaleString()} (${sp.amountUsd})
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#0B0B0B]">{sp.reference}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${badgeClass}`}
                          >
                            {(sp.status === 'pending_verification' || sp.status === 'pending_payment') && (
                              <Clock className="w-3 h-3" />
                            )}
                            {statusLabel}
                          </span>
                          {sp.rejectionReason && (
                            <p className="text-[11px] text-red-600 mt-1">{sp.rejectionReason}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {sp.provider === 'paystack' && sp.status === 'pending_payment' && (
                            <button
                              type="button"
                              disabled={verifyingSubRef === sp.reference}
                              onClick={() => void handleVerifySubscriptionPaystack(sp.reference)}
                              className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {verifyingSubRef === sp.reference ? 'Verifying...' : 'Verify Paystack'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* SECTION: DIRECT CARRIER SMS BUNDLES & CUSTOM QUANTITY SLIDER */}
      <section id="carrier-bundles" className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
              Arkesel Carrier Node v2
            </span>
            <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B] mt-0.5">
              Arkesel SMS Bundles &amp; Platform Billing
            </h2>
            <p className="text-xs text-[#71717A] mt-0.5">
              High-priority Tier-1 route delivery across MTN Ghana, Telecel, and AT networks via Arkesel v2 API.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="https://sms.arkesel.com/user/sms-api/info"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Arkesel SMS API Info</span>
              <ExternalLink className="w-3 h-3 text-[#71717A]" />
            </a>
            <a
              href="https://sms.arkesel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <span>Open Arkesel Platform</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Live Arkesel Gateway Connection & Balance Panel */}
        <div className="bg-[#F5F5F7] rounded-3xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#0B0B0B]">
                Arkesel Live Integration
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                  arkeselStatus?.live
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : arkeselStatus?.configured
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-white text-[#71717A] border border-[#E5E5EA]'
                }`}
              >
                {arkeselStatus?.live
                  ? 'Connected • Live Balance'
                  : arkeselStatus?.configured
                  ? 'Key Set • Check Gateway'
                  : arkeselStatus?.mode === 'sandbox'
                  ? 'Sandbox Mode'
                  : 'Checking Gateway'}
              </span>
            </div>
            <p className="text-xs text-[#71717A] max-w-xl leading-relaxed">
              Recharge your Arkesel merchant wallet directly on{' '}
              <a
                href="https://sms.arkesel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#0B0B0B] underline underline-offset-2"
              >
                sms.arkesel.com
              </a>{' '}
              (MTN MoMo, Telecel Cash, AT Money, or card), then verify live gateway units or record a bundle allocation to your organizer workspace below.
            </p>
            {arkeselStatus?.error && (
              <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{arkeselStatus.error}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
            <div className="bg-white rounded-2xl px-4 py-3 min-w-[120px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                Arkesel SMS
              </span>
              <p className="font-display text-lg font-bold text-[#0B0B0B] mt-0.5 tabular-nums">
                {arkeselStatus?.smsBalance !== null && arkeselStatus?.smsBalance !== undefined
                  ? arkeselStatus.smsBalance.toLocaleString()
                  : '—'}
              </p>
            </div>
            <div className="bg-white rounded-2xl px-4 py-3 min-w-[120px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                Main Wallet
              </span>
              <p className="font-display text-lg font-bold text-[#0B0B0B] mt-0.5 tabular-nums">
                {arkeselStatus?.mainBalance !== null && arkeselStatus?.mainBalance !== undefined
                  ? `GH₵ ${arkeselStatus.mainBalance.toLocaleString()}`
                  : '—'}
              </p>
            </div>
            <div className="bg-white rounded-2xl px-4 py-3 min-w-[120px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                Sender ID
              </span>
              <p className="font-mono text-sm font-bold text-[#0B0B0B] mt-1 truncate">
                {arkeselStatus?.senderId || profile.senderId || 'Arkesel'}
              </p>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => void refreshBillingTelemetry()}
                disabled={arkeselLoading}
                className="w-full h-full min-h-[54px] px-4 py-2 rounded-2xl bg-white hover:bg-[#0B0B0B] hover:text-white text-[#0B0B0B] border border-[#E5E5EA] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${arkeselLoading ? 'animate-spin' : ''}`} />
                <span>Refresh Balance</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SMS_BUNDLE_CATALOG.map((pack) => (
            <div
              key={pack.id}
              className={`rounded-3xl p-6 flex flex-col justify-between gap-5 transition-all ${
                pack.featured
                  ? 'bg-white border border-[#E5E5EA] shadow-sm'
                  : 'bg-[#F5F5F7] hover:bg-white hover:border hover:border-[#E5E5EA]'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold text-[#0B0B0B]">{pack.name}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
                      pack.featured
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-white text-[#0B0B0B]'
                    }`}
                  >
                    {pack.featured ? 'Best Value' : `${pack.credits.toLocaleString()} SMS`}
                  </span>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-[30px] leading-none font-bold text-[#0B0B0B] tabular-nums">
                    GH₵ {pack.amountGhs.toLocaleString()}
                  </span>
                  <span className="text-xs text-[#71717A] tabular-nums">{pack.approxUsd}</span>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-[#444748]">
                  <span className="tabular-nums">GH₵ {pack.unitRateGhs} per SMS</span>
                  {pack.savings && (
                    <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-[10px]">
                      {pack.savings}
                    </span>
                  )}
                </div>

                <p className="text-xs text-[#71717A] leading-relaxed">{pack.desc}</p>
              </div>

              <button
                type="button"
                onClick={() =>
                  openBundleCheckout({
                    bundleId: pack.id,
                    bundleName: pack.name,
                    credits: pack.credits,
                    amountGhs: pack.amountGhs,
                  })
                }
                className={`w-full py-2.5 px-4 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                  pack.featured
                    ? 'bg-[#0B0B0B] hover:bg-zinc-800 text-white'
                    : 'bg-white hover:bg-[#0B0B0B] hover:text-white text-[#0B0B0B] border border-[#E5E5EA]'
                }`}
              >
                Buy {pack.credits.toLocaleString()} SMS Credits
              </button>
            </div>
          ))}
        </div>

        {/* Custom Quantity Slider */}
        <div className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-md space-y-1">
            <div className="flex items-center gap-2 text-base font-bold text-[#0B0B0B]">
              <SlidersHorizontal className="w-4 h-4" />
              <span>Custom Credit Quantity</span>
            </div>
            <p className="text-xs text-[#71717A] leading-relaxed">
              Drag the slider to calculate tiered Ghanaian Cedi bulk billing totals for your exact summit attendance.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-5 flex-1 lg:max-w-xl">
            <div className="flex-1 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-[#71717A]">Quantity</span>
                <span className="text-[#0B0B0B] tabular-nums">
                  {customCredits.toLocaleString()} SMS Credits
                </span>
              </div>
              <input
                type="range"
                min={100}
                max={10000}
                step={100}
                value={customCredits}
                onChange={(e) => setCustomCredits(Number(e.target.value))}
                aria-label="Custom SMS credits quantity"
                className="w-full accent-[#0B0B0B] cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-[#71717A] tabular-nums">
                <span>100</span>
                <span>5,000</span>
                <span>10,000</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 flex flex-col items-center justify-center min-w-[180px] text-center shadow-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                Estimated Total
              </span>
              <span className="font-display text-[26px] leading-8 font-bold text-[#0B0B0B] mt-0.5 tabular-nums">
                GH₵ {customTotalGhs.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() =>
                  openBundleCheckout({
                    bundleId: 'custom',
                    bundleName: `Custom ${customCredits.toLocaleString()} SMS Bundle`,
                    credits: customCredits,
                    amountGhs: customTotalGhs,
                  })
                }
                className="mt-2.5 w-full py-2 px-4 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Checkout via Arkesel
              </button>
            </div>
          </div>
        </div>

        {/* Verified Bundle Checkout Drawer */}
        {checkoutDraft && (
          <form
            onSubmit={handleConfirmBundlePurchase}
            className="bg-white border border-[#E5E5EA] rounded-3xl p-6 shadow-md space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                  Verified SMS Bundle Checkout
                </span>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B] mt-0.5">
                  {checkoutDraft.bundleName} — {checkoutDraft.credits.toLocaleString()} SMS (GH₵{' '}
                  {checkoutDraft.amountGhs.toLocaleString()})
                </h3>
                <p className="text-xs text-[#71717A] mt-1 leading-relaxed max-w-2xl">
                  Pay instantly with Mobile Money or Card via Paystack, or pay directly on{' '}
                  <a
                    href="https://sms.arkesel.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#0B0B0B] underline underline-offset-2"
                  >
                    sms.arkesel.com
                  </a>{' '}
                  and submit your transaction receipt reference below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutDraft(null)}
                aria-label="Close bundle checkout"
                className="p-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Instant Paystack Gateway Option */}
            <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#0B0B0B]" />
                  <span className="text-xs font-bold text-[#0B0B0B]">
                    Instant MoMo &amp; Card Checkout (Paystack)
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      arkeselStatus?.paystackConfigured
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-white text-[#71717A] border border-[#E5E5EA]'
                    }`}
                  >
                    {arkeselStatus?.paystackConfigured ? 'Auto-Credits on Payment' : 'Not Configured'}
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] leading-relaxed">
                  {arkeselStatus?.paystackConfigured
                    ? 'Verified server-side with Paystack before crediting SMS units atomically.'
                    : 'Set PAYSTACK_SECRET_KEY on the server to enable automated MTN MoMo, Telecel Cash & Card settlement.'}
                </p>
              </div>
              <button
                type="button"
                disabled={!arkeselStatus?.paystackConfigured || paystackInitializing}
                onClick={() => void handlePayWithPaystack()}
                className="px-4 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>
                  {paystackInitializing
                    ? 'Starting Paystack...'
                    : `Pay GH₵ ${checkoutDraft.amountGhs.toLocaleString()} Online`}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">Arkesel Payment Channel</label>
                <select
                  value={paymentChannel}
                  onChange={(e) => setPaymentChannel(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#F5F5F7] border border-transparent focus:border-[#0B0B0B] text-xs font-medium text-[#0B0B0B] outline-none"
                >
                  <option value="Arkesel Portal Wallet">Arkesel Portal Wallet (sms.arkesel.com)</option>
                  <option value="MTN Mobile Money">MTN Mobile Money (via Arkesel)</option>
                  <option value="Telecel Cash">Telecel Cash (via Arkesel)</option>
                  <option value="AT Money">AT Money (via Arkesel)</option>
                  <option value="Visa / Mastercard">Visa / Mastercard (via Arkesel)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">
                  Transaction Receipt / Arkesel Reference <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  maxLength={80}
                  value={arkeselReference}
                  onChange={(e) => setArkeselReference(e.target.value)}
                  placeholder="Required (6+ chars, e.g. ARK-TX-904218)"
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#F5F5F7] border border-transparent focus:border-[#0B0B0B] text-xs font-mono text-[#0B0B0B] outline-none"
                />
              </div>
            </div>

            <div className="rounded-2xl bg-[#F5F5F7] px-4 py-3 text-[11px] text-[#52525B] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
              <span>
                {arkeselStatus?.mode === 'sandbox'
                  ? 'Sandbox Mode active: valid receipt references credit test SMS bundles immediately.'
                  : 'Live Carrier Protection: manual Arkesel/MoMo receipt references are logged as Pending Verification until verified and approved in the Apps Creator Console.'}
              </span>
            </div>

            {checkoutError && (
              <div className="px-4 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700">
                {checkoutError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EEEEF0]">
              <a
                href="https://sms.arkesel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <span>Open Arkesel Portal</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCheckoutDraft(null)}
                  className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={purchasing || arkeselReference.trim().length < 6}
                  className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>
                    {purchasing
                      ? 'Submitting Receipt...'
                      : arkeselStatus?.mode === 'sandbox'
                        ? `Credit +${checkoutDraft.credits.toLocaleString()} SMS (Sandbox)`
                        : `Submit Receipt (+${checkoutDraft.credits.toLocaleString()} SMS)`}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* SMS Bundle Purchase & Verification Ledger */}
        <div className="bg-[#F5F5F7] rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-bold text-[#0B0B0B]">
                SMS Bundle Purchase &amp; Verification Ledger
              </h3>
              <p className="text-xs text-[#71717A]">
                Idempotent transaction receipts — duplicate references cannot double-credit your workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshBillingTelemetry()}
              disabled={purchasesLoading}
              className="px-3.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${purchasesLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Ledger</span>
            </button>
          </div>

          {purchases.length === 0 ? (
            <p className="text-xs text-[#71717A] bg-white rounded-2xl px-4 py-3 border border-[#E5E5EA]">
              No SMS bundle purchases recorded yet.
            </p>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E5E5EA] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7] text-[#71717A] font-semibold">
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Bundle</th>
                    <th className="py-2.5 px-4">Credits</th>
                    <th className="py-2.5 px-4">Amount</th>
                    <th className="py-2.5 px-4">Reference</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA]">
                  {purchases.map((p) => {
                    const badgeClass =
                      p.status === 'credited'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : p.status === 'pending_verification' || p.status === 'pending_payment'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-red-50 text-red-700 border-red-200';
                    const statusLabel =
                      p.status === 'credited'
                        ? 'Credited'
                        : p.status === 'pending_verification'
                          ? 'Pending Verification'
                          : p.status === 'pending_payment'
                            ? 'Awaiting Paystack'
                            : p.status === 'rejected'
                              ? 'Rejected'
                              : 'Failed';
                    return (
                      <tr key={p.id} className="hover:bg-[#F5F5F7]/50">
                        <td className="py-2.5 px-4 text-[#71717A] whitespace-nowrap tabular-nums">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-[#0B0B0B]">
                          <div>{p.bundleName}</div>
                          <div className="text-[11px] font-normal text-[#71717A]">{p.paymentChannel}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#0B0B0B] tabular-nums">
                          +{p.credits.toLocaleString()} SMS
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#0B0B0B] tabular-nums">
                          GH₵ {p.amountGhs.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#0B0B0B]">{p.reference}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${badgeClass}`}
                          >
                            {p.status === 'pending_verification' && <Clock className="w-3 h-3" />}
                            {statusLabel}
                          </span>
                          {p.rejectionReason && (
                            <p className="text-[11px] text-red-600 mt-1">{p.rejectionReason}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {p.provider === 'paystack' && p.status === 'pending_payment' && (
                            <button
                              type="button"
                              disabled={verifyingRef === p.reference}
                              onClick={() => void handleVerifyPaystack(p.reference)}
                              className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {verifyingRef === p.reference ? 'Verifying...' : 'Verify Paystack'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* SECTION: SPECIFICATION MATRIX */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Specification &amp; Schema Enforcements
          </h2>
          <p className="text-xs text-[#71717A]">
            System quota rules enforced across event creation, registration, and bulk SMS dispatch.
          </p>
        </div>

        <div className="overflow-x-auto bg-[#F5F5F7] rounded-3xl p-4">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A] border-b border-[#E5E5EA]">
                <th className="py-3 px-4">Feature Capability</th>
                <th className="py-3 px-4 w-44">Free Tier</th>
                <th className="py-3 px-4 w-48 text-[#0B0B0B]">Pro Tier ($19/mo)</th>
                <th className="py-3 px-4 hidden sm:table-cell">Enforcement Layer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]/70 text-xs">
              {SPEC_ROWS.map((row) => (
                <tr key={row.capability} className="hover:bg-white/60 transition-colors">
                  <td className="py-3 px-4 font-semibold text-[#0B0B0B]">{row.capability}</td>
                  <td className="py-3 px-4 text-[#71717A]">{row.free}</td>
                  <td className="py-3 px-4 font-semibold text-[#0B0B0B]">{row.pro}</td>
                  <td className="py-3 px-4 text-[#71717A] font-mono hidden sm:table-cell">
                    {row.layer}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SUBSCRIPTION ENFORCEMENT FOOTER */}
      <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#0B0B0B]">Strict Subscription Enforcement</span>
              <span className="px-2.5 py-0.5 rounded-full bg-white text-[#0B0B0B] text-[11px] font-semibold">
                {effectivePlan}
              </span>
            </div>
            <p className="text-xs text-[#71717A] mt-1 max-w-2xl leading-relaxed">
              Plan entitlements and Arkesel SMS bundle credits are protected by database triggers and verified payment ledgers across the entire Creator Studio.
            </p>
          </div>
        </div>

        {isPro && (
          <button
            type="button"
            onClick={() => setDowngradeConfirmOpen(true)}
            className="px-4 py-2.5 rounded-full bg-white hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0 self-end md:self-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Downgrade to Starter Free Tier</span>
          </button>
        )}
      </section>
    </div>
  );
};
