import type { EventItem, EventMessageConfig } from '../types/events';

export const MAX_SHOTS_PER_USER = 5;

export function calculateSmsCredits(message?: string): number {
  const clean = (message || '').trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 160));
}

export function getDefaultMessageConfig(event?: Partial<EventItem>): Required<EventMessageConfig> {
  return {
    confirmationMessage:
      event?.messageConfig?.confirmationMessage?.trim() ||
      `Hi {name}, your pass for {event} ({code}) is confirmed for {date} at {venue}. View & snap 5 photos on our shared disposable camera: {cameraLink}`,
    reminderMessage:
      event?.messageConfig?.reminderMessage?.trim() ||
      `Reminder: {event} starts {date} at {time} ({venue}). Present QR token {code} at the gate. Camera: {cameraLink}`,
    checkInMessage:
      event?.messageConfig?.checkInMessage?.trim() ||
      `Welcome to {event}, {name}! You're checked in. Snap up to 5 photos on our disposable camera & turn them into a collage: {cameraLink}`,
    thankYouMessage:
      event?.messageConfig?.thankYouMessage?.trim() ||
      `Thank you for attending {event}, {name}! Relive the moments & turn your 5 camera shots into a collage: {cameraLink}`,
    includeCameraLink: event?.messageConfig?.includeCameraLink !== false,
  };
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
      : 'https://www.eventsbyyou.xyz');
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
  event: Pick<EventItem, 'id' | 'slug' | 'title' | 'date' | 'time' | 'venue' | 'city' | 'messageConfig'>;
  attendeeName?: string;
  ticketCode?: string;
  originOverride?: string;
  includeGuestInCameraUrl?: boolean;
}): { text: string; cameraUrl: string } {
  const defaults = getDefaultMessageConfig(params.event);
  const rawTemplate =
    params.template?.trim() ||
    (params.type === 'checkin'
      ? defaults.checkInMessage
      : params.type === 'reminder'
        ? defaults.reminderMessage
        : params.type === 'thankyou'
          ? defaults.thankYouMessage
          : defaults.confirmationMessage);

  const shouldPersonalize = Boolean(params.includeGuestInCameraUrl || params.type === 'checkin');
  const cameraUrl = buildCameraLinkForOrigin(
    params.event.slug || params.event.id,
    params.originOverride,
    shouldPersonalize ? params.attendeeName : undefined,
    shouldPersonalize ? params.ticketCode : undefined
  );

  const attendeeName = params.attendeeName?.trim() || 'Guest';
  const ticketCode = params.ticketCode?.trim() || '#EVT-PASS';

  const hasCameraPlaceholder = /\{camera_?link\}|\{camera\}/i.test(rawTemplate);

  let rendered = rawTemplate
    .replace(/\{name\}/gi, attendeeName)
    .replace(/\{event\}/gi, params.event.title)
    .replace(/\{date\}/gi, params.event.date)
    .replace(/\{time\}/gi, params.event.time)
    .replace(/\{venue\}/gi, params.event.venue)
    .replace(/\{city\}/gi, params.event.city)
    .replace(/\{ticket_?code\}|\{code\}/gi, ticketCode)
    .replace(/\{camera_?link\}|\{camera\}/gi, cameraUrl);

  const includeLink = params.type === 'checkin' || params.event.messageConfig?.includeCameraLink !== false;
  if (includeLink && !hasCameraPlaceholder && !rendered.includes(cameraUrl)) {
    rendered = `${rendered.trim()} Disposable Camera (5 shots & collage): ${cameraUrl}`;
  }

  return { text: rendered.trim(), cameraUrl };
}
