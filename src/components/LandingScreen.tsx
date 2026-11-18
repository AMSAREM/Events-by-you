import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { EVENT_CATEGORIES } from '../data/initialData';

interface LandingScreenProps {
  featuredEvent: EventItem;
  allEvents?: EventItem[];
  recentAttendees: Attendee[];
  isSignedIn: boolean;
  onNavigateSignIn: (prefillEmail?: string) => void;
  onNavigateSignUp: (prefillEmail?: string) => void;
  onNavigateDemoEvent: (eventId?: string) => void;
  onNavigateStudio: () => void;
  onOpenQrScanner?: (eventId?: string) => void;
  onUpgradePro?: () => void;
  onQuickStartEmail: (email: string) => void;
}

const SHOWCASE_CARDS = [
  {
    city: 'Accra · 250 Guests',
    title: 'Mensah & Boateng Royal Wedding',
    desc: 'Sent 250 personalized family table & gate QR passes via MTN Ghana SMS with zero uninvited gate congestion.',
    metaLeft: 'Wedding & Reception · 100% SMS',
    metaRight: 'Nov 2025',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBqdQMrDffGOyHEwpnKTm-3CbnTfnwQ_1ITZ74OxiMLqu8JwWar2YqO4QncyEjv5ZyPsNPqDHZ_dX-w8eVj1MJsZp84O8t7CUChBDWIuLvJ0s4WcybODsEi5dYZxOOmQ1U8sqqzk5K44ARXT7iJ7c-WDhED5izHuSkK3rZgmpbaHmZ-9wvLoDbmOFHDB74SgnKWxjZJxmpUgN7-SfM61Gg7uoOLPpMOuj2tWFeV39I',
    alt: 'A formal wedding and corporate celebration auditorium in Accra Ghana.',
  },
  {
    city: 'Accra · 1,200 Members',
    title: 'Grace Revival Night & Choir Convention',
    desc: 'Offline-first church gate check-in scanned 1,100+ congregation passes smoothly even during sanctuary bandwidth dips.',
    metaLeft: 'Church & Memorial · Offline PWA',
    metaRight: 'Jan 2026',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAuUW0cp_miKU3K9RaPob6LVYjfeEMZ7jl6RGfZICcCIcRGAG3EGfeE8QBrn3EQKKy6YCdIoSp_V-pBojAtVXCWDfKHuBcZCZBKdpPVDeOjRRdei5uncIeq4z-_ztXiB370d_Z2Kt_eHrSECOwc3y68KLjd7fv5kL9o4UIkABEIgKk33erh20uCBbs9UeRx_suFVEvm_2VV7n6Yx72zGHHB4sQYMVyLtMF7-SViuAc',
    alt: 'A large church convention and musical stage hall.',
  },
  {
    city: 'Lagos · 680 Tickets',
    title: 'Acoustic Live & Corporate Tech Gala',
    desc: 'Handled VIP concert tables, executive corporate badges, and post-event thank-you SMS blasts in a single workspace.',
    metaLeft: 'Musical · Corporate · Tech',
    metaRight: 'Feb 2026',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDKaMIegmFvTXWyiQBkM5sHw0txMLUSGU5xQHo4EFrekKXUUrVsAg7EFUlwoTq17diFtM6Ye6hbK2tcvDNgrvnnVqVPoM7vGLbfC5NYdmetke6gXtvGnvWVIvKt-CSUM8PkHElalrcBnC5y0fMttGmMppswQ8E2oD4v_I5XyMR02m-d8rvbp0cC3C79DdkLxHD-E0Kz-WnTNSBU7WbiP35G78U9HQBD4RuBYS5GJ04',
    alt: 'A stylish monochrome musical and corporate event showcase gallery.',
  },
];

const HERO_BACKDROP_IMG =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA2B37ASDLzQJlTEgxHjO5HiKbfdUBIQ5QUuvv6wzTLOe1EUrMjwlof1Sm6J9tf96MOXiGJo_fEcySLmoUMa-2BZVEv0S4Rho53cHQBMESnSfw-d1Rk6w73AQnrI19P7QhX27KkxVnI8H8fOaTE-xOCkZVJqrlOZz66QL_jcBEhbyqtGxB8IFRoFtdbuOUjfxznKUXZosWukNQnqlOkBDdPh1VZSXIbyHCGznja8tw';

