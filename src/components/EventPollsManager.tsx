import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { EventItem, EventPoll, EventPollStatus } from '../types/events';
import { CORPORATE_POLL_TEMPLATES, isPollsEnabledForEvent } from '../lib/polls';
import { buildEventInvitationUrl } from '../lib/qr';

interface EventPollsManagerProps {
  event: EventItem;
  totalRegistered: number;
  canManage: boolean;
  onTogglePollsEnabled?: (enabled: boolean) => Promise<void> | void;
  onCreatePoll?: (
    eventId: string,
    payload: {
      question: string;
      description?: string;
      sessionLabel?: string;
      options: string[];
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => Promise<EventPoll | void>;
  onUpdatePoll?: (
    eventId: string,
    pollId: string,
    patch: {
      question?: string;
      description?: string;
      sessionLabel?: string;
      status?: EventPollStatus;
      allowMultiple?: boolean;
      showResultsToPublic?: boolean;
      requireVerifiedPass?: boolean;
    }
  ) => Promise<EventPoll | void>;
  onDeletePoll?: (eventId: string, pollId: string) => Promise<void>;
  onOpenPublicPolls?: () => void;
  onToast?: (message: string) => void;
}

export const EventPollsManager: React.FC<EventPollsManagerProps> = ({
  event,
  totalRegistered,
  canManage,
  onTogglePollsEnabled,
  onCreatePoll,
  onUpdatePoll,
  onDeletePoll,
  onOpenPublicPolls,
  onToast,
}) => {
  const pollsEnabled = isPollsEnabledForEvent(event);
  const polls = useMemo(
    () => (Array.isArray(event.extraDataConfig?.polls) ? event.extraDataConfig!.polls! : []),
    [event.extraDataConfig?.polls]
  );

  const [question, setQuestion] = useState('');
  const [sessionLabel, setSessionLabel] = useState('');
  const [description, setDescription] = useState('');
  const [optionInputs, setOptionInputs] = useState<string[]>(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [showResultsToPublic, setShowResultsToPublic] = useState(true);
  const [requireVerifiedPass, setRequireVerifiedPass] = useState(false);
  const [initialStatus, setInitialStatus] = useState<'active' | 'draft'>('active');
  const [creating, setCreating] = useState(false);
  const [busyPollId, setBusyPollId] = useState<string | null>(null);
  const [togglingFeature, setTogglingFeature] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const pollsUrl = buildEventInvitationUrl(event.slug || event.id, 'polls');

  const stats = useMemo(() => {
    const activeCount = polls.filter((p) => p.status === 'active').length;
    const totalVotes = polls.reduce((sum, p) => sum + (Number(p.totalVotes) || 0), 0);
    const highestPollVotes = polls.reduce(
      (max, p) => Math.max(max, Number(p.totalVotes) || 0),
      0
    );
    const engagementPct =
      totalRegistered > 0 ? Math.min(100, Math.round((highestPollVotes / totalRegistered) * 100)) : 0;
    return { activeCount, totalVotes, engagementPct };
  }, [polls, totalRegistered]);

  const applyTemplate = (templateId: string) => {
    const tpl = CORPORATE_POLL_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setQuestion(tpl.question);
    setSessionLabel(tpl.sessionLabel);
    setDescription(tpl.description);
    setOptionInputs([...tpl.options]);
    setAllowMultiple(tpl.allowMultiple);
    setShowResultsToPublic(tpl.showResultsToPublic);
    setRequireVerifiedPass(tpl.requireVerifiedPass);
    setFormError(null);
  };

  const handleCopyPollsUrl = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(pollsUrl).catch(() => {});
    }
    setCopiedUrl(true);
    onToast?.('Live Polls link copied');
    window.setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleExportPollsCsv = () => {
    if (polls.length === 0) return;
    const rows = [
      ['Poll ID', 'Session', 'Question', 'Status', 'Option', 'Votes', 'Share (%)', 'Total Poll Votes'].join(','),
    ];
    for (const poll of polls) {
      const total = Math.max(0, Number(poll.totalVotes) || 0);
      for (const opt of poll.options) {
        const votes = Math.max(0, Number(opt.votes) || 0);
        const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
        const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
        rows.push(
          [
            escape(poll.id),
            escape(poll.sessionLabel || ''),
            escape(poll.question),
            escape(poll.status),
            escape(opt.label),
            String(votes),
            `${pct}%`,
            String(total),
          ].join(',')
        );
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.slug}-polls-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast?.('Poll results CSV downloaded');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreatePoll || creating) return;
    const cleanQuestion = question.trim();
    const cleanedOptions = optionInputs.map((o) => o.trim()).filter(Boolean);
    if (!cleanQuestion) {
      setFormError('Enter the corporate poll question or resolution.');
      return;
    }
    if (cleanedOptions.length < 2) {
      setFormError('Add at least two distinct voting options.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await onCreatePoll(event.id, {
        question: cleanQuestion,
        description: description.trim() || undefined,
        sessionLabel: sessionLabel.trim() || undefined,
        options: cleanedOptions,
        status: initialStatus,
        allowMultiple,
        showResultsToPublic,
        requireVerifiedPass,
      });
      setQuestion('');
      setSessionLabel('');
      setDescription('');
      setOptionInputs(['', '']);
      setAllowMultiple(false);
      setShowResultsToPublic(true);
      setRequireVerifiedPass(false);
      onToast?.(
        initialStatus === 'active'
          ? 'Live corporate poll published to /e/' + event.slug + '/polls'
          : 'Poll saved as draft'
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create poll.');
    } finally {
      setCreating(false);
    }
  };

  const handlePollUpdate = async (
    pollId: string,
    patch: Parameters<NonNullable<EventPollsManagerProps['onUpdatePoll']>>[2],
    toastText: string
  ) => {
    if (!onUpdatePoll) return;
    setBusyPollId(pollId);
    try {
      await onUpdatePoll(event.id, pollId, patch);
      onToast?.(toastText);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Unable to update poll.');
    } finally {
      setBusyPollId(null);
    }
  };

  const handlePollDelete = async (pollId: string) => {
    if (!onDeletePoll) return;
    setBusyPollId(pollId);
    try {
      await onDeletePoll(event.id, pollId);
      onToast?.('Poll removed');
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Unable to delete poll.');
    } finally {
      setBusyPollId(null);
    }
  };

  return (
    <section className="bg-[#F5F5F7] rounded-[28px] p-6 sm:p-8 space-y-6">
      {/* Header & Stage Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#0B0B0B]" />
            <h2 className="font-display text-[22px] font-bold text-[#0B0B0B] tracking-[-0.02em]">
              Corporate Polls &amp; Audience Voting
            </h2>
          </div>
          <p className="text-xs text-[#71717A] mt-1">
            Run board resolutions, executive keynotes, Q&amp;A prioritization &amp; live attendee votes at{' '}
            <span className="font-mono text-[#0B0B0B]">/e/{event.slug}/polls</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && onTogglePollsEnabled && (
            <button
              type="button"
              disabled={togglingFeature}
              onClick={async () => {
                setTogglingFeature(true);
                try {
                  await Promise.resolve(onTogglePollsEnabled(!pollsEnabled));
                  onToast?.(
                    !pollsEnabled
                      ? 'Live Polls tab enabled on public event page'
                      : 'Live Polls tab hidden from public navigation'
                  );
                } finally {
                  setTogglingFeature(false);
                }
              }}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                pollsEnabled
                  ? 'bg-white border-[#E5E5EA] text-[#0B0B0B] hover:border-[#0B0B0B]'
                  : 'bg-[#0B0B0B] border-[#0B0B0B] text-white'
              }`}
            >
              {pollsEnabled ? 'Polls Tab Enabled' : 'Enable Polls Tab'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyPollsUrl}
            className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedUrl ? 'Copied' : 'Copy Polls URL'}</span>
          </button>
          {polls.length > 0 && (
            <button
              type="button"
              onClick={handleExportPollsCsv}
              className="px-3.5 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Results CSV</span>
            </button>
          )}
          {onOpenPublicPolls && (
            <button
              type="button"
              onClick={onOpenPublicPolls}
              className="px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Live Stage Polls</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]">
          <span className="text-[11px] text-[#71717A] block">Configured Polls</span>
          <span className="text-xl font-bold text-[#0B0B0B] tabular-nums">{polls.length}</span>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]">
          <span className="text-[11px] text-[#71717A] block">Live Voting Now</span>
          <span className="text-xl font-bold text-[#0B0B0B] tabular-nums">{stats.activeCount}</span>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]">
          <span className="text-[11px] text-[#71717A] block">Total Votes Cast</span>
          <span className="text-xl font-bold text-[#0B0B0B] tabular-nums">
            {stats.totalVotes.toLocaleString()}
          </span>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]">
          <span className="text-[11px] text-[#71717A] block">Peak Turnout Rate</span>
          <span className="text-xl font-bold text-[#0B0B0B] tabular-nums">
            {stats.engagementPct}%
          </span>
        </div>
      </div>

      {/* Poll Builder */}
      {canManage && onCreatePoll && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-5 sm:p-6 rounded-2xl bg-white border border-[#E5E5EA] space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#0B0B0B]">Create Corporate Poll or Motion</h3>
              <p className="text-[11px] text-[#71717A]">
                Start from an executive template or write a custom question below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {CORPORATE_POLL_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.id)}
                  className="px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{tpl.name}</span>
                </button>
              ))}
            </div>
          </div>

          {formError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                Poll Question / Resolution *
              </label>
              <input
                type="text"
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Which strategic initiative should take priority in H1?"
                className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-medium text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                Session / Track Label
              </label>
              <input
                type="text"
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                placeholder="e.g. Opening Keynote / AGM"
                className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
              Context / Moderator Prompt (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief guidance for delegates before casting their vote"
              className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-[#0B0B0B]">
                Answer Choices ({optionInputs.length}/10)
              </label>
              {optionInputs.length < 10 && (
                <button
                  type="button"
                  onClick={() => setOptionInputs((prev) => [...prev, ''])}
                  className="text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Option
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {optionInputs.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="w-6 text-center text-[11px] font-mono text-[#71717A] tabular-nums">
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) =>
                      setOptionInputs((prev) =>
                        prev.map((item, i) => (i === idx ? e.target.value : item))
                      )
                    }
                    placeholder={`Option ${idx + 1}`}
                    className="flex-1 h-9 px-3 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                  {optionInputs.length > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        setOptionInputs((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label={`Remove option ${idx + 1}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[#71717A] hover:text-[#EF4444] hover:bg-[#F5F5F7]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] cursor-pointer">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="w-4 h-4 accent-[#0B0B0B]"
              />
              <span>Allow multi-select votes</span>
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] cursor-pointer">
              <input
                type="checkbox"
                checked={showResultsToPublic}
                onChange={(e) => setShowResultsToPublic(e.target.checked)}
                className="w-4 h-4 accent-[#0B0B0B]"
              />
              <span>Show live percentages</span>
            </label>
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] cursor-pointer">
              <input
                type="checkbox"
                checked={requireVerifiedPass}
                onChange={(e) => setRequireVerifiedPass(e.target.checked)}
                className="w-4 h-4 accent-[#0B0B0B]"
              />
              <span>Verified delegates only</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="inline-flex items-center p-1 rounded-full bg-[#F5F5F7] border border-[#E5E5EA]">
              <button
                type="button"
                onClick={() => setInitialStatus('active')}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  initialStatus === 'active'
                    ? 'bg-[#0B0B0B] text-white'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Launch Live Immediately
              </button>
              <button
                type="button"
                onClick={() => setInitialStatus('draft')}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  initialStatus === 'draft'
                    ? 'bg-[#0B0B0B] text-white'
                    : 'text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Save as Draft
              </button>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-neutral-800 text-white text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {creating
                ? 'Saving Poll...'
                : initialStatus === 'active'
                  ? 'Launch Live Poll'
                  : 'Save Draft Poll'}
            </button>
          </div>
        </form>
      )}

      {/* Existing Polls List */}
      <div className="space-y-3">
        {polls.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white border border-[#E5E5EA] text-center space-y-2">
            <BarChart3 className="w-6 h-6 text-[#71717A] mx-auto" />
            <p className="text-sm font-semibold text-[#0B0B0B]">
              No polls configured for this event yet
            </p>
            <p className="text-xs text-[#71717A] max-w-md mx-auto">
              Use the builder above or pick a corporate template to launch instant audience voting, panel Q&amp;A topics, or verified AGM resolutions.
            </p>
          </div>
        ) : (
          polls.map((poll) => {
            const total = Math.max(0, Number(poll.totalVotes) || 0);
            const isBusy = busyPollId === poll.id;
            return (
              <div
                key={poll.id}
                className="p-5 sm:p-6 rounded-2xl bg-white border border-[#E5E5EA] space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className={`font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                          poll.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : poll.status === 'closed'
                              ? 'bg-[#F5F5F7] text-[#71717A] border border-[#E5E5EA]'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {poll.status === 'active'
                          ? 'Live Voting'
                          : poll.status === 'closed'
                            ? 'Closed'
                            : 'Draft'}
                      </span>
                      {poll.sessionLabel && (
                        <span className="font-medium text-[#71717A]">{poll.sessionLabel}</span>
                      )}
                      {poll.requireVerifiedPass && (
                        <span className="inline-flex items-center gap-1 text-[#0B0B0B] font-medium">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Accredited Pass Only
                        </span>
                      )}
                      {poll.allowMultiple && (
                        <span className="text-[#71717A]">Multi-select</span>
                      )}
                      {poll.showResultsToPublic === false && poll.status !== 'closed' && (
                        <span className="inline-flex items-center gap-1 text-[#71717A]">
                          <Lock className="w-3 h-3" />
                          Results hidden until closed
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-[#0B0B0B]">{poll.question}</h3>
                    {poll.description && (
                      <p className="text-xs text-[#71717A]">{poll.description}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <span className="text-lg font-bold text-[#0B0B0B] tabular-nums block">
                      {total.toLocaleString()}
                    </span>
                    <span className="text-[11px] text-[#71717A]">Total votes</span>
                  </div>
                </div>

                {/* Real-Time Result Bars */}
                <div className="space-y-2">
                  {poll.options.map((opt) => {
                    const votes = Math.max(0, Number(opt.votes) || 0);
                    const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                    return (
                      <div key={opt.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[#0B0B0B]">{opt.label}</span>
                          <span className="font-mono font-semibold text-[#0B0B0B] tabular-nums shrink-0 ml-3">
                            {votes.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-[#F5F5F7] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#0B0B0B] transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Governance Actions */}
                {canManage && onUpdatePoll && (
                  <div className="pt-3 border-t border-[#E5E5EA] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {poll.status !== 'active' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handlePollUpdate(
                              poll.id,
                              { status: 'active' },
                              'Poll launched live'
                            )
                          }
                          className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-800 disabled:opacity-50"
                        >
                          <PlayCircle className="w-3.5 h-3.5" />
                          <span>{poll.status === 'closed' ? 'Reopen Voting' : 'Launch Live'}</span>
                        </button>
                      )}
                      {poll.status === 'active' && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handlePollUpdate(
                                poll.id,
                                { status: 'closed' },
                                'Poll closed & final results locked'
                              )
                            }
                            className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-800 disabled:opacity-50"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Close &amp; Reveal</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handlePollUpdate(
                                poll.id,
                                { status: 'draft' },
                                'Poll paused to draft'
                              )
                            }
                            className="px-3.5 py-1.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#E8E8EA] disabled:opacity-50"
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handlePollUpdate(
                            poll.id,
                            { showResultsToPublic: poll.showResultsToPublic === false },
                            poll.showResultsToPublic === false
                              ? 'Live results now visible to audience'
                              : 'Results sealed until poll closes'
                          )
                        }
                        className="px-3.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {poll.showResultsToPublic === false ? (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Reveal Live Tally</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Seal Until Close</span>
                          </>
                        )}
                      </button>
                    </div>

                    {onDeletePoll && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handlePollDelete(poll.id)}
                        className="px-3 py-1.5 rounded-full text-[11px] font-semibold text-[#71717A] hover:text-[#EF4444] hover:bg-[#F5F5F7] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
