import type {
  Attendee,
  DesignTheme,
  DisposableRollSettings,
  DisposableShot,
  EventExtraDataConfig,
  EventItem,
  EventValidationConfig,
  OrganizerProfile,
  ScheduleBlock,
  SystemAlert,
  TimeRange,
  VelocityPoint,
} from '../types/events.ts';

export const EVENT_CATEGORIES = [
  'Events',
  'Program',
  'Wedding',
  'Funeral',
  'Church',
  'Musical',
  'Corporate',
  'Tech',
] as const;

export interface CategoryDesignPreset {
  flyerUrl: string;
  designTheme: DesignTheme;
  validationConfig: EventValidationConfig;
  extraDataConfig: EventExtraDataConfig;
}

export const CATEGORY_DESIGN_PRESETS: Record<string, CategoryDesignPreset> = {
  Wedding: {
    flyerUrl: '/src/assets/images/flyer_wedding_royal_1795075790983.jpg',
    designTheme: 'editorial-ivory',
    validationConfig: {
      enabled: true,
      label: 'Guest Circle & Table Validation',
      options: [
        "Bride's Family",
        "Groom's Family",
        'Mutual Friends',
        'Bridal Party',
        'Church & Community',
        'VIP Elders',
      ],
      requireInviteCode: false,
      inviteCode: '',
    },
    extraDataConfig: {
      enableGiftTable: true,
      giftTitle: 'Gift Table & Cash Envelope Registry',
      momoNumber: '',
      momoName: '',
      giftRegistryItems: [
        'Cash Envelope / MoMo Blessing',
        'Luxury Espresso Machine Set',
        'Bridal Linen & Bedding Suite',
        'Fine Dining Glassware (12-Piece)',
        'Honeymoon Travel Fund Contribution',
      ],
      customFields: [
        {
          id: 'dietary_note',
          label: 'Dietary / Allergy Preference',
          type: 'select',
          required: false,
          options: ['Standard Banquet', 'Vegetarian', 'Halal', 'No Nuts / Gluten-Free'],
        },
        {
          id: 'plus_one',
          label: 'Seat Reservation / Plus-One Name',
          type: 'text',
          required: false,
          placeholder: 'Optional spouse or partner full name',
        },
      ],
    },
  },
  Tech: {
    flyerUrl: '/src/assets/images/flyer_tech_summit_1795075791295.jpg',
    designTheme: 'swiss-grid',
    validationConfig: {
      enabled: true,
      label: 'Delegate Role Verification',
      options: [
        'Engineer / Architect',
        'Founder / Executive',
        'Investor / Partner',
        'Speaker / Panelist',
        'Community Builder',
        'Press & Media',
      ],
      requireInviteCode: false,
      inviteCode: '',
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'workshop_track',
          label: 'Primary Breakout Track',
          type: 'select',
          required: true,
          options: ['Distributed Systems & Infra', 'FinTech & Payments', 'Applied AI & Products', 'Founder Office Hours'],
        },
        {
          id: 'badge_size',
          label: 'Summit T-Shirt / Merch Size',
          type: 'select',
          required: false,
          options: ['S', 'M', 'L', 'XL', 'XXL'],
        },
        {
          id: 'linkedin_github',
          label: 'GitHub or LinkedIn Handle',
          type: 'text',
          required: false,
          placeholder: '@handle or profile URL',
        },
      ],
    },
  },
  Church: {
    flyerUrl: '/src/assets/images/flyer_church_revival_1795075792994.jpg',
    designTheme: 'obsidian-gold',
    validationConfig: {
      enabled: true,
      label: 'Congregation & Fellowship Group',
      options: [
        'Church Member',
        'First-Time Guest',
        'Choir / Workforce',
        'Youth & Campus Fellowship',
        'Pastoral & Visiting Clergy',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'home_parish',
          label: 'Home Parish / Branch',
          type: 'text',
          required: false,
          placeholder: 'e.g. Accra Central Assembly',
        },
        {
          id: 'prayer_request',
          label: 'Prayer Request / Counseling Focus',
          type: 'textarea',
          required: false,
          placeholder: 'Optional note for the pastoral altar team',
        },
      ],
    },
  },
  Musical: {
    flyerUrl: '/src/assets/images/flyer_musical_live_1795075793134.jpg',
    designTheme: 'obsidian-gold',
    validationConfig: {
      enabled: true,
      label: 'Pass Enclosure & Section',
      options: [
        'Frontline Pit / Standing',
        'VIP Table Lounge',
        'Early Bird General',
        'Artist Guestlist',
        'Backstage & Media',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'arrival_wave',
          label: 'Planned Gate Arrival Window',
          type: 'select',
          required: false,
          options: ['06:00 PM (Opening Acoustic)', '07:30 PM (Main Ensemble)', '09:00 PM (Headliner Set)'],
        },
        {
          id: 'song_request',
          label: 'Encore Song Request / Shoutout',
          type: 'text',
          required: false,
          placeholder: 'Which track should the live band play?',
        },
      ],
    },
  },
  Corporate: {
    flyerUrl: '/src/assets/images/flyer_corporate_gala_1795075792816.jpg',
    designTheme: 'obsidian-gold',
    validationConfig: {
      enabled: true,
      label: 'Corporate Accreditation',
      options: [
        'Board & C-Suite',
        'Corporate Delegate',
        'Institutional Sponsor',
        'Keynote & Honoree',
        'Financial Press',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      enablePolls: true,
      pollsTitle: 'Live Corporate & Delegate Polls',
      polls: [],
      customFields: [
        {
          id: 'job_title',
          label: 'Official Title & Department',
          type: 'text',
          required: false,
          placeholder: 'e.g. VP Treasury Operations',
        },
        {
          id: 'dinner_course',
          label: 'Gala Dinner Entree Selection',
          type: 'select',
          required: true,
          options: ['Herb-Crusted Red Snapper', 'Braised Beef Medallion', 'Plant-Based Chef Tasting'],
        },
      ],
    },
  },
  Funeral: {
    flyerUrl: '/src/assets/images/flyer_funeral_memorial_1795075793453.jpg',
    designTheme: 'warm-monochrome',
    validationConfig: {
      enabled: true,
      label: 'Family & Sympathizer Delegation',
      options: [
        'Royal Clan / Immediate Family',
        'Church & Clergy Delegation',
        'Friends & Old Students',
        'Workplace & Association',
        'Community Sympathizer',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'sympathy_pledge',
          label: 'Family Wreath / Commemoration Pledge (Optional)',
          type: 'text',
          required: false,
          placeholder: 'e.g. GHS 200 Family Support or Floral Wreath',
        },
        {
          id: 'condolence_tribute',
          label: 'Condolence Book Tribute Note',
          type: 'textarea',
          required: false,
          placeholder: 'Share a brief tribute memory for the printed family keepsake',
        },
      ],
    },
  },
  Program: {
    flyerUrl: '/src/assets/images/flyer_corporate_gala_1795075792816.jpg',
    designTheme: 'swiss-grid',
    validationConfig: {
      enabled: true,
      label: 'Program Cohort Validation',
      options: [
        'Full Program Fellow',
        'Workshop Participant',
        'Mentor & Facilitator',
        'Invited Observer',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'session_focus',
          label: 'Session Objective / Question',
          type: 'textarea',
          required: false,
          placeholder: 'What outcome would you like from this program?',
        },
      ],
    },
  },
  Events: {
    flyerUrl: '/src/assets/images/flyer_musical_live_1795075793134.jpg',
    designTheme: 'warm-monochrome',
    validationConfig: {
      enabled: true,
      label: 'Guest Relation & Access Tier',
      options: [
        'Host & Family Circle',
        'Invited Guest',
        'Community & Friends',
        'VIP & Partners',
      ],
      requireInviteCode: false,
    },
    extraDataConfig: {
      enableGiftTable: false,
      customFields: [
        {
          id: 'guest_note',
          label: 'Special Accommodation or Note',
          type: 'text',
          required: false,
          placeholder: 'Accessibility, seating, or arrival notes',
        },
      ],
    },
  },
};

