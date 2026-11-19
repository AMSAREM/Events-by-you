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
} from '../types/events';

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
      inviteCode: 'ROYAL2026',
    },
    extraDataConfig: {
      enableGiftTable: true,
      giftTitle: 'Couple Gift Table & Cash Envelope Registry',
      momoNumber: '+233 24 559 8104',
      momoName: 'Boateng-Mensah Wedding Registry',
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
      inviteCode: 'BUILD2026',
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
  name: 'Josh Mensah',
  firstName: 'Josh',
  role: 'Lead Organiser',
  email: 'josh@eventsapp.africa',
  studio: 'Accra Gatherings & Events Hub',
  plan: 'Pro Organizer',
  smsCredits: 1840,
  capacityAlertThreshold: 90,
};

export const INITIAL_EVENTS: EventItem[] = [
  {
    id: 'evt-tech-leaders-2026',
    slug: 'tech-leaders-summit-2026',
    title: 'Tech Leaders Summit 2026',
    subtitle:
      'Annual summit connecting engineering leaders, founders, and infrastructure architects across Africa.',
    category: 'Tech',
    status: 'live',
    date: 'Nov 28, 2026',
    isoDate: '2026-11-28',
    time: '09:00 AM - 05:00 PM GMT',
    venue: 'Accra International Conference Centre',
    city: 'Accra',
    capacity: 50,
    registered: 42,
    checkedIn: 34,
    smsDispatched: 42,
    ticketPrice: 0,
    revenue: 0,
    organizer: 'Josh Mensah',
    artwork: 'architecture',
    designTheme: CATEGORY_DESIGN_PRESETS.Tech.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Tech.flyerUrl,
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Tech.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Tech.extraDataConfig,
  },
  {
    id: 'evt-wedding-mensah',
    slug: 'mensah-boateng-wedding',
    title: 'Mensah & Boateng Royal Wedding',
    subtitle:
      'Holy matrimony, garden cocktail hour, and evening dinner reception with reserved family & guest table passes.',
    category: 'Wedding',
    status: 'upcoming',
    date: 'Dec 06, 2026',
    isoDate: '2026-12-06',
    time: '11:00 AM - 08:00 PM GMT',
    venue: 'Labadi Beach Hotel Gardens',
    city: 'Accra',
    capacity: 250,
    registered: 218,
    checkedIn: 0,
    smsDispatched: 218,
    ticketPrice: 0,
    revenue: 0,
    organizer: 'Boateng Family Planners',
    artwork: 'spatial',
    designTheme: CATEGORY_DESIGN_PRESETS.Wedding.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Wedding.flyerUrl,
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Wedding.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Wedding.extraDataConfig,
  },
  {
    id: 'evt-church-revival',
    slug: 'grace-revival-convention',
    title: 'Grace Revival Night & Choir Convention',
    subtitle:
      'An evening of worship, guest choir ministrations, and prophetic word with rapid SMS gate check-in.',
    category: 'Church',
    status: 'live',
    date: 'Nov 22, 2026',
    isoDate: '2026-11-22',
    time: '05:30 PM - 09:30 PM GMT',
    venue: 'Lighthouse Cathedral Auditorium',
    city: 'Accra',
    capacity: 1200,
    registered: 1120,
    checkedIn: 940,
    smsDispatched: 1118,
    ticketPrice: 0,
    revenue: 0,
    organizer: 'Grace Chapel Ministry',
    artwork: 'forum',
    designTheme: CATEGORY_DESIGN_PRESETS.Church.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Church.flyerUrl,
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Church.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Church.extraDataConfig,
  },
  {
    id: 'evt-musical-accra',
    slug: 'accra-acoustic-afrobeats-live',
    title: 'Accra Acoustic & Afrobeats Live',
    subtitle:
      'Live orchestral highlife, acoustic soul, and headliner concert under the stars with VIP table passes.',
    category: 'Musical',
    status: 'upcoming',
    date: 'Dec 14, 2026',
    isoDate: '2026-12-14',
    time: '06:00 PM - 11:30 PM GMT',
    venue: 'Untamed Empire Arena',
    city: 'Accra',
    capacity: 800,
    registered: 684,
    checkedIn: 0,
    smsDispatched: 680,
    ticketPrice: 25,
    revenue: 17100,
    organizer: 'GoldCoast Live Music',
    artwork: 'sound',
    designTheme: CATEGORY_DESIGN_PRESETS.Musical.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Musical.flyerUrl,
    broadcastError: '2 Telco DLR retries pending',
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Musical.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Musical.extraDataConfig,
  },
  {
    id: 'evt-funeral-memorial',
    slug: 'nana-osei-tutu-memorial',
    title: 'Celebration of Life: Nana Osei Tutu Memorial',
    subtitle:
      'Burial service, family tribute roster, and Sunday Thanksgiving reception with coordinated guest seating.',
    category: 'Funeral',
    status: 'upcoming',
    date: 'Dec 19, 2026',
    isoDate: '2026-12-19',
    time: '08:00 AM - 04:00 PM GMT',
    venue: 'Ridge Park Forecourt',
    city: 'Kumasi',
    capacity: 500,
    registered: 420,
    checkedIn: 0,
    smsDispatched: 420,
    ticketPrice: 0,
    revenue: 0,
    organizer: 'Osei Tutu Royal Family',
    artwork: 'typography',
    designTheme: CATEGORY_DESIGN_PRESETS.Funeral.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Funeral.flyerUrl,
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Funeral.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Funeral.extraDataConfig,
  },
  {
    id: 'evt-corporate-gala',
    slug: 'west-africa-executive-gala',
    title: 'West Africa Corporate & Banking Gala',
    subtitle:
      'Annual shareholder dinner, executive awards ceremony, and keynote address for corporate leadership.',
    category: 'Corporate',
    status: 'upcoming',
    date: 'Dec 11, 2026',
    isoDate: '2026-12-11',
    time: '06:30 PM WAT',
    venue: 'Kempinski Gold Coast City',
    city: 'Accra',
    capacity: 400,
    registered: 356,
    checkedIn: 0,
    smsDispatched: 356,
    ticketPrice: 75,
    revenue: 26700,
    organizer: 'Meridian Corporate Group',
    artwork: 'hardware',
    designTheme: CATEGORY_DESIGN_PRESETS.Corporate.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Corporate.flyerUrl,
    qrPassPublished: true,
    validationConfig: CATEGORY_DESIGN_PRESETS.Corporate.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Corporate.extraDataConfig,
  },
  {
    id: 'evt-cultural-lagos',
    slug: 'lagos-cultural-arts-festival',
    title: 'Lagos Cultural & Heritage Showcase',
    subtitle:
      'Multi-stage cultural exhibition, culinary pavilion, and artisan showcase open to registered guests.',
    category: 'Events',
    status: 'draft',
    date: 'Jan 16, 2027',
    isoDate: '2027-01-16',
    time: '12:00 PM WAT',
    venue: 'Victoria Island Gallery',
    city: 'Lagos',
    capacity: 300,
    registered: 0,
    checkedIn: 0,
    smsDispatched: 0,
    ticketPrice: 15,
    revenue: 0,
    organizer: 'Josh Mensah',
    artwork: 'forum',
    designTheme: CATEGORY_DESIGN_PRESETS.Events.designTheme,
    flyerUrl: CATEGORY_DESIGN_PRESETS.Events.flyerUrl,
    qrPassPublished: false,
    validationConfig: CATEGORY_DESIGN_PRESETS.Events.validationConfig,
    extraDataConfig: CATEGORY_DESIGN_PRESETS.Events.extraDataConfig,
  },
];

