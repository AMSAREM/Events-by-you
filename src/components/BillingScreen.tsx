import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Infinity as InfinityIcon,
  Lock,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Verified,
  Zap,
} from 'lucide-react';
import { EventItem, OrganizerProfile } from '../types/events';

interface BillingScreenProps {
  profile: OrganizerProfile;
  events: EventItem[];
  onUpdateProfile: (profile: OrganizerProfile) => void;
}

const CREDIT_BUNDLES = [
  {
    id: 'starter',
    name: 'Starter Pack',
    credits: 250,
    priceGhs: 'GH₵ 50',
    approxUsd: '(~$3.80)',
    unitRate: 'GH₵ 0.20 per SMS',
    desc: 'Ideal for intimate weddings, church fellowships, memorials, or boutique meetups.',
    featured: false,
  },
  {
    id: 'growth',
    name: 'Growth Pack',
    credits: 1000,
    priceGhs: 'GH₵ 175',
    approxUsd: '(~$13.20)',
    unitRate: 'GH₵ 0.175 per SMS',
    savings: '12.5% savings',
    desc: 'Recommended for concerts, church conventions, corporate galas, and morning guest reminders.',
    featured: true,
  },
  {
    id: 'summit',
    name: 'Enterprise Pack',
    credits: 5000,
    priceGhs: 'GH₵ 750',
    approxUsd: '(~$56.50)',
    unitRate: 'GH₵ 0.15 per SMS',
    savings: '25% savings',
    desc: 'For large festivals, multi-day conventions, automated turnstile entrance pings, and high-volume rosters.',
    featured: false,
  },
];

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
    capability: 'Monthly Arkesel SMS Grant',
    free: '20 initial credits',
    pro: '500 free credits / mo',
    layer: 'monthly_sms_grant',
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
    free: 'Events App Footer Badge',
    pro: 'Zero Branding / White-label',
    layer: 'SSR Template Renderer',
  },
];

