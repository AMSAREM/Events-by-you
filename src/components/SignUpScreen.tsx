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
import { startGoogleOAuthPopup } from '../lib/googleAuthClient';
import type { AppRole, OrganizerProfile } from '../types/events';
import { BrandLogo } from './BrandLogo';
import { GoogleAuthButton } from './GoogleAuthButton';

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
  onAuthenticated: (
    session: StoredAuthSession,
    profile: OrganizerProfile,
    openCreatorConsole?: boolean,
    isNewUser?: boolean
  ) => void;
}

const KOJO_THUMBNAIL =
  '/src/assets/images/dispo_summit_networking_1795017070315.jpg';

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
  const accountRole = 'organizer' as const;
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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

  const emailValidation = useMemo(
    () => (orgEmail.trim() ? validateStrictEmail(orgEmail) : null),
    [orgEmail]
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

    const emailCheck = validateStrictEmail(orgEmail);
    if (!emailCheck.ok) {
      setFormError(emailCheck.error);
      return;
    }
    const cleanEmail = emailCheck.normalized;

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
        onAuthenticated(res.session, res.profile, false, true);
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

  const handleGoogleSignUp = async () => {
    if (!agreed) {
      setFormError('Please accept the Terms of Service & Privacy Policy to continue with Google.');
      return;
    }
    setFormError(null);
    setGoogleLoading(true);
    try {
      const result = await startGoogleOAuthPopup({
        mode: 'signup',
        studio: orgName.trim() || undefined,
        appRole: accountRole,
      });
      if (!result.ok) {
        if (!result.cancelled) {
          setFormError(result.error);
        }
        return;
      }
      onAuthenticated(result.session, result.profile, false, result.isNewUser);
    } finally {
      setGoogleLoading(false);
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
                <p className="text-sm text-[#444748] mb-6 max-w-xl leading-relaxed">
                  Create your free individual or organiser account instantly with Google, or register with phone &amp; email (6-digit Arkesel SMS + Resend verification). Top up any Arkesel SMS bundle inside Billing to dispatch guest SMS.
                </p>

                <div className="mb-5">
                  <GoogleAuthButton
                    mode="signup"
                    loading={googleLoading}
                    disabled={submitting}
                    onClick={handleGoogleSignUp}
                  />
                  <div className="relative flex items-center justify-center my-5">
                    <div className="border-t border-[#E5E5EA] w-full" />
                    <span className="px-3 bg-white text-[11px] font-medium text-[#71717A] uppercase tracking-wider shrink-0">
                      or register with phone &amp; email
                    </span>
                    <div className="border-t border-[#E5E5EA] w-full" />
                  </div>
                </div>

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
                          placeholder="Your full name"
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

                  {/* Row 2: Required Email & Primary Telecom Gateway */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="signup-email"
                        className="text-xs font-semibold text-[#1A1C1D] flex items-center justify-between"
                      >
                        <span>Personal or Organisation Email</span>
                        <span className="text-[11px] font-normal text-[#71717A]">Required</span>
                      </label>
                      <div className="relative">
                        <input
                          id="signup-email"
                          type="email"
                          required
                          value={orgEmail}
                          onChange={(e) => {
                            setOrgEmail(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          placeholder="you@gmail.com"
                          className="w-full bg-[#F5F5F7] rounded-full px-4 py-3 pr-10 text-sm text-[#0B0B0B] placeholder:text-[#71717A] outline-none focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                        />
                        <AtSign className="w-4 h-4 text-[#71717A] absolute right-3.5 top-3.5 pointer-events-none" />
                      </div>
                      {emailValidation && (
                        <p
                          className={`text-[11px] pl-3 ${
                            emailValidation.ok ? 'text-emerald-700 font-medium' : 'text-[#EF4444]'
                          }`}
                        >
                          {emailValidation.ok
                            ? `Verified email format: ${emailValidation.normalized}`
                            : emailValidation.error}
                        </p>
                      )}
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

                  {/* Workspace Access Role */}
                  <div className="rounded-2xl px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold text-[#0B0B0B] block">
                        Event Organiser Studio Account
                      </span>
                      <span className="text-[10px] text-[#71717A] block mt-0.5">
                        Only event organisers can enter the Studio workspace
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[10px] font-bold uppercase tracking-wider shrink-0">
                      Organiser
                    </span>
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
                    disabled={submitting || googleLoading}
                    className="w-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-sm font-semibold rounded-full py-3.5 px-6 flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
                  >
                    <span>
                      {submitting
                        ? 'Sending SMS & Email Code...'
                        : 'Verify SMS & Email & Create Account'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
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
                  “Events By You made attendee check-in effortless. We sent 420 gate pass SMS alerts
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
