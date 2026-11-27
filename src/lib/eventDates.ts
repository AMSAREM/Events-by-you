import type { Attendee, EventCheckInPolicy, EventItem, ScheduleBlock } from '../types/events.ts';

export const SCHEDULE_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SCHEDULE_EVENT_DAYS = [
  'Day 1',
  'Day 2',
  'Day 3',
  'Day 4',
  'Day 5',
  'Day 6',
  'Day 7',
] as const;
export const ALL_SCHEDULE_DAYS: readonly ScheduleBlock['day'][] = [
  ...SCHEDULE_EVENT_DAYS,
  ...SCHEDULE_WEEKDAYS,
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value?: string | null): value is string {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === trimmed;
}

export function sanitizeIsoDate(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return isValidIsoDate(trimmed) ? trimmed : undefined;
}

export function sanitizeCheckInPolicy(value: unknown): EventCheckInPolicy | undefined {
  if (value === 'single-entry' || value === 'daily-reentry') return value;
  return undefined;
}

export function normalizeScheduleDay(
  day: unknown,
  fallback: ScheduleBlock['day'] = 'Sat'
): ScheduleBlock['day'] {
  if (typeof day === 'string') {
    const matched = ALL_SCHEDULE_DAYS.find(
      (candidate) => candidate.toLowerCase() === day.trim().toLowerCase()
    );
    if (matched) return matched;
  }
  return fallback;
}

export function getTodayIsoDate(now = new Date()): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Accra',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    if (isValidIsoDate(formatted)) return formatted;
  } catch {
    // Fallback to UTC ISO slice if Intl timeZone is unavailable
  }
  return now.toISOString().slice(0, 10);
}

export function sanitizeCheckedInDates(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const item of raw) {
    const iso = sanitizeIsoDate(typeof item === 'string' ? item : undefined);
    if (iso && !seen.has(iso)) {
      seen.add(iso);
      valid.push(iso);
    }
  }
  return valid.length > 0 ? valid.sort() : [];
}

export function isMultiDayEvent(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): boolean {
  const start = sanitizeIsoDate(event?.isoDate);
  const end = sanitizeIsoDate(event?.endIsoDate);
  return Boolean(start && end && end > start);
}

export function getEventDayCount(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): number {
  const start = sanitizeIsoDate(event?.isoDate);
  const end = sanitizeIsoDate(event?.endIsoDate);
  if (!start || !end || end <= start) return 1;
  const diffMs = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  const days = Math.round(diffMs / 86_400_000) + 1;
  return Math.max(1, Math.min(30, days));
}

export function getEventCheckInPolicy(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'checkInPolicy'> | null
): EventCheckInPolicy {
  const explicit = sanitizeCheckInPolicy(event?.checkInPolicy);
  if (explicit) return explicit;
  return isMultiDayEvent(event) ? 'daily-reentry' : 'single-entry';
}

export function formatEventDateSpan(
  isoDate?: string,
  endIsoDate?: string,
  fallbackLabel?: string
): string {
  const startIso = sanitizeIsoDate(isoDate);
  if (!startIso) {
    return fallbackLabel?.trim() || 'Upcoming';
  }
  const endIso = sanitizeIsoDate(endIsoDate);
  const startDate = new Date(`${startIso}T00:00:00Z`);
  const fmtMonthDayYear = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const fmtMonthDay = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    });

  if (!endIso || endIso <= startIso) {
    return fmtMonthDayYear(startDate);
  }

  const endDate = new Date(`${endIso}T00:00:00Z`);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();

  if (sameMonth) {
    const month = startDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const startDay = String(startDate.getUTCDate()).padStart(2, '0');
    const endDay = String(endDate.getUTCDate()).padStart(2, '0');
    return `${month} ${startDay} – ${endDay}, ${startDate.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${fmtMonthDay(startDate)} – ${fmtMonthDay(endDate)}, ${startDate.getUTCFullYear()}`;
  }
  return `${fmtMonthDayYear(startDate)} – ${fmtMonthDayYear(endDate)}`;
}

export function formatEventDurationBadge(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string | null {
  if (!isMultiDayEvent(event)) return null;
  return `${getEventDayCount(event)}-Day Event`;
}

export interface EventDateSlot {
  isoDate: string;
  dayIndex: number;
  dayTag: ScheduleBlock['day'];
  weekdayShort: (typeof SCHEDULE_WEEKDAYS)[number];
  shortLabel: string;
  fullLabel: string;
}

const UTC_WEEKDAY_MAP: readonly (typeof SCHEDULE_WEEKDAYS)[number][] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];

