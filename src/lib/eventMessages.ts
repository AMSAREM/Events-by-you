import type { EventItem, EventMessageConfig } from '../types/events.ts';
import { formatEventDateSpan } from './eventDates.ts';

export const MAX_SHOTS_PER_USER = 5;
export const POWERED_BY_LINE = 'powered by eventsbyyou.xyz';

export function appendPoweredByLine(message?: string): string {
  const clean = (message || '').trim();
  if (!clean) return POWERED_BY_LINE;
  if (/powered\s+by\s+eventsbyyou\.xyz/i.test(clean)) {
    return clean;
  }
  return `${clean}\n${POWERED_BY_LINE}`;
}

export function stripTrailingPoweredByLine(message?: string): string {
  const clean = (message || '').trim();
  if (!clean) return '';
  return clean
    .replace(/\n*\s*powered\s+by\s+eventsbyyou\.xyz\s*$/i, '')
    .trim();
}

export function calculateSmsCredits(message?: string): number {
  const clean = (message || '').trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 160));
}

export const DEFAULT_CONFIRMATION_MESSAGE =
  `Welcome and thank you for celebrating with us! Hi {name}, your pass for {event} ({code}) is confirmed for {date} at {venue}. Program Outline: {programLink} · Disposable camera (5 photos): {cameraLink}`;

export const LEGACY_DEFAULT_CONFIRMATION_MESSAGES = [
  `Hi {name}, your pass for {event} ({code}) is confirmed for {date} at {venue}. Program Outline: {programLink} · Disposable camera (5 photos): {cameraLink}`,
  `Hi {name}, your pass for {event} ({code}) is confirmed for {date} at {venue}. Disposable camera (5 photos): {cameraLink}`,
  `Hi {name}, your pass for {event} ({code}) is confirmed for {date} at {venue}.`,
];

export function isLegacyDefaultConfirmationMessage(message?: string | null): boolean {
  const clean = (message || '').trim();
  if (!clean) return false;
  return LEGACY_DEFAULT_CONFIRMATION_MESSAGES.includes(clean);
}

export const DEFAULT_CHECKIN_MESSAGE =
  `You're checked in to {event}, {name}! Thank you for being a part of the celebration. Program Outline: {programLink} · Snap up to 5 photos on our disposable camera & turn them into a collage: {cameraLink}`;

export const LEGACY_DEFAULT_CHECKIN_MESSAGES = [
  `Welcome to {event}, {name}! You're checked in. Snap up to 5 photos on our disposable camera & turn them into a collage: {cameraLink}`,
  `Thank you for being a part of the celebration at {event}, {name}! You're checked in. Snap up to 5 photos on our disposable camera & turn them into a collage: {cameraLink}`,
  `You're checked in to {event}, {name}! Thank you for being a part of the celebration. Snap up to 5 photos on our disposable camera & turn them into a collage: {cameraLink}`,
];

export function isLegacyDefaultCheckInMessage(message?: string | null): boolean {
  const clean = (message || '').trim();
  if (!clean) return false;
  return LEGACY_DEFAULT_CHECKIN_MESSAGES.includes(clean);
}

export function getDefaultMessageConfig(event?: Partial<EventItem>): Required<EventMessageConfig> {
  const customConfirmation = event?.messageConfig?.confirmationMessage?.trim();
  const customCheckIn = event?.messageConfig?.checkInMessage?.trim();
  return {
    confirmationMessage:
      customConfirmation && !isLegacyDefaultConfirmationMessage(customConfirmation)
        ? customConfirmation
        : DEFAULT_CONFIRMATION_MESSAGE,
    reminderMessage:
      event?.messageConfig?.reminderMessage?.trim() ||
      `Reminder: {event} starts {date} at {time} ({venue}). Present QR token {code} at the gate. Program Outline: {programLink} · Camera: {cameraLink}`,
    checkInMessage:
      customCheckIn && !isLegacyDefaultCheckInMessage(customCheckIn)
        ? customCheckIn
        : DEFAULT_CHECKIN_MESSAGE,
    thankYouMessage:
      event?.messageConfig?.thankYouMessage?.trim() ||
      `Thank you for attending {event}, {name}! Program Outline: {programLink} · Relive the moments & turn your 5 camera shots into a collage: {cameraLink}`,
    includeCameraLink: event?.messageConfig?.includeCameraLink !== false,
  };
}

export function buildEventLinkForOrigin(
  slugOrId: string,
  originOverride?: string
): string {
  const clean = encodeURIComponent(slugOrId.trim() || 'event');
  const origin =
    originOverride?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz');
  return `${origin}/e/${clean}`;
}

export function buildProgramLinkForOrigin(
  slugOrId: string,
  originOverride?: string
): string {
  const clean = encodeURIComponent(slugOrId.trim() || 'event');
  const origin =
    originOverride?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz');
  return `${origin}/e/${clean}/program`;
}

