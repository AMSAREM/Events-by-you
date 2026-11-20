import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Gift,
  Plus,
  QrCode,
  Radio,
  Sparkles,
  X,
} from 'lucide-react';

interface OnboardingWalkthroughModalProps {
  open: boolean;
  userName?: string;
  hasEvents: boolean;
  onClose: (markComplete?: boolean) => void;
  onCreateEvent: () => void;
  onGoSettings: () => void;
  onGoScanner: () => void;
  onGoCamera: () => void;
}

interface GuideStep {
  id: string;
  badge: string;
  title: string;
  summary: string;
  highlights: string[];
  actionLabel: string;
  icon: React.FC<{ className?: string }>;
  onAction: () => void;
}

export const OnboardingWalkthroughModal: React.FC<OnboardingWalkthroughModalProps> = ({
  open,
  userName,
  hasEvents,
  onClose,
  onCreateEvent,
  onGoSettings,
  onGoScanner,
  onGoCamera,
}) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setStepIndex(0);
    }
  }, [open]);

  const firstName = userName?.trim().split(/\s+/)[0] || 'Organiser';

  const steps: GuideStep[] = [
    {
      id: 'sender-id',
      badge: 'Step 1 of 5 · Studio Setup',
      title: `Welcome, ${firstName} — Configure Your Brand & SMS Sender ID`,
      summary:
        'Start in Settings to set your organisation name, support reply-to email, and custom Arkesel SMS Sender ID (up to 11 alphanumeric characters) used on every ticket pass and check-in alert.',
      highlights: [
        'Set a custom Arkesel Sender ID (e.g. MYEVENT26) for Ghana & West Africa carriers.',
        'Monitor your live SMS credit wallet and dispatch a real carrier test SMS.',
        'Customize capacity alert thresholds before gates open.',
      ],
      actionLabel: 'Open Sender ID & Settings',
      icon: Radio,
      onAction: () => {
        onClose(true);
        onGoSettings();
      },
    },
    {
      id: 'create-event',
      badge: 'Step 2 of 5 · Productions',
      title: 'Create & Publish Your First Event Page',
      summary:
        'Use the 4-step Create Event Wizard to configure venue, date, seating capacity, run-of-show blocks, custom RSVP questions, and upload your event flyer—which also drives your Overview header banner.',
      highlights: [
        'Generates a live public link (/e/your-event-slug) for guest RSVPs.',
        'Supports custom registration confirmation & arrival check-in SMS templates.',
        'Every attendee automatically receives an email + SMS digital QR pass.',
      ],
      actionLabel: hasEvents ? 'Create Another Event' : 'Create First Event',
      icon: Plus,
      onAction: () => {
        onClose(true);
        onCreateEvent();
      },
    },
    {
      id: 'gift-table',
      badge: 'Step 3 of 5 · Standalone Gift Table',
      title: 'Dedicated Gift Table & Appointed Attendant Links',
      summary:
        'Open Gift Table directly from the Nav Bar or Hero Quick Actions—completely separate from Walk-In registration, attendee rosters, and gate check-in seats.',
      highlights: [
        'Create unique Gift Desk links (/e/slug/gifts?desk=...) for people manning the physical Gift Table or receiving MoMo gifts without sharing studio login access.',
        'Guests can also send MoMo/cash pledges, registry gifts, and well-wishes directly on /e/slug/gifts.',
        'Track which attendant recorded each gift and export Gift Table CSV ledgers separately from attendee manifests.',
      ],
      actionLabel: 'Continue Walkthrough',
      icon: Gift,
      onAction: () => setStepIndex((prev) => Math.min(4, prev + 1)),
    },
    {
      id: 'qr-gate',
      badge: 'Step 4 of 5 · Gate Operations',
      title: 'Scan Passes at the Gate & Trigger Check-In SMS',
      summary:
        'Admit registered guests via live QR Gate Scanner or handle Walk-In arrivals on-site. Duplicate scans are automatically blocked, and admitted guests immediately receive their check-in SMS.',
      highlights: [
        'Camera QR verification with instant duplicate-entry protection.',
        'Dedicated Walk-In registration desk inside the scanner and Event Workspace.',
        'Check-in SMS automatically appends the guest’s personal Disposable Camera access link.',
      ],
      actionLabel: 'Open QR Gate Scanner',
      icon: QrCode,
      onAction: () => {
        onClose(true);
        onGoScanner();
      },
    },
    {
      id: 'disposable-camera',
      badge: 'Step 5 of 5 · 35mm Disposable Camera',
      title: '5-Shot Disposable Camera, Collages & High-Res ZIP',
      summary:
        'Every checked-in attendee unlocks up to 5 analog film captures via their SMS check-in link—allowing them to combine shots into a printable Collage or download all 5 high-resolution photos as a single .zip file.',
      highlights: [
        'Three film stocks: Fuji C200, Kodak Gold 200, and Ilford HP5 monochrome.',
        'Built-in darkroom collage builder turning guest frames into shareable keepsakes.',
        'One-click high-resolution .zip bundle download of each guest’s 5 captured frames.',
      ],
      actionLabel: 'Preview Disposable Camera',
      icon: Camera,
      onAction: () => {
        onClose(true);
        onGoCamera();
      },
    },
  ];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(true);
      } else if (e.key === 'ArrowRight') {
        setStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setStepIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, steps.length]);

  if (!open) return null;

  const active = steps[stepIndex] ?? steps[0];
  const StepIcon = active.icon;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-guide-title"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl rounded-[28px] bg-white border border-[#E5E5EA] shadow-2xl overflow-hidden">
        {/* Top bar */}
        <div className="px-6 pt-5 pb-4 border-b border-[#E5E5EA] flex items-center justify-between gap-3 bg-[#F5F5F7]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#71717A]">
                Quick Start Walkthrough
              </p>
              <p className="text-xs font-semibold text-[#0B0B0B] truncate">{active.badge}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose(true)}
            aria-label="Close quick guide"
            className="w-8 h-8 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive step selector */}
        <div className="px-6 pt-4 flex items-center gap-1.5 overflow-x-auto">
          {steps.map((step, idx) => {
            const isCurrent = idx === stepIndex;
            const isDone = idx < stepIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(idx)}
                className={`flex-1 min-w-[44px] py-2 px-2.5 rounded-xl text-[11px] font-semibold border transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  isCurrent
                    ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                    : isDone
                      ? 'bg-[#F5F5F7] text-[#0B0B0B] border-[#E5E5EA]'
                      : 'bg-white text-[#71717A] border-[#E5E5EA] hover:text-[#0B0B0B]'
                }`}
              >
                {isDone ? (
                  <Check className="w-3 h-3 shrink-0" />
                ) : (
                  <span className="font-mono">{idx + 1}</span>
                )}
                <span className="hidden sm:inline">
                  {idx === 0
                    ? 'Sender ID'
                    : idx === 1
                      ? 'Create'
                      : idx === 2
                        ? 'Gift Table'
                        : idx === 3
                          ? 'Gate QR'
                          : 'Camera'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Step Body */}
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] flex items-center justify-center shrink-0">
              <StepIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="onboarding-guide-title"
                className="font-display text-xl sm:text-2xl font-bold tracking-[-0.02em] text-[#0B0B0B] leading-snug"
              >
                {active.title}
              </h2>
              <p className="text-sm text-[#52525B] leading-relaxed mt-2">{active.summary}</p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] p-4 space-y-2.5">
            {active.highlights.map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-xs text-[#0B0B0B]">
                <span className="w-5 h-5 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3" />
                </span>
                <span className="leading-relaxed">{item}</span>
              </div>
            ))}
          </div>

          {/* Action bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#E5E5EA]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onClose(true)}
                className="px-3.5 py-2 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
              >
                Skip Guide
              </button>
              {active.id !== 'gift-table' && (
                <button
                  type="button"
                  onClick={active.onAction}
                  className="px-4 py-2 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] transition-colors"
                >
                  {active.actionLabel}
                </button>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                className="px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] disabled:opacity-40 text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              {isLast ? (
                <button
                  type="button"
                  onClick={() => onClose(true)}
                  className="px-5 py-2 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Finish &amp; Enter Studio</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
                  className="px-5 py-2 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
