import type {
  EventItem,
  EventPlanningConfig,
  PlanningBudgetCategory,
  PlanningBudgetItem,
  PlanningBudgetStatus,
  PlanningPriority,
  PlanningTask,
  PlanningTaskPhase,
  PlanningTeamRole,
  PlanningVendor,
  PlanningVendorStatus,
} from '../types/events.ts';
import { getEventDateSlots, sanitizeIsoDate } from './eventDates.ts';

export const PLANNING_PHASES: PlanningTaskPhase[] = [
  'Venue & Permits',
  'Vendors & Catering',
  'Marketing & Invites',
  'Gate & Tech',
  'Day-Of Operations',
];

export const PLANNING_BUDGET_CATEGORIES: PlanningBudgetCategory[] = [
  'Venue',
  'AV & Production',
  'Catering',
  'Decor & Signage',
  'Security & Staffing',
  'Marketing & SMS',
  'Contingency',
];

export const PLANNING_ROLE_SUGGESTIONS: string[] = [
  'Gate Check-In Lead',
  'Usher & Seating Lead',
  'Gift Desk Attendant',
  'Stage & Program Coordinator',
  'AV & Sound Technician',
  'Vendor Liaison',
  'VIP Protocol Officer',
  'Security Coordinator',
];

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

interface CategoryPlanningKit {
  currency: 'GHS' | 'USD';
  targetBudget: number;
  tasks: Omit<PlanningTask, 'id'>[];
  budgetItems: Omit<PlanningBudgetItem, 'id'>[];
  vendors: Omit<PlanningVendor, 'id'>[];
  teamRoles: Omit<PlanningTeamRole, 'id'>[];
}