export function formatIsoDateShort(isoDate?: string, includeWeekday = true): string {
  const clean = sanitizeIsoDate(isoDate);
  if (!clean) return '';
  const d = new Date(`${clean}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    ...(includeWeekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function getWeekdayForIsoDate(isoDate?: string): (typeof SCHEDULE_WEEKDAYS)[number] | undefined {
  const clean = sanitizeIsoDate(isoDate);
  if (!clean) return undefined;
  const d = new Date(`${clean}T00:00:00Z`);
  return UTC_WEEKDAY_MAP[d.getUTCDay()] ?? 'Sat';
}

export function getEventDateSlots(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): EventDateSlot[] {
  const startIso = sanitizeIsoDate(event?.isoDate);
  if (!startIso) return [];
  const dayCount = getEventDayCount(event);
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  const slots: EventDateSlot[] = [];

  for (let idx = 0; idx < dayCount; idx++) {
    const d = new Date(startMs + idx * 86_400_000);
    const isoDate = d.toISOString().slice(0, 10);
    const weekdayShort = UTC_WEEKDAY_MAP[d.getUTCDay()] ?? 'Sat';
    const dayTag: ScheduleBlock['day'] =
      dayCount > 1 && idx < SCHEDULE_EVENT_DAYS.length
        ? SCHEDULE_EVENT_DAYS[idx]
        : weekdayShort;
    const shortLabel = formatIsoDateShort(isoDate, true);
    const fullLabel =
      dayCount > 1 ? `Day ${idx + 1} · ${shortLabel}` : shortLabel;
    slots.push({
      isoDate,
      dayIndex: idx,
      dayTag,
      weekdayShort,
      shortLabel,
      fullLabel,
    });
  }
  return slots;
}

export function getEventIsoDates(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string[] {
  return getEventDateSlots(event).map((slot) => slot.isoDate);
}

export function getScheduleBlockDayFromIso(
  isoDate?: string,
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null,
  fallback: ScheduleBlock['day'] = 'Sat'
): ScheduleBlock['day'] {
  const clean = sanitizeIsoDate(isoDate);
  if (!clean) return fallback;
  const slots = getEventDateSlots(event);
  const matched = slots.find((s) => s.isoDate === clean);
  if (matched) return matched.dayTag;
  return getWeekdayForIsoDate(clean) ?? fallback;
}

export function resolveIsoDateForScheduleDay(
  day?: ScheduleBlock['day'],
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string | undefined {
  const startIso = sanitizeIsoDate(event?.isoDate);
  if (!startIso) return undefined;
  const slots = getEventDateSlots(event);
  if (slots.length === 0) return startIso;

  if (!day) return slots[0].isoDate;
  const dayNumMatch = /^Day\s+(\d+)$/i.exec(day.trim());
  if (dayNumMatch) {
    const idx = Math.max(0, Number(dayNumMatch[1]) - 1);
    if (idx < slots.length) {
      return slots[idx].isoDate;
    }
    const startMs = Date.parse(`${startIso}T00:00:00Z`);
    return new Date(startMs + idx * 86_400_000).toISOString().slice(0, 10);
  }

  const weekdayMatch = slots.find(
    (s) => s.weekdayShort.toLowerCase() === day.trim().toLowerCase()
  );
  if (weekdayMatch) return weekdayMatch.isoDate;

  return slots.length === 1 ? slots[0].isoDate : undefined;
}

export function resolveScheduleBlockDate(
  block: Pick<ScheduleBlock, 'day' | 'date'>,
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string | undefined {
  const explicit = sanitizeIsoDate(block.date);
  if (explicit) return explicit;
  return resolveIsoDateForScheduleDay(block.day, event);
}

export function formatScheduleBlockDateBadge(
  block: Pick<ScheduleBlock, 'day' | 'date'>,
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string {
  const resolved = resolveScheduleBlockDate(block, event);
  if (!resolved) return block.day;
  const slots = getEventDateSlots(event);
  const slot = slots.find((s) => s.isoDate === resolved);
  if (slot) return slot.fullLabel;
  return formatIsoDateShort(resolved, true) || block.day;
}

export function compareScheduleBlocksChronological(
  a: Pick<ScheduleBlock, 'day' | 'date' | 'time'>,
  b: Pick<ScheduleBlock, 'day' | 'date' | 'time'>,
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): number {
  const da = resolveScheduleBlockDate(a, event) || '';
  const db = resolveScheduleBlockDate(b, event) || '';
  if (da && db && da !== db) {
    return da.localeCompare(db);
  }
  if (da && !db) return -1;
  if (!da && db) return 1;
  return String(a.time || '').localeCompare(String(b.time || ''));
}

export function getEventDayOptions(
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): { value: ScheduleBlock['day']; label: string; isoDate?: string }[] {
  const options: { value: ScheduleBlock['day']; label: string; isoDate?: string }[] = [];
  const slots = getEventDateSlots(event);

  if (slots.length > 1) {
    const capped = Math.min(SCHEDULE_EVENT_DAYS.length, slots.length);
    for (let idx = 0; idx < capped; idx++) {
      const slot = slots[idx];
      options.push({
        value: SCHEDULE_EVENT_DAYS[idx],
        label: slot.fullLabel,
        isoDate: slot.isoDate,
      });
    }
  } else if (slots.length === 1) {
    options.push({
      value: 'Day 1',
      label: `Day 1 · ${slots[0].shortLabel}`,
      isoDate: slots[0].isoDate,
    });
  } else {
    options.push({ value: 'Day 1', label: 'Day 1' });
  }

  for (const weekday of SCHEDULE_WEEKDAYS) {
    const matchingSlot = slots.find((s) => s.weekdayShort === weekday);
    options.push({
      value: weekday,
      label: matchingSlot ? `${weekday} · ${matchingSlot.shortLabel}` : weekday,
      isoDate: matchingSlot?.isoDate,
    });
  }

  return options;
}

export function isAttendeeCheckedInForDate(
  attendee: Pick<Attendee, 'checkedIn' | 'checkedInDates'>,
  event?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'checkInPolicy'> | null,
  dateIso = getTodayIsoDate()
): boolean {
  const policy = getEventCheckInPolicy(event);
  if (policy === 'single-entry') {
    return Boolean(attendee.checkedIn);
  }
  const dates = Array.isArray(attendee.checkedInDates) ? attendee.checkedInDates : [];
  if (dates.length > 0) {
    return dates.includes(dateIso);
  }
  return false;
}

export function getAttendeeCheckedInDaysCount(
  attendee: Pick<Attendee, 'checkedIn' | 'checkedInDates'>
): number {
  const dates = Array.isArray(attendee.checkedInDates) ? attendee.checkedInDates : [];
  if (dates.length > 0) return dates.length;
  return attendee.checkedIn ? 1 : 0;
}

function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function parseClockTimeTo24h(rawTime?: string): {
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
} {
  const defaults = { startHour: 9, startMin: 0, endHour: 17, endMin: 0 };
  if (!rawTime || typeof rawTime !== 'string') return defaults;

  const matches = Array.from(
    rawTime.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi)
  ).map((m) => {
    let hour = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return {
      hour: Math.max(0, Math.min(23, hour)),
      min: Math.max(0, Math.min(59, min)),
    };
  });

  if (matches.length === 0) return defaults;
  const start = matches[0];
  const end =
    matches.length >= 2
      ? matches[1]
      : { hour: Math.min(23, start.hour + 3), min: start.min };

  return {
    startHour: start.hour,
    startMin: start.min,
    endHour: end.hour,
    endMin: end.min,
  };
}

function formatIcsDateTimeUtc(isoDate: string, hour: number, minute: number): string {
  const compact = isoDate.replace(/-/g, '');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${compact}T${hh}${mm}00Z`;
}

export function buildEventIcsContent(
  event: EventItem,
  opts?: {
    ticketCode?: string;
    validationGroup?: string;
    invitationUrl?: string;
  }
): string {
  const startIso = sanitizeIsoDate(event.isoDate) ?? getTodayIsoDate();
  const endIso =
    sanitizeIsoDate(event.endIsoDate) && sanitizeIsoDate(event.endIsoDate)! >= startIso
      ? sanitizeIsoDate(event.endIsoDate)!
      : startIso;

  const { startHour, startMin, endHour, endMin } = parseClockTimeTo24h(event.time);
  const dtStart = formatIcsDateTimeUtc(startIso, startHour, startMin);

  let effectiveEndHour = endHour;
  let effectiveEndMin = endMin;
  if (endIso === startIso && (endHour < startHour || (endHour === startHour && endMin <= startMin))) {
    effectiveEndHour = Math.min(23, startHour + 3);
    effectiveEndMin = startMin;
  }
  const dtEnd = formatIcsDateTimeUtc(endIso, effectiveEndHour, effectiveEndMin);

  const descriptionParts = [
    opts?.ticketCode ? `Digital Gate Pass ${opts.ticketCode}` : undefined,
    opts?.validationGroup ? `(${opts.validationGroup})` : undefined,
    isMultiDayEvent(event) ? `${getEventDayCount(event)}-Day Event` : undefined,
    opts?.invitationUrl,
  ].filter(Boolean);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Events By You//Event Registration & SMS Ticketing//EN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${opts?.ticketCode ?? event.slug}@eventsbyyou.xyz`)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText([event.venue, event.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.join(' · ') || event.subtitle || event.title)}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
