import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  CheckCircle2,
  Download,
  Lock,
  Maximize2,
  Minimize2,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import type { EventItem, EventPoll } from '../types/events';
import { api } from '../lib/api';
import {
  buildEventInvitationUrl,
  DeterministicQrSvg,
  downloadQrSvg,
} from '../lib/qr';
import { getContrastTextColor, normalizeHexColor } from '../lib/themeColors';

interface PublicPollsViewProps {
  event: EventItem;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onPollEventSync?: (updatedEvent: EventItem) => void;
  onOpenCheckin?: () => void;
}

const VOTER_ID_KEY = 'eventsapp_poll_voter_id_v1';
const VOTED_CHOICES_KEY = 'eventsapp_poll_voted_choices_v1';

function getOrCreateVoterKey(): string {
  try {
    const existing = localStorage.getItem(VOTER_ID_KEY);
    if (existing && existing.length >= 8) return existing;
    const generated = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VOTER_ID_KEY, generated);
    return generated;
  } catch {
    return `v_${Date.now().toString(36)}`;
  }
}

function loadLocalVotedMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(VOTED_CHOICES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalVote(pollId: string, optionIds: string[]) {
  try {
    const prev = loadLocalVotedMap();
    localStorage.setItem(VOTED_CHOICES_KEY, JSON.stringify({ ...prev, [pollId]: optionIds }));
  } catch {
    // Ignore storage quota issues
  }
}

export const PublicPollsView: React.FC<PublicPollsViewProps> = ({
  event,
  isFullscreen = false,
  onToggleFullscreen,
  onPollEventSync,
  onOpenCheckin,
}) => {
  const [polls, setPolls] = useState<EventPoll[]>(() =>
    Array.isArray(event.extraDataConfig?.polls)
      ? event.extraDataConfig!.polls!.filter((p) => p.status !== 'draft')
      : []
  );
  const [selectedByPoll, setSelectedByPoll] = useState<Record<string, string[]>>({});
  const [votedMap, setVotedMap] = useState<Record<string, string[]>>(() => loadLocalVotedMap());
  const [passCodeInput, setPassCodeInput] = useState('');
  const [submittingPollId, setSubmittingPollId] = useState<string | null>(null);
  const [errorByPoll, setErrorByPoll] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const pollsUrl = buildEventInvitationUrl(event.slug || event.id, 'polls');
  const customBrand = normalizeHexColor(event.brandColor || event.extraDataConfig?.brandColor);
  const customBrandText = customBrand ? getContrastTextColor(customBrand) : undefined;
  const voterKey = useMemo(() => getOrCreateVoterKey(), []);

  useEffect(() => {
    setPolls(
      Array.isArray(event.extraDataConfig?.polls)
        ? event.extraDataConfig!.polls!.filter((p) => p.status !== 'draft')
        : []
    );
  }, [event.id, event.extraDataConfig?.polls]);

  const fetchLatestPolls = useCallback(
    async (silent = true) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await api.public.getEventPolls(event.slug || event.id);
        setPolls(Array.isArray(res.polls) ? res.polls : []);
        if (res.event) {
          onPollEventSync?.(res.event);
        }
      } catch {
        // Keep current polls state silently on background refresh failure
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [event.id, event.slug, onPollEventSync]
  );

  useEffect(() => {
    void fetchLatestPolls(true);
    const interval = window.setInterval(() => {
      void fetchLatestPolls(true);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchLatestPolls]);

  const requiresVerifiedPass = polls.some(
    (p) => p.status === 'active' && Boolean(p.requireVerifiedPass)
  );

  const totalVotesAll = useMemo(
    () => polls.reduce((sum, p) => sum + (Number(p.totalVotes) || 0), 0),
    [polls]
  );
  const activeCount = useMemo(
    () => polls.filter((p) => p.status === 'active').length,
    [polls]
  );

  const handleToggleOption = (poll: EventPoll, optionId: string) => {
    if (poll.status !== 'active' || votedMap[poll.id]) return;
    setErrorByPoll((prev) => {
      if (!prev[poll.id]) return prev;
      const next = { ...prev };
      delete next[poll.id];
      return next;
    });
    setSelectedByPoll((prev) => {
      const current = prev[poll.id] ?? [];
      if (!poll.allowMultiple) {
        return { ...prev, [poll.id]: [optionId] };
      }
      const exists = current.includes(optionId);
      return {
        ...prev,
        [poll.id]: exists ? current.filter((id) => id !== optionId) : [...current, optionId],
      };
    });
  };

  const handleSubmitVote = async (poll: EventPoll) => {
    const chosen = selectedByPoll[poll.id] ?? [];
    if (chosen.length === 0) {
      setErrorByPoll((prev) => ({
        ...prev,
        [poll.id]: 'Select an option before submitting your vote.',
      }));
      return;
    }
    if (poll.requireVerifiedPass && !passCodeInput.trim()) {
      setErrorByPoll((prev) => ({
        ...prev,
        [poll.id]: 'Enter your registered Event Pass Code, email, or phone number above.',
      }));
      return;
    }

    setSubmittingPollId(poll.id);
    setErrorByPoll((prev) => {
      const next = { ...prev };
      delete next[poll.id];
      return next;
    });

    try {
      const res = await api.public.votePoll(event.slug || event.id, poll.id, {
        optionIds: chosen,
        voterKey,
        passCode: poll.requireVerifiedPass ? passCodeInput.trim() : undefined,
      });
      saveLocalVote(poll.id, chosen);
      setVotedMap((prev) => ({ ...prev, [poll.id]: chosen }));
      setPolls((prev) => prev.map((p) => (p.id === poll.id ? res.poll : p)));
      if (res.event) onPollEventSync?.(res.event);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to submit vote.';
      if (message.toLowerCase().includes('already been recorded')) {
        saveLocalVote(poll.id, chosen);
        setVotedMap((prev) => ({ ...prev, [poll.id]: chosen }));
      }
      setErrorByPoll((prev) => ({ ...prev, [poll.id]: message }));
    } finally {
      setSubmittingPollId(null);
    }
  };

  const handleSharePollsLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pollsUrl);
      }
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="space-y-5">
      {/* Stage Header Card */}
      <section className="bg-[#0B0B0B] text-white rounded-[32px] p-5 sm:p-7 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-zinc-400">
              <span>{event.category}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{activeCount} Live</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{totalVotesAll.toLocaleString()} Votes Cast</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
              {event.extraDataConfig?.pollsTitle || `${event.title} — Live Polls`}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-300">
              {event.title} · {event.date} · {event.venue}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchLatestPolls(false)}
              disabled={refreshing}
              className="h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Sync Votes</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSharePollsLink()}
              className="h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Link Copied' : 'Share Polls'}</span>
            </button>
            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="h-9 px-4 rounded-full bg-white text-[#0B0B0B] hover:bg-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Exit Stage Mode</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Stage Projector Mode</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Main Content Grid: Left Polls + Right Scan-to-Vote QR Stage Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 space-y-4">
          {requiresVerifiedPass && (
            <section className="bg-white rounded-[24px] p-4 sm:p-5 border border-[#E5E5EA] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#0B0B0B] shrink-0" />
                  <span className="text-xs font-bold text-[#0B0B0B]">
                    Accredited Delegate Verification
                  </span>
                </div>
                {onOpenCheckin && (
                  <button
                    type="button"
                    onClick={onOpenCheckin}
                    className="text-[11px] font-semibold text-[#0B0B0B] underline shrink-0"
                  >
                    Need a QR pass?
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#71717A]">
                One or more governance polls require a registered attendee pass. Enter your ticket code (e.g. #EVT-2026-...), email, or mobile number once below.
              </p>
              <input
                type="text"
                value={passCodeInput}
                onChange={(e) => setPassCodeInput(e.target.value)}
                placeholder="Enter Pass Code (#...), registered email, or +233..."
                className="w-full h-11 px-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
              />
            </section>
          )}

          {polls.length === 0 ? (
            <section className="bg-white rounded-[28px] p-8 sm:p-10 border border-[#E5E5EA] text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#F5F5F7] text-[#0B0B0B] flex items-center justify-center mx-auto">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-[#0B0B0B]">
                No Live Polls Active Right Now
              </h2>
              <p className="text-xs sm:text-sm text-[#71717A] max-w-md mx-auto leading-relaxed">
                This screen updates automatically every few seconds as soon as the host launches a corporate poll, panel Q&amp;A vote, or AGM motion.
              </p>
            </section>
          ) : (
            polls.map((poll) => {
              const total = Math.max(0, Number(poll.totalVotes) || 0);
              const alreadyVotedChoices = votedMap[poll.id];
              const hasVoted = Boolean(alreadyVotedChoices && alreadyVotedChoices.length > 0);
              const selectedChoices = hasVoted
                ? alreadyVotedChoices!
                : selectedByPoll[poll.id] ?? [];
              const showPercentages =
                poll.status === 'closed' || poll.showResultsToPublic !== false;
              const isSubmitting = submittingPollId === poll.id;
              const pollErr = errorByPoll[poll.id];

              return (
                <section
                  key={poll.id}
                  className="bg-white rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className={`font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                            poll.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-[#F5F5F7] text-[#71717A] border border-[#E5E5EA]'
                          }`}
                        >
                          {poll.status === 'active' ? 'Open for Voting' : 'Closed · Final Results'}
                        </span>
                        {poll.sessionLabel && (
                          <span className="font-medium text-[#71717A]">{poll.sessionLabel}</span>
                        )}
                        {poll.requireVerifiedPass && (
                          <span className="inline-flex items-center gap-1 font-medium text-[#0B0B0B]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Verified Pass
                          </span>
                        )}
                        {poll.allowMultiple && (
                          <span className="text-[#71717A]">Multi-select</span>
                        )}
                      </div>
                      <h2 className="text-lg sm:text-xl font-bold text-[#0B0B0B] tracking-tight">
                        {poll.question}
                      </h2>
                      {poll.description && (
                        <p className="text-xs text-[#71717A] leading-relaxed">{poll.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-base font-bold text-[#0B0B0B] tabular-nums block">
                        {total.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-[#71717A]">votes</span>
                    </div>
                  </div>

                  {/* Voting Options */}
                  <div className="space-y-2.5">
                    {poll.options.map((opt) => {
                      const votes = Math.max(0, Number(opt.votes) || 0);
                      const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                      const isSelected = selectedChoices.includes(opt.id);
                      const canClick = poll.status === 'active' && !hasVoted && !isSubmitting;

                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={!canClick}
                          onClick={() => handleToggleOption(poll, opt.id)}
                          className={`w-full min-h-[48px] relative overflow-hidden rounded-2xl border text-left transition-all px-4 py-3 flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'border-[#0B0B0B] bg-[#F5F5F7]'
                              : 'border-[#E5E5EA] bg-white hover:border-[#0B0B0B]/50'
                          } ${!canClick ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          {showPercentages && (
                            <div
                              className="absolute inset-y-0 left-0 bg-[#0B0B0B]/[0.06] transition-all duration-500 pointer-events-none"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: customBrand
                                  ? `${customBrand}1F`
                                  : undefined,
                              }}
                            />
                          )}
                          <div className="relative z-10 flex items-center gap-3 min-w-0">
                            <span
                              className={`w-5 h-5 ${
                                poll.allowMultiple ? 'rounded-md' : 'rounded-full'
                              } border flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-[#0B0B0B] border-[#0B0B0B] text-white'
                                  : 'border-[#C7C7CC] bg-white'
                              }`}
                              style={
                                isSelected && customBrand
                                  ? {
                                      backgroundColor: customBrand,
                                      borderColor: customBrand,
                                      color: customBrandText,
                                    }
                                  : undefined
                              }
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </span>
                            <span className="text-sm font-semibold text-[#0B0B0B]">
                              {opt.label}
                            </span>
                          </div>
                          {showPercentages && (
                            <div className="relative z-10 flex items-center gap-2 shrink-0 tabular-nums">
                              <span className="text-xs text-[#71717A]">
                                {votes.toLocaleString()}
                              </span>
                              <span className="text-xs font-bold text-[#0B0B0B] min-w-[36px] text-right">
                                {pct}%
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {pollErr && (
                    <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                      {pollErr}
                    </div>
                  )}

                  {/* Submit / Status Footer */}
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                    {hasVoted ? (
                      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Vote recorded
                          {!showPercentages && poll.status === 'active'
                            ? ' — results reveal when poll closes'
                            : ''}
                        </span>
                      </div>
                    ) : poll.status !== 'active' ? (
                      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#71717A]">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Voting has closed for this resolution.</span>
                      </div>
                    ) : (
                      <>
                        <span className="text-[11px] text-[#71717A]">
                          {poll.showResultsToPublic === false
                            ? 'Sealed ballot — tally reveals once closed'
                            : 'Results update live across all devices'}
                        </span>
                        <button
                          type="button"
                          disabled={isSubmitting || selectedChoices.length === 0}
                          onClick={() => void handleSubmitVote(poll)}
                          className="h-10 px-5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-bold transition-colors disabled:opacity-45"
                          style={
                            customBrand
                              ? { backgroundColor: customBrand, color: customBrandText }
                              : undefined
                          }
                        >
                          {isSubmitting ? 'Submitting Vote...' : 'Cast Vote'}
                        </button>
                      </>
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* Right Side Stage Scan-to-Vote QR Card */}
        <aside className="lg:col-span-4 bg-white rounded-[28px] p-5 sm:p-6 border border-[#E5E5EA] flex flex-col items-center text-center gap-4">
          <div className="w-full flex items-center justify-between">
            <span className="text-xs font-bold text-[#0B0B0B] inline-flex items-center gap-1.5">
              <QrCode className="w-4 h-4" />
              Scan to Join Live Polls
            </span>
            <span className="text-[11px] font-mono text-[#71717A]">/polls</span>
          </div>
          <div className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-center">
            <DeterministicQrSvg
              value={pollsUrl}
              size={isFullscreen ? 240 : 196}
              label={`Live Polls QR for ${event.title}`}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#0B0B0B]">
              Project on Auditorium Screens
            </p>
            <p className="text-[11px] text-[#71717A] leading-relaxed">
              Delegates scan with their phone camera to cast live votes during keynotes, townhalls &amp; board motions.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 w-full">
            <button
              type="button"
              onClick={() => void handleSharePollsLink()}
              className="h-9 px-3 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B]"
            >
              {copiedLink ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={() => downloadQrSvg(pollsUrl, `${event.slug}-polls-qr.svg`)}
              className="h-9 px-3 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save QR</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
