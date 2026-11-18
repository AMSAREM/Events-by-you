import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  ArtworkVariant,
  EventItem,
  OrganizerProfile,
  ScheduleBlock,
} from '../types/events';
import { EVENT_CATEGORIES } from '../data/initialData';
import { MonochromePoster } from './MonochromeArtwork';

interface CreateEventWizardScreenProps {
  profile: OrganizerProfile;
  events: EventItem[];
  onCancel: () => void;
  onNavigateBilling: () => void;
  onCreateEvent: (event: EventItem, blocks: ScheduleBlock[]) => Promise<void> | void;
}

const DEFAULT_FLYER_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuB64zppvQ--lTZt5G8HBRwJiEoTH_IfBaf4trwNq4H_g6Nt7M4qJrhBBI-5lCfDNFpjQTfQSM5hjXN2hrwuNoTq0qPnpsqDKiuR29BPOKzpMOyIBenB94FsZEvsFLvLYZVECuvfGc9tm7JV5Lwh5lNqNRPs2U2RhEQx91pmOHFGs4D0vjYj8XaEhWsaH5CyD662oOrO8WbM5IanKjWzDAyq7wAJt1xoXBdIwa_4sLU';

const DEFAULT_MAP_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBG7XwCjdJL0mywXlYxEdYbBKh6f91nmzT9OsA7DYZpARieaEYX8dX6HIzvhcl2k-1vKXcNTXZ75cX-uhN5kLFYtZuO-gTscHm5p0chIaBDm2CGzD21CbjM-KWMFrUsZnunsCRk15ngt8OQJ6-is1tDwj5_k4Q3Fj9O_HNlmJYu039OhwDk4x3zkjtJugvccalmUSTXuAvuyvN4Fl32FFciGu3C-4hnLJKIK5hEXpw';

const DEFAULT_MOBILE_CARD_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDE0LSA2Iri_71JYod29SaVB-S2EA4Buwds9qDMeE-eR0ztOY0xYczSQc12FQW30PLYhBrBye5ENH9_68SdNyImwmFjOyB4E8SS3JybbMjl0_bU0PK9vFaE89oZ6GsJ82lFtky69CxU_yHZyL8pIozZxcKUu8tROop6gaPuaEkVRT54914HOC3MvYshiE1nSJIfP-2sQ7VvL_uHtV7-_GV1KB6XZ5bkgIs7zYNMBsE';

const ARTWORK_OPTIONS: { id: ArtworkVariant; label: string }[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'forum', label: 'Forum' },
  { id: 'sound', label: 'Sound' },
  { id: 'typography', label: 'Typography' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'spatial', label: 'Spatial' },
];

