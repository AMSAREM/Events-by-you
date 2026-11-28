import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Gift,
  Globe,
  HelpCircle,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  QrCode,
  Send,
  ShieldCheck,
  Signal,
  Smartphone,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { BLOG_ARTICLES, FAQ_ITEMS, MARKETING_SEO } from '../lib/seoConfig';
import { BrandLogo, BrandOfficialBadge } from './BrandLogo';
import { SeoHead } from './SeoHead';

export interface MarketingPageProps {
  isSignedIn: boolean;
  onNavigateStudio: () => void;
  onSignOut: () => void;
}

const MARKETING_NAV_LINKS = [
  { to: '/', label: 'Product' },
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' },
  { to: '/blog', label: 'Blog' },
] as const;

const MarketingPageShell: React.FC<{
  isSignedIn: boolean;
  onNavigateStudio: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}> = ({ isSignedIn, onNavigateStudio, onSignOut, children }) => {
  const { pathname } = useLocation();
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col overflow-x-clip">
      <header className="sticky top-0 z-50 w-full bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-[#E5E5EA] pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 md:py-0 md:h-20 flex flex-wrap md:flex-nowrap xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-between gap-x-3 lg:gap-x-5 gap-y-2">
          <Link
            to="/"
            className="xl:justify-self-start flex items-center text-left shrink-0 min-w-0 rounded-xl py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D3822]/20"
          >
            <BrandLogo
              variant="light"
              size="md"
              subtitle="Weddings · Church · Corporate · Tech"
              subtitleClassName="hidden xl:block text-[#71717A]"
            />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="order-3 md:order-2 xl:justify-self-center w-full md:w-auto min-w-0 flex items-center md:justify-center gap-1 sm:gap-1.5 md:gap-0.5 lg:gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border-t border-black/[0.06] md:border md:border-black/[0.06] md:bg-white/75 md:rounded-full md:p-1 md:shadow-[0_1px_3px_rgba(0,0,0,0.04)] pt-2 md:pt-1 pb-0.5 md:pb-1 text-xs lg:text-[13px]"
          >
            {MARKETING_NAV_LINKS.map((item) => {
              const isActive = normalizedPath === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    isActive
                      ? 'text-[#0B0B0B] font-semibold bg-black/[0.05] md:bg-[#F5F5F7] rounded-full px-3 py-1.5 whitespace-nowrap shrink-0 transition-colors'
                      : 'text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0'
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="order-2 md:order-3 xl:justify-self-end flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isSignedIn ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center justify-center h-9 rounded-full text-xs lg:text-[13px] font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.05] transition-colors px-2.5 sm:px-3 whitespace-nowrap shrink-0"
              >
                Log Out
              </button>
            ) : (
              <Link
                to="/signin"
                className="inline-flex items-center justify-center h-9 rounded-full text-xs lg:text-[13px] font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.05] transition-colors px-2.5 sm:px-3 whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}

            {isSignedIn ? (
              <button
                type="button"
                onClick={onNavigateStudio}
                className="inline-flex items-center justify-center h-9 bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-[0_6px_16px_-4px_rgba(11,11,11,0.22)] whitespace-nowrap shrink-0"
              >
                <span className="lg:hidden">Studio</span>
                <span className="hidden lg:inline">Open Studio</span>
              </button>
            ) : (
              <Link
                to="/signup"
                className="inline-flex items-center justify-center h-9 bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-[0_6px_16px_-4px_rgba(11,11,11,0.22)] whitespace-nowrap shrink-0"
              >
                Create Event
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">{children}</main>

      <footer className="w-full bg-[#F3F3F5] border-t border-[#E5E5EA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pt-10 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 pb-8">
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <BrandLogo variant="light" size="md" />
                <BrandOfficialBadge className="w-36 sm:w-40" />
              </div>
              <p className="text-sm text-[#71717A] max-w-sm leading-relaxed">
                The infrastructure layer for weddings, funerals, church conventions, musical
                concerts, corporate galas, and tech summits. Multi-tenant ticketing and instant
                SMS verification.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#444748]">
                <span>Ghana NCA Telecom Verified</span>
                <span aria-hidden="true">·</span>
                <span>Resend Authenticated Infrastructure</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Platform
              </span>
              <Link to="/features" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Features
              </Link>
              <Link to="/how-it-works" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                How It Works
              </Link>
              <Link to="/pricing" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Pricing
              </Link>
              <Link to="/faq" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                FAQ
              </Link>
              <Link to="/blog" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Blog
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Company
              </span>
              <Link to="/about" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                About Events By You
              </Link>
              <Link to="/contact" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Contact &amp; Support
              </Link>
              <Link to="/" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Platform Overview
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Access &amp; Studio
              </span>
              <Link to="/signin" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Sign In
              </Link>
              <Link to="/signup" className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]">
                Create Account
              </Link>
              <button
                type="button"
                onClick={onNavigateStudio}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Organiser Studio
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
            <p>© 2026 Events By You Inc. Built for weddings, funerals, church, musical, corporate &amp; tech gatherings.</p>
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <Link to="/terms" className="hover:text-[#0B0B0B] transition-colors">
                Terms &amp; Conditions
              </Link>
              <Link to="/privacy" className="hover:text-[#0B0B0B] transition-colors">
                Privacy Policy
              </Link>
              <a href="/sitemap.xml" className="hover:text-[#0B0B0B] transition-colors">
                Sitemap
              </a>
              <a href="/robots.txt" className="hover:text-[#0B0B0B] transition-colors">
                Robots
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

const PageCtaBanner: React.FC<{
  title: string;
  subtitle: string;
  isSignedIn: boolean;
  onNavigateStudio: () => void;
}> = ({ title, subtitle, isSignedIn, onNavigateStudio }) => (
  <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pb-16">
    <div className="bg-[#0B0B0B] text-white rounded-[28px] p-7 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-xl">
      <div className="max-w-2xl space-y-2">
        <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em]">{title}</h2>
        <p className="text-sm text-zinc-300 leading-relaxed">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {isSignedIn ? (
          <button
            type="button"
            onClick={onNavigateStudio}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors"
          >
            <span>Open Organiser Studio</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors"
          >
            <span>Launch Your Event Free</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        <Link
          to="/contact"
          className="inline-flex items-center gap-2 px-5 py-3.5 rounded-full bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/15 transition-colors"
        >
          <span>Talk to Accra Support</span>
        </Link>
      </div>
    </div>
  </section>
);

export const FeaturesPage: React.FC<MarketingPageProps> = (props) => {
  const features = [
    {
      icon: QrCode,
      tag: '0.3s Gate Speed',
      title: 'Fullscreen Check-In & QR Pass Screen',
      summary:
        'Scan passes directly from volunteer phones or run an automated entrance kiosk screen with single-entry anti-passback protection.',
      points: [
        'Instant audio chime and visual badge confirmation on check-in',
        'Multi-day date enforcement and passback lockouts per ticket code',
        'Direct /e/slug/checkin URLs that open straight to pass validation',
      ],
    },
    {
      icon: UserPlus,
      tag: 'E.164 & Circles',
      title: 'Guest Circle Validation & Custom RSVP',
      summary:
        'Keep guest lists clean with normalized Ghana & international E.164 phone numbers, optional emails, and searchable circle validation.',
      points: [
        'Automatically formats 024 / 055 numbers to +233 before dispatch',
        'Verify guests against Family, VIP, Friends, or committee circles',
        'Custom registration questions exported cleanly to CSV',
      ],
    },
    {
      icon: Camera,
      tag: '35mm Film Lab',
      title: 'Shared 35mm Event Disposable Camera',
      summary:
        'Checked-in guests unlock 5 curated film frames directly from their pass — no app store download required.',
      points: [
        'Kodak Gold, Ilford B&W, Fuji C200, and CineStill 800T looks',
        'Optional Darkroom Lock until the organiser releases the roll',
        'One-click A4 contact sheet printouts from the event lab',
      ],
    },
    {
      icon: Gift,
      tag: '/e/slug/gifts',
      title: 'Standalone Gift Table & Appointed Desk',
      summary:
        'Give gift table attendants a dedicated portal to log Mobile Money transfers, cash envelopes, and registry pledges safely.',
      points: [
        'Scoped desk URLs keep billing, attendee lists, and studio settings private',
        'Track reconciled GHS & USD pledges in real time',
        'Clean guest gratitude logs ready for post-event export',
      ],
    },
    {
      icon: Signal,
      tag: 'Arkesel v2 + Resend',
      title: 'Sub-3.2s SMS & Email Ticket Delivery',
      summary:
        'Every registration triggers a plain GSM-7 SMS pass over MTN Ghana, Telecel, and AT paired with optional Resend email delivery.',
      points: [
        'Register custom Ghana NCA-compliant Sender IDs',
        'Works reliably even when attendees arrive on feature phones',
        'Scheduled reminders and emergency gate announcements from Studio',
      ],
    },
    {
      icon: WifiOff,
      tag: 'IndexedDB PWA',
      title: 'Offline-Ready Gate Scanner PWA',
      summary:
        'Install the Events By You scanner onto any usher smartphone and continue validating passes if venue cellular data drops.',
      points: [
        'Local manifest caching verifies QR payloads with zero network',
        'Automatic background sync once connectivity returns',
        'Role-scoped gate_staff credentials isolate sensitive tenant records',
      ],
    },
  ];

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/features']} />

      <section className="bg-[#0B0B0B] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-20 space-y-6">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            Platform Architecture
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] max-w-3xl text-balance">
            Every tool required from first RSVP to final gate scan.
          </h1>
          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            Built specifically for West African weddings, church conventions, concerts, and tech
            summits where telecom reliability, offline gate resilience, and clean guest operations
            decide the experience.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              to="/how-it-works"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors"
            >
              <span>See 3-Step Workflow</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/15 transition-colors"
            >
              <span>Compare Plans in GHS &amp; USD</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-7 flex flex-col justify-between gap-6 shadow-sm"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-[#444748] bg-[#F5F5F7] border border-[#E5E5EA] px-3 py-1 rounded-full">
                      {feature.tag}
                    </span>
                  </div>
                  <h2 className="font-display text-xl font-bold tracking-tight text-[#0B0B0B]">
                    {feature.title}
                  </h2>
                  <p className="text-sm text-[#444748] leading-relaxed">{feature.summary}</p>
                </div>

                <ul className="space-y-2.5 pt-4 border-t border-[#E5E5EA]">
                  {feature.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-xs text-[#444748] leading-relaxed">
                      <CheckCircle2 className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <PageCtaBanner
        title="Ready to put SMS passes and offline check-in to work?"
        subtitle="Publish an event page in two minutes with your own /e/slug URL, custom circle validation, and standalone gift table."
        isSignedIn={props.isSignedIn}
        onNavigateStudio={props.onNavigateStudio}
      />
    </MarketingPageShell>
  );
};

export const PricingPage: React.FC<MarketingPageProps> = (props) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');

  const proPriceUsd = billingCycle === 'annual' ? '$15' : '$19';
  const proPriceGhs = billingCycle === 'annual' ? 'GHS 230' : 'GHS 290';

  const smsBundles = [
    { name: 'Mini Top-Up', credits: '100 SMS Credits', price: 'GHS 25', perSms: 'GHS 0.25 / SMS' },
    { name: 'Event Pack', credits: '500 SMS Credits', price: 'GHS 110', perSms: 'GHS 0.22 / SMS' },
    { name: 'Convention Pack', credits: '2,000 SMS Credits', price: 'GHS 380', perSms: 'GHS 0.19 / SMS' },
  ];

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/pricing']} />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-12 sm:py-16 space-y-12">
        <div className="max-w-3xl space-y-4">
          <p className="text-xs font-mono uppercase tracking-widest text-[#71717A]">
            Transparent GHS &amp; USD Pricing
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#0B0B0B]">
            Start free. Scale when your guest list grows.
          </h1>
          <p className="text-sm sm:text-base text-[#444748] leading-relaxed">
            Host your first event at GHS 0 with instant SMS passes and offline gate check-in, or
            unlock custom Ghana Sender IDs, unlimited events, and full team access.
          </p>

          <div className="inline-flex items-center gap-1 p-1 bg-white border border-[#E5E5EA] rounded-full">
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                billingCycle === 'annual'
                  ? 'bg-[#0B0B0B] text-white'
                  : 'text-[#444748] hover:text-[#0B0B0B]'
              }`}
            >
              Annual (Save 21%)
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-[#0B0B0B] text-white'
                  : 'text-[#444748] hover:text-[#0B0B0B]'
              }`}
            >
              Monthly Billing
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Starter */}
          <div className="bg-white rounded-[28px] border border-[#E5E5EA] p-7 flex flex-col justify-between gap-6 shadow-sm">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-[#71717A]">Starter</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold text-[#0B0B0B]">GHS 0</span>
                  <span className="text-xs text-[#71717A]">forever</span>
                </div>
                <p className="text-xs text-[#71717A] mt-1">No card required to publish</p>
              </div>
              <p className="text-sm text-[#444748] leading-relaxed">
                Ideal for intimate weddings, memorial services, and community meetups getting
                started.
              </p>
              <ul className="space-y-3 pt-4 border-t border-[#E5E5EA] text-xs text-[#444748]">
                {[
                  '1 active published event page (/e/slug)',
                  '20 complimentary Arkesel SMS credits',
                  'Offline QR gate scanner & anti-passback',
                  'Standalone Gift Table (/e/slug/gifts)',
                  'Standard email pass confirmations',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {props.isSignedIn ? (
              <button
                type="button"
                onClick={props.onNavigateStudio}
                className="w-full py-3.5 rounded-full border border-[#0B0B0B] text-[#0B0B0B] text-xs font-bold hover:bg-[#F5F5F7] transition-colors"
              >
                Open Studio
              </button>
            ) : (
              <Link
                to="/signup"
                className="w-full py-3.5 rounded-full border border-[#0B0B0B] text-[#0B0B0B] text-xs font-bold hover:bg-[#F5F5F7] transition-colors text-center"
              >
                Create Free Account
              </Link>
            )}
          </div>

          {/* Pro Organizer */}
          <div className="bg-[#0B0B0B] text-white rounded-[28px] p-7 flex flex-col justify-between gap-6 shadow-xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Pro Organizer
                </p>
                <span className="text-[11px] font-semibold bg-white/15 text-white px-3 py-1 rounded-full">
                  Most Popular
                </span>
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold">{proPriceGhs}</span>
                  <span className="text-xs text-zinc-400">/ month</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Approx. {proPriceUsd}/mo billed {billingCycle}
                </p>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Built for professional planners, churches, and recurring ticketed productions.
              </p>
              <ul className="space-y-3 pt-4 border-t border-white/15 text-xs text-zinc-200">
                {[
                  'Unlimited active events & custom /e/slug URLs',
                  'Custom NCA-registered Arkesel SMS Sender ID',
                  'Unlimited attendees & multi-usher gate seats',
                  '35mm Event Disposable Camera & Darkroom control',
                  'Full CSV exports, gift ledger reconciliation & webhooks',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {props.isSignedIn ? (
              <button
                type="button"
                onClick={props.onNavigateStudio}
                className="w-full py-3.5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors"
              >
                Manage Plan in Studio
              </button>
            ) : (
              <Link
                to="/signup"
                className="w-full py-3.5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors text-center"
              >
                Start Pro Organizer
              </Link>
            )}
          </div>

          {/* Enterprise */}
          <div className="bg-white rounded-[28px] border border-[#E5E5EA] p-7 flex flex-col justify-between gap-6 shadow-sm">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-[#71717A]">
                  Enterprise &amp; Conventions
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold text-[#0B0B0B]">Custom</span>
                </div>
                <p className="text-xs text-[#71717A] mt-1">Volume SMS &amp; dedicated gate SLA</p>
              </div>
              <p className="text-sm text-[#444748] leading-relaxed">
                For national church conventions, stadium concerts, and multi-day enterprise summits.
              </p>
              <ul className="space-y-3 pt-4 border-t border-[#E5E5EA] text-xs text-[#444748]">
                {[
                  'High-throughput Arkesel routing across GH, NG & KE',
                  'Dedicated developer API apps & HMAC webhooks',
                  'Multi-gate usher provisioning & live command telemetry',
                  'On-site Accra onboarding & custom invoice settlement',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Link
              to="/contact"
              className="w-full py-3.5 rounded-full bg-[#0B0B0B] text-white text-xs font-bold hover:bg-neutral-800 transition-colors text-center"
            >
              Contact Sales Team
            </Link>
          </div>
        </div>

        {/* Prepaid SMS Bundles */}
        <div className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#0B0B0B]">
                Prepaid Arkesel SMS Bundles
              </h2>
              <p className="text-xs sm:text-sm text-[#71717A] mt-1">
                Credits never expire while your workspace stays active. Top up anytime inside Studio.
              </p>
            </div>
            <Link
              to="/faq"
              className="text-xs font-semibold text-[#0B0B0B] underline underline-offset-4"
            >
              Read SMS &amp; billing FAQ
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {smsBundles.map((bundle) => (
              <div
                key={bundle.name}
                className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-5 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-xs font-semibold text-[#71717A]">{bundle.name}</p>
                  <p className="font-display text-lg font-bold text-[#0B0B0B] mt-0.5">
                    {bundle.credits}
                  </p>
                  <p className="text-[11px] font-mono text-[#444748] mt-1">{bundle.perSms}</p>
                </div>
                <span className="font-display text-xl font-bold text-[#0B0B0B] shrink-0">
                  {bundle.price}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export const HowItWorksPage: React.FC<MarketingPageProps> = (props) => {
  const steps = [
    {
      step: '01',
      title: 'Create & Publish in 2 Minutes',
      description:
        'Upload your event flyer, configure venue or virtual schedule blocks, enable optional email & circle validation fields, and claim a clean /e/slug URL.',
      highlights: [
        'Instant public RSVP, schedule, and live polls page',
        'Custom invitation circles (Family, VIP, Church Members)',
        'Draft, active, and past status visibility controls',
      ],
    },
    {
      step: '02',
      title: 'Collect Validated RSVPs & Gift Pledges',
      description:
        'Guests register in seconds with automatic E.164 phone normalization and duplicate protection, while gift pledges stay organized on a standalone /e/slug/gifts desk.',
      highlights: [
        'Phone-first registration works even when guests have no email',
        'Appoint dedicated gift table staff with scoped desk URLs',
        'Instant QR invitation cards ready for WhatsApp & SMS sharing',
      ],
    },
    {
      step: '03',
      title: 'Deliver SMS QR Passes & Scan Offline',
      description:
        'Every attendee receives a unique QR pass via Arkesel SMS and optional Resend email in under 3.2 seconds—validated offline at the door with audio feedback.',
      highlights: [
        'Anti-passback gate scanner blocks reused ticket codes',
        'IndexedDB offline mode handles crowded basement venues',
        'Checked-in guests unlock 5 shots on the 35mm disposable camera',
      ],
    },
  ];

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/how-it-works']} />

      <section className="bg-[#0B0B0B] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-20 space-y-5">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            Three-Step Workflow
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] max-w-3xl">
            From blank event sheet to smooth gate entry in three steps.
          </h1>
          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            No spreadsheet merges, no manual WhatsApp ticket screenshots, and no entrance queues
            stalling when venue mobile reception fades.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-16 space-y-6">
        {steps.map((item) => (
          <article
            key={item.step}
            className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start shadow-sm"
          >
            <div className="lg:col-span-2">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#0B0B0B] text-white font-mono text-lg font-bold">
                {item.step}
              </span>
            </div>
            <div className="lg:col-span-5 space-y-2">
              <h2 className="font-display text-2xl font-bold text-[#0B0B0B]">{item.title}</h2>
              <p className="text-sm text-[#444748] leading-relaxed">{item.description}</p>
            </div>
            <ul className="lg:col-span-5 space-y-3 bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA] p-5">
              {item.highlights.map((highlight) => (
                <li
                  key={highlight}
                  className="flex items-start gap-2.5 text-xs sm:text-sm text-[#0B0B0B]"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <PageCtaBanner
        title="See it live inside your organiser studio"
        subtitle="Create a test event, preview the fullscreen check-in QR pass screen, and test SMS pass formatting in minutes."
        isSignedIn={props.isSignedIn}
        onNavigateStudio={props.onNavigateStudio}
      />
    </MarketingPageShell>
  );
};

export const FaqPage: React.FC<MarketingPageProps> = (props) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/faq']} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-10">
        <div className="space-y-4">
          <p className="text-xs font-mono uppercase tracking-widest text-[#71717A]">
            Help Center &amp; Documentation
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#0B0B0B]">
            Frequently Asked Questions
          </h1>
          <p className="text-sm sm:text-base text-[#444748] leading-relaxed">
            Answers on Arkesel SMS ticket delivery across Ghana carriers, offline QR gate
            scanning, standalone gift desks, disposable camera rolls, and billing.
          </p>
        </div>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={item.question}
                className="bg-white rounded-2xl border border-[#E5E5EA] overflow-hidden shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="w-full px-5 sm:px-6 py-5 text-left flex items-center justify-between gap-4 hover:bg-[#FAFAFC] transition-colors"
                >
                  <span className="font-display text-base sm:text-lg font-bold text-[#0B0B0B]">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#444748] shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 sm:px-6 pb-5 pt-1 text-sm text-[#444748] leading-relaxed border-t border-[#E5E5EA]/70">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B0B0B]">
                Need custom help with an upcoming event?
              </h2>
              <p className="text-xs sm:text-sm text-[#71717A] mt-0.5">
                Reach our Accra team directly for Sender ID registration or large-venue gate prep.
              </p>
            </div>
          </div>
          <Link
            to="/contact"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-bold hover:bg-neutral-800 transition-colors shrink-0"
          >
            <span>Contact Support</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export const AboutPage: React.FC<MarketingPageProps> = (props) => {
  const pillars = [
    {
      icon: Smartphone,
      title: 'Telecom-First Reliability',
      body: 'Built around direct Ghana carrier routes via Arkesel v2 so ticket passes reach MTN, Telecel, and AT handsets in seconds—even without smartphones or mobile data.',
    },
    {
      icon: ShieldCheck,
      title: 'Multi-Tenant Isolation & Security',
      body: 'Every workspace uses PostgreSQL Row Level Security, scoped gate_staff & gift desk permissions, hashed API credentials, and automatic 30-minute idle session protection.',
    },
    {
      icon: Globe,
      title: 'Built for Real Gatherings Across Africa',
      body: 'Designed in Accra for the full spectrum of real gatherings—weddings, family memorials, church conventions, concerts, corporate galas, and tech summits.',
    },
  ];

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/about']} />

      <section className="bg-[#0B0B0B] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-20 space-y-5">
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            About Events By You Inc.
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] max-w-3xl">
            Dependable event infrastructure engineered in Accra for high-trust gatherings.
          </h1>
          <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            Too many memorable events stall at the entrance because PDFs fail to load or volunteer
            lists fall out of sync. Events By You unifies registration, SMS pass delivery, gate
            scanning, gift desks, and shared disposable photography in one reliable workspace.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-16 space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <article
                key={pillar.title}
                className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-7 space-y-4 shadow-sm"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h2 className="font-display text-xl font-bold text-[#0B0B0B]">{pillar.title}</h2>
                <p className="text-sm text-[#444748] leading-relaxed">{pillar.body}</p>
              </article>
            );
          })}
        </div>

        <div className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-9 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#71717A] uppercase tracking-wider">
              <MapPin className="w-4 h-4 text-[#0B0B0B]" />
              <span>Headquarters</span>
            </div>
            <p className="font-display text-lg font-bold text-[#0B0B0B]">Accra, Ghana</p>
            <p className="text-xs text-[#71717A]">Serving GH, NG, KE &amp; diaspora organisers</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#71717A] uppercase tracking-wider">
              <Building2 className="w-4 h-4 text-[#0B0B0B]" />
              <span>Carrier &amp; Mail Partners</span>
            </div>
            <p className="font-display text-lg font-bold text-[#0B0B0B]">Arkesel v2 &amp; Resend</p>
            <p className="text-xs text-[#71717A]">NCA-compliant Sender IDs &amp; DKIM email</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#71717A] uppercase tracking-wider">
              <Lock className="w-4 h-4 text-[#0B0B0B]" />
              <span>Data Architecture</span>
            </div>
            <p className="font-display text-lg font-bold text-[#0B0B0B]">PostgreSQL + Offline PWA</p>
            <p className="text-xs text-[#71717A]">Row Level Security &amp; IndexedDB check-in cache</p>
          </div>
        </div>
      </section>

      <PageCtaBanner
        title="Build your next gathering on Events By You"
        subtitle="Open Creator Studio to launch an event page, or review our pricing plans first."
        isSignedIn={props.isSignedIn}
        onNavigateStudio={props.onNavigateStudio}
      />
    </MarketingPageShell>
  );
};

export const ContactPage: React.FC<MarketingPageProps> = (props) => {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [topic, setTopic] = useState('Organiser Onboarding');
  const [message, setMessage] = useState('');
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !contact.trim() || !message.trim()) {
      setError('Please enter your name, email or phone number, and message.');
      return;
    }
    const mailSubject = encodeURIComponent(`[Events By You · ${topic}] ${name.trim()}`);
    const mailBody = encodeURIComponent(
      `Name: ${name.trim()}\nReply To: ${contact.trim()}\nTopic: ${topic}\n\n${message.trim()}`
    );
    const refId = `EBY-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    setSubmittedRef(refId);
    if (typeof window !== 'undefined') {
      window.location.href = `mailto:support@eventsbyyou.xyz?subject=${mailSubject}&body=${mailBody}`;
    }
  };

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/contact']} />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-widest text-[#71717A]">
                Support &amp; Partnerships
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#0B0B0B]">
                Talk with our Accra organiser team.
              </h1>
              <p className="text-sm text-[#444748] leading-relaxed">
                Whether you need help registering an NCA SMS Sender ID, setting up multi-gate
                scanners for a convention, or importing an existing VIP guest list, we respond fast.
              </p>
            </div>

            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5 flex items-start gap-3.5">
                <Mail className="w-5 h-5 text-[#0B0B0B] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#71717A] uppercase tracking-wider">
                    Organiser Support
                  </p>
                  <a
                    href="mailto:support@eventsbyyou.xyz"
                    className="font-mono text-sm font-semibold text-[#0B0B0B] hover:underline"
                  >
                    support@eventsbyyou.xyz
                  </a>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5 flex items-start gap-3.5">
                <ShieldCheck className="w-5 h-5 text-[#0B0B0B] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#71717A] uppercase tracking-wider">
                    Privacy &amp; Compliance
                  </p>
                  <a
                    href="mailto:privacy@eventsapp.africa"
                    className="font-mono text-sm font-semibold text-[#0B0B0B] hover:underline"
                  >
                    privacy@eventsapp.africa
                  </a>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5 flex items-start gap-3.5">
                <MapPin className="w-5 h-5 text-[#0B0B0B] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#71717A] uppercase tracking-wider">
                    Operations Hub
                  </p>
                  <p className="text-sm font-semibold text-[#0B0B0B]">Accra, Greater Accra, Ghana</p>
                  <p className="text-xs text-[#71717A] mt-0.5">Mon – Sat · 8:00 AM – 8:00 PM GMT</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-[#E5E5EA]">
                <MessageSquare className="w-5 h-5 text-[#0B0B0B]" />
                <h2 className="font-display text-xl font-bold text-[#0B0B0B]">Send an Inquiry</h2>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-medium text-red-700">
                  {error}
                </div>
              )}

              {submittedRef && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900 space-y-1">
                  <p className="font-bold">
                    Inquiry prepared ({submittedRef})
                  </p>
                  <p>
                    Your email client should open to <span className="font-mono">support@eventsbyyou.xyz</span>.
                    You can also write directly to that address anytime.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#0B0B0B]">Full Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Kwame Mensah"
                    className="w-full rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] px-3.5 py-2.5 text-sm text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#0B0B0B]">
                    Email or Phone (+233)
                  </span>
                  <input
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="kwame@example.com or 024..."
                    className="w-full rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] px-3.5 py-2.5 text-sm text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#0B0B0B]">Topic</span>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] px-3.5 py-2.5 text-sm text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                >
                  <option value="Organiser Onboarding">Organiser Onboarding</option>
                  <option value="Arkesel Sender ID Registration">
                    Arkesel Sender ID Registration
                  </option>
                  <option value="Enterprise Summit or Convention">
                    Enterprise Summit or Convention
                  </option>
                  <option value="Gate Scanner or Billing Support">
                    Gate Scanner or Billing Support
                  </option>
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#0B0B0B]">How can we help?</span>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share your event date, expected guest count, or technical question..."
                  className="w-full rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] px-3.5 py-2.5 text-sm text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B] resize-y"
                />
              </label>

              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[#0B0B0B] text-white text-xs font-bold hover:bg-neutral-800 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Message to Support</span>
              </button>
            </form>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export const BlogPage: React.FC<MarketingPageProps> = (props) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeSlug, setActiveSlug] = useState<string | null>(BLOG_ARTICLES[0]?.slug ?? null);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(BLOG_ARTICLES.map((post) => post.category)))],
    []
  );

  const filteredArticles = useMemo(() => {
    if (selectedCategory === 'All') return BLOG_ARTICLES;
    return BLOG_ARTICLES.filter((post) => post.category === selectedCategory);
  }, [selectedCategory]);

  return (
    <MarketingPageShell {...props}>
      <SeoHead {...MARKETING_SEO['/blog']} />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-12 sm:py-16 space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-[#71717A]">
              Organiser Playbooks
            </p>
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#0B0B0B]">
              Field notes for smooth African events.
            </h1>
            <p className="text-sm sm:text-base text-[#444748] leading-relaxed">
              Operational guides covering GSM-7 SMS ticketing, anti-passback turnstile setup,
              separated gift desks, and shared 35mm disposable rolls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
                  selectedCategory === cat
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-white border border-[#E5E5EA] text-[#444748] hover:text-[#0B0B0B]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredArticles.map((article) => {
            const isExpanded = activeSlug === article.slug;
            return (
              <article
                key={article.slug}
                className="bg-white rounded-[28px] border border-[#E5E5EA] p-6 sm:p-8 flex flex-col justify-between gap-5 shadow-sm"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#71717A]">
                    <span className="px-2.5 py-1 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] font-semibold">
                      {article.category}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {article.date} · {article.readTime}
                    </span>
                  </div>

                  <h2 className="font-display text-xl sm:text-2xl font-bold text-[#0B0B0B] leading-snug">
                    {article.title}
                  </h2>

                  <p className="text-sm text-[#444748] leading-relaxed">{article.excerpt}</p>
                </div>

                {isExpanded ? (
                  <div className="space-y-3 pt-4 border-t border-[#E5E5EA]">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                      Key Operational Takeaways
                    </p>
                    <ul className="space-y-2.5">
                      {article.takeaways.map((point) => (
                        <li
                          key={point}
                          className="flex items-start gap-2.5 text-xs sm:text-sm text-[#0B0B0B] leading-relaxed"
                        >
                          <CheckCircle2 className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveSlug(article.slug)}
                      className="inline-flex items-center gap-2 text-xs font-bold text-[#0B0B0B] hover:underline underline-offset-4"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Read Operational Takeaways</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <PageCtaBanner
        title="Put these playbooks to work at your next event"
        subtitle="Launch your event page, configure SMS passes, and test gate QR scanning inside Studio."
        isSignedIn={props.isSignedIn}
        onNavigateStudio={props.onNavigateStudio}
      />
    </MarketingPageShell>
  );
};
