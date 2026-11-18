export type AppRoute =
  | 'home'
  | 'signin'
  | 'signup'
  | 'reset-password'
  | 'verify-otp'
  | 'demo-event'
  | 'camera'
  | 'studio';

export type NavScreen =
  | 'overview'
  | 'checkin'
  | 'camera'
  | 'events'
  | 'schedule'
  | 'attendees'
  | 'analytics'
  | 'console'
  | 'billing'
  | 'settings';

export type FilmStock = 'ilford-bw' | 'kodak-gold' | 'fuji-c200' | 'cinestill-800t';

export interface DisposableShot {
  id: string;
  eventId: string;
  frameNumber: number;
  dataUrl: string;
  capturedBy: string;
  caption?: string;
  filmStock: FilmStock;
  dateStamp: string;
  capturedAt: string;
  developed: boolean;
  likes: number;
  liked?: boolean;
}

export interface DisposableRollSettings {
  exposuresLimit: 12 | 24 | 36;
  darkroomMode: boolean;
}

export type StudioSubScreen = 'create-event' | 'csv-export' | null;

export type EventStatus = 'live' | 'upcoming' | 'draft' | 'past';

export type ArtworkVariant =
  | 'architecture'
  | 'sound'
  | 'typography'
  | 'hardware'
  | 'spatial'
  | 'forum';

export interface ScheduleBlock {
  id: string;
  eventId: string;
  time: string;
  duration: string;
  title: string;
  stage: string;
  lead: string;
  completed: boolean;
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';
}

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  status: EventStatus;
  date: string;
  isoDate: string;
  time: string;
  venue: string;
  city: string;
  capacity: number;
  registered: number;
  checkedIn: number;
  smsDispatched: number;
  ticketPrice: number;
  revenue: number;
  organizer: string;
  artwork: ArtworkVariant;
  broadcastError?: string;
  flyerUrl?: string;
  venueFormat?: 'in-person' | 'virtual' | 'hybrid';
  senderId?: string;
}

export type AttendeeTier = 'VIP' | 'General' | 'Speaker' | 'Press';

export interface Attendee {
  id: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  eventId: string;
  tier: AttendeeTier;
  checkedIn: boolean;
  checkedInAt?: string;
  ticketCode: string;
  smsStatus: 'Arkesel Sent' | 'Resend Delivered' | 'Pending';
  paymentStatus: 'paid' | 'failed';
}

export interface SystemAlert {
  id: string;
  title: string;
  detail: string;
  category: 'capacity' | 'broadcast' | 'payment';
  eventId?: string;
  timestamp: string;
  resolved: boolean;
}

export type TimeRange = '7D' | '30D' | '90D';

export interface VelocityPoint {
  label: string;
  registrations: number;
  checkIns: number;
  revenue: number;
}

export interface OrganizerProfile {
  name: string;
  firstName: string;
  role: string;
  email: string;
  studio: string;
  plan: 'Starter' | 'Pro Organizer' | 'Enterprise';
  smsCredits: number;
  capacityAlertThreshold: number;
  avatarUrl?: string;
  replyToEmail?: string;
  timezone?: string;
  twoFactorEnabled?: boolean;
  senderId?: string;
}

export type CreatorAppType = 'kiosk' | 'webhook-worker' | 'widget' | 'mobile-app';

export type CreatorAppEnvironment = 'sandbox' | 'production';

export type CreatorAppStatus = 'active' | 'paused';

export type CreatorAppScope =
  | 'events:read'
  | 'attendees:read'
  | 'checkin:write'
  | 'sms:dispatch'
  | 'camera:read'
  | 'webhooks:manage';

export type WebhookTriggerEvent =
  | 'attendee.registered'
  | 'attendee.checked_in'
  | 'sms.dispatched'
  | 'payment.settled'
  | 'camera.shot_captured';

export interface CreatorApp {
  id: string;
  name: string;
  slug: string;
  description: string;
  appType: CreatorAppType;
  environment: CreatorAppEnvironment;
  status: CreatorAppStatus;
  eventId?: string;
  clientId: string;
  secretPrefix: string;
  scopes: CreatorAppScope[];
  webhookUrl?: string;
  webhookEvents: WebhookTriggerEvent[];
  allowedOrigins: string[];
  requestsCount: number;
  lastUsedAt?: string;
  createdAt: string;
}

export interface CreatorAppLog {
  id: string;
  appId: string;
  eventType: string;
  method: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  requestSummary: string;
  responseSummary: string;
  createdAt: string;
}

