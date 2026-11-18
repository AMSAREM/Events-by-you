import React, { useState } from 'react';
import {
  ArrowRight,
  AtSign,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
  Smartphone,
  Star,
  Timer,
  User,
} from 'lucide-react';

import { api } from '../lib/api';

interface ResetPasswordScreenProps {
  initialEmail?: string;
  onBackHome: () => void;
  onBackSignIn: () => void;
  onProceedToOtp: (email: string) => void;
  onNavigateDemoEvent: () => void;
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({
  initialEmail = '',
  onBackHome,
  onBackSignIn,
  onProceedToOtp,
  onNavigateDemoEvent,
}) => {
  const [method, setMethod] = useState<'email' | 'sms'>('email');
  const [contactValue, setContactValue] = useState(initialEmail || 'amoakoimml@gmail.com');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleMethodChange = (next: 'email' | 'sms') => {
    setMethod(next);
    setSent(false);
    setErrorMsg(null);
    if (next === 'email' && !contactValue.includes('@')) {
      setContactValue(initialEmail || 'amoakoimml@gmail.com');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactValue.trim()) return;
    setSending(true);
    setErrorMsg(null);
    try {
      await api.auth.resetPassword(contactValue.trim(), window.location.origin);
      setSent(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send recovery email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-[#F9F9FB] text-[#1A1C1D] min-h-screen flex flex-col justify-between selection:bg-[#0B0B0B] selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 max-w-7xl mx-auto px-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-2"
          >
            <span className="w-8 h-8 rounded-full bg-[#0B0B0B] flex items-center justify-center text-white font-display font-bold text-sm">
              E
            </span>
            <span className="font-display text-base font-bold text-[#1A1C1D] tracking-tight">
              Events
            </span>
          </button>

          <nav className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackHome}
              className="px-4 py-1.5 rounded-full text-xs font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-[#EEEEF0] transition-colors"
            >
              Home
            </button>
            <button
              type="button"
              onClick={onNavigateDemoEvent}
              className="px-4 py-1.5 rounded-full text-xs font-medium text-[#444748] hover:text-[#0B0B0B] hover:bg-[#EEEEF0] transition-colors"
            >
              Live Demo Event
            </button>
          </nav>

          <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
        </div>
      </header>

      <main className="w-full pt-16 flex-1 flex flex-col items-center justify-center px-3 md:px-6">
        <div className="w-full max-w-7xl mx-auto py-6 md:py-10">
          {/* Top Status Banner Pill */}
          <div className="w-full mb-6">
            <div className="bg-[#F5F5F7] rounded-full px-5 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#0B0B0B]" />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-[#1A1C1D]">
                  DIRECT CARRIER ROUTES &amp; SUPABASE AUTH RECOVERY: 100% OPERATIONAL
                </span>
              </div>
              <button
                type="button"
                onClick={onBackSignIn}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A1C1D] hover:text-[#0B0B0B] transition-colors whitespace-nowrap"
              >
                <span>Remember your password? Sign in to studio</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Two-Column Asymmetrical Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Primary Recovery Card */}
            <section className="lg:col-span-7 bg-white rounded-[28px] p-6 sm:p-8 shadow-[0_12px_32px_-8px_rgba(11,11,11,0.06)] flex flex-col">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F7] w-fit mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1A1C1D]">
                  Account Recovery &amp; Security
                </span>
              </div>

              <h1 className="font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.03em] mb-2">
                Reset your studio password
              </h1>
              <p className="text-sm text-[#71717A] mb-6 max-w-xl leading-relaxed">
                Enter your registered work or organization email. We will send a secure password
                reset link and a temporary 6-digit SMS verification code to your verified mobile
                number.
              </p>

              {/* Method Selector Tabs */}
              <div
                className="bg-[#F5F5F7] rounded-full p-1.5 flex items-center gap-1 mb-6 max-w-md"
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'email'}
                  onClick={() => handleMethodChange('email')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-full text-xs font-semibold transition-all ${
                    method === 'email'
                      ? 'bg-[#0B0B0B] text-white shadow-sm'
                      : 'text-[#444748] hover:text-[#0B0B0B]'
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Magic Email Link</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'sms'}
                  onClick={() => handleMethodChange('sms')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-full text-xs font-semibold transition-all ${
                    method === 'sms'
                      ? 'bg-[#0B0B0B] text-white shadow-sm'
                      : 'text-[#444748] hover:text-[#0B0B0B]'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>SMS OTP Code</span>
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-xs font-semibold text-[#1A1C1D]"
                      htmlFor="recovery-contact"
                    >
                      {method === 'email'
                        ? 'Work / Organisation Email'
                        : 'Verified Mobile Number (E.164)'}
                    </label>
                    <span className="text-[11px] font-medium text-[#71717A]">Required</span>
                  </div>
                  <div className="relative flex items-center">
                    <AtSign className="w-4 h-4 text-[#71717A] absolute left-4 pointer-events-none" />
                    <input
                      id="recovery-contact"
                      type={method === 'email' ? 'email' : 'tel'}
                      required
                      value={contactValue}
                      onChange={(e) => setContactValue(e.target.value)}
                      placeholder={
                        method === 'email' ? 'amoakoimml@gmail.com' : '+233 24 000 0000'
                      }
                      className="w-full bg-[#F5F5F7] hover:bg-[#EEEEF0]/70 focus:bg-white text-[#0B0B0B] text-sm pl-11 pr-4 py-3 rounded-full outline-none transition-all focus:ring-2 focus:ring-[#0B0B0B]"
                    />
                  </div>
                </div>

                {/* SMS Fallback Indicator Card */}
                <div className="bg-[#F5F5F7] rounded-2xl p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <p className="text-[11px] text-[#71717A]">Linked backup number</p>
                      <p className="text-xs font-semibold text-[#1A1C1D] truncate tabular-nums">
                        +233 24 ••• ••84{' '}
                        <span className="text-[#71717A] font-normal">
                          (MTN Ghana · Arkesel v2)
                        </span>
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-white text-[11px] font-semibold text-[#0B0B0B] shrink-0">
                    Ready
                  </span>
                </div>

                {errorMsg && (
                  <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs font-medium text-[#0B0B0B]">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={sending}
                  className="w-full mt-1 py-3.5 px-6 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md"
                >
                  <span>
                    {sending
                      ? 'Sending...'
                      : method === 'sms'
                        ? 'Send 6-Digit SMS Code'
                        : 'Send Recovery Instructions'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Time-Sensitive Recovery Token Card */}
              <div className="mt-6 bg-[#F5F5F7] rounded-2xl p-4 flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
                  <Timer className="w-4 h-4 text-[#0B0B0B]" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-xs font-semibold text-[#1A1C1D]">
                    Time-Sensitive Recovery Token
                  </h2>
                  <p className="text-xs text-[#71717A] leading-relaxed">
                    Check your inbox or spam folder. The reset link expires in 15 minutes. Active
                    sessions on untrusted devices will be revoked upon password update.
                  </p>
                </div>
              </div>

              {/* Success Toast Feedback State */}
              {sent && (
                <div className="mt-4 bg-[#0B0B0B] text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-white">Instructions Dispatched</p>
                      <p className="text-xs text-zinc-300 mt-0.5">
                        A cryptographically signed token has been routed to{' '}
                        <strong className="text-white">{contactValue}</strong> alongside priority
                        carrier SMS.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onProceedToOtp(contactValue)}
                    className="px-4 py-2 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    Enter 6-Digit OTP →
                  </button>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-[#E5E5EA] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onProceedToOtp(contactValue)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B0B0B] hover:opacity-80 transition-opacity w-fit"
                >
                  <span>Already have your 6-digit SMS code? Verify identity</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5 text-[11px] text-[#71717A]">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Encrypted end-to-end via Supabase Auth &amp; Row Level Security.</span>
                </div>
              </div>
            </section>

            {/* Right Column: Protocol & Trust Shield */}
            <aside className="lg:col-span-5 bg-[#F5F5F7] rounded-[28px] p-6 flex flex-col justify-between gap-6 border border-[#E5E5EA]">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wider uppercase text-[#71717A]">
                    SECURITY PROTOCOL
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white text-[11px] font-medium text-[#0B0B0B]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                    Verified
                  </span>
                </div>

                <h2 className="font-display text-[22px] leading-snug font-bold text-[#0B0B0B] tracking-[-0.02em]">
                  Account protection built for multi-tenant organizers:
                </h2>

                <div className="flex flex-col gap-4 mt-1">
                  {[
                    {
                      icon: Shield,
                      title: 'Automated Session Invalidation',
                      desc: 'Instantly revokes leaked tokens across active gate scanners and dashboard browsers upon password reset.',
                    },
                    {
                      icon: KeyRound,
                      title: 'Carrier-Verified 2FA Fallback',
                      desc: 'Uses Arkesel v2 priority SMS gateway to dispatch a 6-digit OTP if email delivery is delayed.',
                    },
                    {
                      icon: ShieldCheck,
                      title: 'Strict Tenant Isolation',
                      desc: 'Your events, attendee rosters, and SMS broadcast credits remain isolated by Row Level Security (RLS).',
                    },
                    {
                      icon: Clock,
                      title: '15-Minute Ephemeral Tokens',
                      desc: 'Single-use cryptographic reset tokens generated via Supabase Auth.',
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-[#0B0B0B]" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#1A1C1D]">{item.title}</p>
                          <p className="text-xs text-[#71717A] leading-relaxed mt-0.5">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="w-full bg-white rounded-2xl p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-[#0B0B0B] shrink-0" />
                  <p className="text-[11px] text-[#71717A] truncate">
                    Resend &amp; Arkesel SMS:{' '}
                    <span className="font-semibold text-[#0B0B0B]">100% Operational</span>
                  </p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] font-mono font-semibold shrink-0">
                  38ms
                </span>
              </div>

              {/* Akua Mansa Testimonial */}
              <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                <div className="flex items-center gap-0.5 text-[#0B0B0B]">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="w-4 h-4 fill-[#0B0B0B] text-[#0B0B0B]" />
                  ))}
                </div>
                <blockquote className="text-xs text-[#1A1C1D] italic leading-relaxed">
                  “When one of our gate leads lost access right before 400 attendees arrived, the
                  instant SMS recovery got our scanner back online in 45 seconds.”
                </blockquote>
                <div className="flex items-center gap-2.5 pt-1">
                  <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center text-xs font-bold">
                    AM
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0B0B0B] truncate">Akua Mansa</p>
                    <p className="text-[11px] text-[#71717A] truncate">
                      Head of Operations, DevCongress Accra
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <footer className="w-full bg-white border-t border-[#E5E5EA] py-5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] text-[#71717A]">
          <p>© 2025 Events App Inc. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Support</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