export const INITIAL_ATTENDEES: Attendee[] = [
  {
    id: 'att-tls-1',
    name: 'Kofi Annan',
    email: 'kofi@accrasystems.gh',
    phone: '+233 24 412 3456',
    organization: 'Accra Systems',
    eventId: 'evt-tech-leaders-2026',
    tier: 'VIP',
    checkedIn: true,
    checkedInAt: '09:12 AM',
    ticketCode: 'TLS-2026-0811',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Founder / Executive',
    customResponses: {
      workshop_track: 'Distributed Systems & Infra',
      badge_size: 'L',
      linkedin_github: '@kofiannan-dev',
    },
  },
  {
    id: 'att-tls-2',
    name: 'Abena Osei',
    email: 'abena@techhub.gh',
    phone: '+233 20 898 7654',
    organization: 'TechHub Ghana',
    eventId: 'evt-tech-leaders-2026',
    tier: 'General',
    checkedIn: false,
    ticketCode: 'TLS-2026-0819',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Engineer / Architect',
    customResponses: {
      workshop_track: 'FinTech & Payments',
      badge_size: 'M',
    },
  },
  {
    id: 'att-tls-3',
    name: 'Kwesi Appiah',
    email: 'kwesi@startup.io',
    phone: '+233 55 321 6549',
    organization: 'Startup IO',
    eventId: 'evt-tech-leaders-2026',
    tier: 'VIP',
    checkedIn: true,
    checkedInAt: '09:25 AM',
    ticketCode: 'TLS-2026-0827',
    smsStatus: 'Resend Delivered',
    paymentStatus: 'paid',
    validationGroup: 'Investor / Partner',
    customResponses: {
      workshop_track: 'Founder Office Hours',
      badge_size: 'XL',
    },
  },
  {
    id: 'att-tls-4',
    name: 'Ama Serwaa',
    email: 'ama@fintech.africa',
    phone: '+233 24 987 6543',
    organization: 'FinTech Africa',
    eventId: 'evt-tech-leaders-2026',
    tier: 'General',
    checkedIn: false,
    ticketCode: 'TLS-2026-0835',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Community Builder',
    customResponses: {
      workshop_track: 'Applied AI & Products',
      badge_size: 'S',
    },
  },
  {
    id: 'att-101',
    name: 'Maame Efua Boateng',
    email: 'efua.boateng@family.gh',
    phone: '+233 24 559 8104',
    organization: 'Bride Family Table 1',
    eventId: 'evt-wedding-mensah',
    tier: 'VIP',
    checkedIn: true,
    checkedInAt: '10:42',
    ticketCode: 'WED-26-8891-VIP',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: "Bride's Family",
    giftEntry: {
      giftType: 'cash-momo',
      amount: 1500,
      currency: 'GHS',
      side: "Bride's Family",
      message: 'Wishing Kofi & Ama an eternal covenant of joy and peace!',
    },
    customResponses: {
      dietary_note: 'Standard Banquet',
      plus_one: 'Uncle Yaw Boateng',
    },
  },
  {
    id: 'att-102',
    name: 'Pastor Daniel Adjei',
    email: 'd.adjei@gracechapel.org',
    phone: '+233 50 112 9942',
    organization: 'Grace Chapel Ministry',
    eventId: 'evt-church-revival',
    tier: 'Speaker',
    checkedIn: true,
    checkedInAt: '17:15',
    ticketCode: 'CHU-26-8892-SPK',
    smsStatus: 'Resend Delivered',
    paymentStatus: 'paid',
    validationGroup: 'Pastoral & Visiting Clergy',
    customResponses: {
      home_parish: 'Grace Chapel Cathedral',
      prayer_request: 'Open heavens over the youth revival choir',
    },
  },
  {
    id: 'att-103',
    name: 'Kwame Boateng',
    email: 'kwame@goldcoast.vc',
    phone: '+233 20 884 1120',
    organization: 'GoldCoast Holdings',
    eventId: 'evt-corporate-gala',
    tier: 'VIP',
    checkedIn: false,
    ticketCode: 'CRP-26-8898-VIP',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Board & C-Suite',
    customResponses: {
      job_title: 'Managing Partner',
      dinner_course: 'Herb-Crusted Red Snapper',
    },
  },
  {
    id: 'att-104',
    name: 'Tunde Bakare',
    email: 'tunde@lagoslive.ng',
    phone: '+234 803 441 9021',
    organization: 'Lagos Music Press',
    eventId: 'evt-musical-accra',
    tier: 'VIP',
    checkedIn: false,
    ticketCode: 'MUS-26-4401-VIP',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'failed',
    validationGroup: 'Backstage & Media',
    customResponses: {
      arrival_wave: '06:00 PM (Opening Acoustic)',
      song_request: 'Highlife Medley in D Major',
    },
  },
  {
    id: 'att-105',
    name: 'Nana Akua Prempeh',
    email: 'akua.prempeh@kumasi.gh',
    phone: '+233 24 390 4411',
    organization: 'Asanteman Family Delegation',
    eventId: 'evt-funeral-memorial',
    tier: 'VIP',
    checkedIn: true,
    checkedInAt: '08:15',
    ticketCode: 'FUN-26-2109-VIP',
    smsStatus: 'Resend Delivered',
    paymentStatus: 'paid',
    validationGroup: 'Royal Clan / Immediate Family',
    customResponses: {
      sympathy_pledge: 'GHS 500 Royal Family Support',
      condolence_tribute: 'Forever remembered for wisdom, kindness, and service to Kumasi.',
    },
  },
  {
    id: 'att-106',
    name: 'Chidi Okonkwo',
    email: 'chidi@meridianbank.ng',
    phone: '+234 818 220 7731',
    organization: 'Meridian Bank PLC',
    eventId: 'evt-corporate-gala',
    tier: 'Speaker',
    checkedIn: false,
    ticketCode: 'CRP-26-3302-SPK',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Keynote & Honoree',
    customResponses: {
      job_title: 'Group Head of Strategy',
      dinner_course: 'Braised Beef Medallion',
    },
  },
  {
    id: 'att-107',
    name: 'Sister Grace Owusu',
    email: 'grace.owusu@gracechapel.org',
    phone: '+233 54 512 0091',
    organization: 'Mass Choir Ministry',
    eventId: 'evt-church-revival',
    tier: 'General',
    checkedIn: true,
    checkedInAt: '17:28',
    ticketCode: 'CHU-26-1044-GEN',
    smsStatus: 'Arkesel Sent',
    paymentStatus: 'paid',
    validationGroup: 'Choir / Workforce',
    customResponses: {
      home_parish: 'Cantonments Sanctuary',
    },
  },
  {
    id: 'att-108',
    name: 'Esi Mensah-Bonsu',
    email: 'esi@beatpulse.com',
    phone: '+233 24 910 3318',
    organization: 'BeatPulse Media',
    eventId: 'evt-musical-accra',
    tier: 'Press',
    checkedIn: false,
    ticketCode: 'MUS-26-8904-PRS',
    smsStatus: 'Resend Delivered',
    paymentStatus: 'paid',
    validationGroup: 'Backstage & Media',
    customResponses: {
      arrival_wave: '07:30 PM (Main Ensemble)',
    },
  },
];