export const LandingScreen: React.FC<LandingScreenProps> = ({
  featuredEvent,
  allEvents = [featuredEvent],
  recentAttendees,
  isSignedIn,
  onNavigateSignIn,
  onNavigateSignUp,
  onNavigateDemoEvent,
  onNavigateStudio,
  onOpenQrScanner,
  onUpgradePro,
  onQuickStartEmail,
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
        evt.date.toLowerCase().includes(q);
      return catOk && cityOk && queryOk;
    });
  }, [allEvents, finderCategory, finderCity, finderQuery]);

  const topMatchedEvent = matchingEvents[0] ?? featuredEvent;

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
    setTimeout(() => {
      onQuickStartEmail(quickEmail.trim());
    }, 350);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const primaryAttendees = recentAttendees
    .filter((a) => a.eventId === featuredEvent.id)
    .slice(0, 2);

  const occupancyPct = Math.round(
    (featuredEvent.registered / Math.max(1, featuredEvent.capacity)) * 100
  );

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1A1C1D] antialiased flex flex-col">
      {/* FIXED TOP HEADER */}
      <header className="fixed top-0 w-full z-50 bg-[#F5F5F7]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-2.5 md:py-0 md:h-20 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-3 sm:gap-x-4 lg:gap-x-6 gap-y-2">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2 sm:gap-2.5 text-left shrink-0"
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-sm sm:text-base font-bold text-[#1A1C1D] tracking-tight leading-none whitespace-nowrap">
                Events App
              </span>
              <span className="hidden sm:block md:hidden lg:block text-[11px] font-medium text-[#71717A] whitespace-nowrap mt-0.5">
                Weddings · Church · Corporate · Tech
              </span>
            </div>
          </button>

          <nav
            aria-label="Primary navigation"
            className="order-3 md:order-2 w-full md:w-auto min-w-0 flex items-center md:justify-center gap-4 lg:gap-7 overflow-x-auto border-t border-[#E5E5EA]/70 md:border-t-0 pt-2 md:pt-0 text-xs lg:text-sm"
          >
            <button
              type="button"
              onClick={() => scrollToSection('live-preview')}
              className="text-[#0B0B0B] font-semibold whitespace-nowrap shrink-0"
            >
              Product
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('how-it-works')}
              className="text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('features')}
              className="text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('pricing')}
              className="text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
            >
              Pricing
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('community-showcase')}
              className="text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap shrink-0"
            >
              Case Studies
            </button>
            <button
              type="button"
              onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignIn())}
              className="sm:hidden text-[#0B0B0B] font-semibold whitespace-nowrap shrink-0 ml-auto"
            >
              {isSignedIn ? 'Open Studio' : 'Sign In'}
            </button>
          </nav>

          <div className="order-2 md:order-3 flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignIn())}
              className="hidden sm:inline-flex text-xs lg:text-sm font-medium text-[#444748] hover:text-[#0B0B0B] transition-colors px-2 lg:px-3 py-1.5 whitespace-nowrap shrink-0"
            >
              {isSignedIn ? 'Open Studio' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignUp())}
              className="inline-flex items-center justify-center bg-[#0B0B0B] text-white text-xs font-semibold px-3.5 sm:px-4 lg:px-5 py-2 sm:py-2.5 rounded-full hover:bg-neutral-800 transition-colors shadow-[0_12px_32px_-8px_rgba(11,11,11,0.16)] whitespace-nowrap shrink-0"
            >
              <span className="lg:hidden">{isSignedIn ? 'Studio' : 'Get Started'}</span>
              <span className="hidden lg:inline">
                {isSignedIn ? 'Open Studio' : 'Create Event / Get Started Free'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="w-full pt-[96px] sm:pt-[100px] md:pt-20 flex-1">
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

            <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-12 pt-14 md:pt-20 pb-20">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
                {/* Left 7 Columns: Headline, Check-In & QR Scanner CTAs, Categories & Partners */}
                <div className="lg:col-span-7 flex flex-col justify-between">
                  <p className="text-xs font-semibold text-zinc-300 tracking-wide mb-5">
                    Africa&apos;s Event Gateway · Arkesel &amp; Resend Powered
                  </p>

                  <h1 className="font-display text-[36px] leading-[44px] md:text-[54px] md:leading-[62px] text-white tracking-[-0.03em] font-bold text-balance">
                    Events App Where Every Event Begins
                  </h1>

                  <p className="mt-5 text-sm md:text-[17px] md:leading-[26px] text-white/80 max-w-xl">
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
                          className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap shrink-0 ${
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
                  <div className="mt-8 flex flex-wrap items-center gap-3.5">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenQrScanner ? onOpenQrScanner(topMatchedEvent.id) : onNavigateStudio()
                      }
                      className="inline-flex items-center gap-2 bg-white text-[#0B0B0B] text-xs font-bold px-6 py-3.5 rounded-full shadow-lg hover:bg-neutral-200 transition-all hover:-translate-y-0.5 whitespace-nowrap shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Open QR Code Scanner</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateDemoEvent(topMatchedEvent.id)}
                      className="inline-flex items-center gap-2 bg-white/15 text-white hover:bg-white/25 text-xs font-semibold px-6 py-3.5 rounded-full border border-white/20 backdrop-blur-md transition-all whitespace-nowrap shrink-0"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Check-In Registration</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignUp())}
                      className="inline-flex items-center gap-2 bg-transparent text-white/85 hover:text-white text-xs font-semibold px-4 py-3.5 rounded-full transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Create Your Event</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Right 5 Columns: Find or Host Events Interactive Card */}
                <div className="lg:col-span-5">
                  <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-2xl text-[#0B0B0B] border border-white/60">
                    <div className="flex items-center justify-between pb-4 border-b border-[#E5E5EA]">
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
                        onNavigateDemoEvent(topMatchedEvent.id);
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
                      {topMatchedEvent && (
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
                              {topMatchedEvent.date}
                            </p>
                          </div>
                          {onOpenQrScanner && (
                            <button
                              type="button"
                              onClick={() => onOpenQrScanner(topMatchedEvent.id)}
                              title="Open QR Gate Scanner for this event"
                              className="px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              QR Scan
                            </button>
                          )}
                        </div>
                      )}

                      <div className="pt-1">
                        <button
                          type="submit"
                          className="w-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                        >
                          <span>Find Event &amp; Register</span>
                          <Search className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="pt-2 text-center border-t border-[#E5E5EA]">
                        <button
                          type="button"
                          onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignUp())}
                          className="text-xs text-[#71717A] hover:text-[#0B0B0B] transition-colors inline-flex items-center gap-1"
                        >
                          <span className="text-[#0B0B0B] font-semibold">Organizing an event?</span>
                          <span>Create in 2 minutes</span>
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
          <section className="relative max-w-7xl mx-auto px-6 lg:px-12 pt-14 pb-20">
            {/* PROMINENT CHECK-IN REGISTRATION & QR CODE SCANNER COMMAND SPOTLIGHT */}
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
              <div className="bg-[#0B0B0B] text-white rounded-[28px] p-6 sm:p-7 flex flex-col justify-between gap-5 shadow-xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-white/10 px-3 py-1 rounded-full">
                    0.3s Camera Verify
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    Live QR Code Gate Scanner
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-300 mt-1.5 leading-relaxed">
                    Launch the camera QR scanner or enter any guest pass code at the door. Blocks
                    duplicate scans automatically and syncs gate turnout in real time.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onOpenQrScanner ? onOpenQrScanner(topMatchedEvent.id) : onNavigateStudio()
                    }
                    className="px-5 py-2.5 rounded-full bg-white text-[#0B0B0B] text-xs font-bold hover:bg-zinc-200 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Launch QR Scanner Now</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-white text-[#0B0B0B] rounded-[28px] p-6 sm:p-7 border border-[#E5E5EA] flex flex-col justify-between gap-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center shrink-0">
                    <UserPlus className="w-6 h-6" />
                  </div>
                  <span className="text-[11px] font-mono text-[#0B0B0B] bg-[#F5F5F7] px-3 py-1 rounded-full">
                    Walk-In &amp; RSVP Passes
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                    Instant Check-In Registration
                  </h2>
                  <p className="text-xs sm:text-sm text-[#71717A] mt-1.5 leading-relaxed">
                    Collect guest details in seconds for weddings, church services, funerals,
                    concerts, or summits—delivering a scannable QR gate pass via Arkesel SMS.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigateDemoEvent(topMatchedEvent.id)}
                    className="px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-bold hover:bg-neutral-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Open Registration Form</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenQrScanner ? onOpenQrScanner(topMatchedEvent.id) : onNavigateStudio()
                    }
                    className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    Walk-In Gate Desk
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive 3-Step Hero Product Walkthrough Slider */}
            <div className="mt-14 relative max-w-6xl mx-auto" id="live-preview">
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
                className="bg-[#EEEEF0] p-4 sm:p-8 rounded-[28px] shadow-sm border border-[#E5E5EA]/70"
              >
                {/* SLIDE 1: Create & Publish */}
                {activeSlide === 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-6 shadow-sm flex flex-col justify-between">
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
                              {featuredEvent.title}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <span className="block text-[11px] uppercase tracking-wider text-[#71717A] mb-1">
                                Auto Generated URL
                              </span>
                              <div className="p-2.5 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] font-mono text-xs text-[#0B0B0B] flex items-center justify-between gap-2">
                                <span className="truncate">events.africa/e/{featuredEvent.slug}</span>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              </div>
                            </div>
                            <div>
                              <span className="block text-[11px] uppercase tracking-wider text-[#71717A] mb-1">
                                Venue &amp; Capacity
                              </span>
                              <div className="p-2.5 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] text-xs text-[#0B0B0B] flex items-center justify-between gap-2">
                                <span className="truncate tabular-nums">
                                  {featuredEvent.city} · {featuredEvent.capacity} max
                                </span>
                                <MapPin className="w-4 h-4 text-[#71717A] shrink-0" />
                              </div>
                            </div>
                          </div>

                          <div className="p-3 bg-[#F5F5F7] rounded-xl border border-dashed border-[#C4C7C7] flex items-center justify-between gap-3">
                            <div>
                              <span className="text-xs font-semibold text-[#0B0B0B] block">
                                Hero Flyer Optimized (1920 × 1080 WebP)
                              </span>
                              <span className="text-[11px] text-[#71717A]">
                                {featuredEvent.venue} · Ready for instant edge deploy
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={onNavigateStudio}
                              className="px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] shrink-0 transition-colors"
                            >
                              Open Wizard
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 text-[#0B0B0B]">
                          <Bolt className="w-4 h-4 text-emerald-600 shrink-0" />
                          Instant CDN deployment across Accra, Lagos, Nairobi &amp; Kigali in 0.8s.
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded font-mono text-[#0B0B0B] shrink-0">
                          Global Edge
                        </span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono">
                            Public Preview · /e/{featuredEvent.slug}
                          </span>
                          <span className="text-[11px] text-emerald-400 bg-white/10 px-2.5 py-0.5 rounded-full font-medium">
                            Published ({occupancyPct}%)
                          </span>
                        </div>
                        <div className="mt-4">
                          <span className="text-[11px] text-zinc-400 tabular-nums">
                            {featuredEvent.date} · In-Person
                          </span>
                          <h3 className="text-xl font-bold text-white mt-1">{featuredEvent.title}</h3>
                          <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">
                            {featuredEvent.subtitle}
                          </p>
                        </div>

                        <div className="mt-6 bg-white/10 p-4 rounded-2xl border border-white/10 space-y-2.5">
                          <div className="flex items-center justify-between text-[11px] text-white/80">
                            <span>Fast Attendee Registration</span>
                            <span className="text-emerald-400 font-mono">Free RSVP</span>
                          </div>
                          <div className="space-y-2 font-mono text-xs">
                            <div className="p-2.5 bg-[#0B0B0B]/60 rounded-xl border border-white/10 text-white/90 flex items-center justify-between">
                              <span>{primaryAttendees[0]?.name ?? 'Kofi Asante'}</span>
                              <span className="text-white/40 text-[10px]">Name</span>
                            </div>
                            <div className="p-2.5 bg-[#0B0B0B]/60 rounded-xl border border-white/10 text-emerald-400 flex items-center justify-between">
                              <span className="tabular-nums">
                                {primaryAttendees[0]?.phone ?? '+233 24 559 8104'}
                              </span>
                              <span className="text-emerald-400/70 text-[10px]">Normalized</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onNavigateDemoEvent(featuredEvent.id)}
                            className="w-full py-2.5 bg-white text-[#0B0B0B] text-xs font-bold rounded-full hover:bg-neutral-200 transition-colors"
                          >
                            Reserve Ticket (Instant SMS)
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                        <span>60-second attendee checkout</span>
                        <span className="text-white font-mono">No passwords required</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SLIDE 2: Instant SMS & Email Delivery Engine */}
                {activeSlide === 1 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-6 shadow-sm flex flex-col justify-between">
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
                            {featuredEvent.smsDispatched} / {featuredEvent.registered} Delivered (99.4%)
                          </span>
                        </div>

                        <div className="mt-5 space-y-3.5">
                          <div className="p-3.5 bg-[#F5F5F7] rounded-2xl border border-[#E5E5EA]">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px] text-[#71717A]">
                              <span>
                                Sender ID: <strong className="text-[#0B0B0B]">TECHGHANA</strong>
                              </span>
                              <span className="font-mono text-emerald-700 font-semibold tabular-nums">
                                GSM-7: 114 / 160 Chars (1 Credit)
                              </span>
                            </div>
                            <p className="font-mono text-xs text-[#0B0B0B] leading-relaxed bg-white p-3 rounded-xl border border-[#E5E5EA]">
                              Hi {primaryAttendees[0]?.name.split(' ')[0] ?? 'Kofi'}, your pass for{' '}
                              {featuredEvent.title} is confirmed. Show QR token{' '}
                              <span className="text-emerald-700 font-bold">
                                {primaryAttendees[0]?.ticketCode ?? 'ACS-25-8891-VIP'}
                              </span>{' '}
                              at {featuredEvent.venue}.
                            </p>
                          </div>

                          <div className="grid grid-cols-3 gap-2.5 text-center">
                            <div className="p-3 bg-[#F5F5F7] rounded-xl">
                              <span className="text-[11px] text-[#71717A] block">MTN Direct SS7</span>
                              <span className="text-xs font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                                1.8s Latency
                              </span>
                              <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                100% Success
                              </span>
                            </div>
                            <div className="p-3 bg-[#F5F5F7] rounded-xl">
                              <span className="text-[11px] text-[#71717A] block">Telecel SMPP</span>
                              <span className="text-xs font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                                2.2s Latency
                              </span>
                              <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                99.8% Success
                              </span>
                            </div>
                            <div className="p-3 bg-[#F5F5F7] rounded-xl">
                              <span className="text-[11px] text-[#71717A] block">AT Gateway</span>
                              <span className="text-xs font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                                2.5s Latency
                              </span>
                              <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                                99.2% Success
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-2 text-[#0B0B0B]">
                          <Mail className="w-4 h-4 shrink-0" />
                          Simultaneous transactional email sent via Resend V2 API (1.1s latency).
                        </span>
                        <span className="text-emerald-700 font-bold shrink-0">Dual-Route</span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
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
                              TECHGHANA
                            </span>
                            <span className="text-[11px] font-mono text-[#71717A]">Just now</span>
                          </div>
                          <p className="text-xs text-[#1A1C1D] leading-relaxed">
                            Hi {primaryAttendees[0]?.name.split(' ')[0] ?? 'Kofi'}, your pass for{' '}
                            {featuredEvent.title} is confirmed. Show your QR token at check-in:{' '}
                            <strong className="font-mono bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                              {primaryAttendees[0]?.ticketCode ?? 'ACS-25-8891-VIP'}
                            </strong>
                            .
                          </p>
                          <div className="mt-3 p-2 bg-[#F5F5F7] rounded-xl flex items-center justify-between text-[11px] font-mono">
                            <span className="text-[#71717A]">Pass Link:</span>
                            <button
                              type="button"
                              onClick={() => onNavigateDemoEvent(featuredEvent.id)}
                              className="text-emerald-700 font-bold underline"
                            >
                              events.africa/t/8891
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          No Internet Needed by Attendee
                        </span>
                        <span className="text-white font-semibold">Works on Feature Phones</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SLIDE 3: Sub-Second Gate Check-In & PWA Turnstile */}
                {activeSlide === 2 && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    <div className="lg:col-span-7 bg-white rounded-2xl p-6 shadow-sm flex flex-col justify-between">
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
                            Gate 1 Active
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3 my-4">
                          <div className="p-3 bg-[#F5F5F7] rounded-xl">
                            <span className="text-[11px] text-[#71717A] block">Admitted</span>
                            <span className="font-display text-2xl sm:text-[28px] font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                              {featuredEvent.checkedIn}/{featuredEvent.registered}
                            </span>
                            <span className="text-[11px] text-emerald-600 font-semibold tabular-nums">
                              {Math.round(
                                (featuredEvent.checkedIn / Math.max(1, featuredEvent.registered)) * 100
                              )}
                              % Turnout
                            </span>
                          </div>
                          <div className="p-3 bg-[#F5F5F7] rounded-xl">
                            <span className="text-[11px] text-[#71717A] block">Scan Velocity</span>
                            <span className="font-display text-2xl sm:text-[28px] font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                              0.3s
                            </span>
                            <span className="text-[11px] text-[#71717A]">Sub-second camera</span>
                          </div>
                          <div className="p-3 bg-[#F5F5F7] rounded-xl">
                            <span className="text-[11px] text-[#71717A] block">Duplicates</span>
                            <span className="font-display text-2xl sm:text-[28px] font-bold text-[#0B0B0B] mt-0.5 block tabular-nums">
                              0
                            </span>
                            <span className="text-[11px] text-emerald-600 font-semibold">
                              Zero Passback
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {primaryAttendees.map((att, idx) => (
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

                      <div className="mt-5 p-3 bg-[#F5F5F7] rounded-xl flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-2 text-[#0B0B0B]">
                          <WifiOff className="w-4 h-4 text-emerald-600 shrink-0" />
                          IndexedDB offline cache holds 100% attendee manifest if venue WiFi drops.
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded font-mono text-[#0B0B0B] shrink-0">
                          Offline Ready
                        </span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 bg-[#0B0B0B] text-white rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden">
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
                            <svg
                              className="w-28 h-28 text-[#0B0B0B] fill-current"
                              viewBox="0 0 100 100"
                              aria-hidden="true"
                            >
                              <path d="M0,0 h30 v30 h-30 z M5,5 v20 h20 v-20 z M10,10 h10 v10 h-10 z" />
                              <path d="M70,0 h30 v30 h-30 z M75,5 v20 h20 v-20 z M80,10 h10 v10 h-10 z" />
                              <path d="M0,70 h30 v30 h-30 z M5,75 v20 h20 v-20 z M10,80 h10 v10 h-10 z" />
                              <rect height="10" width="20" x="40" y="5" />
                              <rect height="15" width="10" x="40" y="25" />
                              <rect height="20" width="5" x="60" y="20" />
                              <rect height="10" width="15" x="5" y="40" />
                              <rect height="10" width="15" x="25" y="45" />
                              <rect height="10" width="25" x="50" y="45" />
                              <rect height="15" width="15" x="80" y="40" />
                              <rect height="15" width="15" x="40" y="65" />
                              <rect height="15" width="10" x="65" y="65" />
                              <rect height="25" width="15" x="80" y="70" />
                              <rect height="10" width="25" x="45" y="85" />
                            </svg>
                            <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg absolute">
                              <Check className="w-5 h-5" />
                            </div>
                          </div>
                          <span className="mt-3 font-mono text-[13px] font-bold tracking-widest text-[#0B0B0B]">
                            {primaryAttendees[0]?.ticketCode ?? 'ACS-25-8891-VIP'}
                          </span>
                          <span className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                            Access Granted: All Keynotes &amp; Lounge
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Smartphone className="w-4 h-4 text-white" />
                          Synced to Cloud DB
                        </span>
                        <button
                          type="button"
                          onClick={onNavigateStudio}
                          className="text-white font-semibold hover:underline"
                        >
                          Launch Gate Scanner →
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slider Interactive Bottom Progress Bar */}
                <div className="mt-6 pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <span className="font-mono text-[#0B0B0B] font-semibold tabular-nums">
                      0{activeSlide + 1} / 03
                    </span>
                    <div className="flex-1 sm:w-48 h-1.5 bg-white rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0B0B0B] transition-all duration-300"
                        style={{ width: `${((activeSlide + 1) / 3) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setActiveSlide(0)}
                      className={`transition-colors ${
                        activeSlide === 0 ? 'text-[#0B0B0B] font-semibold' : 'hover:text-[#0B0B0B]'
                      }`}
                    >
                      1. Studio
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveSlide(1)}
                      className={`transition-colors ${
                        activeSlide === 1 ? 'text-[#0B0B0B] font-semibold' : 'hover:text-[#0B0B0B]'
                      }`}
                    >
                      2. SMS Engine
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveSlide(2)}
                      className={`transition-colors ${
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
        <section id="how-it-works" className="w-full bg-[#F3F3F5] py-20">
          <div className="max-w-7xl mx-auto px-6 lg:px-12">
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Operational Architecture
              </span>
              <h2 className="mt-2 font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em] text-balance">
                Three steps to packed rooms and zero gate delays.
              </h2>
              <p className="mt-3 text-sm text-[#71717A]">
                Designed specifically to bridge high-traffic web landing pages with African mobile
                carrier reliability.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Step 1 */}
              <div className="bg-white p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150">
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
              <div className="bg-white p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150">
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
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl">
                    <span className="font-mono text-[11px] text-[#71717A] line-through">
                      024 412 3456
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="font-mono text-[11px] text-emerald-700 font-bold">
                      +233244123456
                    </span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-white p-8 rounded-2xl shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all duration-150">
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
                  <div className="flex items-center justify-between text-[#0B0B0B] text-xs font-semibold tabular-nums">
                    <span>Arkesel SMS: 2.8s</span>
                    <span className="text-emerald-600">· Resend: 1.1s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: PLATFORM FEATURE MATRIX */}
        <section id="features" className="max-w-7xl mx-auto px-6 lg:px-12 py-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Telecom &amp; Hardware Infrastructure
              </span>
              <h2 className="mt-2 font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] max-w-xl tracking-[-0.02em]">
                Engineered for African connectivity challenges.
              </h2>
            </div>
            <p className="text-sm text-[#71717A] max-w-sm leading-relaxed">
              Built ground-up with native carrier APIs, offline fallbacks, and multi-tenant
              telemetry for conference halls with erratic WiFi.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Feature 1 */}
            <div className="bg-[#F3F3F5] p-8 rounded-2xl flex flex-col justify-between">
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
              <div className="mt-8 p-4 bg-white rounded-2xl flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0B0B0B]">Carrier Gateway Health</span>
                <span className="text-[11px] text-emerald-600 flex items-center gap-1.5 font-semibold tabular-nums">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  99.98% Latency &lt; 3.0s
                </span>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="bg-[#F3F3F5] p-8 rounded-2xl flex flex-col justify-between">
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
              <div className="mt-8 p-4 bg-white rounded-2xl flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0B0B0B]">Fraud Prevention Rate</span>
                <span className="text-[11px] text-[#0B0B0B] font-semibold tabular-nums">
                  100% Unique RSVP Verification
                </span>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="bg-[#F3F3F5] p-8 rounded-2xl flex flex-col justify-between">
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
              <div className="mt-8 p-4 bg-white rounded-2xl flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0B0B0B]">Avg Scan Velocity</span>
                <span className="text-[11px] text-[#0B0B0B] font-semibold tabular-nums">
                  45 Attendees / Min / Gate
                </span>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="bg-[#F3F3F5] p-8 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mb-6">
                  <WifiOff className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Installable PWA with Offline Local Cache
                </h3>
                <p className="mt-3 text-sm text-[#71717A] leading-relaxed">
                  Add Events App to iOS and Android home screens without app store downloads. Local
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
              <div className="mt-8 p-4 bg-white rounded-2xl flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0B0B0B]">Offline Tolerance</span>
                <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Zero Data Loss on Reconnect
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: TRANSPARENT PLANS & QUOTAS */}
        <section id="pricing" className="w-full bg-[#F3F3F5] py-24">
          <div className="max-w-6xl mx-auto px-6 lg:px-12">
            <div className="text-center max-w-2xl mx-auto">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Simple, Fair Pricing
              </span>
              <h2 className="mt-2 font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Start free. Scale when your audience expands.
              </h2>
              <p className="mt-3 text-sm text-[#71717A]">
                No hidden fees, no per-ticket commissions on free meetups.
              </p>

              {/* Interactive Monthly / Annual Switcher */}
              <div className="mt-8 inline-flex items-center p-1 bg-[#E8E8EA] rounded-full border border-[#E5E5EA]">
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

            <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
              {/* Free Starter Tier */}
              <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                      Free Starter Tier
                    </span>
                    <span className="text-[11px] font-semibold text-[#71717A]">
                      Weddings &amp; Meetups
                    </span>
                  </div>
                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="font-display text-[44px] leading-none font-bold text-[#0B0B0B] tabular-nums">
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
                    onClick={() => (isSignedIn ? onNavigateStudio() : onNavigateSignUp())}
                    className="w-full inline-flex items-center justify-center bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold py-3.5 rounded-full hover:bg-[#E2E2E4] transition-colors"
                  >
                    Get Started Free
                  </button>
                </div>
              </div>

              {/* Pro Organizer Tier */}
              <div className="bg-[#0B0B0B] text-white p-8 sm:p-10 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Pro Organizer Tier
                    </span>
                    <span className="px-3 py-1 rounded-full bg-white/10 text-white text-[11px] font-semibold">
                      Concerts, Church &amp; Corporate
                    </span>
                  </div>
                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="font-display text-[44px] leading-none font-bold text-white tabular-nums">
                      {billingCycle === 'annual' ? '$15' : '$19'}
                    </span>
                    <span className="text-sm text-white/60 tabular-nums">
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
                      'Zero Events App Watermarks on passes',
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
                      if (isSignedIn) {
                        if (onUpgradePro) onUpgradePro();
                        else onNavigateStudio();
                      } else {
                        onNavigateSignUp();
                      }
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
        <section id="community-showcase" className="max-w-7xl mx-auto px-6 lg:px-12 py-20">
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-10 gap-4">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Powered Events across the Continent
              </span>
              <h2 className="mt-1 font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em]">
                Built for memorable gatherings.
              </h2>
            </div>
            <button
              type="button"
              onClick={onNavigateStudio}
              className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1 hover:underline"
            >
              <span>Explore past event case studies</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SHOWCASE_CARDS.map((card, idx) => (
              <div
                key={card.title}
                className="bg-[#F3F3F5] rounded-2xl overflow-hidden flex flex-col shadow-sm group"
              >
                <div className="relative w-full h-52 overflow-hidden bg-[#0B0B0B]">
                  {!failedImages[idx] ? (
                    <img
                      src={card.img}
                      alt={card.alt}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImages((prev) => ({ ...prev, [idx]: true }))}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#1C1B1B] to-[#0B0B0B] flex items-center justify-center p-6 text-center">
                      <span className="font-display text-lg font-bold text-white/90">
                        {card.title}
                      </span>
                    </div>
                  )}
                  <span className="absolute top-3 right-3 px-3 py-1 rounded-full bg-[#0B0B0B]/80 backdrop-blur-md text-white text-[11px] font-medium tabular-nums">
                    {card.city}
                  </span>
                </div>

                <div className="p-6 flex flex-col justify-between flex-1">
                  <div>
                    <h4 className="text-base font-semibold text-[#0B0B0B]">{card.title}</h4>
                    <p className="mt-2 text-[13px] text-[#71717A] leading-relaxed">{card.desc}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#E5E5EA] flex items-center justify-between text-[11px] text-[#71717A]">
                    <span>{card.metaLeft}</span>
                    <span className="text-[#0B0B0B] font-semibold tabular-nums">
                      {card.metaRight}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 6: INTERACTIVE QUICK-START CTA BANNER */}
        <section className="max-w-7xl mx-auto px-6 lg:px-12 pb-24">
          <div className="bg-white rounded-[32px] p-8 sm:p-14 shadow-sm relative overflow-hidden">
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#EEEEF0] rounded-full blur-3xl pointer-events-none" />
            <div className="max-w-3xl mx-auto text-center relative z-10">
              <div className="w-12 h-12 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center mx-auto mb-6">
                <Rocket className="w-5 h-5" />
              </div>
              <h2 className="font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.02em] text-balance">
                Ready to host your wedding, church program, concert, corporate gala, or summit?
              </h2>
              <p className="mt-4 text-sm text-[#71717A] max-w-xl mx-auto leading-relaxed">
                Join planners, churches, families, and event teams creating seamless guest
                registration with guaranteed SMS passes and real-time gate check-in.
              </p>

              <div className="mt-8 max-w-md mx-auto">
                <form
                  onSubmit={handleQuickStart}
                  className="flex flex-col sm:flex-row items-center gap-2 p-1.5 bg-[#F5F5F7] rounded-full"
                >
                  <input
                    type="email"
                    required
                    value={quickEmail}
                    onChange={(e) => setQuickEmail(e.target.value)}
                    placeholder="Enter your organizer email"
                    aria-label="Enter your organizer email"
                    className="w-full bg-transparent px-5 py-3 text-sm text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none rounded-full"
                  />
                  <button
                    type="submit"
                    className="w-full sm:w-auto shrink-0 bg-[#0B0B0B] text-white text-xs font-semibold px-6 py-3 rounded-full hover:bg-neutral-800 transition-colors whitespace-nowrap"
                  >
                    {quickSent ? 'Opening Studio...' : 'Create Your Event Now'}
                  </button>
                </form>
                <div className="mt-3 flex items-center justify-center gap-4 text-[#71717A] text-[11px] font-medium">
                  <span>Free forever tier available</span>
                  <span>·</span>
                  <span>No credit card required</span>
                  <span>·</span>
                  <span>Live in 2 minutes</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="w-full bg-[#F3F3F5] border-t border-[#E5E5EA]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 pt-10 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 pb-8">
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <span className="font-display text-base font-bold text-[#1A1C1D] tracking-tight">
                  Events App
                </span>
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
              <button
                type="button"
                onClick={() => scrollToSection('live-preview')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Product Tour
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Ticketing &amp; Badging
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('pricing')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Tiered Pricing
              </button>
              <button
                type="button"
                onClick={onNavigateStudio}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Event Planner Portal
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Supported Gatherings
              </span>
              <button
                type="button"
                onClick={() => onNavigateDemoEvent(featuredEvent.id)}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Weddings &amp; Memorials
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('community-showcase')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Church &amp; Musical Live
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('community-showcase')}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Corporate &amp; Tech Summits
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#1A1C1D] uppercase tracking-wider">
                Access &amp; Support
              </span>
              <button
                type="button"
                onClick={() => onNavigateSignIn()}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Organizer Sign In
              </button>
              <button
                type="button"
                onClick={() => onNavigateDemoEvent(featuredEvent.id)}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Live Attendee Demo
              </button>
              <button
                type="button"
                onClick={onNavigateStudio}
                className="text-left text-sm text-[#444748] hover:text-[#0B0B0B]"
              >
                Creator Studio
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[#71717A]">
            <p>© 2026 Events App Inc. Built for weddings, funerals, church, musical, corporate &amp; tech gatherings.</p>
            <div className="flex items-center gap-6">
              <span>Privacy</span>
              <span>Compliance</span>
              <span>System Status</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
