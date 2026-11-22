import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  Camera,
  Check,
  Gift,
  HelpCircle,
  Layers,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  Shield,
  Signal,
  Smartphone,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { BLOG_ARTICLES, FAQ_ITEMS, MARKETING_SEO } from '../lib/seoConfig';
import { MarketingLayout } from './MarketingLayout';
import { SeoHead } from './SeoHead';

interface SharedMarketingPageProps {
  isSignedIn: boolean;
  onNavigateStudio?: () => void;
  onSignOut?: () => void;
}

export const FeaturesPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  const features = [
    {
      icon: QrCode,
      badge: '0.3s Camera & Kiosk QR',
      title: 'Fullscreen Check-In & Gate QR Scanner',
      description:
        'Display a fullscreen Check-In QR Pass screen at venue entrances while volunteer ushers scan passes on mobile cameras with instant anti-passback protection.',
      points: ['Zero duplicate entries', 'Volunteer gate login', 'Real-time studio headcount'],
    },
    {
      icon: UserPlus,
      badge: 'E.164 & Circle Rules',
      title: 'Guest Validation, Custom Forms & RSVP',
      description:
        'Validate guests by invited circles (Family, Friends, VIP), collect custom attendee fields, normalize Ghanaian phone numbers (+233), and block duplicate phone RSVPs.',
      points: ['Invite code support', 'Custom select & text fields', '60-second passwordless RSVP'],
    },
    {
      icon: Camera,
      badge: '35mm Film Roll',
      title: 'Event Disposable Camera',
      description:
        'Turn every checked-in guest pass into a 5-shot 35mm disposable film camera roll with flash, zoom, Kodak/Ilford/CineStill film presets, darkroom timer, and printable contact sheets.',
      points: ['Check-in pass 5-shot unlock', 'Organiser darkroom control', 'A4 contact sheet PDF'],
    },
    {
      icon: Gift,
      badge: 'Standalone /e/slug/gifts',
      title: 'Standalone Gift Table & Desk Portal',
      description:
        'Keep cash, Mobile Money envelopes, and registry item pledges on their own dedicated gift portal and appointed desk attendant ledger — strictly isolated from gate check-in and Studio.',
      points: ['Scoped desk attendant links', 'MoMo & cash envelope ledger', 'Separate CSV reconciliation'],
    },
    {
      icon: MessageSquare,
      badge: 'Arkesel v2 & Resend',
      title: 'Transactional SMS & Email Passes',
      description:
        'Dispatch branded QR ticket tokens via MTN, Telecel, and AT carrier routes in under 3.2 seconds alongside Resend HTML email confirmations and post-event SMS thank-you blasts.',
      points: ['Custom Ghana NCA Sender IDs', 'GSM-7 credit optimizer', 'Delivery receipts (DLR)'],
    },
    {
      icon: Layers,
      badge: 'Flyers & Offline PWA',
      title: 'Designer Flyers, Schedule & Offline Cache',
      description:
        'Publish editorial invitation cards with custom 1200×630 OpenGraph previews, manage live stage schedules, export guest manifests to CSV, and scan offline via IndexedDB.',
      points: ['Multi-theme flyer cards', 'Zero data loss offline sync', 'Installable iOS & Android PWA'],
    },
  ];

  return (
    <MarketingLayout
      activePath="/features"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/features']} />

      <section className="bg-[#0B0B0B] text-white py-14 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Platform Capabilities
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] max-w-3xl">
            Every tool Ghanaian event organisers need from invitation to gate check-in.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            Built ground-up for West African carrier latency, venue connectivity drops, and clean
            separation between registration gates, gift table attendants, and organiser controls.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/signin"
              className="px-6 py-3 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center gap-2"
            >
              <span>Sign In to Launch an Event</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/pricing"
              className="px-6 py-3 rounded-full bg-white/10 text-white border border-white/20 text-xs font-semibold hover:bg-white/20 transition-colors"
            >
              Compare GHS &amp; USD Plans
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <article
                key={feat.title}
                className="bg-white rounded-[28px] p-6 border border-[#E5E5EA] flex flex-col justify-between gap-5 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono bg-[#F5F5F7] text-[#0B0B0B] px-2.5 py-1 rounded-full">
                      {feat.badge}
                    </span>
                  </div>
                  <h2 className="mt-4 font-display text-xl font-bold text-[#0B0B0B]">
                    {feat.title}
                  </h2>
                  <p className="mt-2 text-sm text-[#71717A] leading-relaxed">{feat.description}</p>
                </div>
                <ul className="space-y-2 pt-3 border-t border-[#E5E5EA] text-xs text-[#1A1C1D]">
                  {feat.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </MarketingLayout>
  );
};