export const CreateEventWizardScreen: React.FC<CreateEventWizardScreenProps> = ({
  profile,
  events,
  onCancel,
  onNavigateBilling,
  onCreateEvent,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [category, setCategory] = useState<string>('Events');
  const [title, setTitle] = useState('Accra Annual Gathering & Showcase 2026');
  const [slug, setSlug] = useState('accra-annual-gathering-2026');
  const [slugTouched, setSlugTouched] = useState(false);
  const [overview, setOverview] = useState(
    'Join 500+ guests across weddings, church conventions, musical nights, corporate galas, memorials, and tech summits with seamless SMS gate passes.'
  );
  const [tags, setTags] = useState<string[]>(['Events', 'Accra 2026', 'SMS Pass']);
  const [newTagInput, setNewTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  const [venueFormat, setVenueFormat] = useState<'in-person' | 'virtual' | 'hybrid'>('in-person');
  const [dateLabel, setDateLabel] = useState('Nov 14, 2026');
  const [timeLabel, setTimeLabel] = useState('09:00 AM - 05:30 PM GMT');
  const [venue, setVenue] = useState('Mövenpick Ambassador Hotel');
  const [city, setCity] = useState('Accra, Ghana');

  const [flyerUrl, setFlyerUrl] = useState<string>(DEFAULT_FLYER_URL);
  const [flyerFailed, setFlyerFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [cardFailed, setCardFailed] = useState(false);
  const [artwork, setArtwork] = useState<ArtworkVariant>('architecture');

  // Step 2: Schedule blocks
  const [draftBlocks, setDraftBlocks] = useState<
    { id: string; time: string; title: string; lead: string; stage: string }[]
  >([
    {
      id: 'wiz-blk-1',
      time: '09:00 - 10:00',
      title: 'Opening Keynote: Resilient Cloud Infrastructure',
      lead: profile.name,
      stage: 'Main Auditorium',
    },
    {
      id: 'wiz-blk-2',
      time: '10:30 - 11:45',
      title: 'Panel: Arkesel SMS & Mobile Payout Rails',
      lead: 'Regional FinTech Leads',
      stage: 'Hall B',
    },
  ]);
  const [newBlockTime, setNewBlockTime] = useState('13:00 - 14:15');
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockLead, setNewBlockLead] = useState('');
  const [newBlockStage, setNewBlockStage] = useState('Workshop Lab');

  // Step 3: Telecom & Capacity
  const [senderId, setSenderId] = useState('TECHLEADERS');
  const [replyEmail, setReplyEmail] = useState(profile.email);
  const [instantDispatch, setInstantDispatch] = useState(true);
  const [capacity, setCapacity] = useState(profile.plan === 'Starter' ? 50 : 500);
  const [ticketPrice, setTicketPrice] = useState(0);
  const [smsTemplate, setSmsTemplate] = useState(
    'Hi {name}, your pass for {event} is confirmed! Present QR token {ticket_code} at {venue}.'
  );
  const [enforceUniquePhone, setEnforceUniquePhone] = useState(true);
  const [autoCloseCap, setAutoCloseCap] = useState(true);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFreePlan = profile.plan === 'Starter';
  const activeEventsCount = events.filter((e) => e.status === 'live' || e.status === 'upcoming').length;
  const activeEventSample = events.find((e) => e.status === 'live') ?? events[0];
  const isAtFreeLimit = isFreePlan && activeEventsCount >= 1;

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugTouched) {
      const nextSlug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
      if (nextSlug) setSlug(nextSlug);
    }
  };

  const handleCopySlug = () => {
    const full = `${window.location.origin}/e/${slug}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(full).catch(() => {});
    }
    setCopiedSlug(true);
    setTimeout(() => setCopiedSlug(false), 1800);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFlyerUrl(reader.result);
        setFlyerFailed(false);
        setCardFailed(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setAddingTag(false);
      setNewTagInput('');
      return;
    }
    setTags((prev) => [...prev, trimmed]);
    setNewTagInput('');
    setAddingTag(false);
  };

  const handleAddDraftBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockTitle.trim()) return;
    setDraftBlocks((prev) => [
      ...prev,
      {
        id: `wiz-blk-${Date.now()}`,
        time: newBlockTime.trim() || '14:00 - 15:00',
        title: newBlockTitle.trim(),
        lead: newBlockLead.trim() || profile.name,
        stage: newBlockStage.trim() || 'Main Hall',
      },
    ]);
    setNewBlockTitle('');
    setNewBlockLead('');
  };

  const applyCategoryPreset = (nextCat: string) => {
    setCategory(nextCat);
    const presets: Record<
      string,
      {
        title: string;
        slug: string;
        overview: string;
        tags: string[];
        venue: string;
        artwork: ArtworkVariant;
        block1: string;
        block2: string;
      }
    > = {
      Events: {
        title: 'Accra Cultural & Heritage Gathering 2026',
        slug: 'accra-cultural-gathering-2026',
        overview:
          'Curated celebration bringing families, community leaders, and special guests together with instant QR passes and seamless gate check-in.',
        tags: ['Events', 'Celebration', 'Accra 2026'],
        venue: 'Accra International Conference Centre',
        artwork: 'forum',
        block1: 'Doors Open & Guest Arrival Check-In',
        block2: 'Main Program & Evening Hospitality',
      },
      Wedding: {
        title: 'Mensah & Boateng Royal Wedding Reception',
        slug: 'mensah-boateng-royal-wedding',
        overview:
          'Holy matrimony, garden cocktail hour, and dinner reception with reserved family tables and instant SMS seating invitations.',
        tags: ['Wedding', 'Ceremony & Reception', 'Family RSVP'],
        venue: 'Labadi Beach Hotel Gardens',
        artwork: 'spatial',
        block1: 'Bridal Processional, Vows & Ring Exchange',
        block2: 'Grand Reception Dinner & First Dance',
      },
      Funeral: {
        title: 'Celebration of Life: Nana Osei Tutu Memorial',
        slug: 'nana-osei-tutu-memorial-2026',
        overview:
          'Dignified funeral service, family tribute reading, and Sunday Thanksgiving reception with coordinated guest seating and gate passes.',
        tags: ['Funeral', 'Memorial Service', 'Thanksgiving'],
        venue: 'Ridge Park Forecourt',
        artwork: 'typography',
        block1: 'Filing Past, Family Tributes & Biography Reading',
        block2: 'Burial Procession & Refreshment Reception',
      },
      Church: {
        title: 'Grace Revival Night & Choir Convention',
        slug: 'grace-revival-convention-2026',
        overview:
          'Evening of worship, mass choir ministration, and prophetic word with rapid SMS pass verification at sanctuary entrances.',
        tags: ['Church', 'Worship & Choir', 'Convention'],
        venue: 'Lighthouse Cathedral Auditorium',
        artwork: 'forum',
        block1: 'Opening Praise & Mass Choir Ministration',
        block2: 'Sermon & Prayer Altar Call',
      },
      Musical: {
        title: 'Accra Acoustic & Afrobeats Live Concert',
        slug: 'accra-acoustic-afrobeats-live',
        overview:
          'Live orchestral highlife, acoustic soul, and headliner performances under the stars with VIP table and general admission QR passes.',
        tags: ['Musical', 'Live Concert', 'VIP Tables'],
        venue: 'Untamed Empire Arena',
        artwork: 'sound',
        block1: 'Acoustic Highlife & Opening Guest Sets',
        block2: 'Headliner Live Band Performance',
      },
      Corporate: {
        title: 'West Africa Executive & Banking Gala 2026',
        slug: 'west-africa-executive-gala-2026',
        overview:
          'Annual corporate gala, stakeholder forum, and executive awards dinner with badge printing and VIP table check-in.',
        tags: ['Corporate', 'Executive Gala', 'Awards'],
        venue: 'Kempinski Gold Coast City',
        artwork: 'hardware',
        block1: 'Executive Keynote & Annual Results Briefing',
        block2: 'Corporate Excellence Awards & Dinner',
      },
      Tech: {
        title: 'Accra AI & Cloud Summit 2026',
        slug: 'accra-ai-cloud-2026',
        overview:
          'Join 500+ engineering leaders, cloud architects, and builders across Africa for production talks, demos, and developer workshops.',
        tags: ['Tech', 'Developers & AI', 'Summit'],
        venue: 'Mövenpick Ambassador Hotel',
        artwork: 'architecture',
        block1: 'Opening Keynote: Resilient Cloud Infrastructure',
        block2: 'Panel: Arkesel SMS & Mobile Payout Rails',
      },
    };
    const p = presets[nextCat];
    if (p) {
      setTitle(p.title);
      if (!slugTouched) setSlug(p.slug);
      setOverview(p.overview);
      setTags(p.tags);
      setVenue(p.venue);
      setArtwork(p.artwork);
      setDraftBlocks([
        { id: 'wiz-blk-1', time: '09:00 - 11:00', title: p.block1, lead: profile.name, stage: 'Main Hall' },
        { id: 'wiz-blk-2', time: '12:00 - 14:30', title: p.block2, lead: 'Program Hosts', stage: 'Main Stage' },
      ]);
    }
  };

  const handleFinish = async (publishStatus: 'upcoming' | 'draft') => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const eventId = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const finalCap = isFreePlan ? Math.min(50, Math.max(10, capacity)) : Math.max(10, capacity);
      const createdEvent: EventItem = {
        id: eventId,
        slug: slug.trim() || 'new-event',
        title: title.trim() || 'Untitled Production',
        subtitle: overview.trim(),
        category: category || tags[0] || 'Events',
        status: publishStatus,
        date: dateLabel.trim() || 'Dec 18, 2026',
        isoDate: '2026-12-18',
        time: timeLabel.trim() || '09:00 GMT',
        venue: venueFormat === 'virtual' ? 'Livestream Stage' : venue.trim() || 'Main Auditorium',
        city: city.trim() || 'Accra',
        capacity: finalCap,
        registered: 0,
        checkedIn: 0,
        smsDispatched: 0,
        ticketPrice: Math.max(0, ticketPrice),
        revenue: 0,
        organizer: profile.studio || profile.name,
        artwork,
        flyerUrl: flyerUrl || undefined,
        venueFormat,
        senderId,
      };

      const createdBlocks: ScheduleBlock[] = draftBlocks.map((blk, i) => ({
        id: `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${i}`,
        eventId,
        time: blk.time,
        duration: '60m',
        title: blk.title,
        stage: blk.stage,
        lead: blk.lead,
        completed: false,
        day: 'Sat',
      }));

      await onCreateEvent(createdEvent, createdBlocks);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { id: 1 as const, title: 'Event Basics & Flyer', sub: 'Core Info & Media' },
    { id: 2 as const, title: 'Program & Schedule', sub: 'Tracks & Sessions' },
    { id: 3 as const, title: 'SMS & Automations', sub: 'Arkesel & Capacity' },
    { id: 4 as const, title: 'Review & Publish', sub: 'Pre-flight Checks' },
  ];

  const smsSegments = Math.max(1, Math.ceil(smsTemplate.length / 160));

  return (
    <div className="space-y-6">
      {/* Top Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-[#71717A]">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 hover:text-[#0B0B0B] font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Events
            </button>
            <span>/</span>
            <span className="text-[#0B0B0B] font-semibold">Create New Event</span>
          </div>
          <h1 className="font-display text-[26px] sm:text-[32px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Event Creation Wizard
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleFinish('draft')}
            className="px-4 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => handleFinish('upcoming')}
            className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>Publish Event</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4-Step Progress Stepper */}
      <div className="bg-[#F5F5F7] rounded-3xl p-2 flex items-center gap-1.5 overflow-x-auto">
        {steps.map((s) => {
          const active = step === s.id;
          const completed = step > s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl flex-1 min-w-[175px] text-left transition-all ${
                active
                  ? 'bg-white shadow-sm'
                  : completed
                  ? 'opacity-90 hover:bg-white/60'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                  active || completed
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#E2E2E4] text-[#444748]'
                }`}
              >
                {completed ? <Check className="w-3.5 h-3.5" /> : s.id}
              </span>
              <span className="min-w-0">
                <span className="text-xs font-semibold text-[#0B0B0B] block truncate">
                  {s.title}
                </span>
                <span className="text-[11px] text-[#71717A] block truncate">{s.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Primary Content Grid (8 cols Form / 4 cols Sticky Sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
          {step === 1 && (
            <>
              {/* Card 1: Basic Info */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Basic Event Information
                  </h2>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Step 1.1
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
                    Event Type (Click to load tailored defaults)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EVENT_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => applyCategoryPreset(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                          category === cat
                            ? 'bg-[#0B0B0B] text-white'
                            : 'bg-white text-[#71717A] hover:text-[#0B0B0B] border border-[#E5E5EA]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Event Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="e.g. Mensah & Boateng Wedding or Tech Summit"
                    className="w-full h-11 px-4 rounded-2xl bg-white text-sm text-[#0B0B0B] shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#0B0B0B]">Public Event URL</label>
                    <span className="text-[11px] font-medium text-[#0B0B0B]">Slug available</span>
                  </div>
                  <div className="flex items-center bg-white rounded-2xl px-4 h-11 shadow-sm text-xs">
                    <span className="text-[#71717A] select-none">eventsapp.africa/e/</span>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                      }}
                      className="w-full bg-transparent font-mono font-semibold text-[#0B0B0B] focus:outline-none ml-0.5"
                    />
                    <button
                      type="button"
                      onClick={handleCopySlug}
                      title="Copy preview link"
                      className="ml-2 text-[#71717A] hover:text-[#0B0B0B] shrink-0"
                    >
                      {copiedSlug ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#0B0B0B]">
                      Event Agenda &amp; Overview
                    </label>
                    <span className="text-[11px] text-[#71717A]">Supports Markdown</span>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#EEEEF0]/70 text-[11px] text-[#71717A]">
                      <button
                        type="button"
                        onClick={() => setOverview((p) => `${p}\n• Keynote: `)}
                        className="px-2 py-0.5 rounded bg-white text-[#0B0B0B] font-semibold hover:bg-[#E2E2E4]"
                      >
                        + Bullet
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverview((p) => `${p}\n**Track Highlight:** `)}
                        className="px-2 py-0.5 rounded bg-white text-[#0B0B0B] font-semibold hover:bg-[#E2E2E4]"
                      >
                        + Bold
                      </button>
                      <span className="ml-auto">Rich Text Mode</span>
                    </div>
                    <textarea
                      rows={4}
                      value={overview}
                      onChange={(e) => setOverview(e.target.value)}
                      className="w-full p-4 bg-transparent text-xs sm:text-sm text-[#0B0B0B] focus:outline-none resize-none leading-relaxed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-2">
                    Tags &amp; Industry Classification
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-medium"
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                          aria-label={`Remove ${tag}`}
                          className="hover:opacity-75"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                    {addingTag ? (
                      <form onSubmit={handleAddTag} className="inline-flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          placeholder="Tag name"
                          className="h-7 px-3 rounded-full bg-white text-xs text-[#0B0B0B] border border-[#E5E5EA] focus:outline-none w-28"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold"
                        >
                          Add
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingTag(true)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#E8E8EA] hover:bg-white text-[#0B0B0B] text-[11px] font-semibold transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Category</span>
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Card 2: Date, Time & Venue */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4.5 h-4.5 text-[#0B0B0B]" />
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                      Date, Time &amp; Location
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    Step 1.2
                  </span>
                </div>

                <div className="p-1 bg-[#E8E8EA] rounded-2xl flex items-center max-w-md">
                  {(
                    [
                      { id: 'in-person', label: 'In-Person Venue' },
                      { id: 'virtual', label: 'Virtual / Stream' },
                      { id: 'hybrid', label: 'Hybrid Format' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setVenueFormat(mode.id)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        venueFormat === mode.id
                          ? 'bg-white text-[#0B0B0B] shadow-sm'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Event Date
                    </label>
                    <input
                      type="text"
                      value={dateLabel}
                      onChange={(e) => setDateLabel(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Hours &amp; Timezone
                    </label>
                    <input
                      type="text"
                      value={timeLabel}
                      onChange={(e) => setTimeLabel(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      Venue / Hall Name
                    </label>
                    <input
                      type="text"
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                      City &amp; Country
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                    />
                  </div>
                </div>

                {/* Map Visual Preview */}
                <div className="relative w-full h-36 rounded-2xl overflow-hidden shadow-sm bg-[#E8E8EA]">
                  {!mapFailed ? (
                    <img
                      src={DEFAULT_MAP_URL}
                      alt="Venue location map preview"
                      referrerPolicy="no-referrer"
                      onError={() => setMapFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#EEEEF0] to-[#D9DADC]" />
                  )}
                  <div className="absolute inset-0 bg-[#0B0B0B]/15 flex items-end p-4">
                    <div className="bg-white/95 backdrop-blur-md px-3.5 py-1.5 rounded-full inline-flex items-center gap-2 shadow-sm text-xs font-semibold text-[#0B0B0B]">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>
                        {venue} · {city}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 3: Flyer & Monochrome Motif */}
              <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImagePlus className="w-4.5 h-4.5 text-[#0B0B0B]" />
                    <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                      Flyer &amp; Visual Banner
                    </h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                    16:9 Media
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                  <div className="md:col-span-5 relative group overflow-hidden rounded-2xl bg-white aspect-[4/3] shadow-sm">
                    {flyerUrl && !flyerFailed ? (
                      <img
                        src={flyerUrl}
                        alt="Event flyer banner preview"
                        referrerPolicy="no-referrer"
                        onError={() => setFlyerFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-4">
                        <MonochromePoster variant={artwork} className="w-24 h-24 rounded-2xl" />
                      </div>
                    )}
                    <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-[#0B0B0B]/80 text-white text-[10px] font-semibold">
                      16:9 Banner Active
                    </span>
                  </div>

                  <div className="md:col-span-7 flex flex-col gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-6 rounded-2xl bg-white border border-dashed border-[#C4C7C7] hover:border-[#0B0B0B] text-center transition-colors flex flex-col items-center gap-1.5"
                    >
                      <ImagePlus className="w-6 h-6 text-[#0B0B0B]" />
                      <span className="text-xs font-semibold text-[#0B0B0B]">
                        Click to upload custom event flyer
                      </span>
                      <span className="text-[11px] text-[#71717A]">
                        PNG, JPG, or WebP up to 5.0 MB
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <span className="text-[11px] text-[#71717A]">
                        Fallback Poster Motif:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {ARTWORK_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setArtwork(opt.id)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                              artwork === opt.id
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-white text-[#71717A] hover:text-[#0B0B0B]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {step === 2 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Program &amp; Session Schedule
                  </h2>
                  <p className="text-xs text-[#71717A] mt-0.5">
                    Sessions added here publish directly to your public registration timeline.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-white text-xs font-semibold text-[#0B0B0B] tabular-nums">
                  {draftBlocks.length} blocks
                </span>
              </div>

              <form onSubmit={handleAddDraftBlock} className="p-4 rounded-2xl bg-white grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={newBlockTitle}
                  onChange={(e) => setNewBlockTitle(e.target.value)}
                  placeholder="Session Title (e.g. Fireside Chat)"
                  className="sm:col-span-2 h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <input
                  type="text"
                  value={newBlockTime}
                  onChange={(e) => setNewBlockTime(e.target.value)}
                  placeholder="13:00 - 14:15"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs font-mono text-[#0B0B0B] focus:outline-none"
                />
                <input
                  type="text"
                  value={newBlockLead}
                  onChange={(e) => setNewBlockLead(e.target.value)}
                  placeholder="Speaker / Host"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <input
                  type="text"
                  value={newBlockStage}
                  onChange={(e) => setNewBlockStage(e.target.value)}
                  placeholder="Room / Stage"
                  className="h-10 px-4 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none"
                />
                <button
                  type="submit"
                  className="h-10 px-5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
                >
                  + Add Program Block
                </button>
              </form>

              <div className="space-y-2.5">
                {draftBlocks.map((blk) => (
                  <div
                    key={blk.id}
                    className="p-4 rounded-2xl bg-white flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="px-3 py-1 rounded-full bg-[#F5F5F7] font-mono text-xs font-semibold text-[#0B0B0B] tabular-nums shrink-0">
                        {blk.time}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0B0B0B] truncate">{blk.title}</p>
                        <p className="text-[11px] text-[#71717A] truncate">
                          {blk.lead} · {blk.stage}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftBlocks((prev) => prev.filter((item) => item.id !== blk.id))
                      }
                      aria-label="Remove program block"
                      className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#EF4444]/10 hover:text-[#EF4444] flex items-center justify-center text-[#71717A] shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4.5 h-4.5 text-[#0B0B0B]" />
                  <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                    Telecom, Ticketing &amp; Messaging
                  </h2>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#E8E8EA] text-[11px] font-semibold uppercase tracking-wider text-[#71717A]">
                  Arkesel &amp; Resend
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Arkesel SMS Sender ID
                  </label>
                  <select
                    value={senderId}
                    onChange={(e) => setSenderId(e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] shadow-sm focus:outline-none"
                  >
                    <option value="TECHLEADERS">TECHLEADERS (Primary • NCA Verified)</option>
                    <option value="EVENTSAPP">Default System (EVENTSAPP)</option>
                    <option value="DEVCON">DEVCON (Community Approved)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Organizer Reply-To Email
                  </label>
                  <div className="flex items-center bg-white rounded-2xl px-4 h-11 shadow-sm">
                    <Mail className="w-4 h-4 text-[#71717A] mr-2 shrink-0" />
                    <input
                      type="email"
                      value={replyEmail}
                      onChange={(e) => setReplyEmail(e.target.value)}
                      className="w-full bg-transparent text-xs sm:text-sm text-[#0B0B0B] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Capacity Ceiling ({isFreePlan ? 'Max 50 on Free Tier' : 'Unlimited on Pro'})
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={isFreePlan ? 50 : 25000}
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] font-mono shadow-sm focus:outline-none tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1.5">
                    Ticket Price ($0 = Free RSVP)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={ticketPrice}
                    onChange={(e) => setTicketPrice(Number(e.target.value))}
                    className="w-full h-11 px-4 rounded-2xl bg-white text-xs sm:text-sm text-[#0B0B0B] font-mono shadow-sm focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Instant Multi-Channel Dispatch
                  </p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    Auto-send instant Arkesel SMS ticket with QR hash &amp; Resend email upon RSVP.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={instantDispatch}
                    onChange={(e) => setInstantDispatch(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#0B0B0B]">
                    Confirmation SMS Template
                  </label>
                  <span className="text-[11px] font-mono text-[#71717A] tabular-nums">
                    {smsSegments} SMS credit/pass · {smsTemplate.length} / 160 chars
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={smsTemplate}
                  onChange={(e) => setSmsTemplate(e.target.value)}
                  className="w-full p-4 rounded-2xl bg-white text-xs font-mono text-[#0B0B0B] shadow-sm focus:outline-none resize-none"
                />
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="bg-[#F5F5F7] rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-[#0B0B0B]">
                  Pre-Flight Review &amp; Launch
                </h2>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready to Publish
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Title &amp; URL</span>
                  <p className="text-sm font-bold text-[#0B0B0B]">{title}</p>
                  <p className="text-xs font-mono text-[#71717A]">/e/{slug}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Schedule &amp; Venue</span>
                  <p className="text-sm font-bold text-[#0B0B0B]">{dateLabel}</p>
                  <p className="text-xs text-[#71717A]">
                    {venue} · {city}
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Program Blocks</span>
                  <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                    {draftBlocks.length} Scheduled Sessions
                  </p>
                  <p className="text-xs text-[#71717A]">First block: {draftBlocks[0]?.time ?? 'None'}</p>
                </div>
                <div className="p-4 rounded-2xl bg-white space-y-1">
                  <span className="text-[11px] text-[#71717A]">Telecom &amp; Quota</span>
                  <p className="text-sm font-bold text-[#0B0B0B] tabular-nums">
                    Sender ID: {senderId} · Cap {capacity}
                  </p>
                  <p className="text-xs text-[#71717A]">
                    {instantDispatch ? 'Auto SMS + Resend active' : 'Manual dispatch only'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleFinish('draft')}
                  className="px-5 py-2.5 rounded-full bg-white text-[#0B0B0B] border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleFinish('upcoming')}
                  className="px-6 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  <span>{submitting ? 'Publishing...' : 'Publish Event Live'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT SIDEBAR COLUMN (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6 min-w-0">
          {/* Subscription Guardrail Card */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">Subscription Guardrail</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  isAtFreeLimit
                    ? 'bg-[#EF4444]/10 text-[#EF4444]'
                    : 'bg-white text-[#0B0B0B]'
                }`}
              >
                {isAtFreeLimit ? 'Limit Reached' : 'Quota Clear'}
              </span>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-base font-bold text-[#0B0B0B]">
                  {isFreePlan ? 'Free Tier' : profile.plan}
                </span>
                <span className="text-xs text-[#71717A] tabular-nums">
                  {isFreePlan
                    ? `${activeEventsCount} of 1 Active Events`
                    : `${activeEventsCount} Active Events (∞)`}
                </span>
              </div>
              <div className="w-full bg-[#E2E2E4] rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full ${isAtFreeLimit ? 'bg-[#EF4444]' : 'bg-[#0B0B0B]'}`}
                  style={{ width: isFreePlan ? '100%' : '28%' }}
                />
              </div>
            </div>

            {isFreePlan && activeEventSample && (
              <div className="p-3.5 bg-white rounded-2xl text-xs text-[#71717A] leading-relaxed">
                <strong className="text-[#0B0B0B]">{activeEventSample.title}</strong> is active.
                Upgrade to Pro for unlimited concurrent events and higher capacities.
              </div>
            )}

            {isFreePlan && (
              <div className="bg-[#0B0B0B] text-white rounded-2xl p-4 flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-semibold block">Upgrade to Pro</span>
                  <span className="text-[11px] text-zinc-400">$19 / month · Unlimited events</span>
                </div>
                <button
                  type="button"
                  onClick={onNavigateBilling}
                  className="px-3.5 py-1.5 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
                >
                  Upgrade
                </button>
              </div>
            )}
          </section>

          {/* Live Mobile Attendee Card Preview */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0B0B0B]">Live Attendee Preview</span>
              <span className="text-[11px] font-mono text-[#71717A] truncate">/e/{slug}</span>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden bg-[#EEEEF0]">
                {!cardFailed ? (
                  <img
                    src={flyerUrl !== DEFAULT_FLYER_URL ? flyerUrl : DEFAULT_MOBILE_CARD_URL}
                    alt="Mobile attendee ticket preview"
                    referrerPolicy="no-referrer"
                    onError={() => setCardFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    <MonochromePoster variant={artwork} className="w-20 h-20 rounded-xl" />
                  </div>
                )}
                <span className="absolute top-2 right-2 px-2.5 py-0.5 rounded-full bg-white/95 text-[#0B0B0B] text-[11px] font-semibold">
                  {ticketPrice === 0 ? 'Free Pass' : `$${ticketPrice}`}
                </span>
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] tabular-nums">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{dateLabel}</span>
                </div>
                <h3 className="text-sm font-bold text-[#0B0B0B] mt-1 leading-snug">{title}</h3>
                <p className="text-[11px] text-[#71717A] mt-0.5 truncate">
                  {venue} · {city}
                </p>
              </div>

              <div className="w-full py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold text-center">
                {ticketPrice === 0 ? 'Register Free Pass' : `Get Pass ($${ticketPrice})`}
              </div>
            </div>
          </section>

          {/* Registration Safeguards */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0B0B0B]">Registration Safeguards</span>
              <ShieldCheck className="w-4 h-4 text-[#71717A]" />
            </div>

            <label className="flex items-start gap-3 p-3.5 bg-white rounded-2xl cursor-pointer">
              <input
                type="checkbox"
                checked={enforceUniquePhone}
                onChange={(e) => setEnforceUniquePhone(e.target.checked)}
                className="mt-0.5 accent-[#0B0B0B] w-4 h-4 shrink-0"
              />
              <span>
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  Enforce unique phone number
                </span>
                <span className="text-[11px] text-[#71717A]">
                  Prevents duplicate ticket generation per MSISDN.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 p-3.5 bg-white rounded-2xl cursor-pointer">
              <input
                type="checkbox"
                checked={autoCloseCap}
                onChange={(e) => setAutoCloseCap(e.target.checked)}
                className="mt-0.5 accent-[#0B0B0B] w-4 h-4 shrink-0"
              />
              <span>
                <span className="text-xs font-semibold text-[#0B0B0B] block">
                  Auto-close when cap is reached
                </span>
                <span className="text-[11px] text-[#71717A]">
                  Switches public RSVP form to waitlist mode automatically.
                </span>
              </span>
            </label>
          </section>

          {/* Footer Step Navigation */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3 | 4) : onCancel())}
              className="px-4 py-2 text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
            >
              {step > 1 ? '← Previous Step' : 'Cancel & Discard'}
            </button>
            {step < 4 && (
              <button
                type="button"
                onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}
                className="px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <span>
                  {step === 1
                    ? 'Next: Program & Schedule'
                    : step === 2
                    ? 'Next: SMS & Automations'
                    : 'Next: Review & Publish'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
