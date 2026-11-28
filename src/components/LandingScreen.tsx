import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Calendar,
  CalendarPlus,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gift,
  Layers,
  Mail,
  MapPin,
  MessageSquare,
  QrCode,
  Radio,
  Rocket,
  Search,
  Settings,
  Shield,
  Signal,
  Smartphone,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { Attendee, EventItem } from '../types/events';
import { EVENT_CATEGORIES, getCategoryPreset } from '../data/initialData';
import { formatEventDateSpan } from '../lib/eventDates';
import { MARKETING_SEO } from '../lib/seoConfig';
import { DeterministicQrSvg, buildEventInvitationUrl } from '../lib/qr';
import { BrandLogo, BrandOfficialBadge } from './BrandLogo';
import { EventFlyerCard } from './EventFlyerCard';
import { PWAInstallButton } from './PWAInstallButton';
import { SeoHead } from './SeoHead';

interface LandingScreenProps {
  featuredEvent?: EventItem | null;
  allEvents?: EventItem[];
  recentAttendees: Attendee[];
  isSignedIn: boolean;
  hasSetEvent?: boolean;
  onNavigateSignIn: (prefillEmail?: string) => void;
  onNavigateSignUp: (prefillEmail?: string) => void;
  onCreateEvent?: () => void;
  onNavigateDemoEvent: (
    eventId?: string,
    focusSection?: 'top' | 'register' | 'checkin' | 'gifts'
  ) => void;
  onNavigateStudio: () => void;
  onSignOut?: () => void;
  onOpenQrScanner?: (eventId?: string) => void;
  onOpenDisposableCamera?: (eventId?: string) => void;
  onUpgradePro?: () => void;
  onQuickStartEmail: (email: string) => void;
  onOpenLegal?: (doc: 'terms' | 'privacy') => void;
}

const HERO_BACKDROP_IMG = '/src/assets/images/flyer_corporate_gala_1795075792816.jpg';

const SHOWCASE_PREVIEW_EVENT = {
  title: 'Accra Tech Founders Summit 2026',
  subtitle:
    'Keynotes, circle-validated VIP networking, and instant QR turnstile check-in.',
  slug: 'accra-tech-summit',
  category: 'Tech',
  city: 'Accra',
  venue: 'Kempinski Gold Coast Hotel',
  date: 'Sat, Nov 14 · 6:00 PM',
  venueFormat: 'In-Person',
  capacity: 500,
  registered: 420,
  checkedIn: 318,
  smsDispatched: 420,
  occupancyPct: 84,
  senderId: 'SUMMIT26',
  flyerUrl: getCategoryPreset('Tech').flyerUrl,
};

const SHOWCASE_PREVIEW_ATTENDEES = [
  {
    id: 'demo-att-1',
    name: 'Kwame Mensah',
    phone: '+233 24 000 1842',
    tier: 'VIP Circle',
    ticketCode: 'EBY-9482-KM',
  },
  {
    id: 'demo-att-2',
    name: 'Ama Boateng',
    phone: '+233 55 000 3109',
    tier: 'General Pass',
    ticketCode: 'EBY-7120-AB',
  },
];