export const BillingScreen: React.FC<BillingScreenProps> = ({
  profile,
  events,
  onUpdateProfile,
}) => {
  const [isAnnual, setIsAnnual] = useState(false);
  const [customCredits, setCustomCredits] = useState(2500);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isPro = profile.plan !== 'Starter';
  const activeEventsCount = events.filter((e) => e.status === 'live' || e.status === 'upcoming').length;
  const topEvent = events[0];
  const topFillPct = topEvent
    ? Math.min(100, Math.round((topEvent.registered / Math.max(1, topEvent.capacity)) * 100))
    : 0;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  const handleTopUp = (amount: number, packName: string) => {
    onUpdateProfile({
      ...profile,
      smsCredits: profile.smsCredits + amount,
    });
    showToast(`+${amount.toLocaleString()} SMS added via ${packName}`);
  };

  const handleUpgradeToPro = () => {
    if (isPro) return;
    onUpdateProfile({
      ...profile,
      plan: 'Pro Organizer',
      smsCredits: profile.smsCredits + 500,
    });
    showToast('Upgraded to Pro Organizer Tier! +500 bonus SMS credits granted.');
  };

  const handleResetFreeTier = () => {
    onUpdateProfile({
      ...profile,
      plan: 'Starter',
      smsCredits: 20,
    });
    showToast('Account reverted to Starter Free Tier sandbox state (20 credits).');
  };

  const customUnitRate = customCredits >= 5000 ? 0.15 : customCredits >= 1000 ? 0.175 : 0.2;
  const customTotalGhs = Math.round(customCredits * customUnitRate);

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
            onClick={() => handleTopUp(100, 'Test Credits Simulator')}
            className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+100 Test Credits</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('carrier-bundles');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Instant Top-Up</span>
          </button>
        </div>
      </div>

      {/* SECTION: ORGANISER ACCOUNT STATUS BANNER */}
      <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
              Organiser Account Status
            </span>
            <span
              className={`px-3 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                isPro ? 'bg-[#0B0B0B] text-white' : 'bg-[#E2E2E4] text-[#0B0B0B]'
              }`}
            >
              {isPro ? `${profile.plan} Active` : 'Free Starter Plan'}
            </span>
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
              {profile.smsCredits < 100 ? 'Low balance alert active' : 'Direct Arkesel route'}
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
              Active Events
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] tabular-nums">
                {isPro ? activeEventsCount : `${Math.min(activeEventsCount, 1)}/1`}
              </span>
              <span className="text-xs text-[#71717A]">{isPro ? 'unlimited' : 'cap'}</span>
            </div>
            <div className="w-full bg-[#EEEEF0] h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-[#0B0B0B] h-full rounded-full transition-all duration-300"
                style={{ width: isPro ? '24%' : '100%' }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 col-span-2 sm:col-span-1 flex flex-col justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
              Attendee Cap
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] tabular-nums">
                {isPro ? '∞' : topEvent?.registered ?? 42}
              </span>
              <span className="text-xs text-[#71717A] tabular-nums">
                {isPro ? 'uncapped' : `/ ${topEvent?.capacity ?? 50} limit`}
              </span>
            </div>
            <span className="text-[11px] text-[#71717A] mt-2 truncate tabular-nums">
              {topEvent ? `${topEvent.title}: ${topFillPct}% full` : 'Ready'}
            </span>
          </div>
        </div>
      </section>

      {/* SECTION: SUBSCRIPTION TIERS */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
              Subscription Tiers
            </h2>
            <p className="text-xs text-[#71717A]">
              Enforced at registration time via workspace schema triggers.
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* FREE TIER */}
          <div className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold text-[#0B0B0B]">Free Plan</span>
                <span className="px-3 py-1 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold shadow-sm">
                  {!isPro ? 'Current Tier' : 'Community Tier'}
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-[36px] leading-none font-bold text-[#0B0B0B] tabular-nums">
                    $0
                  </span>
                  <span className="text-sm text-[#71717A]">/ month</span>
                </div>
                <p className="text-xs text-[#71717A] mt-1">
                  Lifetime free for emerging independent community organizers
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="bg-white rounded-2xl p-3.5 space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Active Events Limit</span>
                    <span className="tabular-nums">1 / 1 (Cap)</span>
                  </div>
                  <div className="w-full bg-[#E8E8EA] h-1.5 rounded-full overflow-hidden">
                    <div className="bg-[#0B0B0B] h-full rounded-full w-full" />
                  </div>
                  <span className="text-[11px] text-[#71717A] block">
                    Cannot publish concurrent drafts
                  </span>
                </div>

                <div className="bg-white rounded-2xl p-3.5 space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Attendee Registration Gate</span>
                    <span className="tabular-nums">42 / 50 (84%)</span>
                  </div>
                  <div className="w-full bg-[#E8E8EA] h-1.5 rounded-full overflow-hidden">
                    <div className="bg-[#EF4444] h-full rounded-full w-[84%]" />
                  </div>
                  <span className="text-[11px] text-[#71717A] block">
                    Pauses automatically at 50 registrations
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 pt-1 text-xs">
                <div className="flex items-center gap-2.5 text-[#0B0B0B]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>20 starting Arkesel carrier SMS credits</span>
                </div>
                <div className="flex items-center gap-2.5 text-[#0B0B0B]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Standard QR ticket generation &amp; check-in app</span>
                </div>
                <div className="flex items-center gap-2.5 text-[#71717A]">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Custom SMS/Email templates (system default only)</span>
                </div>
                <div className="flex items-center gap-2.5 text-[#71717A]">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Attendee raw CSV exports locked</span>
                </div>
                <div className="flex items-center gap-2.5 text-[#71717A]">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Post-event thank you: Email only (SMS disabled)</span>
                </div>
              </div>
            </div>

            {!isPro ? (
              <button
                type="button"
                disabled
                className="w-full py-3 px-4 rounded-full bg-[#E8E8EA] text-[#71717A] text-xs font-semibold cursor-not-allowed"
              >
                Active Tier • Free Plan
              </button>
            ) : (
              <button
                type="button"
                onClick={handleResetFreeTier}
                className="w-full py-3 px-4 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold transition-colors"
              >
                Switch to Free Starter Tier
              </button>
            )}
          </div>

          {/* PRO TIER */}
          <div className="bg-white border border-[#E5E5EA] rounded-3xl p-6 sm:p-8 flex flex-col justify-between gap-6 shadow-sm">
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-base font-bold text-[#0B0B0B]">
                  <span>Pro Organizer Tier</span>
                  <Sparkles className="w-4 h-4" />
                </span>
                <span className="px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold uppercase tracking-wider">
                  Unlimited Scale
                </span>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-[36px] leading-none font-bold text-[#0B0B0B] tabular-nums">
                    {isAnnual ? '$190' : '$19'}
                  </span>
                  <span className="text-sm text-[#71717A]">
                    {isAnnual ? '/ year' : '/ month'}
                  </span>
                </div>
                <p className="text-xs text-[#71717A] mt-1">
                  {isAnnual
                    ? 'Includes 2 months free • Save $38 annually'
                    : 'Billed monthly • Cancel anytime with zero downtime'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-[#F5F5F7] flex items-center gap-2.5">
                  <InfinityIcon className="w-5 h-5 text-[#0B0B0B] shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-[#0B0B0B] block">Unlimited</span>
                    <span className="text-[11px] text-[#71717A]">Concurrent Events</span>
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#F5F5F7] flex items-center gap-2.5">
                  <UserPlus className="w-5 h-5 text-[#0B0B0B] shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-[#0B0B0B] block">No Attendee Cap</span>
                    <span className="text-[11px] text-[#71717A]">Zero Gatekeeping</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 pt-1 text-xs">
                {[
                  { strong: '500 bonus SMS credits', rest: ' added to carrier balance monthly' },
                  { strong: 'Custom Sender IDs', rest: ' registered on Arkesel (11 chars)' },
                  { strong: 'Customizable templates', rest: ' for SMS & Email with dynamic tokens' },
                  { strong: 'Instant CSV & TSV exports', rest: ' with check-in timestamps & Act 843 logs' },
                  { strong: 'Thank-you SMS broadcasts', rest: ' alongside Resend email blasts' },
                  { strong: '100% white-label', rest: ' registration pages with zero watermarks' },
                ].map((item) => (
                  <div key={item.strong} className="flex items-center gap-2.5 text-[#0B0B0B]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      <strong>{item.strong}</strong>
                      {item.rest}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleUpgradeToPro}
                disabled={isPro}
                className={`w-full py-3 px-4 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all ${
                  isPro
                    ? 'bg-[#F5F5F7] text-[#71717A] cursor-not-allowed'
                    : 'bg-[#0B0B0B] hover:bg-zinc-800 text-white shadow-sm'
                }`}
              >
                {isPro ? (
                  <>
                    <Check className="w-4 h-4 text-[#0B0B0B]" />
                    <span>{profile.plan} Active</span>
                  </>
                ) : (
                  <>
                    <span>Upgrade to Pro Tier</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              <p className="text-[11px] text-[#71717A] text-center">
                Instant unlock • Sandboxed quota enforcement
              </p>
            </div>
          </div>
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
              Direct Carrier SMS Bundles
            </h2>
            <p className="text-xs text-[#71717A] mt-0.5">
              High-priority Tier-1 route delivery across MTN Ghana, Telecel, and AT networks. Credits rollover automatically.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#71717A] shrink-0">
            <Verified className="w-4 h-4 text-[#0B0B0B]" />
            <span>Standard GSM-7 (160 chars/part)</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CREDIT_BUNDLES.map((pack) => (
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
                    {pack.priceGhs}
                  </span>
                  <span className="text-xs text-[#71717A] tabular-nums">{pack.approxUsd}</span>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-[#444748]">
                  <span className="tabular-nums">{pack.unitRate}</span>
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
                onClick={() => handleTopUp(pack.credits, pack.name)}
                className={`w-full py-2.5 px-4 rounded-full text-xs font-semibold transition-colors ${
                  pack.featured
                    ? 'bg-[#0B0B0B] hover:bg-zinc-800 text-white'
                    : 'bg-white hover:bg-[#0B0B0B] hover:text-white text-[#0B0B0B] border border-[#E5E5EA]'
                }`}
              >
                Top Up {pack.credits.toLocaleString()} Credits
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

            <div className="bg-white rounded-2xl p-4 flex flex-col items-center justify-center min-w-[165px] text-center shadow-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                Estimated Total
              </span>
              <span className="font-display text-[26px] leading-8 font-bold text-[#0B0B0B] mt-0.5 tabular-nums">
                GH₵ {customTotalGhs.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => handleTopUp(customCredits, 'Custom Bundle')}
                className="mt-2.5 w-full py-2 px-4 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold transition-colors"
              >
                Checkout
              </button>
            </div>
          </div>
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

      {/* SANDBOX CONTROLS FOOTER */}
      <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#0B0B0B]">Billing Engine Sandbox Mode</span>
              <span className="px-2.5 py-0.5 rounded-full bg-white text-[#0B0B0B] text-[11px] font-semibold">
                Live State Sync
              </span>
            </div>
            <p className="text-xs text-[#71717A] mt-1 max-w-2xl leading-relaxed">
              Upgrades and SMS top-ups update your organizer profile plan and Arkesel balance across the entire Creator Studio in real time.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetFreeTier}
          className="px-4 py-2.5 rounded-full bg-white hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap shrink-0 self-end md:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset to Default Free Tier</span>
        </button>
      </section>
    </div>
  );
};
