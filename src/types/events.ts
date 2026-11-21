export type AppRoute =
  | 'home'
  | 'signin'
  | 'signup'
  | 'reset-password'
  | 'verify-otp'
  | 'demo-event'
  | 'camera'
  | 'studio'
  | 'terms'
  | 'privacy';

export type NavScreen =
  | 'overview'
  | 'checkin'
  | 'camera'
  | 'gifts'
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
  shooterKey?: string;
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

export type DesignTheme =
  | 'editorial-ivory'
  | 'obsidian-gold'
  | 'swiss-grid'
  | 'warm-monochrome';

export interface EventValidationConfig {
  enabled: boolean;
  label: string;
  options: string[];
  requireInviteCode?: boolean;
  inviteCode?: string;
}

export interface CustomFormField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface GiftTableAttendantLink {
  id: string;
  eventId: string;
  token: string;
  attendantName: string;
  roleLabel?: string;
  phone?: string;
  active: boolean;
  recordedCount?: number;
  createdAt: string;
  lastUsedAt?: string;
}

export interface GiftTableEntry {
  id: string;
  eventId: string;
  giverName: string;
  giverPhone?: string;
  giftType: 'cash-momo' | 'registry-item' | 'blessing-only';
  amount?: number;
  currency?: 'GHS' | 'USD';
  registryItem?: string;
  side?: string;
  message?: string;
  recordedVia?: 'public-table' | 'gift-desk';
  recordedBy?: string;
  attendantLinkId?: string;
  createdAt: string;
}

export interface EventExtraDataConfig {
  enableGiftTable: boolean;
  giftTitle?: string;
  momoNumber?: string;
  momoName?: string;
  giftRegistryItems?: string[];
  giftLedger?: GiftTableEntry[];
  attendantLinks?: GiftTableAttendantLink[];
  brandColor?: string;
  customFields: CustomFormField[];
}

export interface AttendeeGiftEntry {
  giftType: 'cash-momo' | 'registry-item' | 'blessing-only';
  amount?: number;
  currency?: 'GHS' | 'USD';
  registryItem?: string;
  side?: string;
  message?: string;
}