function buildCategoryKit(
  rawCategory: string,
  organizerName: string,
  venueName: string
): CategoryPlanningKit {
  const cat = (rawCategory || 'Events').trim().toLowerCase();
  const lead = organizerName.trim() || 'Lead Organiser';
  const venueLabel = venueName.trim() || 'Primary Venue';

  if (cat === 'wedding') {
    return {
      currency: 'GHS',
      targetBudget: 85000,
      tasks: [
        {
          title: `Confirm ceremony & reception floorplan with ${venueLabel}`,
          phase: 'Venue & Permits',
          priority: 'high',
          dueLabel: 'T-21 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Finalize banquet menu tasting & cake delivery window',
          phase: 'Vendors & Catering',
          priority: 'high',
          dueLabel: 'T-14 Days',
          assignee: 'Catering Lead',
          completed: false,
        },
        {
          title: 'Verify Gift Table MoMo details & assign attendant links',
          phase: 'Gate & Tech',
          priority: 'high',
          dueLabel: 'T-7 Days',
          assignee: 'Gift Desk Lead',
          completed: false,
        },
        {
          title: 'Send SMS + digital QR passes to Bridal Party & VIP Elders',
          phase: 'Marketing & Invites',
          priority: 'medium',
          dueLabel: 'T-5 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Test welcome gate QR scanner & print standby table chart',
          phase: 'Gate & Tech',
          priority: 'high',
          dueLabel: 'Day Before',
          assignee: 'Gate Check-In Lead',
          completed: false,
        },
        {
          title: 'Conduct morning briefing with ushers & bridal protocol team',
          phase: 'Day-Of Operations',
          priority: 'high',
          dueLabel: 'Event Morning',
          assignee: 'Usher & Seating Lead',
          completed: false,
        },
      ],
      budgetItems: [
        {
          title: 'Ceremony & Reception Hall Rental',
          category: 'Venue',
          estimatedCost: 22000,
          actualCost: 22000,
          depositPaid: 11000,
          status: 'deposit_paid',
          vendorName: venueLabel,
        },
        {
          title: 'Banquet Catering & Drinks (250 Guests)',
          category: 'Catering',
          estimatedCost: 35000,
          actualCost: 34500,
          depositPaid: 15000,
          status: 'deposit_paid',
        },
        {
          title: 'Floral Arch, Centerpieces & Lighting',
          category: 'Decor & Signage',
          estimatedCost: 14000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Live Band, MC & Sound System',
          category: 'AV & Production',
          estimatedCost: 8500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'SMS Invitations & Printed Welcome Board',
          category: 'Marketing & SMS',
          estimatedCost: 1800,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
      ],
      vendors: [
        {
          name: venueLabel,
          serviceCategory: 'Venue & Facilities',
          contactPerson: 'Events Manager',
          phone: '+233 24 000 0101',
          quotedFee: 22000,
          status: 'confirmed',
          arrivalWindow: '06:30 AM',
        },
        {
          name: 'Royal Feast Catering',
          serviceCategory: 'Catering & Service',
          contactPerson: 'Head Chef',
          phone: '+233 24 000 0202',
          quotedFee: 34500,
          status: 'confirmed',
          arrivalWindow: '08:00 AM',
        },
        {
          name: 'Lumina Florals & Styling',
          serviceCategory: 'Decor & Florals',
          contactPerson: 'Lead Stylist',
          phone: '+233 20 000 0303',
          quotedFee: 14000,
          status: 'quoted',
          arrivalWindow: '06:00 AM',
        },
      ],
      teamRoles: [
        {
          memberName: lead,
          roleTitle: 'Stage & Program Coordinator',
          station: 'Main Reception Hall',
          shiftWindow: '08:00 AM - 08:00 PM',
          briefed: true,
        },
        {
          memberName: 'Unassigned — Assign Lead',
          roleTitle: 'Gate Check-In Lead',
          station: 'Main Entrance Desk',
          shiftWindow: '09:30 AM - 03:00 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Usher',
          roleTitle: 'Usher & Seating Lead',
          station: 'VIP & Family Tables',
          shiftWindow: '09:30 AM - 04:00 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Attendant',
          roleTitle: 'Gift Desk Attendant',
          station: 'Welcome Foyer Gift Table',
          shiftWindow: '10:00 AM - 05:00 PM',
          briefed: false,
        },
      ],
    };
  }

  if (cat === 'corporate' || cat === 'tech') {
    const isTech = cat === 'tech';
    return {
      currency: 'USD',
      targetBudget: isTech ? 18500 : 14000,
      tasks: [
        {
          title: `Sign venue SLA, fiber internet & backup power check at ${venueLabel}`,
          phase: 'Venue & Permits',
          priority: 'high',
          dueLabel: 'T-21 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: isTech
            ? 'Confirm keynote AV HDMI matrix, stage timers & demo Wi-Fi VLAN'
            : 'Verify AGM/executive presentation decks & microphone allocation',
          phase: 'Vendors & Catering',
          priority: 'high',
          dueLabel: 'T-7 Days',
          assignee: 'AV & Sound Technician',
          completed: false,
        },
        {
          title: 'Configure Live Polls & verified delegate pass restrictions',
          phase: 'Gate & Tech',
          priority: 'medium',
          dueLabel: 'T-5 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Dispatch SMS + calendar reminder & test Walk-In registration QR',
          phase: 'Marketing & Invites',
          priority: 'high',
          dueLabel: 'T-2 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Calibrate reception tablet scanners & badge printers',
          phase: 'Gate & Tech',
          priority: 'high',
          dueLabel: 'Day Before',
          assignee: 'Gate Check-In Lead',
          completed: false,
        },
        {
          title: 'Speaker green-room soundcheck & registration desk open',
          phase: 'Day-Of Operations',
          priority: 'high',
          dueLabel: 'Event Morning',
          assignee: 'Stage & Program Coordinator',
          completed: false,
        },
      ],
      budgetItems: [
        {
          title: 'Conference Hall & Breakout Rooms',
          category: 'Venue',
          estimatedCost: 5500,
          actualCost: 5500,
          depositPaid: 2750,
          status: 'deposit_paid',
          vendorName: venueLabel,
        },
        {
          title: 'Stage LED Screen, Lighting & Recording AV',
          category: 'AV & Production',
          estimatedCost: 4200,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Executive Coffee Breaks & Working Lunch',
          category: 'Catering',
          estimatedCost: 4800,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Lanyards, Directional Signage & Stage Branding',
          category: 'Decor & Signage',
          estimatedCost: 1500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Delegate SMS Dispatch & Contingency Reserve',
          category: 'Contingency',
          estimatedCost: isTech ? 2500 : 1200,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
      ],
      vendors: [
        {
          name: venueLabel,
          serviceCategory: 'Venue & Wi-Fi Infrastructure',
          contactPerson: 'Conference Coordinator',
          phone: '+233 30 000 0401',
          quotedFee: 5500,
          status: 'confirmed',
          arrivalWindow: '06:30 AM',
        },
        {
          name: 'Precision Stage & AV',
          serviceCategory: 'Sound, Projection & Recording',
          contactPerson: 'Technical Director',
          phone: '+233 24 000 0402',
          quotedFee: 4200,
          status: 'quoted',
          arrivalWindow: '07:00 AM',
        },
      ],
      teamRoles: [
        {
          memberName: lead,
          roleTitle: 'Stage & Program Coordinator',
          station: 'Main Auditorium',
          shiftWindow: '07:30 AM - 05:30 PM',
          briefed: true,
        },
        {
          memberName: 'Unassigned — Assign Lead',
          roleTitle: 'Gate Check-In Lead',
          station: 'Lobby Registration Kiosk',
          shiftWindow: '07:30 AM - 01:00 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Tech',
          roleTitle: 'AV & Sound Technician',
          station: 'FOH Control Booth',
          shiftWindow: '07:00 AM - 05:30 PM',
          briefed: false,
        },
      ],
    };
  }

  if (cat === 'church') {
    return {
      currency: 'GHS',
      targetBudget: 24000,
      tasks: [
        {
          title: `Inspect sanctuary seating, overflow tents & parking flow at ${venueLabel}`,
          phase: 'Venue & Permits',
          priority: 'high',
          dueLabel: 'T-14 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Run choir & guest minister soundcheck and wireless mic batteries',
          phase: 'Vendors & Catering',
          priority: 'high',
          dueLabel: 'Day Before',
          assignee: 'AV & Sound Technician',
          completed: false,
        },
        {
          title: 'Prepare First-Timer Welcome Desk & QR check-in cards',
          phase: 'Gate & Tech',
          priority: 'medium',
          dueLabel: 'T-3 Days',
          assignee: 'Usher & Seating Lead',
          completed: false,
        },
        {
          title: 'Send SMS congregation reminder with service schedule',
          phase: 'Marketing & Invites',
          priority: 'medium',
          dueLabel: 'T-2 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Pre-service prayer & usher station briefing',
          phase: 'Day-Of Operations',
          priority: 'high',
          dueLabel: 'Event Morning',
          assignee: 'Usher & Seating Lead',
          completed: false,
        },
      ],
      budgetItems: [
        {
          title: 'Audio, Livestream & Projector Reinforcement',
          category: 'AV & Production',
          estimatedCost: 8500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Visiting Clergy Hospitality & Refreshments',
          category: 'Catering',
          estimatedCost: 5500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Overflow Canopies, Chairs & Directional Signage',
          category: 'Decor & Signage',
          estimatedCost: 6500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Congregation SMS Reminders',
          category: 'Marketing & SMS',
          estimatedCost: 1500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
      ],
      vendors: [
        {
          name: 'Sanctuary Sound & Media',
          serviceCategory: 'Audio & Livestream',
          contactPerson: 'Media Director',
          phone: '+233 24 000 0501',
          quotedFee: 8500,
          status: 'confirmed',
          arrivalWindow: '06:00 AM',
        },
      ],
      teamRoles: [
        {
          memberName: lead,
          roleTitle: 'Stage & Program Coordinator',
          station: 'Altar & Pulpit',
          shiftWindow: '06:30 AM - 01:00 PM',
          briefed: true,
        },
        {
          memberName: 'Unassigned — Assign Head Usher',
          roleTitle: 'Usher & Seating Lead',
          station: 'Sanctuary Doors & Aisles',
          shiftWindow: '06:30 AM - 01:00 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Welcome Lead',
          roleTitle: 'Gate Check-In Lead',
          station: 'First-Timer Welcome Desk',
          shiftWindow: '07:00 AM - 12:30 PM',
          briefed: false,
        },
      ],
    };
  }

  if (cat === 'musical') {
    return {
      currency: 'GHS',
      targetBudget: 65000,
      tasks: [
        {
          title: `Secure noise permit, barrier plan & emergency exits at ${venueLabel}`,
          phase: 'Venue & Permits',
          priority: 'high',
          dueLabel: 'T-21 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Confirm backline rider, stage monitors & lighting rig plot',
          phase: 'Vendors & Catering',
          priority: 'high',
          dueLabel: 'T-7 Days',
          assignee: 'AV & Sound Technician',
          completed: false,
        },
        {
          title: 'Publish live Walk-In QR & gate scanner checkpoints',
          phase: 'Gate & Tech',
          priority: 'high',
          dueLabel: 'T-3 Days',
          assignee: 'Gate Check-In Lead',
          completed: false,
        },
        {
          title: 'Complete full band soundcheck & VIP wristband distribution',
          phase: 'Day-Of Operations',
          priority: 'high',
          dueLabel: 'Event Morning',
          assignee: 'Stage & Program Coordinator',
          completed: false,
        },
      ],
      budgetItems: [
        {
          title: 'Concert Venue & Generator Fuel',
          category: 'Venue',
          estimatedCost: 18000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Line-Array PA, Backline & Stage Lighting',
          category: 'AV & Production',
          estimatedCost: 26000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Gate Security & Crowd Ushers',
          category: 'Security & Staffing',
          estimatedCost: 9000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Artist Green Room & Crew Meals',
          category: 'Catering',
          estimatedCost: 6000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
      ],
      vendors: [
        {
          name: 'Apex Live Audio & Rigging',
          serviceCategory: 'PA, Backline & Lighting',
          contactPerson: 'FOH Engineer',
          phone: '+233 24 000 0601',
          quotedFee: 26000,
          status: 'quoted',
          arrivalWindow: '10:00 AM',
        },
        {
          name: 'Shield Event Security',
          serviceCategory: 'Gate & Crowd Security',
          contactPerson: 'Operations Lead',
          phone: '+233 20 000 0602',
          quotedFee: 9000,
          status: 'sourcing',
          arrivalWindow: '03:00 PM',
        },
      ],
      teamRoles: [
        {
          memberName: lead,
          roleTitle: 'Stage & Program Coordinator',
          station: 'Backstage & Wings',
          shiftWindow: '02:00 PM - 11:30 PM',
          briefed: true,
        },
        {
          memberName: 'Unassigned — Assign Gate Lead',
          roleTitle: 'Gate Check-In Lead',
          station: 'Main Ticket Gate',
          shiftWindow: '04:30 PM - 10:30 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Security',
          roleTitle: 'Security Coordinator',
          station: 'VIP Pit & Perimeter',
          shiftWindow: '04:00 PM - 11:30 PM',
          briefed: false,
        },
      ],
    };
  }

  if (cat === 'funeral') {
    return {
      currency: 'GHS',
      targetBudget: 42000,
      tasks: [
        {
          title: `Confirm grounds, canopy layout & family seating at ${venueLabel}`,
          phase: 'Venue & Permits',
          priority: 'high',
          dueLabel: 'T-14 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Finalize tribute brochure print run & digital program link',
          phase: 'Marketing & Invites',
          priority: 'high',
          dueLabel: 'T-5 Days',
          assignee: lead,
          completed: false,
        },
        {
          title: 'Set up Funeral Donation / Gift Table MoMo & attendant desk links',
          phase: 'Gate & Tech',
          priority: 'high',
          dueLabel: 'T-3 Days',
          assignee: 'Gift Desk Attendant',
          completed: false,
        },
        {
          title: 'Coordinate catering packs, chilled water & bereavement ushers',
          phase: 'Vendors & Catering',
          priority: 'medium',
          dueLabel: 'Day Before',
          assignee: 'Usher & Seating Lead',
          completed: false,
        },
      ],
      budgetItems: [
        {
          title: 'Grounds Rental, Canopies & Chairs',
          category: 'Venue',
          estimatedCost: 12000,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Guest Refreshments & Family Hospitality',
          category: 'Catering',
          estimatedCost: 16500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'PA System & Tribute Screen',
          category: 'AV & Production',
          estimatedCost: 6500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
        {
          title: 'Printed Brochures & Memorial Banners',
          category: 'Decor & Signage',
          estimatedCost: 4500,
          actualCost: 0,
          depositPaid: 0,
          status: 'planned',
        },
      ],
      vendors: [
        {
          name: 'Heritage Canopy & Event Rentals',
          serviceCategory: 'Tents, Seating & Stage',
          contactPerson: 'Logistics Lead',
          phone: '+233 24 000 0701',
          quotedFee: 12000,
          status: 'quoted',
          arrivalWindow: '05:30 AM',
        },
      ],
      teamRoles: [
        {
          memberName: lead,
          roleTitle: 'VIP Protocol Officer',
          station: 'Chief Mourner & Family Tent',
          shiftWindow: '07:00 AM - 04:00 PM',
          briefed: true,
        },
        {
          memberName: 'Unassigned — Assign Attendant',
          roleTitle: 'Gift Desk Attendant',
          station: 'Donation & Sympathy Desk',
          shiftWindow: '07:30 AM - 04:00 PM',
          briefed: false,
        },
        {
          memberName: 'Unassigned — Assign Usher',
          roleTitle: 'Usher & Seating Lead',
          station: 'Guest Tents & Hospitality',
          shiftWindow: '07:00 AM - 04:00 PM',
          briefed: false,
        },
      ],
    };
  }

  // Default ('Events', 'Program', or custom category)
  return {
    currency: 'GHS',
    targetBudget: 30000,
    tasks: [
      {
        title: `Confirm venue access window, seating & signage at ${venueLabel}`,
        phase: 'Venue & Permits',
        priority: 'high',
        dueLabel: 'T-14 Days',
        assignee: lead,
        completed: false,
      },
      {
        title: 'Confirm AV equipment, lighting & catering delivery times',
        phase: 'Vendors & Catering',
        priority: 'high',
        dueLabel: 'T-7 Days',
        assignee: lead,
        completed: false,
      },
      {
        title: 'Publish event invitation link & dispatch guest SMS reminders',
        phase: 'Marketing & Invites',
        priority: 'medium',
        dueLabel: 'T-3 Days',
        assignee: lead,
        completed: false,
      },
      {
        title: 'Test Live Check-In QR & Walk-In Registration screen',
        phase: 'Gate & Tech',
        priority: 'high',
        dueLabel: 'Day Before',
        assignee: 'Gate Check-In Lead',
        completed: false,
      },
      {
        title: 'Complete doors-open briefing with ushers & support team',
        phase: 'Day-Of Operations',
        priority: 'high',
        dueLabel: 'Event Morning',
        assignee: 'Usher & Seating Lead',
        completed: false,
      },
    ],
    budgetItems: [
      {
        title: 'Venue Hire & Utilities',
        category: 'Venue',
        estimatedCost: 10000,
        actualCost: 0,
        depositPaid: 0,
        status: 'planned',
      },
      {
        title: 'Audio Visual & Stage Production',
        category: 'AV & Production',
        estimatedCost: 7500,
        actualCost: 0,
        depositPaid: 0,
        status: 'planned',
      },
      {
        title: 'Guest Catering & Refreshments',
        category: 'Catering',
        estimatedCost: 8500,
        actualCost: 0,
        depositPaid: 0,
        status: 'planned',
      },
      {
        title: 'Signage, Passes & SMS Credits',
        category: 'Marketing & SMS',
        estimatedCost: 2500,
        actualCost: 0,
        depositPaid: 0,
        status: 'planned',
      },
    ],
    vendors: [
      {
        name: venueLabel,
        serviceCategory: 'Venue & Facilities',
        contactPerson: 'Site Coordinator',
        phone: '+233 24 000 0801',
        quotedFee: 10000,
        status: 'quoted',
        arrivalWindow: '07:00 AM',
      },
    ],
    teamRoles: [
      {
        memberName: lead,
        roleTitle: 'Stage & Program Coordinator',
        station: 'Main Hall',
        shiftWindow: '08:00 AM - 06:00 PM',
        briefed: true,
      },
      {
        memberName: 'Unassigned — Assign Gate Lead',
        roleTitle: 'Gate Check-In Lead',
        station: 'Main Entrance',
        shiftWindow: '08:00 AM - 02:00 PM',
        briefed: false,
      },
      {
        memberName: 'Unassigned — Assign Usher',
        roleTitle: 'Usher & Seating Lead',
        station: 'Floor & Seating',
        shiftWindow: '08:30 AM - 05:00 PM',
        briefed: false,
      },
    ],
  };
}

export function createStarterPlanningConfig(
  category: string,
  organizerName = 'Lead Organiser',
  venueName = 'Main Venue',
  eventDateContext?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): EventPlanningConfig {
  const kit = buildCategoryKit(category, organizerName, venueName);
  const slots = getEventDateSlots(eventDateContext);
  const eventDates = slots.map((s) => s.isoDate);
  const firstDate = slots[0]?.isoDate;

  const baseTasks: PlanningTask[] = kit.tasks.map((t, i) => {
    const inferredDate =
      t.phase === 'Day-Of Operations' || /event\s*(morning|day|night)/i.test(t.dueLabel)
        ? firstDate
        : undefined;
    return {
      ...t,
      id: uid(`tsk${i}`),
      ...(inferredDate ? { dueDate: inferredDate } : {}),
    };
  });

  if (slots.length > 1) {
    for (const slot of slots.slice(1, 7)) {
      baseTasks.push({
        id: uid(`tsk-d${slot.dayIndex + 1}`),
        title: `Day ${slot.dayIndex + 1} (${slot.shortLabel}): Gate scanner reset, badge check & stage cue readiness`,
        phase: 'Day-Of Operations',
        priority: 'high',
        dueLabel: slot.fullLabel,
        dueDate: slot.isoDate,
        assignee: organizerName || 'Gate Check-In Lead',
        completed: false,
      });
    }
  }

  const baseVendors: PlanningVendor[] = kit.vendors.map((v, i) => ({
    ...v,
    id: uid(`vnd${i}`),
    ...(firstDate && !v.serviceDate ? { serviceDate: firstDate } : {}),
  }));

  const baseRoles: PlanningTeamRole[] = kit.teamRoles.map((r, i) => ({
    ...r,
    id: uid(`rol${i}`),
    ...(firstDate && !r.shiftDate ? { shiftDate: firstDate } : {}),
  }));

  if (slots.length > 1) {
    for (const slot of slots.slice(1, 7)) {
      baseRoles.push({
        id: uid(`rol-d${slot.dayIndex + 1}`),
        memberName: organizerName || 'Lead Organiser',
        roleTitle: `Day ${slot.dayIndex + 1} Gate & Floor Lead`,
        station: venueName || 'Main Entrance',
        shiftWindow: '08:00 AM - 06:00 PM',
        shiftDate: slot.isoDate,
        briefed: false,
      });
    }
  }

  return {
    appliedTemplateCategory: category || 'Events',
    currency: kit.currency,
    targetBudget: kit.targetBudget,
    ...(eventDates.length > 0 ? { eventDates } : {}),
    tasks: baseTasks,
    budgetItems: kit.budgetItems.map((b, i) => ({ ...b, id: uid(`bdg${i}`) })),
    vendors: baseVendors,
    teamRoles: baseRoles,
    updatedAt: new Date().toISOString(),
  };
}

export function mergeStarterPlanningTemplate(
  existing: EventPlanningConfig | undefined,
  category: string,
  mode: 'replace' | 'append',
  organizerName = 'Lead Organiser',
  venueName = 'Main Venue',
  eventDateContext?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): EventPlanningConfig {
  const fresh = createStarterPlanningConfig(category, organizerName, venueName, eventDateContext);
  if (!existing || mode === 'replace') {
    return fresh;
  }
  const existingTaskTitles = new Set(existing.tasks.map((t) => t.title.trim().toLowerCase()));
  const existingBudgetTitles = new Set(existing.budgetItems.map((b) => b.title.trim().toLowerCase()));
  const existingVendorNames = new Set(existing.vendors.map((v) => v.name.trim().toLowerCase()));
  const existingRoleKeys = new Set(
    existing.teamRoles.map((r) => `${r.roleTitle.trim().toLowerCase()}::${r.shiftDate || ''}`)
  );

  const mergedDates =
    fresh.eventDates && fresh.eventDates.length > 0
      ? fresh.eventDates
      : existing.eventDates;

  return {
    ...existing,
    appliedTemplateCategory: category,
    ...(mergedDates && mergedDates.length > 0 ? { eventDates: mergedDates } : {}),
    tasks: [
      ...existing.tasks,
      ...fresh.tasks.filter((t) => !existingTaskTitles.has(t.title.trim().toLowerCase())),
    ],
    budgetItems: [
      ...existing.budgetItems,
      ...fresh.budgetItems.filter((b) => !existingBudgetTitles.has(b.title.trim().toLowerCase())),
    ],
    vendors: [
      ...existing.vendors,
      ...fresh.vendors.filter((v) => !existingVendorNames.has(v.name.trim().toLowerCase())),
    ],
    teamRoles: [
      ...existing.teamRoles,
      ...fresh.teamRoles.filter(
        (r) => !existingRoleKeys.has(`${r.roleTitle.trim().toLowerCase()}::${r.shiftDate || ''}`)
      ),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export interface EventReadinessSummary {
  hasPlan: boolean;
  scorePct: number;
  completedTasks: number;
  totalTasks: number;
  highPriorityRemaining: number;
  confirmedVendors: number;
  totalVendors: number;
  briefedCrew: number;
  totalCrew: number;
  estimatedTotal: number;
  actualTotal: number;
  depositsPaid: number;
  targetBudget: number;
  variance: number;
  currency: 'GHS' | 'USD';
  statusLabel: 'Not Started' | 'In Preparation' | 'Almost Ready' | 'Gate Ready';
  phaseBreakdown: { phase: PlanningTaskPhase; completed: number; total: number }[];
}

export function computeEventReadiness(event: EventItem): EventReadinessSummary {
  const cfg = event.extraDataConfig?.planningConfig;
  const tasks = cfg?.tasks ?? [];
  const budgetItems = cfg?.budgetItems ?? [];
  const vendors = cfg?.vendors ?? [];
  const teamRoles = cfg?.teamRoles ?? [];

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.completed).length;
  const highPriorityRemaining = tasks.filter((t) => !t.completed && t.priority === 'high').length;

  const totalVendors = vendors.length;
  const confirmedVendors = vendors.filter(
    (v) => v.status === 'confirmed' || v.status === 'paid'
  ).length;

  const totalCrew = teamRoles.length;
  const briefedCrew = teamRoles.filter((r) => r.briefed).length;

  const estimatedTotal = budgetItems.reduce((sum, item) => sum + (Number(item.estimatedCost) || 0), 0);
  const actualTotal = budgetItems.reduce((sum, item) => sum + (Number(item.actualCost) || 0), 0);
  const depositsPaid = budgetItems.reduce((sum, item) => sum + (Number(item.depositPaid) || 0), 0);
  const targetBudget = Number(cfg?.targetBudget) || estimatedTotal || 0;
  const committedSpend = actualTotal > 0 ? actualTotal : estimatedTotal;
  const variance = targetBudget - committedSpend;

  const totalUnits = totalTasks + totalVendors + totalCrew;
  const doneUnits = completedTasks + confirmedVendors + briefedCrew;
  const scorePct = totalUnits > 0 ? Math.round((doneUnits / totalUnits) * 100) : 0;

  const hasPlan = totalUnits > 0 || budgetItems.length > 0;
  const statusLabel: EventReadinessSummary['statusLabel'] = !hasPlan
    ? 'Not Started'
    : scorePct >= 90 && highPriorityRemaining === 0
      ? 'Gate Ready'
      : scorePct >= 50
        ? 'Almost Ready'
        : 'In Preparation';

  const phaseBreakdown = PLANNING_PHASES.map((phase) => {
    const phaseTasks = tasks.filter((t) => t.phase === phase);
    return {
      phase,
      completed: phaseTasks.filter((t) => t.completed).length,
      total: phaseTasks.length,
    };
  });

  return {
    hasPlan,
    scorePct,
    completedTasks,
    totalTasks,
    highPriorityRemaining,
    confirmedVendors,
    totalVendors,
    briefedCrew,
    totalCrew,
    estimatedTotal,
    actualTotal,
    depositsPaid,
    targetBudget,
    variance,
    currency: cfg?.currency ?? 'GHS',
    statusLabel,
    phaseBreakdown,
  };
}

export function formatPlanningMoney(amount: number, currency: 'GHS' | 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = Math.abs(safe).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const sign = safe < 0 ? '-' : '';
  return currency === 'USD' ? `${sign}$${formatted}` : `${sign}GHS ${formatted}`;
}

function clampNonNegativeMoney(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

export function sanitizeEventPlanningConfig(
  raw: unknown,
  fallbackCategory = 'Events',
  eventDateContext?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): EventPlanningConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const appliedTemplateCategory =
    typeof obj.appliedTemplateCategory === 'string' && obj.appliedTemplateCategory.trim()
      ? obj.appliedTemplateCategory.trim().slice(0, 64)
      : (fallbackCategory || 'Events').trim().slice(0, 64);

  const currency: 'GHS' | 'USD' = obj.currency === 'USD' ? 'USD' : 'GHS';
  const targetBudget = clampNonNegativeMoney(obj.targetBudget);

  const contextDates = getEventDateSlots(eventDateContext).map((s) => s.isoDate);
  const rawEventDates = Array.isArray(obj.eventDates)
    ? Array.from(
        new Set(
          obj.eventDates
            .map((d) => sanitizeIsoDate(typeof d === 'string' ? d : undefined))
            .filter((d): d is string => Boolean(d))
        )
      ).sort()
    : [];
  const eventDates = contextDates.length > 0 ? contextDates : rawEventDates;

  const dayScheduleNotes: Record<string, string> = {};
  if (obj.dayScheduleNotes && typeof obj.dayScheduleNotes === 'object') {
    for (const [rawKey, rawNote] of Object.entries(obj.dayScheduleNotes as Record<string, unknown>)) {
      const cleanDate = sanitizeIsoDate(rawKey);
      const cleanNote = typeof rawNote === 'string' ? rawNote.trim().slice(0, 500) : '';
      if (cleanDate && cleanNote) {
        dayScheduleNotes[cleanDate] = cleanNote;
      }
    }
  }

  const validPhases = new Set<PlanningTaskPhase>(PLANNING_PHASES);
  const validPriorities = new Set<PlanningPriority>(['high', 'medium', 'low']);
  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks.slice(0, 150) : [];
  const tasks: PlanningTask[] = [];
  for (const item of rawTasks) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 200) : '';
    if (!title) continue;
    const phase = validPhases.has(rec.phase as PlanningTaskPhase)
      ? (rec.phase as PlanningTaskPhase)
      : 'Venue & Permits';
    const priority = validPriorities.has(rec.priority as PlanningPriority)
      ? (rec.priority as PlanningPriority)
      : 'medium';
    const dueDate = sanitizeIsoDate(typeof rec.dueDate === 'string' ? rec.dueDate : undefined);
    tasks.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : uid('tsk'),
      title,
      phase,
      priority,
      dueLabel:
        typeof rec.dueLabel === 'string' && rec.dueLabel.trim()
          ? rec.dueLabel.trim().slice(0, 48)
          : dueDate || 'T-7 Days',
      ...(dueDate ? { dueDate } : {}),
      assignee:
        typeof rec.assignee === 'string' && rec.assignee.trim()
          ? rec.assignee.trim().slice(0, 80)
          : 'Organiser',
      completed: Boolean(rec.completed),
      completedAt:
        Boolean(rec.completed) && typeof rec.completedAt === 'string' && rec.completedAt.trim()
          ? rec.completedAt.trim().slice(0, 40)
          : undefined,
      notes:
        typeof rec.notes === 'string' && rec.notes.trim()
          ? rec.notes.trim().slice(0, 500)
          : undefined,
    });
  }

  const validBudgetCats = new Set<PlanningBudgetCategory>(PLANNING_BUDGET_CATEGORIES);
  const validBudgetStatuses = new Set<PlanningBudgetStatus>(['planned', 'deposit_paid', 'settled']);
  const rawBudget = Array.isArray(obj.budgetItems) ? obj.budgetItems.slice(0, 150) : [];
  const budgetItems: PlanningBudgetItem[] = [];
  for (const item of rawBudget) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 160) : '';
    if (!title) continue;
    const category = validBudgetCats.has(rec.category as PlanningBudgetCategory)
      ? (rec.category as PlanningBudgetCategory)
      : 'Venue';
    const status = validBudgetStatuses.has(rec.status as PlanningBudgetStatus)
      ? (rec.status as PlanningBudgetStatus)
      : 'planned';
    budgetItems.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : uid('bdg'),
      title,
      category,
      estimatedCost: clampNonNegativeMoney(rec.estimatedCost),
      actualCost: clampNonNegativeMoney(rec.actualCost),
      depositPaid: clampNonNegativeMoney(rec.depositPaid),
      status,
      vendorName:
        typeof rec.vendorName === 'string' && rec.vendorName.trim()
          ? rec.vendorName.trim().slice(0, 120)
          : undefined,
      notes:
        typeof rec.notes === 'string' && rec.notes.trim()
          ? rec.notes.trim().slice(0, 400)
          : undefined,
    });
  }

  const validVendorStatuses = new Set<PlanningVendorStatus>([
    'sourcing',
    'quoted',
    'confirmed',
    'paid',
  ]);
  const rawVendors = Array.isArray(obj.vendors) ? obj.vendors.slice(0, 100) : [];
  const vendors: PlanningVendor[] = [];
  for (const item of rawVendors) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 140) : '';
    if (!name) continue;
    const status = validVendorStatuses.has(rec.status as PlanningVendorStatus)
      ? (rec.status as PlanningVendorStatus)
      : 'quoted';
    const serviceDate = sanitizeIsoDate(
      typeof rec.serviceDate === 'string' ? rec.serviceDate : undefined
    );
    vendors.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : uid('vnd'),
      name,
      serviceCategory:
        typeof rec.serviceCategory === 'string' && rec.serviceCategory.trim()
          ? rec.serviceCategory.trim().slice(0, 100)
          : 'Vendor Service',
      contactPerson:
        typeof rec.contactPerson === 'string' && rec.contactPerson.trim()
          ? rec.contactPerson.trim().slice(0, 100)
          : 'Coordinator',
      phone: typeof rec.phone === 'string' ? rec.phone.trim().slice(0, 40) : '',
      email:
        typeof rec.email === 'string' && rec.email.trim()
          ? rec.email.trim().slice(0, 120)
          : undefined,
      quotedFee: clampNonNegativeMoney(rec.quotedFee),
      status,
      arrivalWindow:
        typeof rec.arrivalWindow === 'string' && rec.arrivalWindow.trim()
          ? rec.arrivalWindow.trim().slice(0, 48)
          : undefined,
      ...(serviceDate ? { serviceDate } : {}),
      notes:
        typeof rec.notes === 'string' && rec.notes.trim()
          ? rec.notes.trim().slice(0, 400)
          : undefined,
    });
  }

  const rawRoles = Array.isArray(obj.teamRoles) ? obj.teamRoles.slice(0, 100) : [];
  const teamRoles: PlanningTeamRole[] = [];
  for (const item of rawRoles) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const roleTitle = typeof rec.roleTitle === 'string' ? rec.roleTitle.trim().slice(0, 100) : '';
    const memberName =
      typeof rec.memberName === 'string' && rec.memberName.trim()
        ? rec.memberName.trim().slice(0, 120)
        : '';
    if (!roleTitle && !memberName) continue;
    const shiftDate = sanitizeIsoDate(typeof rec.shiftDate === 'string' ? rec.shiftDate : undefined);
    teamRoles.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : uid('rol'),
      memberName: memberName || 'Unassigned',
      roleTitle: roleTitle || 'Event Staff',
      station:
        typeof rec.station === 'string' && rec.station.trim()
          ? rec.station.trim().slice(0, 120)
          : 'Main Venue',
      shiftWindow:
        typeof rec.shiftWindow === 'string' && rec.shiftWindow.trim()
          ? rec.shiftWindow.trim().slice(0, 64)
          : 'Full Event',
      ...(shiftDate ? { shiftDate } : {}),
      phone:
        typeof rec.phone === 'string' && rec.phone.trim()
          ? rec.phone.trim().slice(0, 40)
          : undefined,
      briefed: Boolean(rec.briefed),
    });
  }

  return {
    appliedTemplateCategory,
    currency,
    targetBudget,
    ...(eventDates.length > 0 ? { eventDates } : {}),
    ...(Object.keys(dayScheduleNotes).length > 0 ? { dayScheduleNotes } : {}),
    tasks,
    budgetItems,
    vendors,
    teamRoles,
    updatedAt: new Date().toISOString(),
  };
}
