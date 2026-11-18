import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Star,
  User,
} from 'lucide-react';

interface SignInScreenProps {
  initialEmail?: string;
  onBackHome: () => void;
  onNavigateDemoEvent: () => void;
  onForgotPassword: (email: string) => void;
  onGoSignUp: (email: string) => void;
  onSubmitCredentials: (email: string) => void;
  onAuthenticated: (email: string, name?: string) => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  initialEmail = '',
  onBackHome,
  onNavigateDemoEvent,
  onForgotPassword,
  onGoSignUp,
  onSubmitCredentials,
  onAuthenticated,
}) => {
  const [email, setEmail] = useState(initialEmail || 'josh@techleaders.africa');
  const [password, setPassword] = useState('••••••••••••');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    onSubmitCredentials(email.trim());
  };

  return (
    <div className="bg-[#F5F5F7] text-[#1A1C1D] min-h-screen flex flex-col justify-between selection:bg-[#0B0B0B] selection:text-white">
      {/* Header matching Stitch Sign-In */}
      <header className="fixed top-0 w-full z-50 bg-[#F5F5F7]/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between">
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
              className="text-xs font-semibold text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap"
            >
              Home
            </button>
            <button
              type="button"
              onClick={onNavigateDemoEvent}
              className="text-xs font-semibold text-[#444748] hover:text-[#0B0B0B] transition-colors whitespace-nowrap"
            >
              Live Demo Event
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Auth Grid */}
      <main className="w-full pt-16 flex-1 flex flex-col justify-center items-center px-4">
        <div className="flex flex-col w-full py-8 md:py-12 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Auth Card */}
            <div className="lg:col-span-7 flex flex-col justify-between bg-white rounded-[32px] p-6 sm:p-10 shadow-[0_12px_32px_-8px_rgba(11,11,11,0.06)]">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-[11px] font-medium mb-6">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                  <span className="tracking-wide uppercase">Events App Creator Access</span>
                </div>

                <h1 className="font-display text-[32px] sm:text-[36px] leading-tight font-bold text-[#0B0B0B] tracking-[-0.03em] mb-2">
                  Welcome back, Organiser
                </h1>
                <p className="text-sm text-[#71717A] mb-8">
                  Sign in to manage your events, attendee rosters, and multi-channel SMS/Email broadcasts.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">

                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5" htmlFor="email">
                      Work Email
                    </label>
                    <div className="relative flex items-center">
                      <Mail className="w-4.5 h-4.5 text-[#71717A] absolute left-4 pointer-events-none" />
                      <input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="josh@techleaders.africa"
                        className="w-full bg-[#F5F5F7] rounded-full py-3.5 pl-11 pr-4 text-sm text-[#0B0B0B] placeholder:text-[#71717A] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                      />
                    </div>
                    <p className="text-[11px] text-[#71717A] mt-1.5 ml-3">
                      Used for organizer dashboard access and critical broadcast delivery logs.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#0B0B0B]" htmlFor="password">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => onForgotPassword(email.trim() || 'josh@techleaders.africa')}
                        className="text-[11px] font-medium text-[#71717A] hover:text-[#0B0B0B] transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative flex items-center">
                      <Lock className="w-4.5 h-4.5 text-[#71717A] absolute left-4 pointer-events-none" />
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-[#F5F5F7] rounded-full py-3.5 pl-11 pr-12 text-sm text-[#0B0B0B] placeholder:text-[#71717A] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                      />
                      <button
                        type="button"
                        aria-label="Toggle password visibility"
                        onClick={() => setShowPassword((p) => !p)}
                        className="absolute right-4 text-[#71717A] hover:text-[#0B0B0B] transition-colors p-1 rounded-full"
                      >
                        {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(e) => setRememberDevice(e.target.checked)}
                        className="sr-only"
                      />
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                          rememberDevice ? 'bg-[#0B0B0B] text-white' : 'bg-[#F5F5F7] text-transparent'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </span>
                      <span className="text-[13px] text-[#0B0B0B]">
                        Remember this device for 30 days
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-2 bg-[#0B0B0B] text-white rounded-full py-3.5 px-6 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all"
                  >
                    <span>Sign In to Creator Studio</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <p className="text-[11px] text-center text-[#71717A]">
                    Preview mode: submit with prefilled credentials or use Google/GitHub for instant studio access.
                  </p>
                </form>

                {/* Divider */}
                <div className="relative my-6 flex items-center justify-center">
                  <div className="w-full h-[1px] bg-[#E5E5EA]" />
                  <span className="absolute bg-white px-4 text-[11px] font-medium text-[#71717A] uppercase tracking-wider">
                    or continue with
                  </span>
                </div>

                {/* Social Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-6">
                  <button
                    type="button"
                    onClick={() => onAuthenticated(email || 'josh@techleaders.africa')}
                    className="flex items-center justify-center gap-2 py-3 px-4 bg-[#F5F5F7] hover:bg-[#EEEEF0] rounded-full text-[#0B0B0B] text-xs font-semibold transition-colors"
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
                    <span>Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAuthenticated(email || 'josh@techleaders.africa')}
                    className="flex items-center justify-center gap-2 py-3 px-4 bg-[#F5F5F7] hover:bg-[#EEEEF0] rounded-full text-[#0B0B0B] text-xs font-semibold transition-colors"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                    <span>GitHub</span>
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E5E5EA]/70 flex flex-col gap-2">
                <div className="flex items-start gap-2 text-[#71717A]">
                  <ShieldCheck className="w-4 h-4 mt-0.5 text-[#0B0B0B] shrink-0" />
                  <span className="text-[11px] leading-relaxed">
                    Multi-tenant Row Level Security enforced. Your event data and attendee contact
                    details are strictly isolated.
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px] pt-2">
                  <span className="text-[#71717A]">
                    Don&apos;t have an organiser account?
                  </span>
                  <button
                    type="button"
                    onClick={() => onGoSignUp(email.trim())}
                    className="text-[#0B0B0B] font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    Create free account
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right Perks & Proof Rail */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-4">
              <div className="bg-[#F5F5F7] rounded-[32px] p-6 sm:p-8 border border-[#E5E5EA] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] uppercase tracking-wider text-[#71717A] font-medium">
                      Organizer Engine
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-white text-[#0B0B0B] text-[11px] font-medium">
                      Tier-1 Gateway
                    </span>
                  </div>
                  <h2 className="font-display text-[22px] leading-7 font-bold text-[#0B0B0B] tracking-[-0.02em] mb-4">
                    Free Starter Tier Benefits Included:
                  </h2>
                  <ul className="space-y-2.5 mb-6">
                    {[
                      {
                        bold: '20 Free Starter SMS Credits',
                        rest: ' automatically loaded on sign up',
                      },
                      {
                        bold: 'Strict E.164 phone normalisation',
                        rest: ' and spam deduplication',
                      },
                      {
                        bold: 'Direct Arkesel Tier-1',
                        rest: ' telecommunication gateway routes',
                      },
                      {
                        bold: '60-second mobile RSVP checkout',
                        rest: ' for your attendees',
                      },
                    ].map((perk) => (
                      <li
                        key={perk.bold}
                        className="flex items-start gap-2.5 p-3 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)]"
                      >
                        <Check className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                        <span className="text-[13px] text-[#0B0B0B] leading-snug">
                          <strong>{perk.bold}</strong>
                          {perk.rest}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Live Gateway Status */}
                <div className="flex items-center justify-between p-3.5 rounded-full bg-white text-[11px] text-[#71717A]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#0B0B0B]" />
                    <span className="text-[#0B0B0B] font-medium">
                      Arkesel Gateway &amp; Resend API
                    </span>
                  </div>
                  <span className="font-semibold text-[#0B0B0B]">100% Operational</span>
                </div>
              </div>

              {/* Social Proof Card */}
              <div className="bg-white rounded-[32px] p-6 sm:p-7 shadow-[0_12px_32px_-8px_rgba(11,11,11,0.06)] flex flex-col justify-between">
                <div className="flex items-center gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className="w-4 h-4 fill-[#0B0B0B] text-[#0B0B0B]" />
                  ))}
                </div>
                <blockquote className="text-sm text-[#0B0B0B] italic mb-4 leading-relaxed">
                  “Events App helped us register 420 tech leaders across Accra in under 2 hours
                  without gate queues.”
                </blockquote>
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#F5F5F7] flex items-center justify-center font-bold text-[#0B0B0B] text-[13px]">
                    DC
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#0B0B0B]">DevCongress Accra Team</p>
                    <p className="text-[11px] text-[#71717A]">
                      Tech Ecosystem &amp; Community Gatherings
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full bg-[#F5F5F7] py-6">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#71717A]">
          <span>© 2025 Events App Inc. All rights reserved.</span>
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