export const LandingScreen: React.FC<LandingScreenProps> = ({
  featuredEvent = null,
  allEvents = featuredEvent ? [featuredEvent] : [],
  recentAttendees,
  isSignedIn,
  hasSetEvent = false,
  onNavigateSignIn,
  onNavigateSignUp,
  onCreateEvent,
  onNavigateDemoEvent,
  onNavigateStudio,
  onSignOut,
  onOpenQrScanner,
  onOpenDisposableCamera,
  onUpgradePro,
  onQuickStartEmail,
  onOpenLegal,
}) => {
  const [quickEmail, setQuickEmail] = useState('');
  const [quickSent, setQuickSent] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [activeSlide, setActiveSlide] = useState<0 | 1 | 2>(0);
  const [sliderPaused, setSliderPaused] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  // Interactive Event Finder card state
  const [finderCategory, setFinderCategory] = useState<string>('all');
  const [finderCity, setFinderCity] = useState<string>('all');
  const [finderQuery, setFinderQuery] = useState<string>('');

  const matchingEvents = useMemo(() => {
    const q = finderQuery.trim().toLowerCase();
    return allEvents.filter((evt) => {
      const catOk =
        finderCategory === 'all' ||
        evt.category.toLowerCase() === finderCategory.toLowerCase();
      const cityOk =
        finderCity === 'all' ||
        evt.city.toLowerCase().includes(finderCity.toLowerCase()) ||
        (finderCity === 'virtual' && evt.venueFormat === 'virtual');
      const queryOk =
        !q ||
        evt.title.toLowerCase().includes(q) ||
        evt.venue.toLowerCase().includes(q) ||
        formatEventDateSpan(evt.isoDate, evt.endIsoDate, evt.date).toLowerCase().includes(q) ||
        (evt.isoDate || '').toLowerCase().includes(q);
      return catOk && cityOk && queryOk;
    });
  }, [allEvents, finderCategory, finderCity, finderQuery]);

  const topMatchedEvent = matchingEvents[0] ?? featuredEvent;

  const publishedEvents = useMemo(() => {
    const active = allEvents.filter((evt) => evt.status !== 'draft');
    const sorted = [...active].sort((a, b) => {
      const aCustom = a.flyerUrl?.startsWith('data:') ? 1 : 0;
      const bCustom = b.flyerUrl?.startsWith('data:') ? 1 : 0;
      return bCustom - aCustom;
    });
    return sorted.slice(0, 9);
  }, [allEvents]);

  useEffect(() => {
    if (sliderPaused) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => ((prev + 1) % 3) as 0 | 1 | 2);
    }, 6000);
    return () => clearInterval(timer);
  }, [sliderPaused]);

  const handleQuickStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickEmail.trim()) return;
    setQuickSent(true);
    const trimmed = quickEmail.trim();
    setTimeout(() => {
      if (isSignedIn) {
        onQuickStartEmail(trimmed);
      } else {
        onNavigateSignIn(trimmed);
      }
    }, 350);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const goAuthOrStudio = () => {
    if (isSignedIn) {
      onNavigateStudio();
      return;
    }
    onNavigateSignIn();
  };

  const goCreateOrLogin = () => {
    if (isSignedIn) {
      if (onCreateEvent) {
        onCreateEvent();
      } else {
        onNavigateStudio();
      }
      return;
    }
    onNavigateSignIn();
  };

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col overflow-x-clip">
      <SeoHead {...MARKETING_SEO['/']} />
      {/* FIXED TOP HEADER */}
      <header className="fixed top-0 inset-x-0 w-full z-50 bg-[#F5F5F7]/88 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 md:py-0 md:h-20 flex flex-wrap md:flex-nowrap xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-between gap-x-3 lg:gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="xl:justify-self-start flex items-center text-left shrink-0 min-w-0 group rounded-xl py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D3822]/20"
          >
            <BrandLogo
              variant="light"
              size="md"
              subtitle="Weddings · Church · Corporate · Tech"
              subtitleClassName="hidden xl:block text-[#71717A]"
            />
          </button>

          <nav
            aria-label="Primary navigation"
            className="order-3 md:order-2 xl:justify-self-center w-full md:w-auto min-w-0 flex items-center md:justify-center gap-1 sm:gap-1.5 md:gap-0.5 lg:gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border-t border-black/[0.06] md:border md:border-black/[0.06] md:bg-white/75 md:rounded-full md:p-1 md:shadow-[0_1px_3px_rgba(0,0,0,0.04)] pt-2 md:pt-1 pb-0.5 md:pb-1 text-xs lg:text-[13px]"
          >
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-[#0B0B0B] font-semibold bg-black/[0.05] md:bg-[#F5F5F7] rounded-full px-3 py-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              Product
            </button>
            <Link
              to="/features"
              className="text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </Link>
            <Link
              to="/how-it-works"
              className="text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </Link>
            <Link
              to="/pricing"
              className="text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Pricing
            </Link>
            <Link
              to="/faq"
              className="text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </Link>
            <Link
              to="/blog"
              className="text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.04] rounded-full px-2.5 lg:px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Blog
            </Link>
          </nav>

          <div className="order-2 md:order-3 xl:justify-self-end flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => (isSignedIn && onSignOut ? onSignOut() : onNavigateSignIn())}
              className="inline-flex items-center justify-center h-9 rounded-full text-xs lg:text-[13px] font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-black/[0.05] transition-colors px-2.5 sm:px-3 whitespace-nowrap shrink-0"
            >
              {isSignedIn ? 'Log Out' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={goCreateOrLogin}
              className="inline-flex items-center justify-center h-9 bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 rounded-full hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-[0_6px_16px_-4px_rgba(11,11,11,0.22)] whitespace-nowrap shrink-0"
            >
              <span className="lg:hidden">{isSignedIn ? 'Studio' : 'Create Event'}</span>
              <span className="hidden lg:inline">
                {isSignedIn ? 'Open Studio' : 'Create Event'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="w-full pt-[102px] sm:pt-[106px] md:pt-20 flex-1 overflow-x-clip">
        {/* SECTION 1: DARK IMMERSIVE HERO + INTERACTIVE EVENT FINDER */}
        <div className="relative w-full overflow-hidden">
          <section className="relative w-full overflow-hidden bg-[#0B0B0B] text-white">
            {/* Full-bleed atmospheric stage backdrop */}
            {!heroImgFailed && (
              <div className="absolute inset-0 pointer-events-none z-0">
                <img
                  src={HERO_BACKDROP_IMG}
                  alt="Crowd at live gathering with atmospheric lighting"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover object-center opacity-75 grayscale contrast-110 scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0B]/85 via-[#0B0B0B]/45 to-[#0B0B0B]/15" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0B]/85 via-transparent to-[#0B0B0B]/35" />
              </div>
            )}

            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pt-8 sm:pt-12 md:pt-14 pb-10 sm:pb-14 lg:pb-16">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 sm:gap-9 lg:gap-12 items-center">
                {/* Left 7 Columns: Headline, Check-In & QR Scanner CTAs, Categories & Partners */}
                <div className="lg:col-span-7 flex flex-col justify-between min-w-0">
                  <p className="text-[11px] sm:text-xs font-semibold text-zinc-300 tracking-wide mb-3 sm:mb-5">
                    Africa&apos;s Event Gateway · Arkesel &amp; Resend Powered
                  </p>

                  <h1 className="font-display text-[30px] leading-[36px] sm:text-[42px] sm:leading-[48px] lg:text-[52px] lg:leading-[60px] xl:text-[56px] xl:leading-[64px] text-white tracking-[-0.03em] font-bold text-balance">
                    Events By You — Where Every Event Begins
                  </h1>

                  <p className="mt-4 sm:mt-5 text-sm sm:text-base lg:text-[17px] lg:leading-[26px] text-white/80 max-w-xl">
                    Built for weddings, funerals, church conventions, musical concerts, corporate
                    galas, and tech summits — guaranteed high-delivery SMS passes, offline-ready QR
                    gate scanning, and frictionless check-in registration.
                  </p>

                  {/* Category Strip — clickable to filter the Find Event card */}
                  <div className="mt-5 flex flex-wrap items-center gap-1.5">
                    {EVENT_CATEGORIES.map((cat) => {
                      const active = finderCategory === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setFinderCategory(active ? 'all' : cat)}
                          className={`px-3 py-1.5 sm:py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'bg-white text-[#0B0B0B] border-white'
                              : 'bg-white/10 text-white/85 border-white/15 hover:bg-white/20'
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>

                  {/* Prominent Hero CTAs */}
                  <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-3.5">
                    <PWAInstallButton variant="hero" className="w-full sm:w-auto" />
                    <button
                      type="button"
                      onClick={goCreateOrLogin}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-transparent text-white/85 hover:text-white text-xs font-semibold px-4 py-3 sm:py-3.5 rounded-full transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Create Your Event</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  {!isSignedIn && (
                    <p className="mt-3 text-[11px] text-white/60">
                      Open any invitation link to validate your circle &amp; claim a QR pass — or sign in in seconds to host events.
                    </p>
                  )}
                </div>

                {/* Right 5 Columns: Find or Host Events Interactive Card */}
                <div className="lg:col-span-5 min-w-0">
                  <div className="bg-white/92 backdrop-blur-md rounded-2xl sm:rounded-3xl p-5 sm:p-7 lg:p-8 shadow-2xl text-[#0B0B0B] border border-white/60">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E5E5EA]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-[#0B0B0B] leading-none">
                            Find or Host Events
                          </h2>
                          <span className="text-[11px] text-[#71717A]">
                            Discover events, register &amp; get QR passes
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-[#71717A] tabular-nums">
                        {matchingEvents.length} Live
                      </span>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        goCreateOrLogin();
                      }}
                      className="mt-5 flex flex-col gap-3.5"
                    >
                      <div>
                        <label
                          htmlFor="hero-event-type"
                          className="block text-[11px] text-[#71717A] uppercase tracking-wider mb-1.5 font-semibold"
                        >
                          Event Type
                        </label>
                        <div className="relative">
                          <select
                            id="hero-event-type"
                            value={finderCategory}
                            onChange={(e) => setFinderCategory(e.target.value)}
                            className="w-full bg-[#F3F3F5] border border-[#E5E5EA] rounded-xl px-4 py-3 text-sm font-medium text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B] appearance-none cursor-pointer pr-10"
                          >
                            <option value="all">All Event Categories</option>
                            {EVENT_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 text-[#71717A] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="hero-event-city"
                          className="block text-[11px] text-[#71717A] uppercase tracking-wider mb-1.5 font-semibold"
                        >
                          Location / City
                        </label>
                        <div className="relative">
                          <select
                            id="hero-event-city"
                            value={finderCity}
                            onChange={(e) => setFinderCity(e.target.value)}
                            className="w-full bg-[#F3F3F5] border border-[#E5E5EA] rounded-xl px-4 py-3 text-sm font-medium text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B] appearance-none cursor-pointer pr-10"
                          >
                            <option value="all">All African Hubs &amp; Virtual</option>
                            <option value="Accra">Accra, Ghana</option>
                            <option value="Lagos">Lagos, Nigeria</option>
                            <option value="Nairobi">Nairobi, Kenya</option>
                            <option value="Kigali">Kigali, Rwanda</option>
                            <option value="virtual">Virtual / Online Livestream</option>
                          </select>
                          <MapPin className="w-4 h-4 text-[#71717A] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="hero-event-search"
                          className="block text-[11px] text-[#71717A] uppercase tracking-wider mb-1.5 font-semibold"
                        >
                          Event Name or Date
                        </label>
                        <div className="relative flex items-center">
                          <input
                            id="hero-event-search"
                            type="text"
                            value={finderQuery}
                            onChange={(e) => setFinderQuery(e.target.value)}
                            placeholder="Search weddings, church, music, corporate..."
                            className="w-full bg-[#F3F3F5] border border-[#E5E5EA] rounded-xl px-4 py-3 text-sm text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:border-[#0B0B0B] pr-10"
                          />
                          <Search className="w-4 h-4 text-[#71717A] absolute right-3.5 pointer-events-none" />
                        </div>
                      </div>

                      {/* Live Top Match Card */}
                      {topMatchedEvent ? (
                        <div className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#71717A] mb-0.5">
                              {matchingEvents.length > 0
                                ? 'Top Matched Event'
                                : 'Featured Fallback · No Exact Match'}
                            </p>
                            <p className="text-xs font-bold text-[#0B0B0B] truncate">
                              {topMatchedEvent.title}
                            </p>
                            <p className="text-[11px] text-[#71717A] mt-0.5 truncate tabular-nums">
                              {topMatchedEvent.category} · {topMatchedEvent.city} ·{' '}
                              {formatEventDateSpan(
                                topMatchedEvent.isoDate,
                                topMatchedEvent.endIsoDate,
                                topMatchedEvent.date
                              )}
                            </p>
                          </div>
                          {onOpenQrScanner && (
                            <button
                              type="button"
                              onClick={goAuthOrStudio}
                              title="Sign in to open QR Gate Scanner"
                              className="px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              QR Scan
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
                          <p className="text-xs font-bold text-[#0B0B0B]">
                            No published events yet
                          </p>
                          <p className="text-[11px] text-[#71717A] mt-0.5">
                            Create your first event to publish a live invitation URL, QR gate scanner, and standalone gift table.
                          </p>
                        </div>
                      )}

                      <div className="pt-1">
                        <button
                          type="submit"
                          className="w-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                        >
                          <span>{isSignedIn ? 'Open Studio & Host Event' : 'Sign In to Host or Manage Events'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="pt-2 text-center border-t border-[#E5E5EA]">
                        <button
                          type="button"
                          onClick={goAuthOrStudio}
                          className="text-xs text-[#71717A] hover:text-[#0B0B0B] transition-colors inline-flex items-center gap-1"
                        >
                          <span className="text-[#0B0B0B] font-semibold">Hosting an event or program?</span>
                          <span>Sign in &amp; create in 2 minutes</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Secondary Light Canvas Container: Prominent Check-In Registration & QR Scanner Spotlight + Walkthrough */}
          <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pt-10 sm:pt-14 pb-14 sm:pb-20">
            {/* ALL CORE PLATFORM FEATURES SHOWCASE (NON-CLICKABLE FEATURE CARDS) */}
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 relative z-10">
              {/* Feature 1: Check-In & QR Pass Screen */}
              <div className="bg-[#0B0B0B] text-white rounded-2xl sm:rounded-[28px] p-5 sm:p-6 flex flex-col justify-between gap-4 shadow-xl min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-white/10 px-2.5 py-1 rounded-full whitespace-nowrap">
                    0.3s Camera &amp; Kiosk QR
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Check-In &amp; QR Pass Screen
                  </h2>
                  <p className="text-xs sm:text-[13px] text-zinc-300 mt-1.5 leading-relaxed">
                    Fullscreen guest Check-In QR Pass screen at venue entrances paired with an
                    anti-passback volunteer gate scanner.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Fullscreen Kiosk QR</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-zinc-200 text-[11px] font-medium whitespace-nowrap">
                    Gate Scanner
                  </span>
                </div>
              </div>

              {/* Feature 2: Guest Validation, Custom Forms & RSVP */}
              <div className="bg-white text-[#0B0B0B] rounded-2xl sm:rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col justify-between gap-4 shadow-sm min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-2.5 py-1 rounded-full whitespace-nowrap">
                    Forms · E.164 RSVP
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Guest Validation &amp; Custom Forms
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#71717A] mt-1.5 leading-relaxed">
                    Circle-based approval (Family, Friends, VIP), custom registration fields, and
                    strict duplicate phone protection.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Circle Validation</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#444748] text-[11px] font-medium whitespace-nowrap">
                    Custom RSVP Fields
                  </span>
                </div>
              </div>

              {/* Feature 3: Event Disposable Camera */}
              <div className="bg-white text-[#0B0B0B] rounded-2xl sm:rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col justify-between gap-4 shadow-sm min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <Camera className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-2.5 py-1 rounded-full whitespace-nowrap">
                    35mm Shared Film
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Event Disposable Camera
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#71717A] mt-1.5 leading-relaxed">
                    Full-viewport guest film camera unlocked by attendee check-in pass with flash,
                    zoom, film presets, and contact sheets.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Camera className="w-3.5 h-3.5" />
                    <span>5-Shot Pass Unlock</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#444748] text-[11px] font-medium whitespace-nowrap">
                    Printout Archive
                  </span>
                </div>
              </div>

              {/* Feature 4: Standalone Gift Table & Desk Portal */}
              <div className="bg-white text-[#0B0B0B] rounded-2xl sm:rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col justify-between gap-4 shadow-sm min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <Gift className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-2.5 py-1 rounded-full whitespace-nowrap">
                    /e/slug/gifts
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Standalone Gift Table &amp; Desk
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#71717A] mt-1.5 leading-relaxed">
                    Dedicated gift portal and appointed desk attendant ledger for cash, MoMo, and
                    registry pledges — separate from the Studio.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Gift className="w-3.5 h-3.5" />
                    <span>Dedicated Gift Link</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#444748] text-[11px] font-medium whitespace-nowrap">
                    Desk Personnel View
                  </span>
                </div>
              </div>

              {/* Feature 5: Arkesel SMS & Resend Email Passes */}
              <div className="bg-white text-[#0B0B0B] rounded-2xl sm:rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col justify-between gap-4 shadow-sm min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-2.5 py-1 rounded-full whitespace-nowrap">
                    MTN · Telecel · AT
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Arkesel SMS &amp; Email Passes
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#71717A] mt-1.5 leading-relaxed">
                    Custom Sender IDs, dynamic QR pass templates, delivery telemetry, and one-click
                    post-event thank-you SMS blasts.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Arkesel v2 SMS</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#444748] text-[11px] font-medium whitespace-nowrap">
                    Resend Email
                  </span>
                </div>
              </div>

              {/* Feature 6: Program Schedule, Flyers & CSV Exports */}
              <div className="bg-white text-[#0B0B0B] rounded-2xl sm:rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col justify-between gap-4 shadow-sm min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-2.5 py-1 rounded-full whitespace-nowrap">
                    Flyers · Live Agenda
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    Designer Flyers &amp; Live Schedule
                  </h2>
                  <p className="text-xs sm:text-[13px] text-[#71717A] mt-1.5 leading-relaxed">
                    Editorial invitation cards with OpenGraph previews, real-time run-of-show
                    program updates, and full CSV guest exports.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Program Schedule</span>
                  </span>
                  <span className="px-3 py-1.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#444748] text-[11px] font-medium whitespace-nowrap">
                    Offline Manifest &amp; CSV
                  </span>
                </div>
              </div>
            </div>

            {/* PUBLISHED EVENTS & DESIGNER INVITATION FLYERS GALLERY */}
            <div className="mt-10 sm:mt-14 max-w-6xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Published Events · Direct /e/slug Invitations &amp; OG Previews
                  </span>
                  <h2 className="mt-1 font-display text-[24px] sm:text-[30px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em]">
                    Designer Event Flyers Ready for Sharing
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={goCreateOrLogin}
                  className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors self-start sm:self-auto whitespace-nowrap"
                >
                  Publish Your Event
                </button>
              </div>

              {publishedEvents.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {publishedEvents.map((evt) => (
                    <EventFlyerCard
                      key={evt.id}
                      event={evt}
                      showActions={false}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-3xl p-8 sm:p-10 border border-[#E5E5EA] text-center space-y-3">
                  <p className="text-sm font-bold text-[#0B0B0B]">No published event flyers yet</p>
                  <p className="text-xs text-[#71717A] max-w-md mx-auto leading-relaxed">
                    Once you create and publish an event in Creator Studio, your live flyer card, registration page, and gate QR pass appear here automatically.
                  </p>
                  <button
                    type="button"
                    onClick={goCreateOrLogin}
                    className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
                  >
                    Publish Your First Event
                  </button>
                </div>
              )}
            </div>

            {/* Interactive 3-Step Hero Product Walkthrough Slider */}
            <div className="mt-10 sm:mt-14 relative max-w-6xl mx-auto scroll-mt-28 md:scroll-mt-24" id="live-preview">
              {/* Step Tabs + Prev/Next Controls */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-5">
                <div
                  role="tablist"
                  aria-label="Product walkthrough steps"
                  className="w-full md:w-auto grid grid-cols-3 md:inline-flex items-stretch md:items-center gap-1 p-1 bg-[#EEEEF0] rounded-2xl md:rounded-full border border-[#E5E5EA]"
                >
                  {(
                    [
                      { id: 0 as const, label: 'Create & Publish', shortLabel: 'Publish' },
                      { id: 1 as const, label: 'SMS & Email Delivery', shortLabel: 'SMS & Email' },
                      { id: 2 as const, label: 'Gate Pass & Check-In', shortLabel: 'Gate Pass' },
                    ] as const
                  ).map((tab, idx) => {
                    const active = activeSlide === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveSlide(tab.id)}
                        className={`min-w-0 px-2 sm:px-3.5 lg:px-4 py-2 rounded-xl md:rounded-full text-[11px] sm:text-xs font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 whitespace-nowrap md:shrink-0 ${
                          active
                            ? 'bg-[#0B0B0B] text-white shadow-sm'
                            : 'text-[#71717A] hover:text-[#0B0B0B]'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            active ? 'bg-white/20 text-white' : 'bg-white text-[#71717A]'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="sm:hidden truncate max-w-full">{tab.shortLabel}</span>
                        <span className="hidden sm:inline">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between md:justify-end gap-2.5 shrink-0 px-3 py-1.5 md:p-0 rounded-2xl md:rounded-none bg-[#EEEEF0]/70 md:bg-transparent border border-[#E5E5EA]/80 md:border-0">
                  <div className="flex items-center gap-2.5 md:mr-1">
                    <span className="hidden lg:inline-block text-[11px] font-medium text-[#71717A] whitespace-nowrap">
                      Interactive Walkthrough
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-[#0B0B0B] tabular-nums lg:hidden">
                      0{activeSlide + 1} / 03
                    </span>
                    <div
                      className="flex md:hidden items-center gap-1"
                      aria-label="Slide indicators"
                    >
                      {([0, 1, 2] as const).map((idx) => (
                        <button
                          key={idx}
                          type="button"
                          aria-label={`Go to step ${idx + 1}`}
                          onClick={() => setActiveSlide(idx)}
                          className={`h-1.5 rounded-full transition-all ${
                            activeSlide === idx
                              ? 'w-5 bg-[#0B0B0B]'
                              : 'w-1.5 bg-[#C4C7C7] hover:bg-[#71717A]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      aria-label="Previous slide"
                      onClick={() => setActiveSlide((prev) => ((prev + 2) % 3) as 0 | 1 | 2)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] active:scale-95 flex items-center justify-center text-[#0B0B0B] transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next slide"
                      onClick={() => setActiveSlide((prev) => ((prev + 1) % 3) as 0 | 1 | 2)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] active:scale-95 flex items-center justify-center text-[#0B0B0B] transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Master Bento Slider Viewport */}
              <div
                onMouseEnter={() => setSliderPaused(true)}
                onMouseLeave={() => setSliderPaused(false)}
                className="bg-[#EEEEF0] p-3.5 sm:p-6 lg:p-8 rounded-2xl sm:rounded-[28px] shadow-sm border border-[#E5E5EA]/70"
              >
                {/* SLIDE 1: Create & Publish */}
                {activeSlide === 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#EEEEF0]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
                              <CalendarPlus className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-sm sm:text-base font-bold text-[#0B0B0B] leading-none">
                                Event Creator Studio
                              </h4>
                              <span className="text-[11px] text-[#71717A]">
                                Step 1 of 3: Details, Schedule &amp; Slug
                              </span>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-semibold">
                            Auto-Saved
                          </span>
                        </div>

                        <div className="mt-5 space-y-3.5">
                          <div>
                            <span className="block text-[11px] uppercase tracking-wider text-[#71717A] mb-1">
                              Event Title
                            </span>
                            <div className="p-3 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] text-sm font-semibold text-[#0B0B0B]">
                              {SHOWCASE_PREVIEW_EVENT.title}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <span className="block text-[11px] uppercase tracking-wider text-[#71717A] mb-1">
                                Auto Generated URL
                              </span>
                              <div className="p-2.5 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] font-mono text-xs text-[#0B0B0B] flex items-center justify-between gap-2">
                                <span className="truncate">
                                  /e/{SHOWCASE_PREVIEW_EVENT.slug}
                                </span>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              </div>
                            </div>
                            <div>
                              <span className="block text-[11px] uppercase tracking-wider text-[#71717A] mb-1">
                                Venue &amp; Capacity
                              </span>
                              <div className="p-2.5 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] text-xs text-[#0B0B0B] flex items-center justify-between gap-2">
                                <span className="truncate tabular-nums">
                                  {SHOWCASE_PREVIEW_EVENT.city} · {SHOWCASE_PREVIEW_EVENT.capacity} max
                                </span>
                                <MapPin className="w-4 h-4 text-[#71717A] shrink-0" />
                              </div>
                            </div>
                          </div>

                          <div className="p-3 bg-[#F5F5F7] rounded-xl border border-dashed border-[#C4C7C7] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <img
                                src={SHOWCASE_PREVIEW_EVENT.flyerUrl}
                                alt={`${SHOWCASE_PREVIEW_EVENT.title} sample hero flyer`}
                                className="w-12 h-10 rounded-lg object-cover border border-[#E5E5EA] shrink-0"
                              />
                              <div className="min-w-0">
                                <span className="text-xs font-semibold text-[#0B0B0B] block truncate">
                                  Hero Flyer Sample · {SHOWCASE_PREVIEW_EVENT.title}
                                </span>
                                <span className="text-[11px] text-[#71717A] block truncate">
                                  {SHOWCASE_PREVIEW_EVENT.venue} · Instant edge deploy
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={goCreateOrLogin}
                              className="self-start sm:self-auto px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] shrink-0 transition-colors"
                            >
                              Open Wizard
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-start sm:items-center gap-1.5 text-[#0B0B0B]">
                          <Bolt className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                          <span>
                            Instant CDN deployment across Accra, Lagos, Nairobi &amp; Kigali in 0.8s.
                          </span>
                        </span>
                        <span className="self-start sm:self-auto bg-white px-2 py-0.5 rounded font-mono text-[#0B0B0B] shrink-0">
                          Global Edge
                        </span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col justify-between relative overflow-hidden min-w-0">
                      <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">
                            Sample Preview · /e/{SHOWCASE_PREVIEW_EVENT.slug}
                          </span>
                          <span className="text-[11px] text-emerald-400 bg-white/10 px-2.5 py-0.5 rounded-full font-medium">
                            Sample ({SHOWCASE_PREVIEW_EVENT.occupancyPct}%)
                          </span>
                        </div>
                        <div className="mt-4">
                          <span className="text-[11px] text-zinc-400 tabular-nums">
                            {SHOWCASE_PREVIEW_EVENT.date} · {SHOWCASE_PREVIEW_EVENT.venueFormat}
                          </span>
                          <h3 className="text-xl font-bold text-white mt-1">
                            {SHOWCASE_PREVIEW_EVENT.title}
                          </h3>
                          <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">
                            {SHOWCASE_PREVIEW_EVENT.subtitle}
                          </p>
                        </div>

                        <div className="mt-6 bg-white/10 p-4 rounded-2xl border border-white/10 space-y-2.5">
                          <div className="flex items-center justify-between text-[11px] text-white/80">
                            <span>Fast Attendee Registration</span>
                            <span className="text-emerald-400 font-mono">Instant QR Pass</span>
                          </div>
                          <div className="space-y-2 font-mono text-xs">
                            <div className="p-2.5 bg-[#0B0B0B]/60 rounded-xl border border-white/10 text-white/90 flex items-center justify-between">
                              <span>{SHOWCASE_PREVIEW_ATTENDEES[0].name}</span>
                              <span className="text-white/40 text-[10px]">Name</span>
                            </div>
                            <div className="p-2.5 bg-[#0B0B0B]/60 rounded-xl border border-white/10 text-emerald-400 flex items-center justify-between">
                              <span className="tabular-nums">
                                {SHOWCASE_PREVIEW_ATTENDEES[0].phone}
                              </span>
                              <span className="text-emerald-400/70 text-[10px]">E.164</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={goCreateOrLogin}
                            className="w-full py-2.5 bg-white text-[#0B0B0B] text-xs font-bold rounded-full hover:bg-neutral-200 transition-colors"
                          >
                            Create Event &amp; Publish
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span>60-second attendee registration</span>
                        <span className="text-white font-mono">No passwords required</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SLIDE 2: Instant SMS & Email Delivery Engine */}
                {activeSlide === 1 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#EEEEF0]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
                              <Radio className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-sm sm:text-base font-bold text-[#0B0B0B] leading-none">
                                Arkesel v2 Telco Engine
                              </h4>
                              <span className="text-[11px] text-[#71717A]">
                                Step 2 of 3: SMS Dispatch &amp; DLR Telemetry
                              </span>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-semibold tabular-nums">
                            {SHOWCASE_PREVIEW_EVENT.smsDispatched} / {SHOWCASE_PREVIEW_EVENT.registered} Dispatched
                          </span>
                        </div>

                        <div className="mt-5 space-y-3.5">
                          <div className="p-3.5 bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA]">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px] text-[#71717A]">
                              <span>
                                Sender ID:{' '}
                                <strong className="text-[#0B0B0B]">
                                  {SHOWCASE_PREVIEW_EVENT.senderId}
                                </strong>
                              </span>
                              <span className="font-mono text-emerald-700 font-semibold tabular-nums">
                                Dynamic Organiser Template
                              </span>
                            </div>
                            <p className="font-mono text-xs text-[#0B0B0B] leading-relaxed bg-white p-3 rounded-xl border border-[#E5E5EA]">
                              Hi {SHOWCASE_PREVIEW_ATTENDEES[0].name.split(' ')[0]}, your pass for{' '}
                              {SHOWCASE_PREVIEW_EVENT.title} is confirmed. Show QR token{' '}
                              <span className="text-emerald-700 font-bold">
                                {SHOWCASE_PREVIEW_ATTENDEES[0].ticketCode}
                              </span>{' '}
                              at {SHOWCASE_PREVIEW_EVENT.venue}.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5 sm:text-center">
                            <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                              <span className="text-[11px] text-[#71717A] block">MTN Direct SS7</span>
                              <div className="text-right sm:text-center">
                                <span className="text-xs font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                  Arkesel Route
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                  Instant Dispatch
                                </span>
                              </div>
                            </div>
                            <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                              <span className="text-[11px] text-[#71717A] block">Telecel SMPP</span>
                              <div className="text-right sm:text-center">
                                <span className="text-xs font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                  Custom Sender ID
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                  Check-In Link
                                </span>
                              </div>
                            </div>
                            <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                              <span className="text-[11px] text-[#71717A] block">AT Gateway</span>
                              <div className="text-right sm:text-center">
                                <span className="text-xs font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                  Camera Access
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                  5-Shot Unlock
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-start sm:items-center gap-2 text-[#0B0B0B]">
                          <Mail className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
                          <span>
                            Simultaneous transactional email sent via verified Resend delivery.
                          </span>
                        </span>
                        <span className="self-start sm:self-auto text-emerald-700 font-bold shrink-0">
                          Dual-Route
                        </span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col justify-between relative overflow-hidden min-w-0">
                      <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                            Attendee Phone Screen
                          </span>
                          <span className="text-emerald-400 text-[11px] font-mono">
                            Delivered Now
                          </span>
                        </div>

                        <div className="mt-6 bg-white text-[#0B0B0B] p-4 rounded-2xl shadow-md">
                          <div className="flex items-center justify-between pb-2 border-b border-[#EEEEF0] mb-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              {SHOWCASE_PREVIEW_EVENT.senderId}
                            </span>
                            <span className="text-[11px] font-mono text-[#71717A]">Just now</span>
                          </div>
                          <p className="text-xs text-[#1A1C1D] leading-relaxed">
                            Hi {SHOWCASE_PREVIEW_ATTENDEES[0].name.split(' ')[0]}, your pass for{' '}
                            {SHOWCASE_PREVIEW_EVENT.title} is confirmed. Show your QR token at check-in:{' '}
                            <strong className="font-mono bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                              {SHOWCASE_PREVIEW_ATTENDEES[0].ticketCode}
                            </strong>
                            .
                          </p>
                          <div className="mt-3 p-2.5 bg-[#F5F5F7] rounded-xl flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                            <span className="text-[#71717A]">Camera Link:</span>
                            <span className="text-emerald-700 font-bold truncate">
                              /e/{SHOWCASE_PREVIEW_EVENT.slug}/camera
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-white shrink-0" />
                          No Internet Needed for SMS Pass
                        </span>
                        <span className="text-white font-semibold">Works on Feature Phones</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SLIDE 3: Sub-Second Gate Check-In & PWA Turnstile */}
                {activeSlide === 2 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#EEEEF0]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
                              <QrCode className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-sm sm:text-base font-bold text-[#0B0B0B] leading-none">
                                Volunteer Turnstile PWA
                              </h4>
                              <span className="text-[11px] text-[#71717A]">
                                Step 3 of 3: Sub-Second Check-In &amp; Anti-Passback
                              </span>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 text-[11px] font-semibold">
                            Gate Scanner
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 my-4">
                          <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                            <span className="text-[11px] text-[#71717A] block">Admitted</span>
                            <div className="text-right sm:text-left">
                              <span className="font-display text-xl sm:text-2xl lg:text-[26px] font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                {SHOWCASE_PREVIEW_EVENT.checkedIn}/{SHOWCASE_PREVIEW_EVENT.registered}
                              </span>
                              <span className="text-[11px] text-emerald-600 font-semibold tabular-nums">
                                {Math.round(
                                  (SHOWCASE_PREVIEW_EVENT.checkedIn / SHOWCASE_PREVIEW_EVENT.registered) *
                                    100
                                )}
                                % Turnout
                              </span>
                            </div>
                          </div>
                          <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                            <span className="text-[11px] text-[#71717A] block">Scan Velocity</span>
                            <div className="text-right sm:text-left">
                              <span className="font-display text-xl sm:text-2xl lg:text-[26px] font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                0.3s
                              </span>
                              <span className="text-[11px] text-[#71717A]">Sub-second camera</span>
                            </div>
                          </div>
                          <div className="p-3 bg-[#F5F5F7] rounded-xl flex sm:block items-center justify-between gap-2">
                            <span className="text-[11px] text-[#71717A] block">Duplicates</span>
                            <div className="text-right sm:text-left">
                              <span className="font-display text-xl sm:text-2xl lg:text-[26px] font-bold text-[#0B0B0B] sm:mt-0.5 block tabular-nums">
                                0
                              </span>
                              <span className="text-[11px] text-emerald-600 font-semibold">
                                Zero Passback
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {SHOWCASE_PREVIEW_ATTENDEES.map((att, idx) => (
                            <div
                              key={att.id}
                              className="p-3 bg-[#F3F3F5] rounded-2xl flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                    idx === 0
                                      ? 'bg-[#0B0B0B] text-white'
                                      : 'bg-[#E2E2E4] text-[#0B0B0B]'
                                  }`}
                                >
                                  {att.name
                                    .split(' ')
                                    .map((n) => n[0])
                                    .join('')
                                    .slice(0, 2)}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-semibold text-[#0B0B0B] block truncate">
                                    {att.name} ({att.tier})
                                  </span>
                                  <span className="font-mono text-[11px] text-[#71717A] block truncate">
                                    Pass: {att.ticketCode}
                                  </span>
                                </div>
                              </div>
                              <span className="px-2.5 py-0.5 rounded-full bg-white text-emerald-600 text-[11px] font-semibold inline-flex items-center gap-1 shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Valid Entry
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-start sm:items-center gap-2 text-[#0B0B0B]">
                          <WifiOff className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                          <span>
                            IndexedDB offline cache holds 100% attendee manifest if venue WiFi drops.
                          </span>
                        </span>
                        <span className="self-start sm:self-auto bg-white px-2 py-0.5 rounded font-mono text-[#0B0B0B] shrink-0">
                          Offline Ready
                        </span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col justify-between relative overflow-hidden min-w-0">
                      <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                            Scanned Digital Token
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-white/10 px-2.5 py-0.5 rounded-full font-medium">
                            <Check className="w-3.5 h-3.5" />
                            Verified &amp; Burned
                          </span>
                        </div>

                        <div className="mt-5 bg-white p-5 rounded-2xl text-[#0B0B0B] flex flex-col items-center relative">
                          <div className="w-32 h-32 bg-[#EEEEF0] flex items-center justify-center rounded-xl p-2 relative">
                            <DeterministicQrSvg
                              value={buildEventInvitationUrl(
                                SHOWCASE_PREVIEW_EVENT.slug,
                                'checkin'
                              )}
                              size={112}
                              className="rounded-lg"
                            />
                            <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg absolute">
                              <Check className="w-4 h-4" />
                            </div>
                          </div>
                          <span className="mt-3 font-mono text-[13px] font-bold tracking-widest text-[#0B0B0B]">
                            {SHOWCASE_PREVIEW_ATTENDEES[0].ticketCode}
                          </span>
                          <span className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                            Instant Check-In &amp; Disposable Camera Unlock
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Smartphone className="w-4 h-4 text-white shrink-0" />
                          Synced to Cloud DB
                        </span>
                        <button
                          type="button"
                          onClick={onNavigateStudio}
                          className="text-white font-semibold hover:underline"
                        >
                          Open Organiser Studio →
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slider Interactive Bottom Progress Bar */}
                <div className="mt-6 pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <span className="font-mono text-[#0B0B0B] font-semibold tabular-nums shrink-0">
                      0{activeSlide + 1} / 03
                    </span>
                    <div className="flex-1 sm:w-48 h-1.5 bg-white rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0B0B0B] transition-all duration-300"
                        style={{ width: `${((activeSlide + 1) / 3) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setActiveSlide(0)}
                      className={`transition-colors whitespace-nowrap ${
                        activeSlide === 0 ? 'text-[#0B0B0B] font-semibold' : 'hover:text-[#0B0B0B]'
                      }`}
                    >
                      1. Studio
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveSlide(1)}
                      className={`transition-colors whitespace-nowrap ${
                        activeSlide === 1 ? 'text-[#0B0B0B] font-semibold' : 'hover:text-[#0B0B0B]'
                      }`}
                    >
                      2. SMS Engine
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveSlide(2)}
                      className={`transition-colors whitespace-nowrap ${
                        activeSlide === 2 ? 'text-[#0B0B0B] font-semibold' : 'hover:text-[#0B0B0B]'
                      }`}
                    >
                      3. Gate PWA
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* SECTION 2: HOW IT WORKS */}
        <section id="how-it-works" className="w-full bg-[#F3F3F5] py-14 sm:py-20 scroll-mt-28 md:scroll-mt-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12">
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Operational Architecture
              </span>
              <h2 className="mt-2 font-display text-[26px] sm:text-[32px] lg:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em] text-balance">
                Three steps to packed rooms and zero gate delays.
              </h2>
              <p className="mt-3 text-sm text-[#71717A]">
                Designed specifically to bridge high-traffic web landing pages with African mobile
                carrier reliability.
              </p>
            </div>

            <div className="mt-10 sm:mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">
              {/* Step 1 */}
              <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150 min-w-0">
                <div>
                  <div className="w-12 h-12 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] mb-6">
                    <span className="font-display text-xl font-bold">1</span>
                  </div>
                  <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Create &amp; Publish in 2 Minutes
                  </h3>
                  <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                    Upload event flyer banners, set physical or virtual schedules, and configure
                    dynamic SMS templates with{' '}
                    <span className="font-mono text-xs text-[#0B0B0B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                      {'{name}'}
                    </span>
                    ,{' '}
                    <span className="font-mono text-xs text-[#0B0B0B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                      {'{venue}'}
                    </span>
                    , and{' '}
                    <span className="font-mono text-xs text-[#0B0B0B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                      {'{ticket_code}'}
                    </span>{' '}
                    tokens.
                  </p>
                </div>
                <div className="mt-8 bg-[#F3F3F5] p-4 rounded-2xl">
                  <div className="flex items-center gap-2 text-[#71717A] text-[11px] font-medium mb-2">
                    <Settings className="w-3.5 h-3.5" />
                    <span>Template Configurator</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl font-mono text-[11px] text-[#0B0B0B]">
                    Dear {'{name}'}, your pass to {'{summit}'} on {'{date}'} is active.
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150 min-w-0">
                <div>
                  <div className="w-12 h-12 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] mb-6">
                    <span className="font-display text-xl font-bold">2</span>
                  </div>
                  <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Frictionless Attendee Checkout
                  </h3>
                  <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                    Attendees RSVP on{' '}
                    <span className="font-mono text-xs text-[#0B0B0B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                      /e/:slug
                    </span>{' '}
                    in under 60 seconds with their name, normalized phone, and email. Zero mandatory
                    passwords or heavy app downloads.
                  </p>
                </div>
                <div className="mt-8 bg-[#F3F3F5] p-4 rounded-2xl">
                  <div className="flex items-center gap-2 text-[#71717A] text-[11px] font-medium mb-2">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Input Sanitization Engine</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-xl">
                    <span className="font-mono text-[11px] text-[#71717A] line-through">
                      024 412 3456
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="font-mono text-[11px] text-emerald-700 font-bold">
                      +233244123456
                    </span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150 min-w-0">
                <div>
                  <div className="w-12 h-12 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] mb-6">
                    <span className="font-display text-xl font-bold">3</span>
                  </div>
                  <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Instant Multi-Channel Gate Passes
                  </h3>
                  <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                    Transactional Arkesel SMS hits attendee phones in under 3.2 seconds. Full Resend
                    email pass with QR verification token attached, plus 1-click post-event SMS
                    broadcasts.
                  </p>
                </div>
                <div className="mt-8 bg-[#F3F3F5] p-4 rounded-2xl">
                  <div className="flex items-center gap-2 text-[#71717A] text-[11px] font-medium mb-2">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Dual Delivery Latency</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[#0B0B0B] text-xs font-semibold tabular-nums">
                    <span>Arkesel SMS: 2.8s</span>
                    <span className="text-emerald-600">· Resend: 1.1s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: PLATFORM FEATURE MATRIX */}
        <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-20 lg:py-24 scroll-mt-28 md:scroll-mt-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 sm:mb-14 lg:mb-16 gap-4 sm:gap-6">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Telecom &amp; Hardware Infrastructure
              </span>
              <h2 className="mt-2 font-display text-[26px] sm:text-[32px] lg:text-[36px] leading-tight font-bold text-[#0B0B0B] max-w-xl tracking-[-0.02em]">
                Engineered for African connectivity challenges.
              </h2>
            </div>
            <p className="text-sm text-[#71717A] max-w-sm leading-relaxed">
              Built ground-up with native carrier APIs, offline fallbacks, and multi-tenant
              telemetry for conference halls with erratic WiFi.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 lg:gap-8">
            {/* Feature 1 */}
            <div className="bg-[#F3F3F5] p-6 sm:p-8 rounded-2xl flex flex-col justify-between min-w-0">
              <div>
                <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mb-6">
                  <Signal className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Arkesel v2 Native Integration
                </h3>
                <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                  Direct high-priority carrier routes across MTN Ghana, Telecel, and AT networks.
                  GSM-7 character credit auto-calculator guarantees zero split-message wastage with
                  real-time DLR delivery callbacks.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-[#444748]">
                  <span>MTN Direct SS7</span>
                  <span aria-hidden="true">·</span>
                  <span>Telecel SMPP</span>
                  <span aria-hidden="true">·</span>
                  <span>AT Network Ready</span>
                  <span aria-hidden="true">·</span>
                  <span>GSM-7 Optimizing</span>
                </div>
              </div>
              <div className="mt-8 p-4 bg-white rounded-2xl flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#0B0B0B]">Carrier Gateway Health</span>
                <span className="text-[11px] text-emerald-600 flex items-center gap-1.5 font-semibold tabular-nums">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  99.98% Latency &lt; 3.0s
                </span>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="bg-[#F3F3F5] p-6 sm:p-8 rounded-2xl flex flex-col justify-between min-w-0">
              <div>
                <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mb-6">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Duplicate Protection &amp; Auto-Normalization
                </h3>
                <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                  Strips spaces, international dial codes, and local leading zeros. Converts messy
                  attendee input into strict E.164 formats (+233, +234, +254) and prevents duplicate
                  phone registrations.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-[#444748]">
                  <span>E.164 Enforced</span>
                  <span aria-hidden="true">·</span>
                  <span>One RSVP per Phone Number</span>
                  <span aria-hidden="true">·</span>
                  <span>Spam Blocklist</span>
                </div>
              </div>
              <div className="mt-8 p-4 bg-white rounded-2xl flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#0B0B0B]">Fraud Prevention Rate</span>
                <span className="text-[11px] text-[#0B0B0B] font-semibold tabular-nums">
                  100% Unique RSVP Verification
                </span>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="bg-[#F3F3F5] p-6 sm:p-8 rounded-2xl flex flex-col justify-between min-w-0">
              <div>
                <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mb-6">
                  <QrCode className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Live Event Workspace &amp; Gate Check-In
                </h3>
                <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                  Turn any volunteer smartphone camera into an ultra-fast ticket scanner. Real-time
                  token validation warns gatekeepers of duplicate entries with immediate head-count
                  sync into Creator Studio.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-[#444748]">
                  <span>Sub-Second Camera Scan</span>
                  <span aria-hidden="true">·</span>
                  <span>Anti-Passback Check</span>
                  <span aria-hidden="true">·</span>
                  <span>Volunteer PIN Login</span>
                </div>
              </div>
              <div className="mt-8 p-4 bg-white rounded-2xl flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#0B0B0B]">Avg Scan Velocity</span>
                <span className="text-[11px] text-[#0B0B0B] font-semibold tabular-nums">
                  45 Attendees / Min / Gate
                </span>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="bg-[#F3F3F5] p-6 sm:p-8 rounded-2xl flex flex-col justify-between min-w-0">
              <div>
                <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mb-6">
                  <WifiOff className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Installable PWA with Offline Local Cache
                </h3>
                <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                  Add Events By You to iOS and Android home screens without app store downloads. Local
                  storage syncs attendee manifests for offline gate check-in when convention WiFi
                  drops.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-[#444748]">
                  <span>IndexedDB Local Cache</span>
                  <span aria-hidden="true">·</span>
                  <span>Background Sync</span>
                  <span aria-hidden="true">·</span>
                  <span>iOS / Android PWA</span>
                </div>
              </div>
              <div className="mt-8 p-4 bg-white rounded-2xl flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#0B0B0B]">Offline Tolerance</span>
                <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 shrink-0" /> Zero Data Loss on Reconnect
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: TRANSPARENT PLANS & QUOTAS */}
        <section id="pricing" className="w-full bg-[#F3F3F5] py-14 sm:py-20 lg:py-24 scroll-mt-28 md:scroll-mt-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12">
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Simple, Fair Pricing
              </span>
              <h2 className="mt-2 font-display text-[26px] sm:text-[32px] lg:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Start free. Scale when your audience expands.
              </h2>
              <p className="mt-3 text-sm text-[#71717A]">
                No hidden fees, no per-ticket commissions on free meetups.
              </p>

              {/* Interactive Monthly / Annual Switcher */}
              <div className="mt-7 sm:mt-8 inline-flex max-w-full flex-wrap items-center justify-center p-1 bg-[#E8E8EA] rounded-full border border-[#E5E5EA]">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
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

            <div className="mt-10 sm:mt-14 grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
              {/* Free Starter Tier */}
              <div className="bg-white p-6 sm:p-8 lg:p-10 rounded-2xl sm:rounded-3xl shadow-sm flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                      Free Starter Tier
                    </span>
                    <span className="text-[11px] font-semibold text-[#71717A]">
                      Weddings &amp; Meetups
                    </span>
                  </div>
                  <div className="mt-6 flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-[38px] sm:text-[44px] leading-none font-bold text-[#0B0B0B] tabular-nums">
                      $0
                    </span>
                    <span className="text-sm text-[#71717A]">/ forever</span>
                  </div>
                  <p className="mt-2 text-[13px] text-[#71717A]">
                    Everything planners need to run intimate weddings, fellowships, family
                    memorials, and community workshops.
                  </p>
                  <div className="mt-8 flex flex-col gap-3.5">
                    {[
                      '1 Active Event at any time',
                      'Up to 50 Attendees per event',
                      '20 Starter SMS Credits included',
                      'Standard Event Landing Page & URL',
                      'Resend Email Delivery included',
                      'Real-Time Mobile Gate QR Scanner',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-3">
                        <Check className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                        <span className="text-sm text-[#1A1C1D]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-10">
                  <button
                    type="button"
                    onClick={goAuthOrStudio}
                    className="w-full inline-flex items-center justify-center bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold py-3.5 rounded-full hover:bg-[#E2E2E4] transition-colors"
                  >
                    Get Started Free
                  </button>
                </div>
              </div>

              {/* Pro Organizer Tier */}
              <div className="bg-[#0B0B0B] text-white p-6 sm:p-8 lg:p-10 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden min-w-0">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Pro Organizer Tier
                    </span>
                    <span className="px-3 py-1 rounded-full bg-white/10 text-white text-[11px] font-semibold">
                      Concerts, Church &amp; Corporate
                    </span>
                  </div>
                  <div className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-display text-[38px] sm:text-[44px] leading-none font-bold text-white tabular-nums">
                      {billingCycle === 'annual' ? '$15' : '$19'}
                    </span>
                    <span className="text-xs sm:text-sm text-white/60 tabular-nums">
                      {billingCycle === 'annual'
                        ? '/ month (billed $180/yr) · approx. GHS 230/mo'
                        : '/ month · approx. GHS 290'}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-white/70">
                    Complete ticketing and RSVP infrastructure for church conventions, musical
                    concerts, funerals, corporate galas, and tech summits.
                  </p>
                  <div className="mt-8 flex flex-col gap-3.5 text-white">
                    {[
                      'Unlimited Active Events concurrently',
                      'Unlimited Attendees with zero caps',
                      'Custom SMS Sender IDs (e.g. YOURSUMMIT)',
                      'Fully Customizable SMS & Email Pass Templates',
                      'One-Click CSV Attendee Data Export',
                      'Post-Event Thank-You SMS Broadcast Blasts',
                      'Zero Events By You Watermarks on passes',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-3">
                        <Check className="w-4 h-4 text-white shrink-0" />
                        <span className="text-sm">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-10">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSignedIn) onNavigateSignIn();
                      else if (onUpgradePro) onUpgradePro();
                      else onNavigateStudio();
                    }}
                    className="w-full inline-flex items-center justify-center bg-white text-[#0B0B0B] text-xs font-semibold py-3.5 rounded-full hover:bg-neutral-200 transition-colors shadow-lg"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: REAL-TIME COMMUNITY SHOWCASE */}
        <section id="community-showcase" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 py-14 sm:py-20 scroll-mt-28 md:scroll-mt-24">
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-8 sm:mb-10 gap-4">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Powered Events across the Continent
              </span>
              <h2 className="mt-1 font-display text-[26px] sm:text-[32px] lg:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Built for memorable gatherings.
              </h2>
            </div>
            <button
              type="button"
              onClick={goAuthOrStudio}
              className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1 hover:underline shrink-0"
            >
              <span>{isSignedIn ? 'Open Organiser Studio' : 'Sign In for Studio'}</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          {publishedEvents.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {publishedEvents.slice(0, 3).map((evt, idx) => (
                <div
                  key={evt.id}
                  className="bg-[#F3F3F5] rounded-2xl overflow-hidden flex flex-col shadow-sm min-w-0"
                >
                  <div className="relative w-full h-48 sm:h-52 overflow-hidden bg-[#0B0B0B]">
                    {!failedImages[idx] ? (
                      <img
                        src={evt.flyerUrl || getCategoryPreset(evt.category).flyerUrl}
                        alt={evt.title}
                        referrerPolicy="no-referrer"
                        onError={() => setFailedImages((prev) => ({ ...prev, [idx]: true }))}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#1C1B1B] to-[#0B0B0B] flex items-center justify-center p-6 text-center">
                        <span className="font-display text-lg font-bold text-white/90">
                          {evt.title}
                        </span>
                      </div>
                    )}
                    <span className="absolute top-3 right-3 px-3 py-1 rounded-full bg-[#0B0B0B]/80 backdrop-blur-md text-white text-[11px] font-medium tabular-nums">
                      {evt.city} · {evt.registered}/{evt.capacity}
                    </span>
                  </div>

                  <div className="p-5 sm:p-6 flex flex-col justify-between flex-1">
                    <div>
                      <h4 className="text-base font-semibold text-[#0B0B0B]">{evt.title}</h4>
                      <p className="mt-2 text-[13px] text-[#71717A] leading-relaxed line-clamp-2">
                        {evt.subtitle}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#E5E5EA] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#71717A]">
                      <span>{evt.category} · {evt.venue}</span>
                      <span className="text-[#0B0B0B] font-semibold tabular-nums">
                        {formatEventDateSpan(evt.isoDate, evt.endIsoDate, evt.date)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-8 sm:p-10 border border-[#E5E5EA] text-center space-y-3">
              <p className="text-sm font-bold text-[#0B0B0B]">
                Live events hosted by organisers will showcase here
              </p>
              <p className="text-xs text-[#71717A] max-w-md mx-auto">
                Publish your wedding, church program, concert, corporate gala, or summit in Creator Studio to go live immediately.
              </p>
              <button
                type="button"
                onClick={goCreateOrLogin}
                className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
              >
                Create Event Now
              </button>
            </div>
          )}
        </section>

        {/* SECTION 6: INTERACTIVE QUICK-START CTA BANNER */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 pb-16 sm:pb-24">
          <div className="bg-white rounded-3xl sm:rounded-[32px] p-6 sm:p-10 lg:p-14 shadow-sm relative overflow-hidden">
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#EEEEF0] rounded-full blur-3xl pointer-events-none" />
            <div className="max-w-3xl mx-auto text-center relative z-10">
              <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mx-auto mb-5 sm:mb-6">
                <Rocket className="w-5 h-5" />
              </div>
              <h2 className="font-display text-[24px] sm:text-[32px] lg:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em] text-balance">
                Ready to host your wedding, church program, concert, corporate gala, or summit?
              </h2>
              <p className="mt-3 sm:mt-4 text-sm text-[#71717A] max-w-xl mx-auto leading-relaxed">
                Join planners, churches, families, and event teams creating seamless guest
                registration with guaranteed SMS passes and real-time gate check-in.
              </p>

              <div className="mt-7 sm:mt-8 max-w-md mx-auto">
                <form
                  onSubmit={handleQuickStart}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 sm:p-1.5 bg-[#F5F5F7] rounded-2xl sm:rounded-full"
                >
                  <input
                    type="email"
                    required
                    value={quickEmail}
                    onChange={(e) => setQuickEmail(e.target.value)}
                    placeholder="Enter your email address"
                    aria-label="Enter your email address"
                    className="w-full bg-transparent px-4 sm:px-5 py-2.5 sm:py-3 text-sm text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none rounded-xl sm:rounded-full min-w-0"
                  />
                  <button
                    type="submit"
                    className="w-full sm:w-auto shrink-0 bg-[#0B0B0B] text-white text-xs font-semibold px-6 py-3 rounded-xl sm:rounded-full hover:bg-neutral-800 transition-colors whitespace-nowrap"
                  >
                    {quickSent ? 'Opening Studio...' : 'Create Your Event Now'}
                  </button>
                </form>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-1 text-[#71717A] text-[11px] font-medium">
                  <span>Free forever tier available</span>
                  <span aria-hidden="true">·</span>
                  <span>No credit card required</span>
                  <span aria-hidden="true">·</span>
                  <span>Live in 2 minutes</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
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
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Ghana NCA Telecom Verified
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                  Resend Authenticated Infrastructure
                </span>
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
              <button
                type="button"
                onClick={() => scrollToSection('live-preview')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Live Preview
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Access &amp; Studio
              </span>
              <button
                type="button"
                onClick={() => onNavigateSignIn()}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onNavigateSignUp()}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={goAuthOrStudio}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Organiser Studio
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
            <p>© 2026 Events By You Inc. Built for weddings, funerals, church, musical, corporate &amp; tech gatherings.</p>
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <Link
                to="/terms"
                onClick={(e) => {
                  if (onOpenLegal) {
                    e.preventDefault();
                    onOpenLegal('terms');
                  }
                }}
                className="hover:text-[#0B0B0B] transition-colors"
              >
                Terms &amp; Conditions
              </Link>
              <Link
                to="/privacy"
                onClick={(e) => {
                  if (onOpenLegal) {
                    e.preventDefault();
                    onOpenLegal('privacy');
                  }
                }}
                className="hover:text-[#0B0B0B] transition-colors"
              >
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