export const INITIAL_SCHEDULE: ScheduleBlock[] = [
  {
    id: 'sch-tls-1',
    eventId: 'evt-tech-leaders-2026',
    time: '09:00 - 10:00',
    duration: '60m',
    title: 'Keynote: The Future of African Tech Infrastructure',
    stage: 'Main Auditorium · Livestream',
    lead: 'Dr. Kwame Mensah',
    completed: true,
    day: 'Sat',
  },
  {
    id: 'sch-tls-2',
    eventId: 'evt-tech-leaders-2026',
    time: '10:15 - 11:30',
    duration: '75m',
    title: 'Panel: Scaling FinTech Across Borders',
    stage: 'Hall B · Q&A Session',
    lead: 'Elena Boateng & Panelists',
    completed: false,
    day: 'Sat',
  },
  {
    id: 'sch-tls-3',
    eventId: 'evt-tech-leaders-2026',
    time: '12:00 - 01:30',
    duration: '90m',
    title: 'Networking & Founders Lunch',
    stage: 'Courtyard Garden · Catered',
    lead: 'All Attendees',
    completed: false,
    day: 'Sat',
  },
  {
    id: 'sch-wed-1',
    eventId: 'evt-wedding-mensah',
    time: '11:00 - 12:30',
    duration: '90m',
    title: 'Bridal Processional, Vows & Ring Exchange',
    stage: 'Oceanfront Chapel Lawn',
    lead: 'Rev. Samuel Ofori',
    completed: false,
    day: 'Sat',
  },
  {
    id: 'sch-wed-2',
    eventId: 'evt-wedding-mensah',
    time: '14:00 - 18:00',
    duration: '240m',
    title: 'Grand Reception Dinner & First Dance',
    stage: 'Labadi Grand Marquee',
    lead: 'MC Kojo & Live Band',
    completed: false,
    day: 'Sat',
  },
  {
    id: 'sch-chu-1',
    eventId: 'evt-church-revival',
    time: '17:30 - 18:45',
    duration: '75m',
    title: 'Opening Praise & Mass Choir Ministration',
    stage: 'Cathedral Main Sanctuary',
    lead: 'Grace Choir Ensemble',
    completed: true,
    day: 'Wed',
  },
  {
    id: 'sch-chu-2',
    eventId: 'evt-church-revival',
    time: '19:00 - 20:45',
    duration: '105m',
    title: 'Sermon & Prayer Altar Call',
    stage: 'Cathedral Main Sanctuary',
    lead: 'Pastor Daniel Adjei',
    completed: false,
    day: 'Wed',
  },
  {
    id: 'sch-mus-1',
    eventId: 'evt-musical-accra',
    time: '19:00 - 20:30',
    duration: '90m',
    title: 'Acoustic Highlife & Opening Guest Sets',
    stage: 'Main Amphitheatre Stage',
    lead: 'Accra Brass & Acoustic',
    completed: false,
    day: 'Fri',
  },
  {
    id: 'sch-fun-1',
    eventId: 'evt-funeral-memorial',
    time: '08:00 - 10:30',
    duration: '150m',
    title: 'Filing Past, Family Tributes & Biography Reading',
    stage: 'Ridge Park Forecourt',
    lead: 'Osei Tutu Family Elders',
    completed: false,
    day: 'Sat',
  },
  {
    id: 'sch-crp-1',
    eventId: 'evt-corporate-gala',
    time: '18:30 - 20:30',
    duration: '120m',
    title: 'Executive Keynote & Annual Excellence Awards',
    stage: 'Kempinski Grand Ballroom',
    lead: 'Chidi Okonkwo',
    completed: false,
    day: 'Thu',
  },
];