export interface EventMessageConfig {
  confirmationMessage?: string;
  reminderMessage?: string;
  checkInMessage?: string;
  thankYouMessage?: string;
  includeCameraLink?: boolean;
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
  designTheme?: DesignTheme;
  brandColor?: string;
  broadcastError?: string;
  flyerUrl?: string;
  venueFormat?: 'in-person' | 'virtual' | 'hybrid';
  senderId?: string;
  qrPassPublished?: boolean;
  validationConfig?: EventValidationConfig;
  extraDataConfig?: EventExtraDataConfig;
  messageConfig?: EventMessageConfig;
  whiteLabel?: boolean;
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
  validationGroup?: string;
  inviteCodeUsed?: string;
  giftEntry?: AttendeeGiftEntry;
  customResponses?: Record<string, string>;
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

export type AppRole = 'creator' | 'organizer' | 'gate_staff';

export interface OrganizerProfile {
  name: string;
  firstName: string;
  role: string;
  appRole?: AppRole;
  email: string;
  phone?: string;
  phoneVerified?: boolean;
  studio: string;
  plan: 'Starter' | 'Pro Organizer' | 'Enterprise';
  planBillingCycle?: 'monthly' | 'annual';
  planExpiresAt?: string;
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

export type SmsDispatchMode = 'live' | 'sandbox';

export interface BuilderFeatureFlags {
  publicRegistrationsPaused: boolean;
  pausedEventIds: string[];
  smsMode: SmsDispatchMode;
  arkeselSenderId?: string;
  signupsEnabled: boolean;
  starterSeedingEnabled: boolean;
}

export interface BuilderEnvStatus {
  SUPABASE_URL: boolean;
  SUPABASE_ANON_KEY: boolean;
  SUPABASE_SERVICE_ROLE_KEY: boolean;
  ARKESEL_API_KEY: boolean;
  ARKESEL_SENDER_ID: boolean;
  arkeselSenderIdValue: string;
  RESEND_API_KEY: boolean;
  RESEND_FROM_EMAIL: boolean;
  PAYSTACK_SECRET_KEY?: boolean;
  CREATOR_PASSWORD: boolean;
  CREATOR_EMAIL: string;
}

export type SmsPurchaseStatus =
  | 'pending_payment'
  | 'pending_verification'
  | 'credited'
  | 'rejected'
  | 'failed';

export type SmsPurchaseProvider = 'paystack' | 'arkesel_manual' | 'sandbox';

export interface SmsBundlePurchase {
  id: string;
  organizerId: string;
  organizerName?: string;
  organizerEmail?: string;
  bundleId: string;
  bundleName: string;
  credits: number;
  amountGhs: number;
  paymentChannel: string;
  provider: SmsPurchaseProvider;
  reference: string;
  status: SmsPurchaseStatus;
  createdAt: string;
  verifiedAt?: string;
  rejectionReason?: string;
}

export type SubscriptionPaymentStatus =
  | 'pending_payment'
  | 'pending_verification'
  | 'active'
  | 'rejected'
  | 'failed';

export type SubscriptionPaymentProvider = 'paystack' | 'manual' | 'sandbox';

export interface SubscriptionPayment {
  id: string;
  organizerId: string;
  organizerName?: string;
  organizerEmail?: string;
  planId: 'pro' | 'enterprise';
  planName: 'Pro Organizer' | 'Enterprise';
  billingCycle: 'monthly' | 'annual';
  amountUsd: number;
  amountGhs: number;
  paymentChannel: string;
  provider: SubscriptionPaymentProvider;
  reference: string;
  status: SubscriptionPaymentStatus;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
  verifiedAt?: string;
  rejectionReason?: string;
}

export interface SmsDispatchLogEntry {
  id: string;
  messageId?: string;
  recipient: string;
  senderId: string;
  senderIdIsDefaultWarning: boolean;
  purpose: 'signup' | 'login' | 'recovery' | 'pass' | 'test';
  mode: SmsDispatchMode;
  gatewayStatus: string;
  dlrStatus: string;
  errorReason?: string;
  timestamp: string;
  updatedAt?: string;
}

export interface EmailDeliverabilityDiagnostics {
  resendConfigured: boolean;
  activeFrom: string;
  replyTo?: string;
  domainName: string;
  domainVerified: boolean;
  usingSharedSandboxSender: boolean;
  usingSupabaseFallback: boolean;
  verifiedDomains: string[];
  dnsStatus: 'verified' | 'pending' | 'unconfigured' | 'error';
  recommendation: string;
}

export interface BuilderTableCounts {
  profiles: number;
  events: number;
  attendees: number;
  disposable_shots: number;
  creator_apps: number;
}

export interface BuilderErrorEntry {
  id: string;
  source: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export interface BuilderSmsQueueItem {
  attendeeId: string;
  attendeeName: string;
  phone: string;
  eventId: string;
  eventTitle: string;
  smsStatus: Attendee['smsStatus'];
  createdAt?: string;
}

export interface BuilderTenantSummary {
  id: string;
  name: string;
  email: string;
  studio: string;
  appRole: AppRole;
  plan: OrganizerProfile['plan'];
  smsCredits: number;
  eventsCount: number;
  attendeesCount: number;
  shotsCount: number;
  storageMb: number;
  suspended: boolean;
  lastLoginAt: string;
  createdAt: string;
}

export interface BuilderTenantInspection {
  tenant: BuilderTenantSummary;
  events: EventItem[];
  attendees: Attendee[];
}

export interface BuilderEventTrafficRow {
  eventId: string;
  title: string;
  slug: string;
  status: EventItem['status'];
  registered: number;
  capacity: number;
  checkedIn: number;
  duplicateBlocks: number;
  cameraShots: number;
  cameraStorageMb: number;
  registrationPaused: boolean;
}

export interface BuilderDiagnosticFailure {
  id: string;
  kind: 'qr-scan' | 'webhook' | 'client-auth';
  target: string;
  statusCode: number;
  reason: string;
  payloadPreview: string;
  expectedDiff?: string;
  timestamp: string;
  replayed: boolean;
  appId?: string;
}

export interface BuilderTenantUnitEconomics {
  userId: string;
  name: string;
  email: string;
  plan: OrganizerProfile['plan'];
  mrrUsd: number;
  smsSentCount: number;
  smsCostUsd: number;
  storageMb: number;
  storageCostUsd: number;
  netMarginUsd: number;
  unprofitableFlag: boolean;
}

export interface BuilderConsoleOverview {
  storageMode: 'supabase' | 'in-memory';
  dbLatencyMs: number;
  rlsVerified: boolean;
  tableCounts: BuilderTableCounts;
  recentErrors: BuilderErrorEntry[];
  smsTelemetry: {
    mode: SmsDispatchMode;
    activeSenderId: string;
    usingDefaultSenderIdWarning: boolean;
    dlrWebhookUrl?: string;
    totalDispatched: number;
    deliveredCount: number;
    pendingOrFailedCount: number;
    successRatePct: number;
    gatewayBalanceCredits: number;
    gatewayBalanceLive?: boolean;
    gatewayBalanceError?: string;
    organizerCreditLiabilities: number;
    failedQueue: BuilderSmsQueueItem[];
    recentDispatches: SmsDispatchLogEntry[];
  };
  pendingSmsPurchases?: SmsBundlePurchase[];
  pendingSubscriptionPayments?: SubscriptionPayment[];
  emailDiagnostics?: EmailDeliverabilityDiagnostics;
  tenants: BuilderTenantSummary[];
  eventTraffic: BuilderEventTrafficRow[];
  totalDuplicateBlocks: number;
  diagnosticFailures: BuilderDiagnosticFailure[];
  flags: BuilderFeatureFlags;
  envStatus: BuilderEnvStatus;
  unitEconomics: {
    totalMrrUsd: number;
    totalSmsCostUsd: number;
    totalStorageCostUsd: number;
    grossMarginUsd: number;
    totalStorageMb: number;
    proCount: number;
    enterpriseCount: number;
    starterCount: number;
    perTenant: BuilderTenantUnitEconomics[];
  };
}