export const PricingPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const smsBundles = [
    { name: 'Community Top-Up', credits: '200 SMS Credits', priceGhs: 'GHS 25.00', rate: 'GHS 0.125 / SMS' },
    { name: 'Wedding & Summit Pack', credits: '1,000 SMS Credits', priceGhs: 'GHS 110.00', rate: 'GHS 0.11 / SMS' },
    { name: 'Convention Pro Pack', credits: '5,000 SMS Credits', priceGhs: 'GHS 450.00', rate: 'GHS 0.09 / SMS' },
    { name: 'Enterprise Carrier Pack', credits: '20,000 SMS Credits', priceGhs: 'GHS 1,600.00', rate: 'GHS 0.08 / SMS' },
  ];

  return (
    <MarketingLayout
      activePath="/pricing"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/pricing']} />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
            Transparent Pricing in GHS &amp; USD
          </span>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
            Start free. Scale your Ghana events with zero per-ticket commissions.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#71717A]">
            Pay in Ghana Cedis (GHS) via Paystack Mobile Money or card, or settle in USD for regional summits.
          </p>

          <div className="mt-7 inline-flex items-center p-1 bg-[#E8E8EA] rounded-full border border-[#E5E5EA]">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-white text-[#0B0B0B] shadow-sm'
                  : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              Billed Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${
                billingCycle === 'annual'
                  ? 'bg-white text-[#0B0B0B] shadow-sm'
                  : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <span>Billed Annually</span>
              <span className="text-emerald-600 text-[10px] font-bold">SAVE 20%</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
          <article className="bg-white p-8 rounded-3xl border border-[#E5E5EA] shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#0B0B0B]">
                  Free Starter Tier
                </span>
                <span className="text-[11px] font-semibold text-[#71717A]">Weddings &amp; Meetups</span>
              </div>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-[#0B0B0B] tabular-nums">
                  GHS 0
                </span>
                <span className="text-sm text-[#71717A]">($0 / forever)</span>
              </div>
              <p className="mt-2 text-sm text-[#71717A]">
                Everything planners need to run intimate weddings, fellowships, family memorials, and community workshops.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[#1A1C1D]">
                {[
                  '1 Active Event at a time',
                  'Up to 100 Verified Attendees',
                  '20 Starter Arkesel SMS Credits included',
                  'Standard /e/slug Landing Page & Standalone Gift Table',
                  'Resend Email Delivery & Offline Gate QR Scanner',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-10">
              <Link
                to="/signin"
                className="w-full inline-flex items-center justify-center bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold py-3.5 rounded-full hover:bg-[#E2E2E4] transition-colors"
              >
                Sign In to Get Started Free
              </Link>
            </div>
          </article>

          <article className="bg-[#0B0B0B] text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/70">
                  Pro Organizer Tier
                </span>
                <span className="px-3 py-1 rounded-full bg-white/10 text-white text-[11px] font-semibold">
                  Concerts, Church &amp; Corporate
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-white tabular-nums">
                  {billingCycle === 'annual' ? 'GHS 230' : 'GHS 290'}
                </span>
                <span className="text-sm text-white/65 tabular-nums">
                  {billingCycle === 'annual'
                    ? '/ month ($15/mo billed annually)'
                    : '/ month ($19/mo monthly)'}
                </span>
              </div>
              <p className="mt-2 text-sm text-white/75">
                Complete registration and SMS pass infrastructure for church conventions, concerts, funerals, corporate galas, and summits.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-white">
                {[
                  'Unlimited Concurrent Active Events',
                  'Unlimited Attendees with zero caps',
                  'Custom Ghana NCA SMS Sender IDs (e.g. YOURSUMMIT)',
                  'Customizable SMS & Email Pass Templates',
                  'One-Click CSV Guest & Gift Ledger Exports',
                  'Post-Event Thank-You SMS Broadcast Blasts',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-10">
              <Link
                to="/signin"
                className="w-full inline-flex items-center justify-center bg-white text-[#0B0B0B] text-xs font-semibold py-3.5 rounded-full hover:bg-neutral-200 transition-colors"
              >
                Sign In to Upgrade to Pro
              </Link>
            </div>
          </article>
        </div>

        <section className="mt-14 bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E5EA]">
          <h2 className="font-display text-2xl font-bold text-[#0B0B0B]">
            Prepaid Arkesel SMS Credit Bundles (GHS)
          </h2>
          <p className="mt-1.5 text-sm text-[#71717A]">
            Top up anytime via Mobile Money or bank card — credits never expire while your studio remains active.
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {smsBundles.map((bundle) => (
              <div
                key={bundle.name}
                className="p-5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex flex-col justify-between gap-2"
              >
                <div>
                  <span className="text-xs font-semibold text-[#71717A]">{bundle.name}</span>
                  <p className="mt-1 font-display text-lg font-bold text-[#0B0B0B]">
                    {bundle.credits}
                  </p>
                </div>
                <div className="pt-2 border-t border-[#E5E5EA] flex items-baseline justify-between">
                  <span className="font-display text-base font-bold text-[#0B0B0B] tabular-nums">
                    {bundle.priceGhs}
                  </span>
                  <span className="text-[11px] font-mono text-[#71717A]">{bundle.rate}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </MarketingLayout>
  );
};

export const HowItWorksPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  const steps = [
    {
      num: '01',
      icon: Calendar,
      title: 'Create & Publish Your /e/slug in 2 Minutes',
      description:
        'Configure event title, venue, GHS ticket price (or free entry), designer flyer artwork, custom registration questions, and optional standalone gift table in Organiser Studio.',
      detail: 'Auto-generates SEO & WhatsApp OpenGraph preview cards automatically.',
    },
    {
      num: '02',
      icon: Smartphone,
      title: 'Share Validation Links & Normalize Phone Numbers',
      description:
        'Guests open /e/your-event on any mobile browser with zero app downloads or passwords. Local formats such as 024 412 3456 sanitize automatically to strict +233 E.164 format.',
      detail: 'Duplicate registrations by phone number are blocked cleanly.',
    },
    {
      num: '03',
      icon: Signal,
      title: 'Dispatch SMS Passes & Scan Offline at the Gate',
      description:
        'Arkesel v2 dispatches branded SMS QR tokens across MTN, Telecel, and AT in under 3.2 seconds alongside Resend emails. Volunteers scan QR codes offline via IndexedDB manifests.',
      detail: 'Each admitted pass also unlocks 5 shots on the event 35mm disposable camera.',
    },
  ];

  return (
    <MarketingLayout
      activePath="/how-it-works"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/how-it-works']} />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="max-w-3xl">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
            Operational Workflow
          </span>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
            Three steps from event setup to sub-second QR gate check-in.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#71717A] leading-relaxed">
            Engineered to connect polished mobile landing pages with African carrier reliability and zero entrance queues.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <article
                key={step.num}
                className="bg-white rounded-3xl p-7 border border-[#E5E5EA] shadow-sm flex flex-col justify-between gap-6"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold px-3 py-1 rounded-full bg-[#0B0B0B] text-white">
                      Step {step.num}
                    </span>
                    <Icon className="w-5 h-5 text-[#71717A]" />
                  </div>
                  <h2 className="mt-5 font-display text-xl font-bold text-[#0B0B0B]">
                    {step.title}
                  </h2>
                  <p className="mt-3 text-sm text-[#71717A] leading-relaxed">{step.description}</p>
                </div>
                <p className="text-xs font-medium text-[#0B0B0B] bg-[#F5F5F7] p-3.5 rounded-2xl">
                  {step.detail}
                </p>
              </article>
            );
          })}
        </div>

        <div className="mt-12 bg-[#0B0B0B] text-white rounded-3xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h2 className="font-display text-2xl font-bold">Ready to configure your first event?</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Sign in to Organiser Studio to generate your custom invitation link and test QR gate pass.
            </p>
          </div>
          <Link
            to="/signin"
            className="px-6 py-3 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center gap-2 shrink-0"
          >
            <span>Sign In to Studio</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
};

export const FaqPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  return (
    <MarketingLayout
      activePath="/faq"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/faq']} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]">
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Frequently Asked Questions</span>
        </div>
        <h1 className="mt-3 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
          Answers for Ghanaian event organisers, ushers, and guests.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-[#71717A]">
          Everything you need to know about Arkesel SMS passes, offline QR scanning, gift tables, and billing in GHS.
        </p>

        <div className="mt-10 space-y-4">
          {FAQ_ITEMS.map((item) => (
            <article
              key={item.question}
              className="bg-white rounded-2xl p-6 border border-[#E5E5EA] shadow-sm"
            >
              <h2 className="font-display text-lg font-bold text-[#0B0B0B]">{item.question}</h2>
              <p className="mt-2 text-sm text-[#444748] leading-relaxed">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
};

export const AboutPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  return (
    <MarketingLayout
      activePath="/about"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/about']} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20 space-y-10">
        <div className="max-w-3xl">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
            About Events By You
          </span>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
            Reliable event registration &amp; telecom check-in engineered in Accra.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-[#444748] leading-relaxed">
            Events By You exists because global ticketing tools often fail in high-density African
            event halls where email attachments go unread and convention WiFi cuts out at peak check-in hours.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA]">
            <Signal className="w-6 h-6 text-[#0B0B0B]" />
            <h2 className="mt-4 font-display text-lg font-bold text-[#0B0B0B]">
              Carrier-First SMS Delivery
            </h2>
            <p className="mt-2 text-sm text-[#71717A] leading-relaxed">
              Native Arkesel v2 routing ensures passes reach guests on MTN Ghana, Telecel, and AT in
              under 3.2 seconds with Ghana NCA Sender ID support.
            </p>
          </article>
          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA]">
            <WifiOff className="w-6 h-6 text-[#0B0B0B]" />
            <h2 className="mt-4 font-display text-lg font-bold text-[#0B0B0B]">
              Offline-First Gate PWA
            </h2>
            <p className="mt-2 text-sm text-[#71717A] leading-relaxed">
              Volunteer turnstile scanners cache attendee manifests locally inside IndexedDB and
              reconcile check-ins automatically whenever connectivity resumes.
            </p>
          </article>
          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA]">
            <Shield className="w-6 h-6 text-[#0B0B0B]" />
            <h2 className="mt-4 font-display text-lg font-bold text-[#0B0B0B]">
              Strict Role Separation
            </h2>
            <p className="mt-2 text-sm text-[#71717A] leading-relaxed">
              Organiser Studio remains strictly restricted to event organisers, while gift table
              personnel and disposable camera guests stay scoped to their own standalone links.
            </p>
          </article>
        </div>
      </section>
    </MarketingLayout>
  );
};

export const ContactPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  return (
    <MarketingLayout
      activePath="/contact"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/contact']} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
            Contact &amp; Onboarding
          </span>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
            Talk with the Events By You team in Accra.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#71717A] leading-relaxed">
            Need a custom Arkesel Sender ID approved, dedicated gate hardware planning for a 5,000-guest
            convention, or enterprise pricing in GHS? Reach out directly.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA] space-y-2">
            <Mail className="w-5 h-5 text-[#0B0B0B]" />
            <h2 className="font-display text-lg font-bold text-[#0B0B0B]">Organiser Support</h2>
            <p className="text-sm text-[#71717A]">
              Onboarding help, Sender ID setup, and event troubleshooting.
            </p>
            <p className="font-mono text-xs font-semibold text-[#0B0B0B] pt-1">
              support@eventsbyyou.xyz
            </p>
          </article>

          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA] space-y-2">
            <Phone className="w-5 h-5 text-[#0B0B0B]" />
            <h2 className="font-display text-lg font-bold text-[#0B0B0B]">Privacy &amp; Data Desk</h2>
            <p className="text-sm text-[#71717A]">
              Guest data export assistance and compliance inquiries.
            </p>
            <p className="font-mono text-xs font-semibold text-[#0B0B0B] pt-1">
              privacy@eventsapp.africa
            </p>
          </article>

          <article className="bg-white rounded-3xl p-6 border border-[#E5E5EA] space-y-2">
            <MapPin className="w-5 h-5 text-[#0B0B0B]" />
            <h2 className="font-display text-lg font-bold text-[#0B0B0B]">Regional Coverage</h2>
            <p className="text-sm text-[#71717A]">
              Accra, Ghana HQ · Supporting events in Lagos, Nairobi &amp; Kigali.
            </p>
            <p className="font-mono text-xs font-semibold text-[#0B0B0B] pt-1">
              Mon – Sat · 8:00 AM – 8:00 PM GMT
            </p>
          </article>
        </div>
      </section>
    </MarketingLayout>
  );
};

export const BlogPage: React.FC<SharedMarketingPageProps> = ({
  isSignedIn,
  onNavigateStudio,
  onSignOut,
}) => {
  return (
    <MarketingLayout
      activePath="/blog"
      isSignedIn={isSignedIn}
      onNavigateStudio={onNavigateStudio}
      onSignOut={onSignOut}
    >
      <SeoHead {...MARKETING_SEO['/blog']} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]">
          <BookOpen className="w-3.5 h-3.5" />
          <span>Events By You Playbooks</span>
        </div>
        <h1 className="mt-3 font-display text-3xl sm:text-5xl font-bold text-[#0B0B0B] tracking-[-0.03em]">
          Guides for running zero-queue events in Ghana.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-[#71717A] max-w-2xl">
          Field notes from weddings, church conventions, concerts, and corporate summits on SMS delivery, QR gate flows, and gift table operations.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          {BLOG_ARTICLES.map((post) => (
            <article
              key={post.slug}
              className="bg-white rounded-3xl p-6 sm:p-7 border border-[#E5E5EA] shadow-sm flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#71717A]">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] font-semibold">
                    {post.category}
                  </span>
                  <span>
                    {post.date} · {post.readTime}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-xl font-bold text-[#0B0B0B] leading-snug">
                  {post.title}
                </h2>
                <p className="mt-2 text-sm text-[#444748] leading-relaxed">{post.excerpt}</p>
              </div>
              <ul className="pt-4 border-t border-[#E5E5EA] space-y-2 text-xs text-[#71717A]">
                {post.takeaways.map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
};