export const INITIAL_ALERTS: SystemAlert[] = [
  {
    id: 'alt-1',
    title: 'Grace Revival Night at 93% capacity',
    detail: '1,120 / 1,200 seats allocated. Overflow marquee allocation recommended.',
    category: 'capacity',
    eventId: 'evt-church-revival',
    timestamp: '12m ago',
    resolved: false,
  },
  {
    id: 'alt-2',
    title: '2 Telco DLR retries pending',
    detail: 'Arkesel SMS delivery callback retrying 2 guest passes on Accra Acoustic Live.',
    category: 'broadcast',
    eventId: 'evt-musical-accra',
    timestamp: '29m ago',
    resolved: false,
  },
  {
    id: 'alt-3',
    title: 'VIP concert pass payment declined',
    detail: 'Ticket #MUS-26-4401-VIP (Tunde Bakare) needs MoMo / card retry.',
    category: 'payment',
    eventId: 'evt-musical-accra',
    timestamp: '54m ago',
    resolved: false,
  },
];

export const VELOCITY_SERIES: Record<TimeRange, VelocityPoint[]> = {
  '7D': [
    { label: 'Mon', registrations: 142, checkIns: 118, revenue: 3550 },
    { label: 'Tue', registrations: 198, checkIns: 174, revenue: 4950 },
    { label: 'Wed', registrations: 256, checkIns: 238, revenue: 6400 },
    { label: 'Thu', registrations: 224, checkIns: 204, revenue: 5600 },
    { label: 'Fri', registrations: 312, checkIns: 289, revenue: 7800 },
    { label: 'Sat', registrations: 378, checkIns: 352, revenue: 9450 },
    { label: 'Sun', registrations: 420, checkIns: 368, revenue: 10500 },
  ],
  '30D': [
    { label: 'W1', registrations: 340, checkIns: 302, revenue: 8500 },
    { label: 'W2', registrations: 418, checkIns: 381, revenue: 10450 },
    { label: 'W3', registrations: 392, checkIns: 365, revenue: 9800 },
    { label: 'W4', registrations: 510, checkIns: 472, revenue: 12750 },
    { label: 'W5', registrations: 584, checkIns: 541, revenue: 14600 },
    { label: 'Now', registrations: 650, checkIns: 604, revenue: 16250 },
  ],
  '90D': [
    { label: 'Aug', registrations: 790, checkIns: 710, revenue: 19750 },
    { label: 'Sep', registrations: 940, checkIns: 865, revenue: 23500 },
    { label: 'Oct', registrations: 1210, checkIns: 1120, revenue: 30250 },
    { label: 'Nov', registrations: 1650, checkIns: 1528, revenue: 41250 },
  ],
};

