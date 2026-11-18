import React from 'react';
import { ArrowLeft, ArrowRight, FileText, Layers, Lock, ShieldCheck } from 'lucide-react';

interface LegalScreenProps {
  doc: 'terms' | 'privacy';
  isSignedIn: boolean;
  onSwitchDoc: (doc: 'terms' | 'privacy') => void;
  onBackHome: () => void;
  onNavigateSignIn: () => void;
  onNavigateStudio: () => void;
}

export const LegalScreen: React.FC<LegalScreenProps> = ({
  doc,
  isSignedIn,
  onSwitchDoc,
  onBackHome,
  onNavigateSignIn,
  onNavigateStudio,
}) => {
  const isTerms = doc === 'terms';

  return (
    <div className="min-h-dvh w-full max-w-full bg-[#F5F5F7] text-[#0B0B0B] flex flex-col justify-between overflow-x-clip">
      <header className="sticky top-0 z-40 w-full bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-[#E5E5EA]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight">Events App</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-white rounded-full border border-[#E5E5EA]">
              <button
                type="button"
                onClick={() => onSwitchDoc('terms')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                  isTerms ? 'bg-[#0B0B0B] text-white' : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Terms &amp; Conditions
              </button>
              <button
                type="button"
                onClick={() => onSwitchDoc('privacy')}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                  !isTerms ? 'bg-[#0B0B0B] text-white' : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Privacy Policy
              </button>
            </div>

            <button
              type="button"
              onClick={isSignedIn ? onNavigateStudio : onNavigateSignIn}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap"
            >
              <span>{isSignedIn ? 'Open Studio' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <article className="bg-white rounded-3xl border border-[#E5E5EA] p-6 sm:p-10 space-y-8 shadow-sm">
          <header className="space-y-3 pb-6 border-b border-[#E5E5EA]">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B]">
              {isTerms ? <FileText className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{isTerms ? 'Legal · Terms & Conditions' : 'Legal · Privacy Policy'}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-[-0.03em] text-[#0B0B0B]">
              {isTerms ? 'Terms & Conditions of Service' : 'Privacy & Data Protection Policy'}
            </h1>
            <p className="text-xs font-mono text-[#71717A]">
              Effective Date: November 18, 2026 · Events App Inc. (Accra &amp; Lagos Infrastructure)
            </p>
          </header>

          {isTerms ? (
            <div className="space-y-6 text-sm text-[#444748] leading-relaxed">
              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  1. Account Authentication &amp; Event Creation Access
                </h2>
                <p>
                  Creating, publishing, or managing events on Events App requires an authenticated
                  organiser or creator account. Unauthenticated visitors may browse published event
                  pages and submit public RSVP registrations, while Studio modules, SMS broadcasts,
                  and event creation are gated behind verified sign-in credentials.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  2. Role-Based Access Control (RBAC) &amp; Multi-Tenant Isolation
                </h2>
                <p>
                  Workspaces enforce strict tenant separation via Row Level Security (RLS) and
                  scoped role permissions (<span className="font-mono text-xs text-[#0B0B0B]">creator</span>,{' '}
                  <span className="font-mono text-xs text-[#0B0B0B]">organizer</span>,{' '}
                  <span className="font-mono text-xs text-[#0B0B0B]">gate_staff</span>). Gate staff
                  credentials are scoped to pass scanning and attendee check-in operations and may
                  not alter billing plans, developer apps, or event ownership records.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  3. Arkesel SMS Pass Delivery &amp; Telecom Compliance
                </h2>
                <p>
                  Organisers dispatching ticket passes, reminders, or schedule alerts via Arkesel or
                  email gateways warrant that all recipients opted into event communications and
                  that Sender IDs comply with Ghana National Communications Authority (NCA) and
                  applicable West African carrier regulations. Unsolicited promotional blasts or
                  spoofed headers may result in immediate tenant suspension.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  4. Session Timeout &amp; Account Security
                </h2>
                <p>
                  Active Studio and Console sessions enforce an automatic 30-minute inactivity
                  timeout with a 60-second renewal prompt. Users must safeguard bearer tokens,
                  companion app client secrets, and HMAC webhook secrets from unauthorized
                  disclosure.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  5. Billing, SMS Credits &amp; Service Availability
                </h2>
                <p>
                  Prepaid SMS credits and Starter/Pro Organizer/Enterprise plan allocations remain
                  valid while your workspace stays in good standing. Platform administrators may
                  pause registrations or enable sandbox dry-run dispatch during scheduled telecom
                  maintenance or abuse mitigation.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-6 text-sm text-[#444748] leading-relaxed">
              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  1. Information We Collect
                </h2>
                <p>
                  When you register an organiser account or attend an event, we process contact
                  details (full name, work email, normalized E.164 phone number, organization name),
                  event schedules, check-in timestamps, and optional 35mm disposable film camera
                  frames uploaded by event participants.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  2. How We Use &amp; Deliver Guest Passes
                </h2>
                <p>
                  Attendee phone numbers and email addresses are used strictly to generate unique
                  QR ticket tokens, prevent duplicate phone registrations, dispatch confirmations via
                  Arkesel SMS and Resend email, and verify entry at offline-first gate scanners.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  3. Data Isolation, Storage &amp; Session Expiration
                </h2>
                <p>
                  Organiser records are isolated per tenant using PostgreSQL Row Level Security
                  policies. Client authentication secrets are stored using one-way SHA-256 hashes,
                  server environment secrets are never exposed to client browsers, and idle workspace
                  sessions automatically sign out after 30 minutes of inactivity.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  4. 35mm Disposable Camera Media
                </h2>
                <p>
                  Photos captured in the in-app 35mm disposable film camera are scoped to the
                  specific event roll and managed by the hosting organiser, who may toggle darkroom
                  mode, develop rolls, or remove frames at any time.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="font-display text-base font-bold text-[#0B0B0B]">
                  5. Your Rights &amp; Contact
                </h2>
                <p>
                  Organisers and attendees may request correction, CSV export, or deletion of event
                  registration records through their hosting studio or by contacting{' '}
                  <span className="font-mono text-xs text-[#0B0B0B]">privacy@eventsapp.africa</span>.
                </p>
              </section>
            </div>
          )}

          <footer className="pt-6 border-t border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#71717A]">
            <div className="inline-flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-[#0B0B0B]" />
              <span>Multi-tenant Row Level Security &amp; 30-min idle timeout enforced.</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="/sitemap.xml" className="hover:text-[#0B0B0B] underline underline-offset-4">
                sitemap.xml
              </a>
              <a href="/robots.txt" className="hover:text-[#0B0B0B] underline underline-offset-4">
                robots.txt
              </a>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
};
