import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  AtSign,
  BadgeCheck,
  Bolt,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Mail,
  QrCode,
  Shield,
  Smartphone,
  Star,
  User,
  Zap,
} from 'lucide-react';

import { AlertCircle } from 'lucide-react';
import {
  validateStrictEmail,
  validateStrictPassword,
  validateStrictPhoneE164,
} from '../data/initialData';
import { api, saveStoredSession, type StoredAuthSession } from '../lib/api';
import type { AppRole, OrganizerProfile } from '../types/events';

interface SignUpScreenProps {
  initialEmail?: string;
  initialPhone?: string;
  redirectNotice?: string;
  onBackHome: () => void;
  onGoSignIn: () => void;
  onNavigateDemoEvent: () => void;
  onOpenLegal?: (doc: 'terms' | 'privacy') => void;
  onRequireOtp: (target: {
    phone?: string;
    email?: string;
    otpType: 'signup' | 'email' | 'sms';
    countryGateway?: string;
  }) => void;
  onAuthenticated: (session: StoredAuthSession, profile: OrganizerProfile) => void;
}

const KOJO_THUMBNAIL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA00DjztMRXqTK41BdBhA2YBRO1ZP0ESlcY8X6YwEfvvOaGvAz_upchslXzopVaz3_iZFet8b_X6zQyhV8ZxpNHNZRf_-pKYHNRF_KtlUsua3NGoypcf4dRT96wnNfUA3SxoiT7jTDHUYbGNRS4LR1bezIIe_zuPWJJIko483feSrZMPTdCkL7i6J6jUHvrEfk3ZS34nVuTi7jVOlRVUwa614CdblsYD-rvh-TTfvaDZgmuZRgNjnh9';

