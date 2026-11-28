import type {
  EventExtraDataConfig,
  EventItem,
  EventPoll,
  EventPollOption,
  EventPollStatus,
} from '../types/events.ts';
import { sanitizeEventLogoUrl, sanitizeProgramOutline } from './programOutline.ts';

export interface CorporatePollTemplate {
  id: string;
  name: string;
  sessionLabel: string;
  question: string;
  description: string;
  options: string[];
  allowMultiple: boolean;
  showResultsToPublic: boolean;
  requireVerifiedPass: boolean;
}

export const CORPORATE_POLL_TEMPLATES: CorporatePollTemplate[] = [
  {
    id: 'keynote-priority',
    name: 'Strategic Priority',
    sessionLabel: 'Keynote Session',
    question: 'Which strategic initiative should take top priority for H1 2027?',
    description: 'Live executive pulse check across attending delegates.',
    options: [
      'Regional Market Expansion',
      'Operational & Margin Efficiency',
      'Digital Infrastructure & AI Automation',
      'Enterprise Customer Retention',
    ],
    allowMultiple: false,
    showResultsToPublic: true,
    requireVerifiedPass: false,
  },
  {
    id: 'agm-resolution',
    name: 'AGM / Board Resolution',
    sessionLabel: 'Governance Vote',
    question: 'Do you approve Motion 2026-04 on the FY capital allocation framework?',
    description: 'Verified delegate pass required; final tally displays upon close.',
    options: ['Approve Motion', 'Against Motion', 'Abstain'],
    allowMultiple: false,
    showResultsToPublic: false,
    requireVerifiedPass: true,
  },
  {
    id: 'qa-topic',
    name: 'Panel Q&A Focus',
    sessionLabel: 'Executive Panel',
    question: 'Which topics should our panelists address first during Q&A?',
    description: 'Select up to multiple topics you want covered live.',
    options: [
      'Regulatory & Compliance Outlook',
      'Cross-Border Treasury & FX Strategy',
      'Talent & Leadership Scaling',
      '2027 Capital Markets Forecast',
    ],
    allowMultiple: true,
    showResultsToPublic: true,
    requireVerifiedPass: false,
  },
  {
    id: 'session-feedback',
    name: 'Session Pulse Rating',
    sessionLabel: 'Closing Plenary',
    question: 'How actionable were today’s corporate breakout sessions for your team?',
    description: 'Quick end-of-session delegate benchmark.',
    options: [
      'Highly Actionable (5/5)',
      'Valuable Insights (4/5)',
      'Somewhat Useful (3/5)',
      'Needs Deeper Case Studies',
    ],
    allowMultiple: false,
    showResultsToPublic: true,
    requireVerifiedPass: false,
  },
];

export function isPollsEnabledForEvent(
  event?: Pick<EventItem, 'category' | 'extraDataConfig'> | null
): boolean {
  if (!event) return false;
  const cfg = event.extraDataConfig;
  if (cfg?.enablePolls === true) return true;
  if (cfg?.enablePolls === false) {
    return Array.isArray(cfg.polls) && cfg.polls.some((p) => p.status !== 'draft');
  }
  return (
    event.category?.trim().toLowerCase() === 'corporate' ||
    (Array.isArray(cfg?.polls) && cfg.polls.some((p) => p.status !== 'draft'))
  );
}

export function sanitizePollForPublic(poll: EventPoll): EventPoll {
  const { voterKeys: _voterKeys, ...rest } = poll;
  const hideVotes = poll.showResultsToPublic === false && poll.status !== 'closed';
  return {
    ...rest,
    options: (poll.options || []).map((opt) => ({
      id: opt.id,
      label: opt.label,
      votes: hideVotes ? 0 : Math.max(0, Number(opt.votes) || 0),
    })),
    totalVotes: Math.max(0, Number(poll.totalVotes) || 0),
  };
}

export function sanitizePublicExtraDataConfig(
  extra?: EventExtraDataConfig
): EventExtraDataConfig | undefined {
  if (!extra) return extra;
  const {
    attendantLinks: _attLinks,
    planningConfig: _planCfg,
    programOutline: rawOutline,
    logoUrl: rawLogoUrl,
    polls,
    ...rest
  } = extra;
  const cleanOutline = sanitizeProgramOutline(rawOutline);
  const cleanLogoUrl = sanitizeEventLogoUrl(rawLogoUrl);
  const base: EventExtraDataConfig = {
    ...rest,
    ...(cleanOutline ? { programOutline: cleanOutline } : {}),
    ...(cleanLogoUrl ? { logoUrl: cleanLogoUrl } : {}),
  };
  if (!Array.isArray(polls)) {
    return base;
  }
  const publicPolls = polls
    .filter((p) => p && p.status !== 'draft')
    .map(sanitizePollForPublic);
  return {
    ...base,
    polls: publicPolls,
  };
}

export function buildValidatedPollOptions(rawOptions: unknown[]): EventPollOption[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of rawOptions) {
    const label =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && 'label' in item
          ? String((item as { label?: unknown }).label || '').trim()
          : '';
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(label.slice(0, 140));
    if (cleaned.length >= 10) break;
  }
  return cleaned.map((label, idx) => ({
    id: `opt-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    votes: 0,
  }));
}

export function normalizePollStatus(raw: unknown, fallback: EventPollStatus = 'active'): EventPollStatus {
  if (raw === 'active' || raw === 'draft' || raw === 'closed') return raw;
  return fallback;
}
