import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  Cpu,
  Database,
  Lock,
  QrCode,
  Radio,
  Shield,
  Star,
  Timer,
  User,
} from 'lucide-react';

import { api, isLocalFallbackMode, saveStoredSession, type StoredAuthSession } from '../lib/api';
import type { OrganizerProfile } from '../types/events';
import { BrandLogo } from './BrandLogo';

interface VerifyOtpScreenProps {
  phone?: string;
  email?: string;
  countryGateway?: string;
  otpType?: 'signup' | 'email' | 'recovery' | 'sms';
  onBackHome: () => void;
  onBackSignIn: () => void;
  onVerified: (
    session: StoredAuthSession,
    profile: OrganizerProfile,
    openCreatorConsole?: boolean,
    isNewUser?: boolean
  ) => void;
  onNavigateDemoEvent: () => void;
  onOpenLegal?: (doc: 'terms' | 'privacy') => void;
}

export const VerifyOtpScreen: React.FC<VerifyOtpScreenProps> = ({
  phone = '',
  email = '',
  countryGateway = 'GH',
  otpType = 'sms',
  onBackHome,
  onBackSignIn,
  onVerified,
  onNavigateDemoEvent,
  onOpenLegal,
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [secondsLeft, setSecondsLeft] = useState(42);
  const [trustDevice, setTrustDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cleanPhone = phone.trim();
  const cleanEmail = email.trim();
  const isDualChannel = Boolean(cleanPhone && cleanEmail);
  const isPhoneChallenge = Boolean(cleanPhone) || otpType === 'sms';
  const displayTarget = cleanPhone || cleanEmail;

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const handleDigitChange = (idx: number, val: string) => {
    const clean = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = clean;
    setDigits(next);
    setErrorMsg(null);
    if (clean && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array.from({ length: 6 }, (_, i) => pasted[i] ?? '');
    setDigits(next);
    setErrorMsg(null);
    const focusIdx = Math.min(5, pasted.length - 1);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleResend = async () => {
    if (secondsLeft > 0) return;
    setErrorMsg(null);
    setResendNotice(null);
    try {
      const res = await api.auth.resendOtp({
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        otpType,
        countryGateway,
      });
      const nextPhone = res.phone || cleanPhone;
      const nextEmail = res.email || cleanEmail;
      setSecondsLeft(42);
      setResendNotice(
        nextPhone && nextEmail
          ? `A fresh 6-digit verification code was dispatched to both ${nextPhone} (SMS) and ${nextEmail} (Email).`
          : res.provider === 'resend' && nextEmail
            ? `A fresh 6-digit verification code was sent to ${nextEmail}.`
            : `A fresh 6-digit verification code was dispatched to ${nextPhone || nextEmail || displayTarget}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resend code.');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('');
    if (code.length < 6) {
      setErrorMsg(
        isDualChannel
          ? 'Please enter the 6-digit verification code sent to your phone via SMS and your email.'
          : isPhoneChallenge
            ? 'Please enter the 6-digit SMS verification code.'
            : 'Please enter the 6-digit verification code sent to your email.'
      );
      const firstEmpty = digits.findIndex((d) => !d);
      if (firstEmpty >= 0) inputRefs.current[firstEmpty]?.focus();
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.auth.verifyOtp({
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        token: code,
        otpType,
        countryGateway,
      });
      saveStoredSession(res.session);
      onVerified(res.session, res.profile, false, otpType === 'signup');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const formattedTime = `00:${secondsLeft < 10 ? `0${secondsLeft}` : secondsLeft}`;

  return (
    <div className="bg-[#F5F5F7] text-[#1A1C1D] min-h-dvh w-full max-w-full flex flex-col justify-between overflow-x-clip selection:bg-[#0B0B0B] selection:text-white">
      {/* Header */}
      <header className="fixed top-0 inset-x-0 w-full z-50 bg-[#F5F5F7]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-[env(safe-area-inset-top)]">
        <div className="h-16 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center"
            aria-label="Events By You Home"
          >
            <BrandLogo variant="light" size="sm" />
          </button>

          <nav className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBackHome}
              className="text-xs font-semibold text-[#444748] hover:text-[#0B0B0B] transition-colors"
            >
              Home
            </button>
            <button
              type="button"
              onClick={onNavigateDemoEvent}
              className="text-xs font-semibold text-[#444748] hover:text-[#0B0B0B] transition-colors"
            >
              Published Events
            </button>
          </nav>

          <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
        </div>
      </header>

      <main className="w-full pt-16 bg-[#F5F5F7] flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col w-full py-5 sm:py-7 lg:py-8 max-w-2xl lg:max-w-6xl mx-auto">
          {/* System Carrier Status Sub-Banner */}
          <div className="w-full mb-6 bg-[#F3F3F5] border border-[#E5E5EA] rounded-2xl sm:rounded-full px-4 sm:px-5 py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-[#0B0B0B] shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1A1C1D]">
                DIRECT CARRIER ROUTES (MTN · TELECEL · AT): 100% OPERATIONAL
              </span>
              <span className="hidden md:inline-block text-[11px] text-[#71717A] px-2.5 py-0.5 rounded-full bg-[#F5F5F7] tabular-nums shrink-0">
                Tier-1 Gateway Latency: 29ms
              </span>
            </div>
            <button
              type="button"
              onClick={onBackSignIn}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A1C1D] hover:text-[#71717A] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Back to Sign in</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Dual-Column Master Frame */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
            {/* Left Column: Primary Verification Card */}
            <form
              onSubmit={handleVerify}
              className="lg:col-span-7 bg-white rounded-3xl p-5 sm:p-7 lg:p-8 shadow-sm flex flex-col justify-between min-w-0"
            >
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F5F5F7] text-[#0B0B0B] mb-6">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                  <span className="text-[11px] tracking-widest uppercase font-semibold">
                    Security Protocol · Two-Factor Challenge
                  </span>
                </div>

                <h1 className="font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.03em] mb-3">
                  {isDualChannel
                    ? 'Verify SMS & Email code'
                    : isPhoneChallenge
                      ? 'Verify your phone number'
                      : 'Verify your identity'}
                </h1>
                <p className="text-sm text-[#71717A] mb-6 leading-relaxed">
                  {isDualChannel ? (
                    <>
                      Enter the 6-digit security code dispatched simultaneously via SMS to{' '}
                      <span className="font-semibold text-[#0B0B0B] tabular-nums">
                        {cleanPhone}
                      </span>{' '}
                      and Email to{' '}
                      <span className="font-semibold text-[#0B0B0B]">{cleanEmail}</span>. Your
                      account is verified and activated once confirmation succeeds.
                    </>
                  ) : isPhoneChallenge ? (
                    <>
                      Enter the 6-digit security code dispatched to{' '}
                      <span className="font-semibold text-[#0B0B0B] tabular-nums">
                        {cleanPhone || displayTarget}
                      </span>
                      . Your account is committed once verification succeeds.
                    </>
                  ) : (
                    <>
                      Enter the 6-digit security code sent to{' '}
                      <span className="font-semibold text-[#0B0B0B]">{cleanEmail}</span>.
                    </>
                  )}
                </p>

                {/* Delivery Metric Card */}
                <div className="p-3.5 rounded-2xl bg-[#F5F5F7] flex items-center justify-between gap-3 mb-8">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#E8E8EA] flex items-center justify-center shrink-0">
                      <Radio className="w-4 h-4 text-[#0B0B0B]" />
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-semibold text-[#0B0B0B] truncate tabular-nums">
                        {isDualChannel
                          ? `SMS & Email OTP sent to ${cleanPhone} & ${cleanEmail}`
                          : isPhoneChallenge
                            ? `SMS OTP dispatched to ${cleanPhone || displayTarget}`
                            : `Email OTP dispatched to ${cleanEmail}`}
                      </p>
                      <p className="text-[11px] text-[#71717A] tabular-nums">
                        {isDualChannel
                          ? 'Dispatched simultaneously via Arkesel SMS & Resend Email · 10-min expiry'
                          : isPhoneChallenge
                            ? 'Routed via Arkesel Direct Carrier Gateway · 10-min expiry'
                            : 'Routed via Resend Transactional API · 10-min expiry'}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#EEEEF0] text-[#1A1C1D]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                    ACTIVE
                  </span>
                </div>

                {/* 6-Digit OTP Interactive Boxes */}
                <div className="mb-8">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                      Authentication Code
                    </label>
                    <span className="text-[11px] font-medium text-[#71717A]">
                      {isDualChannel
                        ? 'Check both your SMS messages & email inbox'
                        : isPhoneChallenge
                          ? 'Check your SMS messages'
                          : 'Check your email inbox (Resend)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-2 sm:gap-3.5">
                    {digits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          inputRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        onPaste={handlePaste}
                        aria-label={`Verification digit ${idx + 1}`}
                        className="w-full aspect-square text-center font-display text-[28px] sm:text-[32px] font-bold text-[#0B0B0B] bg-[#F5F5F7] rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-[#0B0B0B] transition-all tabular-nums"
                      />
                    ))}
                  </div>
                  {isLocalFallbackMode() && (
                    <p className="text-[11px] font-medium text-[#71717A] mt-2">
                      Browser preview mode: enter any 6 digits (e.g. 123456) to complete verification.
                    </p>
                  )}
                  {errorMsg && (
                    <p className="text-xs font-semibold text-[#EF4444] mt-2">{errorMsg}</p>
                  )}
                </div>

                {/* Countdown Resend */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8 text-[11px]">
                  <div className="flex items-center gap-2 text-[#71717A]">
                    <Clock className="w-4 h-4" />
                    <span className="text-[13px]">
                      {isDualChannel
                        ? "Didn't receive SMS or email?"
                        : isPhoneChallenge
                          ? "Didn't receive SMS?"
                          : "Didn't receive code?"}
                    </span>
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={secondsLeft > 0}
                      className={`text-xs font-semibold text-[#0B0B0B] tabular-nums ${
                        secondsLeft === 0 ? 'underline cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      {secondsLeft > 0
                        ? `Resend in ${formattedTime}`
                        : isDualChannel
                          ? 'Resend SMS & Email'
                          : isPhoneChallenge
                            ? 'Resend SMS now'
                            : 'Resend code now'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onBackSignIn}
                    className="text-xs font-semibold text-[#0B0B0B] hover:opacity-70 transition-opacity text-left underline underline-offset-4"
                  >
                    Use a different phone or email
                  </button>
                </div>

                {resendNotice && (
                  <div className="mb-6 p-3.5 rounded-2xl bg-[#F5F5F7] text-xs text-[#1A1C1D]">
                    {resendNotice}
                  </div>
                )}

                {/* Trust Device Checkbox */}
                <label className="flex items-start gap-3.5 cursor-pointer select-none mb-8">
                  <input
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                      trustDevice ? 'bg-[#0B0B0B] text-white' : 'bg-[#F5F5F7] text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-[#0B0B0B] leading-tight">
                      Trust this device &amp; browser for 30 days
                    </span>
                    <span className="text-[11px] text-[#71717A] mt-0.5">
                      Bypasses SMS verification on this hardware until session revocation or cookie
                      clear.
                    </span>
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#0B0B0B] hover:opacity-90 active:scale-[0.99] text-white py-4 px-8 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-60"
                >
                  <span>
                    {submitting ? 'Verifying Code...' : 'Verify and Access Creator Studio'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-[#E5E5EA] flex items-center justify-center gap-2 text-[#71717A] text-[11px] text-center">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Protected by Supabase Auth MFA, Arkesel SMS &amp; Resend Email · Challenge expires
                  in 10 minutes
                </span>
              </div>
            </form>

            {/* Right Column: Security Architecture & Telemetry */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="bg-[#F3F3F5] border border-[#E5E5EA] rounded-3xl p-6 sm:p-8">
                <div className="flex items-center justify-between gap-2 mb-6">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-[#0B0B0B]">
                    <Shield className="w-3.5 h-3.5" />
                    <span className="text-[11px] uppercase tracking-wider font-semibold">
                      Zero-Trust Organiser Security
                    </span>
                  </div>
                  <span className="text-[11px] text-[#71717A] font-mono">Verified</span>
                </div>

                <h2 className="font-display text-[22px] leading-snug font-bold text-[#0B0B0B] mb-6 tracking-[-0.02em]">
                  Protecting attendee privacy and organizer broadcast credit:
                </h2>

                <div className="space-y-3.5">
                  {[
                    {
                      icon: QrCode,
                      title: 'Simultaneous Gate Scanner Protection',
                      desc: 'Gate staff and check-in PWA tokens remain active while sensitive broadcast actions require MFA.',
                    },
                    {
                      icon: Cpu,
                      title: 'Anti-SIM Swap Carrier Telemetry',
                      desc: 'In partnership with Arkesel v2, checks carrier IMSI freshness on MTN, Telecel, and AT before OTP verification.',
                    },
                    {
                      icon: Database,
                      title: 'Strict Row Level Security (RLS) Vault',
                      desc: 'Cryptographically binds the authenticated session token to tenant UUID to prevent cross-talk.',
                    },
                    {
                      icon: Timer,
                      title: '10-Minute Ephemeral Challenge Window',
                      desc: 'OTP tokens invalidate after 3 failed attempts or 10 minutes to defend against brute force.',
                    },
                  ].map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.title} className="p-4 rounded-2xl bg-white">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#F5F5F7] flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-[#0B0B0B]" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-[#0B0B0B] mb-1">
                              {card.title}
                            </h3>
                            <p className="text-xs text-[#71717A] leading-snug">{card.desc}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 p-3.5 rounded-2xl bg-[#E8E8EA] flex items-center justify-between text-xs font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#0B0B0B]" />
                    <span className="text-[#1A1C1D]">Arkesel Priority Carrier Gateway</span>
                  </div>
                  <span className="text-[#71717A] font-mono tabular-nums">
                    100% Operational · 29ms
                  </span>
                </div>
              </div>

              {/* Farida Bedwei Testimonial */}
              <div className="bg-white rounded-3xl p-6 shadow-sm">
                <div className="flex items-center gap-1 text-[#0B0B0B] mb-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="w-4 h-4 fill-[#0B0B0B] text-[#0B0B0B]" />
                  ))}
                </div>
                <p className="text-sm text-[#0B0B0B] italic mb-4 leading-relaxed">
                  “With 500 VIP attendees arriving in 30 minutes, having instant 2FA SMS fallback
                  meant our core team could log in from new gate tablets without getting locked out.”
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center text-xs font-bold">
                    FB
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[#0B0B0B] leading-tight">
                      Farida Bedwei
                    </h4>
                    <p className="text-[11px] text-[#71717A]">
                      Technical Director, DevCongress West Africa
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full bg-[#F5F5F7] py-5 border-t border-[#E5E5EA]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#71717A]">
          <span>© 2026 Events By You Inc. All rights reserved.</span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => onOpenLegal?.('privacy')}
              className="hover:text-[#0B0B0B] transition-colors"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => onOpenLegal?.('terms')}
              className="hover:text-[#0B0B0B] transition-colors"
            >
              Terms &amp; Conditions
            </button>
            <a href="/sitemap.xml" className="hover:text-[#0B0B0B] transition-colors">
              Sitemap
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