export const INITIAL_ROLL_SETTINGS: Record<string, DisposableRollSettings> = {
  'evt-tech-leaders-2026': { exposuresLimit: 24, darkroomMode: false },
  'evt-wedding-mensah': { exposuresLimit: 24, darkroomMode: false },
  'evt-musical-accra': { exposuresLimit: 24, darkroomMode: false },
};

export const INITIAL_DISPOSABLE_SHOTS: DisposableShot[] = [
  {
    id: 'shot-tls-1',
    eventId: 'evt-tech-leaders-2026',
    frameNumber: 1,
    dataUrl: '/src/assets/images/dispo_summit_networking_1795017070315.jpg',
    capturedBy: 'Kofi Annan',
    caption: 'Founders & engineering leads catching up between morning sessions at AICC.',
    filmStock: 'fuji-c200',
    dateStamp: "'26 11 28",
    capturedAt: '10:18 AM',
    developed: true,
    likes: 14,
    liked: false,
  },
  {
    id: 'shot-wed-1',
    eventId: 'evt-wedding-mensah',
    frameNumber: 1,
    dataUrl: '/src/assets/images/dispo_wedding_toast_1795017069093.jpg',
    capturedBy: 'Maame Efua Boateng',
    caption: 'Golden hour toast under the garden string lights at Labadi Beach.',
    filmStock: 'kodak-gold',
    dateStamp: "'26 12 06",
    capturedAt: '05:42 PM',
    developed: true,
    likes: 28,
    liked: true,
  },
  {
    id: 'shot-mus-1',
    eventId: 'evt-musical-accra',
    frameNumber: 1,
    dataUrl: '/src/assets/images/dispo_concert_crowd_1795017069829.jpg',
    capturedBy: 'Esi Mensah-Bonsu',
    caption: 'Encore set under the stage beams — pure energy on 35mm black & white.',
    filmStock: 'ilford-bw',
    dateStamp: "'26 12 14",
    capturedAt: '10:35 PM',
    developed: true,
    likes: 19,
    liked: false,
  },
];

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