export function getCategoryPreset(category?: string): CategoryDesignPreset {
  if (!category) return CATEGORY_DESIGN_PRESETS.Events;
  const matchedKey = Object.keys(CATEGORY_DESIGN_PRESETS).find(
    (key) => key.toLowerCase() === category.trim().toLowerCase()
  );
  return matchedKey ? CATEGORY_DESIGN_PRESETS[matchedKey] : CATEGORY_DESIGN_PRESETS.Events;
}

export const INITIAL_PROFILE: OrganizerProfile = {
  name: 'Organiser',
  firstName: 'Organiser',
  role: 'Lead Organiser',
  email: '',
  studio: 'Events Studio',
  plan: 'Starter',
  smsCredits: 0,
  capacityAlertThreshold: 90,
};

export const INITIAL_EVENTS: EventItem[] = [];

export const INITIAL_ATTENDEES: Attendee[] = [];

export const INITIAL_SCHEDULE: ScheduleBlock[] = [];

export const INITIAL_ALERTS: SystemAlert[] = [];

export const VELOCITY_SERIES: Record<TimeRange, VelocityPoint[]> = {
  '7D': [
    { label: 'Mon', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Tue', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Wed', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Thu', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Fri', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Sat', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Sun', registrations: 0, checkIns: 0, revenue: 0 },
  ],
  '30D': [
    { label: 'W1', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'W2', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'W3', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'W4', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'W5', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Now', registrations: 0, checkIns: 0, revenue: 0 },
  ],
  '90D': [
    { label: 'Q1', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Q2', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Q3', registrations: 0, checkIns: 0, revenue: 0 },
    { label: 'Now', registrations: 0, checkIns: 0, revenue: 0 },
  ],
};

export function computeVelocitySeries(
  events: EventItem[],
  attendees: Attendee[],
  range: TimeRange
): VelocityPoint[] {
  const baseLabels: Record<TimeRange, string[]> = {
    '7D': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    '30D': ['W1', 'W2', 'W3', 'W4', 'W5', 'Now'],
    '90D': ['M1', 'M2', 'M3', 'Now'],
  };
  const labels = baseLabels[range];
  const points: VelocityPoint[] = labels.map((label) => ({
    label,
    registrations: 0,
    checkIns: 0,
    revenue: 0,
  }));
  if (events.length === 0 && attendees.length === 0) {
    return points;
  }

  const eventById = new Map(events.map((evt) => [evt.id, evt]));
  const totalEventRegs = events.reduce((acc, e) => acc + Math.max(0, e.registered || 0), 0);
  const totalEventCheckIns = events.reduce((acc, e) => acc + Math.max(0, e.checkedIn || 0), 0);
  const totalEventRevenue = events.reduce((acc, e) => acc + Math.max(0, e.revenue || 0), 0);

  if (attendees.length > 0) {
    attendees.forEach((att, idx) => {
      const evt = eventById.get(att.eventId);
      const bucketIdx = idx % points.length;
      points[bucketIdx].registrations += 1;
      if (att.checkedIn) {
        points[bucketIdx].checkIns += 1;
      }
      if (att.paymentStatus === 'paid' && evt?.ticketPrice) {
        points[bucketIdx].revenue += evt.ticketPrice;
      }
    });
  }

  const lastIdx = points.length - 1;
  const accountedRegs = points.reduce((acc, p) => acc + p.registrations, 0);
  const accountedChecks = points.reduce((acc, p) => acc + p.checkIns, 0);
  const accountedRev = points.reduce((acc, p) => acc + p.revenue, 0);

  if (totalEventRegs > accountedRegs) {
    points[lastIdx].registrations += totalEventRegs - accountedRegs;
  }
  if (totalEventCheckIns > accountedChecks) {
    points[lastIdx].checkIns += totalEventCheckIns - accountedChecks;
  }
  if (totalEventRevenue > accountedRev) {
    points[lastIdx].revenue += totalEventRevenue - accountedRev;
  }

  return points;
}

export const INITIAL_ROLL_SETTINGS: Record<string, DisposableRollSettings> = {};

export const INITIAL_DISPOSABLE_SHOTS: DisposableShot[] = [];

const GATEWAY_DIAL_CODES: Record<string, string> = {
  GH: '233',
  NG: '234',
  KE: '254',
  RW: '250',
};

/** Normalizes Ghanaian/African local phone inputs into strict E.164 format */
export function normalizePhoneE164(raw: string, countryGateway = 'GH'): string {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    const digitsAfterPlus = cleaned.slice(1).replace(/\D/g, '');
    const strippedTrunkZero = digitsAfterPlus.replace(/^(233|234|254|250)0+(\d+)$/, '$1$2');
    return `+${strippedTrunkZero}`;
  }
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';
  if (
    digits.startsWith('233') ||
    digits.startsWith('234') ||
    digits.startsWith('254') ||
    digits.startsWith('250')
  ) {
    return `+${digits.replace(/^(233|234|254|250)0+(\d+)$/, '$1$2')}`;
  }
  const dialCode = GATEWAY_DIAL_CODES[countryGateway] || '';
  if (digits.startsWith('0') && digits.length >= 9 && dialCode) {
    return `+${dialCode}${digits.slice(1)}`;
  }
  if (dialCode) {
    return `+${dialCode}${digits}`;
  }
  return `+${digits}`;
}