export function buildCameraLinkForOrigin(
  slugOrId: string,
  originOverride?: string,
  guestName?: string,
  ticketCode?: string
): string {
  const clean = encodeURIComponent(slugOrId.trim() || 'event');
  const origin =
    originOverride?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz');
  const base = `${origin}/e/${clean}/camera`;
  const search = new URLSearchParams();
  const trimmedCode = ticketCode?.trim();
  const trimmedGuest = guestName?.trim();
  if (trimmedCode) search.set('pass', trimmedCode);
  if (trimmedGuest) search.set('guest', trimmedGuest);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export function resolveEventMessage(params: {
  template?: string;
  type: 'confirmation' | 'reminder' | 'checkin' | 'thankyou';
  event: Pick<EventItem, 'id' | 'slug' | 'title' | 'date' | 'time' | 'venue' | 'city' | 'messageConfig'> &
    Partial<Pick<EventItem, 'isoDate' | 'endIsoDate'>>;
  attendeeName?: string;
  ticketCode?: string;
  originOverride?: string;
  includeGuestInCameraUrl?: boolean;
}): { text: string; cameraUrl: string; eventUrl: string; programUrl: string } {
  const defaults = getDefaultMessageConfig(params.event);
  const incomingTemplate = params.template?.trim();
  const rawTemplate =
    (incomingTemplate &&
    !(params.type === 'checkin' && isLegacyDefaultCheckInMessage(incomingTemplate)) &&
    !(params.type === 'confirmation' && isLegacyDefaultConfirmationMessage(incomingTemplate))
      ? incomingTemplate
      : '') ||
    (params.type === 'checkin'
      ? defaults.checkInMessage
      : params.type === 'reminder'
        ? defaults.reminderMessage
        : params.type === 'thankyou'
          ? defaults.thankYouMessage
          : defaults.confirmationMessage);

  const shouldPersonalize = Boolean(params.includeGuestInCameraUrl || params.type === 'checkin');
  const eventUrl = buildEventLinkForOrigin(
    params.event.slug || params.event.id,
    params.originOverride
  );
  const programUrl = buildProgramLinkForOrigin(
    params.event.slug || params.event.id,
    params.originOverride
  );
  const cameraUrl = buildCameraLinkForOrigin(
    params.event.slug || params.event.id,
    params.originOverride,
    shouldPersonalize ? params.attendeeName : undefined,
    shouldPersonalize ? params.ticketCode : undefined
  );

  const attendeeName = params.attendeeName?.trim() || 'Guest';
  const ticketCode = params.ticketCode?.trim() || '#EVT-PASS';

  const hasCameraPlaceholder = /\{camera_?link\}|\{camera\}/i.test(rawTemplate);
  const hasProgramPlaceholder = /\{program_?link\}|\{outline_?link\}/i.test(rawTemplate);

  const resolvedDateLabel = formatEventDateSpan(
    params.event.isoDate,
    params.event.endIsoDate,
    params.event.date
  );

  let rendered = rawTemplate
    .replace(/\{name\}/gi, attendeeName)
    .replace(/\{event\}/gi, params.event.title)
    .replace(/\{date\}/gi, resolvedDateLabel)
    .replace(/\{time\}/gi, params.event.time)
    .replace(/\{venue\}/gi, params.event.venue)
    .replace(/\{city\}/gi, params.event.city)
    .replace(/\{ticket_?code\}|\{code\}/gi, ticketCode)
    .replace(/\{program_?link\}|\{outline_?link\}/gi, programUrl)
    .replace(/\{event_?link\}|\{schedule_?link\}/gi, eventUrl)
    .replace(/\{camera_?link\}|\{camera\}/gi, cameraUrl);

  const includeLink = params.type === 'checkin' || params.event.messageConfig?.includeCameraLink !== false;
  if (includeLink && !hasCameraPlaceholder && !rendered.includes(cameraUrl)) {
    rendered = `${rendered.trim()} Disposable Camera (5 shots & collage): ${cameraUrl}`;
  }

  if (!hasProgramPlaceholder && !rendered.includes(programUrl)) {
    rendered = `${rendered.trim()} Program Outline: ${programUrl}`;
  }

  return { text: appendPoweredByLine(rendered), cameraUrl, eventUrl, programUrl };
}

export function ensureProgramLinkInMessage(message: string, programUrl: string): string {
  const clean = (message || '').trim();
  if (!programUrl) return clean;
  if (!clean) return `Program Outline: ${programUrl}`;
  if (clean.includes(programUrl)) return clean;
  return `${clean} Program Outline: ${programUrl}`;
}

export const DEFAULT_GIFT_THANK_YOU_MESSAGE =
  `Thank you, {name}! We appreciate your gift for {event}.`;

export function resolveGiftThankYouMessage(params: {
  event: Pick<EventItem, 'title'>;
  giverName?: string;
  giftType?: 'cash-momo' | 'registry-item' | 'blessing-only';
  currency?: string;
  amount?: number;
  registryItem?: string;
}): { text: string; smsBody: string } {
  const giver = params.giverName?.trim() || 'Friend';
  const giftDetail =
    params.giftType === 'cash-momo' && params.amount
      ? ` (${params.currency === 'USD' ? 'USD' : 'GHS'} ${Number(params.amount).toLocaleString()})`
      : params.giftType === 'registry-item' && params.registryItem?.trim()
        ? ` (${params.registryItem.trim()})`
        : '';
  const smsBody = `Thank you, ${giver}! We appreciate your gift${giftDetail} for ${params.event.title}.`;
  return {
    text: appendPoweredByLine(smsBody),
    smsBody,
  };
}