export const SignUpScreen: React.FC<SignUpScreenProps> = ({
  initialEmail = '',
  initialPhone = '',
  redirectNotice,
  onBackHome,
  onGoSignIn,
  onNavigateDemoEvent,
  onOpenLegal,
  onRequireOtp,
  onAuthenticated,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [orgEmail, setOrgEmail] = useState(initialEmail);
  const [orgName, setOrgName] = useState('');
  const [countryGateway, setCountryGateway] = useState('GH');
  const [accountRole, setAccountRole] = useState<'organizer' | 'gate_staff'>('organizer');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  const strength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const strengthMeta = useMemo(() => {
    if (!password) {
      return {
        label: 'Min 8 chars, 1 uppercase, 1 number',
        colorClass: 'text-[#71717A]',
        barColor: 'bg-[#E5E5EA]',
      };
    }
    if (strength <= 1) {
      return {
        label: 'Weak password',
        colorClass: 'text-[#EF4444] font-medium',
        barColor: 'bg-[#EF4444]',
      };
    }
    if (strength === 2) {
      return {
        label: 'Moderate',
        colorClass: 'text-amber-600 font-medium',
        barColor: 'bg-amber-500',
      };
    }
    if (strength === 3) {
      return {
        label: 'Good',
        colorClass: 'text-[#0B0B0B] font-medium',
        barColor: 'bg-[#0B0B0B]',
      };
    }
    return {
      label: 'Strong (Excellent for RLS workspace)',
      colorClass: 'text-emerald-600 font-semibold',
      barColor: 'bg-emerald-600',
    };
  }, [password, strength]);

  const phoneValidation = useMemo(
    () => (phone.trim() ? validateStrictPhoneE164(phone, countryGateway) : null),
    [phone, countryGateway]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setFormError('Full name must be at least 2 characters.');
      return;
    }

    const phoneCheck = validateStrictPhoneE164(phone, countryGateway);
    if (!phoneCheck.ok) {
      setFormError(phoneCheck.error);
      return;
    }

    let cleanEmail: string | undefined;
    if (orgEmail.trim()) {
      const emailCheck = validateStrictEmail(orgEmail);
      if (!emailCheck.ok) {
        setFormError(emailCheck.error);
        return;
      }
      cleanEmail = emailCheck.normalized;
    }

    const pwCheck = validateStrictPassword(password);
    if (!pwCheck.ok) {
      setFormError(pwCheck.error);
      return;
    }

    if (!agreed) {
      setFormError('Please accept the Terms of Service & NCA SMS regulations to continue.');
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      const firstName = trimmedName.split(' ')[0] || 'My';
      const defaultStudio = `${firstName}'s Events`;
      const res = await api.auth.signUp({
        phone: phoneCheck.normalized,
        email: cleanEmail,
        password,
        name: trimmedName,
        studio: orgName.trim() || defaultStudio,
        countryGateway,
        appRole: accountRole satisfies AppRole,
        agreed,
      });
      if (res.session && res.profile) {
        saveStoredSession(res.session);
        onAuthenticated(res.session, res.profile);
      } else {
        onRequireOtp({
          phone: res.phone || phoneCheck.normalized,
          email: res.email || cleanEmail,
          otpType: res.otpType || 'sms',
          countryGateway,
        });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setOauthLoading(provider);
    setFormError(null);
    try {
      const { url } = await api.auth.getOAuthUrl(provider, window.location.origin);
      window.location.assign(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'OAuth signup failed.');
      setOauthLoading(null);
    }
  };

  return (
    <div className="bg-[#F5F5F7] text-[#1A1C1D] min-h-dvh w-full max-w-full flex flex-col justify-between overflow-x-clip selection:bg-[#0B0B0B] selection:text-white">
      {/* Header */}
      <header className="fixed top-0 inset-x-0 w-full z-50 bg-[#F5F5F7]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-[env(safe-area-inset-top)]">
        <div className="h-16 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-2"
          >
            <div className="w-7 h-7 rounded-full bg-[#0B0B0B] flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-white" />
            </div>
            <span className="font-display text-base text-[#1A1C1D] tracking-tight font-bold">
              Events
            </span>
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
              Live Demo Event
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onGoSignIn}
              className="text-xs font-semibold text-[#0B0B0B] px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] transition-colors whitespace-nowrap"
            >
              Sign In
            </button>
            <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      <main className="w-full pt-16 bg-[#F5F5F7] flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col w-full max-w-2xl lg:max-w-6xl mx-auto py-5 sm:py-7 lg:py-8">
          {/* Top Utility Context Bar */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2 pb-4 mb-6 border-b border-[#E5E5EA]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-[#444748] tracking-wide">
                DIRECT CARRIER ROUTES (MTN · TELECEL · AT):{' '}
                <span className="text-[#0B0B0B] font-bold">100% OPERATIONAL</span>
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-[#71717A]">Already hosting with us?</span>
              <button
                type="button"
                onClick={onGoSignIn}
                className="text-xs font-semibold text-[#0B0B0B] hover:opacity-75 transition-opacity underline underline-offset-4"
              >
                Sign in to studio →
              </button>
            </div>
          </div>

          {/* Primary Split-Card Container */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
            {/* Left Column: Main Sign-Up Form (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-5 sm:p-7 lg:p-8 shadow-sm flex flex-col justify-between min-w-0">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F5F5F7] text-[#1A1C1D] text-xs font-semibold mb-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                  FREE INDIVIDUAL &amp; ORGANISER ACCOUNT
                </div>

                {redirectNotice && (
                  <div className="mb-5 p-3.5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-start gap-2.5 text-xs text-[#0B0B0B]">
                    <Lock className="w-4 h-4 shrink-0 mt-0.5 text-[#0B0B0B]" />
                    <div className="min-w-0">
                      <p className="font-semibold">
                        Create an account or sign in for {redirectNotice}
                      </p>
                      <p className="text-[11px] text-[#71717A] mt-0.5">
                        You will be taken directly to {redirectNotice} once your account is verified.
                      </p>
                    </div>
                  </div>
                )}

                <h1 className="font-display text-[28px] sm:text-[36px] leading-tight text-[#0B0B0B] tracking-[-0.03em] mb-2 font-bold">
                  Start hosting events &amp; programs with high delivery
                </h1>
                <p className="text-sm text-[#444748] mb-8 max-w-xl leading-relaxed">
                  Create your free individual or organiser account. Get 20 free Arkesel SMS credits
                  instantly upon sign up for personal programs, weddings, birthdays, or community events.
                </p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Row 1: Full Name & Mobile Phone Number (Auth & Authorisation) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="signup-name"
                        className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                      >
                        <span>Full Name</span>
                        <span className="text-[11px] font-normal text-[#71717A]">Required</span>
                      </label>
                      <div className="relative">
                        <input
                          id="signup-name"
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => {
                            setFullName(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          placeholder="Josh Mensah"
                          className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 pr-10 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                        />
                        <BadgeCheck className="w-4 h-4 text-[#71717A] absolute right-3.5 top-3.5 pointer-events-none" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="signup-phone"
                        className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                      >
                        <span>Mobile Phone Number (SMS Auth)</span>
                        <span className="text-[11px] font-normal text-[#71717A]">Required</span>
                      </label>
                      <div className="relative">
                        <input
                          id="signup-phone"
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          placeholder="+233 24 123 4567"
                          className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 pr-10 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all tabular-nums"
                        />
                        <Smartphone className="w-4 h-4 text-[#71717A] absolute right-3.5 top-3.5 pointer-events-none" />
                      </div>
                      {phoneValidation && (
                        <p
                          className={`text-[11px] pl-3 ${
                            phoneValidation.ok ? 'text-emerald-700 font-medium' : 'text-[#EF4444]'
                          }`}
                        >
                          {phoneValidation.ok
                            ? `Normalized E.164: ${phoneValidation.normalized}`
                            : phoneValidation.error}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Optional Email & Primary Telecom Gateway */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="signup-email"
                        className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                      >
                        <span>Personal or Organisation Email</span>
                        <span className="text-[11px] font-normal text-[#71717A]">Optional</span>
                      </label>
                      <div className="relative">
                        <input
                          id="signup-email"
                          type="email"
                          value={orgEmail}
                          onChange={(e) => {
                            setOrgEmail(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          placeholder="you@gmail.com (for backup OTP & receipts)"
                          className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 pr-10 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                        />
                        <AtSign className="w-4 h-4 text-[#71717A] absolute right-3.5 top-3.5 pointer-events-none" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="signup-gateway"
                        className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                      >
                        <span>Primary Telecom Gateway</span>
                        <span className="text-[11px] text-emerald-600 font-semibold">
                          Arkesel v2 Active
                        </span>
                      </label>
                      <div className="relative">
                        <select
                          id="signup-gateway"
                          value={countryGateway}
                          onChange={(e) => setCountryGateway(e.target.value)}
                          className="w-full appearance-none bg-[#F5F5F7] rounded-full px-4 py-3 pr-10 text-sm text-[#0B0B0B] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all cursor-pointer"
                        >
                          <option value="GH">Ghana (+233) · Direct Carrier (MTN, Telecel, AT)</option>
                          <option value="NG">Nigeria (+234) · Multi-provider Gateway</option>
                          <option value="KE">Kenya (+254) · Safaricom / Airtel Direct</option>
                          <option value="RW">Rwanda (+250) · Direct Carrier Network</option>
                          <option value="OTHER">International E.164 Global Route</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-[#71717A] absolute right-3.5 top-3.5 pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Host / Organisation Name */}
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="signup-studio"
                      className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                    >
                      <span>Host, Program, or Organisation</span>
                      <span className="text-[11px] font-normal text-[#71717A]">Optional</span>
                    </label>
                    <input
                      id="signup-studio"
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="e.g. Akua's Birthday / Grace Chapel / Royal Events"
                      className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                    />
                  </div>

                  {/* Workspace RBAC Role */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between">
                      <span>Workspace Access Role (RBAC)</span>
                      <span className="text-[11px] text-[#71717A]">Row Level Security</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'organizer', label: 'Individual / Event Host', sub: 'Create events, programs & manage passes' },
                          { id: 'gate_staff', label: 'Gate Check-In Staff', sub: 'QR scanner & door check-in only' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAccountRole(opt.id)}
                          className={`rounded-2xl px-4 py-2.5 text-left border transition-colors ${
                            accountRole === opt.id
                              ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                              : 'bg-[#F5F5F7] text-[#0B0B0B] border-transparent hover:border-[#E5E5EA]'
                          }`}
                        >
                          <span className="text-xs font-semibold block">{opt.label}</span>
                          <span
                            className={`text-[10px] block mt-0.5 ${
                              accountRole === opt.id ? 'text-zinc-300' : 'text-[#71717A]'
                            }`}
                          >
                            {opt.sub}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Password Field + 4-Bar Strength Indicator */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-[#1A1C1D]">
                        Secure Password
                      </label>
                      <span className={`text-[11px] ${strengthMeta.colorClass}`}>
                        {strengthMeta.label}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a master studio password"
                        className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 pr-12 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                      />
                      <button
                        type="button"
                        aria-label="Toggle password visibility"
                        onClick={() => setShowPassword((p) => !p)}
                        className="absolute right-3.5 top-2.5 p-1 rounded-full hover:bg-[#EEEEF0] text-[#71717A] hover:text-[#0B0B0B] transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                      {[1, 2, 3, 4].map((idx) => (
                        <div
                          key={idx}
                          className={`h-1 rounded-full transition-colors duration-300 ${
                            password && strength >= idx ? strengthMeta.barColor : 'bg-[#E5E5EA]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Compliance Checkbox */}
                  <div className="pt-1">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => {
                          setAgreed(e.target.checked);
                          if (e.target.checked) setFormError(null);
                        }}
                        className="sr-only"
                      />
                      <span
                        className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                          agreed ? 'bg-[#0B0B0B] text-white' : 'bg-[#E5E5EA] text-transparent'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </span>
                      <span className="text-[11px] text-[#444748] leading-relaxed">
                        I agree to the{' '}
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.preventDefault();
                            onOpenLegal?.('terms');
                          }}
                          className="text-[#0B0B0B] underline hover:opacity-75"
                        >
                          Terms &amp; Conditions
                        </button>
                        ,{' '}
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.preventDefault();
                            onOpenLegal?.('privacy');
                          }}
                          className="text-[#0B0B0B] underline hover:opacity-75"
                        >
                          Privacy Policy
                        </button>
                        , and NCA SMS delivery regulations regarding attendee consent.
                      </span>
                    </label>
                  </div>

                  {formError && (
                    <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-start gap-2.5 text-xs font-medium text-[#0B0B0B]">
                      <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[#EF4444]">{formError}</p>
                        <p className="text-[11px] text-[#71717A] mt-0.5">
                          Strict validation active — no account or database record was created.
                        </p>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-sm font-semibold rounded-full py-3.5 px-6 flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
                  >
                    <span>
                      {submitting ? 'Sending SMS Verification...' : 'Verify Phone & Create Account'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                {/* Divider */}
                <div className="relative my-7 flex items-center justify-center">
                  <div className="w-full h-px bg-[#E5E5EA]" />
                  <span className="absolute px-4 bg-white text-[11px] font-semibold text-[#71717A] tracking-wider uppercase">
                    OR REGISTER WITH
                  </span>
                </div>

                {/* Social OAuth Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={oauthLoading !== null}
                    onClick={() => handleOAuth('google')}
                    className="w-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] rounded-full py-2.5 px-4 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        fill="#EA4335"
                      />
                    </svg>
                    {oauthLoading === 'google' ? 'Redirecting...' : 'Continue with Google'}
                  </button>
                  <button
                    type="button"
                    disabled={oauthLoading !== null}
                    onClick={() => handleOAuth('github')}
                    className="w-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] rounded-full py-2.5 px-4 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  >
                    <svg className="w-4 h-4 fill-current text-[#0B0B0B]" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    {oauthLoading === 'github' ? 'Redirecting...' : 'Continue with GitHub'}
                  </button>
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#71717A] shrink-0" />
                  <span className="text-[11px] text-[#71717A]">
                    Multi-tenant Row Level Security (RLS) automatically provisioned for your
                    workspace.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onGoSignIn}
                  className="sm:hidden text-xs font-semibold text-[#0B0B0B] underline text-center mt-2"
                >
                  Already have an account? Sign In →
                </button>
              </div>
            </div>

            {/* Right Column: What's Included & Guarantee (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-[#EEEEF0] to-transparent rounded-bl-full pointer-events-none -mr-10 -mt-10" />
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EEEEF0] text-[#0B0B0B] text-[11px] font-semibold mb-4 tracking-wider">
                    FREE STARTER TIER · $0 FOREVER
                  </div>
                  <h2 className="font-display text-[22px] leading-snug font-bold text-[#0B0B0B] mb-3 tracking-[-0.02em]">
                    Everything you need for your first gathering:
                  </h2>

                  <ul className="space-y-4 my-6">
                    {[
                      {
                        icon: Bolt,
                        title: '20 Free Starter SMS Credits',
                        desc: 'Automatically loaded via PostgreSQL trigger directly upon registration.',
                      },
                      {
                        icon: QrCode,
                        title: 'Unlimited Mobile RSVPs & Passes',
                        desc: 'Unique dynamic QR digital passes with Apple and Google Wallet sync support.',
                      },
                      {
                        icon: Smartphone,
                        title: 'Strict E.164 Phone Normalisation',
                        desc: 'Pre-validates (+233) formats to eliminate duplicate entries and conserve SMS budget.',
                      },
                      {
                        icon: Zap,
                        title: 'Installable PWA Gate Check-in',
                        desc: 'Runs offline at the door with instant local cache verification and auto-reconciliation.',
                      },
                      {
                        icon: Mail,
                        title: 'Resend Transactional Routing',
                        desc: 'Instant branded confirmation emails with direct reply-to to your organiser email.',
                      },
                    ].map((feat) => {
                      const Icon = feat.icon;
                      return (
                        <li key={feat.title} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-[#F5F5F7] flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-[#0B0B0B]" />
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-[#0B0B0B] block">
                              {feat.title}
                            </span>
                            <span className="text-[11px] text-[#444748] leading-relaxed">
                              {feat.desc}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="pt-4 border-t border-[#E5E5EA] flex items-center justify-between text-[#71717A] text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Supabase RLS Active
                  </span>
                  <span className="font-mono tabular-nums">Latency: 42ms (ACC)</span>
                </div>
              </div>

              {/* Kojo Boakye Testimonial with Monochrome Showcase Thumbnail */}
              <div className="bg-white rounded-3xl p-6 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="w-4 h-4 fill-amber-500 text-amber-500" />
                  ))}
                  <span className="text-[11px] text-[#71717A] ml-2 font-medium">
                    5.0 Organizer Rating
                  </span>
                </div>

                <blockquote className="text-sm text-[#1A1C1D] italic leading-relaxed">
                  “Events App made attendee check-in effortless. We sent 420 gate pass SMS alerts
                  without a single duplicate number and checked in 380 attendees without any
                  bottleneck.”
                </blockquote>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#EEEEF0] flex items-center justify-center font-bold text-[#0B0B0B] text-xs">
                      KB
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-[#0B0B0B] block">
                        Kojo Boakye
                      </span>
                      <span className="text-[11px] text-[#71717A]">
                        Founder, Silicon Savannah DAO
                      </span>
                    </div>
                  </div>
                  <div
                    className="w-10 h-10 rounded-xl overflow-hidden shadow-sm shrink-0 border border-[#E5E5EA] bg-[#0B0B0B] flex items-center justify-center"
                    title="Community Workspace Showcase"
                  >
                    {!thumbFailed ? (
                      <img
                        src={KOJO_THUMBNAIL}
                        alt="Community Showcase"
                        referrerPolicy="no-referrer"
                        onError={() => setThumbFailed(true)}
                        className="w-full h-full object-cover grayscale contrast-125"
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-white">SS</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full bg-[#F5F5F7] py-5 border-t border-[#E5E5EA]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#71717A]">
          <span>© 2026 Events App Inc. All rights reserved.</span>
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