export function isValidE164Phone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

const DISALLOWED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid',
  'localhost',
  'phone.eventsbyyou.xyz',
]);

export function validateStrictPhoneE164(
  raw: string,
  countryGateway = 'GH'
): { ok: true; normalized: string } | { ok: false; normalized: string; error: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { ok: false, normalized: '', error: 'Mobile phone number is required.' };
  }
  const normalized = normalizePhoneE164(trimmed, countryGateway);
  if (!isValidE164Phone(normalized)) {
    return {
      ok: false,
      normalized,
      error: 'Enter a valid mobile phone number in E.164 format (e.g. +233 24 123 4567).',
    };
  }
  const subscriberDigits = normalized.replace(/^\+(233|234|254|250)/, '');
  if (/^(\d)\1{5,}$/.test(subscriberDigits)) {
    return {
      ok: false,
      normalized,
      error: 'Please enter your real active mobile number (repeated placeholder digits are not allowed).',
    };
  }
  if (normalized.startsWith('+233')) {
    if (!/^\+233[235679]\d{8}$/.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: 'Ghana numbers (+233) must contain 9 digits after +233 (e.g. 024 123 4567 or +233241234567).',
      };
    }
  } else if (normalized.startsWith('+234')) {
    if (!/^\+234[789][01]\d{8}$/.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: 'Nigeria numbers (+234) must contain 10 valid subscriber digits after +234 (e.g. 0803 123 4567).',
      };
    }
  } else if (normalized.startsWith('+254')) {
    if (!/^\+254[17]\d{8}$/.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: 'Kenya numbers (+254) must contain 9 digits starting with 7 or 1 after +254.',
      };
    }
  } else if (normalized.startsWith('+250')) {
    if (!/^\+250[27]\d{8}$/.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: 'Rwanda numbers (+250) must contain 9 digits starting with 7 or 2 after +250.',
      };
    }
  }
  return { ok: true, normalized };
}

export function validateStrictEmail(
  raw: string
): { ok: true; normalized: string } | { ok: false; normalized: string; error: string } {
  const normalized = (raw || '').trim().toLowerCase();
  if (!normalized) {
    return { ok: false, normalized: '', error: 'Email address is required.' };
  }
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    return { ok: false, normalized, error: 'Enter a valid email address (e.g. name@domain.com).' };
  }
  const domain = normalized.split('@')[1] || '';
  if (DISALLOWED_EMAIL_DOMAINS.has(domain)) {
    return {
      ok: false,
      normalized,
      error: `Email domain "${domain}" is reserved or invalid. Use a real personal or organisation email.`,
    };
  }
  return { ok: true, normalized };
}

export function validateStrictPassword(
  password: string
): { ok: true } | { ok: false; error: string } {
  if (!password || typeof password !== 'string') {
    return { ok: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { ok: false, error: 'Password must be 128 characters or fewer.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must include at least 1 uppercase letter (A-Z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must include at least 1 number (0-9).' };
  }
  return { ok: true };
}

