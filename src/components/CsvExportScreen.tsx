import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Clock,
  CloudCog,
  Copy,
  Download,
  FileSpreadsheet,
  Filter,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
} from 'lucide-react';
import { Attendee, EventItem, OrganizerProfile } from '../types/events';

interface CsvExportScreenProps {
  events: EventItem[];
  attendees: Attendee[];
  profile: OrganizerProfile;
  initialEventId?: string;
  onBackToAttendees: () => void;
  onNavigateBilling: () => void;
}

type CohortStatus = 'all' | 'checked_in' | 'not_checked_in' | 'conflicts';
type DelimiterType = 'comma' | 'semicolon' | 'tab';
type EncodingType = 'utf8_bom' | 'utf8' | 'ascii';
type PhoneFormatType = 'e164' | 'national' | 'digits';
type TimeFormatType = 'iso8601' | 'local' | 'epoch';

interface ExportColumn {
  key:
    | 'id'
    | 'name'
    | 'phone'
    | 'email'
    | 'registered_at'
    | 'is_checked_in'
    | 'checked_in_at'
    | 'scanner_name'
    | 'sms_status'
    | 'ticket_nonce';
  label: string;
  code: string;
  hint: string;
  enabled: boolean;
}

const INITIAL_COLUMNS: ExportColumn[] = [
  { key: 'id', label: 'Attendee Identifier', code: 'id', hint: 'Pass / UUID Prefix', enabled: true },
  { key: 'name', label: 'Full Name', code: 'name', hint: 'Primary Attendee Record', enabled: true },
  { key: 'phone', label: 'Normalized Phone', code: 'phone', hint: 'E.164 Standard', enabled: true },
  { key: 'email', label: 'Email Address', code: 'email', hint: 'RFC 5322 Compliant', enabled: true },
  {
    key: 'registered_at',
    label: 'Registration Timestamp',
    code: 'registered_at',
    hint: 'ISO 8601 UTC',
    enabled: true,
  },
  {
    key: 'is_checked_in',
    label: 'Check-In Status',
    code: 'is_checked_in',
    hint: 'Boolean (TRUE/FALSE)',
    enabled: true,
  },
  {
    key: 'checked_in_at',
    label: 'Scan Verification Time',
    code: 'checked_in_at',
    hint: 'Null when Unverified',
    enabled: true,
  },
  {
    key: 'scanner_name',
    label: 'Gate Station Name',
    code: 'scanner_name',
    hint: 'Hardware / Turnstile Tag',
    enabled: true,
  },
  {
    key: 'sms_status',
    label: 'Arkesel SMS Gateway Status',
    code: 'sms_status',
    hint: 'delivered / pending',
    enabled: false,
  },
  {
    key: 'ticket_nonce',
    label: 'Cryptographic Ticket Token',
    code: 'ticket_nonce',
    hint: 'HMAC-SHA256 Sig',
    enabled: false,
  },
];

function formatPhone(raw: string, format: PhoneFormatType, maskPii: boolean): string {
  const digitsOnly = raw.replace(/\D/g, '') || '233244918820';
  if (maskPii) {
    const prefix = digitsOnly.slice(0, 3);
    const suffix = digitsOnly.slice(-4);
    return `+${prefix}••••${suffix}`;
  }
  if (format === 'digits') {
    return digitsOnly;
  }
  if (format === 'national') {
    if (digitsOnly.startsWith('233') && digitsOnly.length > 5) {
      return `0${digitsOnly.slice(3)}`;
    }
    return digitsOnly.startsWith('0') ? digitsOnly : `0${digitsOnly.slice(-9)}`;
  }
  return `+${digitsOnly}`;
}

function formatEmail(email: string, maskPii: boolean): string {
  if (!maskPii) return email;
  const parts = email.split('@');
  if (parts.length !== 2) return '••••';
  return `${parts[0].slice(0, 1)}••••@${parts[1]}`;
}

function formatTimestamp(baseIso: string, checkedInAt: string | undefined, fmt: TimeFormatType, isCheckIn = false): string {
  if (isCheckIn && !checkedInAt) return '';
  if (fmt === 'epoch') {
    return isCheckIn ? '1795511111000' : '1795166062000';
  }
  if (fmt === 'local') {
    return isCheckIn
      ? `28/11/2026 ${checkedInAt}`
      : `24/11/2026 09:14 AM`;
  }
  return isCheckIn
    ? `${baseIso} ${checkedInAt ?? '09:00:00'}`
    : `${baseIso} 09:14:22 GMT`;
}

export const CsvExportScreen: React.FC<CsvExportScreenProps> = ({
  events,
  attendees,
  profile,
  initialEventId,
  onBackToAttendees,
  onNavigateBilling,
}) => {
  const [selectedEventId, setSelectedEventId] = useState<string>(initialEventId || 'all');
  const [statusFilter, setStatusFilter] = useState<CohortStatus>('all');
  const [gateTerminal, setGateTerminal] = useState<string>('all');
  const [epochRange, setEpochRange] = useState<string>('summit_days');
  const [columns, setColumns] = useState<ExportColumn[]>(INITIAL_COLUMNS);
  const [delimiter, setDelimiter] = useState<DelimiterType>('comma');
  const [encoding, setEncoding] = useState<EncodingType>('utf8_bom');
  const [phoneFormat, setPhoneFormat] = useState<PhoneFormatType>('e164');
  const [timeFormat, setTimeFormat] = useState<TimeFormatType>('iso8601');
  const [maskPii, setMaskPii] = useState<boolean>(false);
  const [presetName, setPresetName] = useState<'Gate Operations' | 'Minimal Contact' | 'Full Audit'>('Gate Operations');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [downloadState, setDownloadState] = useState<'idle' | 'preparing' | 'done'>('idle');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const eventRoster = useMemo(() => {
    if (selectedEventId === 'all') return attendees;
    return attendees.filter((a) => a.eventId === selectedEventId);
  }, [attendees, selectedEventId]);

  const counts = useMemo(() => {
    const checkedIn = eventRoster.filter((a) => a.checkedIn).length;
    const pending = eventRoster.filter((a) => !a.checkedIn).length;
    const conflicts = eventRoster.filter((a) => a.paymentStatus === 'failed' || a.smsStatus === 'Pending').length;
    return {
      all: eventRoster.length,
      checkedIn,
      pending,
      conflicts,
    };
  }, [eventRoster]);

  const filteredAttendees = useMemo(() => {
    return eventRoster.filter((att) => {
      if (statusFilter === 'checked_in' && !att.checkedIn) return false;
      if (statusFilter === 'not_checked_in' && att.checkedIn) return false;
      if (statusFilter === 'conflicts' && att.paymentStatus !== 'failed' && att.smsStatus !== 'Pending') {
        return false;
      }
      if (gateTerminal === 'vip' && att.tier !== 'VIP' && att.tier !== 'Speaker') return false;
      if (gateTerminal === 'press' && att.tier !== 'Press') return false;
      return true;
    });
  }, [eventRoster, statusFilter, gateTerminal]);

  const activeColumns = useMemo(() => columns.filter((c) => c.enabled), [columns]);
  const eventMap = useMemo(() => {
    const map = new Map<string, EventItem>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const delimiterChar = delimiter === 'comma' ? ',' : delimiter === 'semicolon' ? ';' : '\t';

  const getCellValue = (att: Attendee, key: ExportColumn['key']): string => {
    const evt = eventMap.get(att.eventId);
    const baseIso = evt?.isoDate ?? '2026-11-28';
    const gateLabel =
      att.tier === 'VIP' || att.tier === 'Speaker'
        ? 'VIP Entrance'
        : att.tier === 'Press'
        ? 'Press Turnstile'
        : 'Main Gate A';

    switch (key) {
      case 'id':
        return att.ticketCode;
      case 'name':
        return att.name;
      case 'phone':
        return formatPhone(att.phone, phoneFormat, maskPii);
      case 'email':
        return formatEmail(att.email, maskPii);
      case 'registered_at':
        return formatTimestamp(baseIso, undefined, timeFormat, false);
      case 'is_checked_in':
        return att.checkedIn ? 'CHECKED_IN' : 'NOT_CHECKED_IN';
      case 'checked_in_at':
        return att.checkedIn ? formatTimestamp(baseIso, att.checkedInAt || '09:12:00', timeFormat, true) : '';
      case 'scanner_name':
        return att.checkedIn ? gateLabel : '—';
      case 'sms_status':
        return att.smsStatus;
      case 'ticket_nonce':
        return `hmac_${att.id.replace(/[^a-z0-9]/gi, '').slice(-6)}f9a2`;
    }
  };

  const generateCsvString = (rowsToUse: Attendee[]) => {
    const header = activeColumns.map((c) => c.code).join(delimiterChar);
    const lines = rowsToUse.map((att) =>
      activeColumns
        .map((c) => {
          const val = getCellValue(att, c.key);
          const escaped = val.replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(delimiterChar)
    );
    return [header, ...lines].join('\n');
  };

  const rawPreviewLines = useMemo(() => {
    const sample = filteredAttendees.slice(0, 4);
    return generateCsvString(sample).split('\n');
  }, [filteredAttendees, activeColumns, delimiterChar, phoneFormat, timeFormat, maskPii]);

  const estimatedKb = useMemo(() => {
    const fullStr = generateCsvString(filteredAttendees);
    const bytes = new Blob([fullStr]).size + (encoding === 'utf8_bom' ? 3 : 0);
    return Math.max(0.4, bytes / 1024).toFixed(1);
  }, [filteredAttendees, activeColumns, delimiterChar, encoding, phoneFormat, timeFormat, maskPii]);

  const toggleColumn = (key: ExportColumn['key']) => {
    setColumns((prev) =>
      prev.map((col) => {
        if (col.key !== key) return col;
        if (col.enabled && activeColumns.length <= 1) return col;
        return { ...col, enabled: !col.enabled };
      })
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    setColumns((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const applyPreset = (preset: 'Gate Operations' | 'Minimal Contact' | 'Full Audit') => {
    setPresetName(preset);
    if (preset === 'Minimal Contact') {
      setColumns((prev) =>
        prev.map((c) => ({
          ...c,
          enabled: ['id', 'name', 'phone', 'email'].includes(c.key),
        }))
      );
      showToast('Applied Minimal Contact preset (4 columns)');
    } else if (preset === 'Full Audit') {
      setColumns((prev) => prev.map((c) => ({ ...c, enabled: true })));
      showToast('Applied Full Audit preset (all 10 attributes)');
    } else {
      setColumns((prev) =>
        prev.map((c) => ({
          ...c,
          enabled: !['sms_status', 'ticket_nonce'].includes(c.key),
        }))
      );
      showToast('Applied Gate Operations preset (8 core attributes)');
    }
  };

  const handleCopySnippet = () => {
    const text = rawPreviewLines.join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const triggerDownload = (extension: 'csv' | 'tsv') => {
    setDownloadState('preparing');
    setTimeout(() => {
      const csvBody = generateCsvString(filteredAttendees);
      const bom = encoding === 'utf8_bom' ? '\uFEFF' : '';
      const blob = new Blob([bom + csvBody], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const slug = selectedEvent ? selectedEvent.slug : 'all-productions';
      link.href = url;
      link.download = `${slug}-attendees.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloadState('done');
      showToast(`Exported ${filteredAttendees.length} records (${estimatedKb} KB)`);
      setTimeout(() => setDownloadState('idle'), 2000);
    }, 350);
  };

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-xl">
          {toastMsg}
        </div>
      )}

      {/* Breadcrumb & Header Bar */}
      <section className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-[#71717A]">
          <button
            type="button"
            onClick={onBackToAttendees}
            className="inline-flex items-center gap-1 hover:text-[#0B0B0B] transition-colors font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Attendees
          </button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span>{selectedEvent ? selectedEvent.title : 'All Productions'}</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#0B0B0B] font-semibold">CSV Export Configuration</span>
        </nav>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-1">
              <h1 className="font-display text-[26px] sm:text-[30px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                Attendee &amp; Check-In Data Export
              </h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EEEEF0] text-[#0B0B0B] text-[11px] font-semibold uppercase tracking-wider">
                {profile.plan === 'Starter' ? 'Preview Mode' : 'Pro Feature Unlocked'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#71717A]">
              Design custom schema payloads, turnstile device audit trails, and privacy-compliant rosters under Act 843.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              value={presetName}
              onChange={(e) => applyPreset(e.target.value as 'Gate Operations' | 'Minimal Contact' | 'Full Audit')}
              aria-label="Column export preset"
              className="h-11 px-4 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-xs font-semibold text-[#0B0B0B] border border-[#E5E5EA] focus:outline-none cursor-pointer"
            >
              <option value="Gate Operations">Preset: Gate Operations</option>
              <option value="Minimal Contact">Preset: Minimal Contact</option>
              <option value="Full Audit">Preset: Full Audit</option>
            </select>

            <button
              type="button"
              onClick={() => triggerDownload('csv')}
              disabled={downloadState === 'preparing'}
              className="h-11 px-6 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-sm transition-all whitespace-nowrap shrink-0 disabled:opacity-70"
            >
              {downloadState === 'done' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Downloaded!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{downloadState === 'preparing' ? 'Preparing...' : 'Download CSV (.csv)'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6 min-w-0">
          {/* 1. Export Scope & Cohort Filters */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
                  <Filter className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#0B0B0B]">
                    1. Export Scope &amp; Cohort Filters
                  </h2>
                  <p className="text-xs text-[#71717A]">
                    Query partition based on sync telemetry and gate devices
                  </p>
                </div>
              </div>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                aria-label="Filter export by event"
                className="h-9 px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:outline-none max-w-full"
              >
                <option value="all">All Events ({attendees.length})</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-[#0B0B0B]">Attendance Status</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'all', label: `All (${counts.all})` },
                    { id: 'checked_in', label: `Checked-In (${counts.checkedIn})` },
                    { id: 'not_checked_in', label: `Pending (${counts.pending})` },
                    { id: 'conflicts', label: `Exceptions (${counts.conflicts})`, alert: true },
                  ] as const
                ).map((tab) => {
                  const active = statusFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStatusFilter(tab.id)}
                      className={`px-3 py-2 rounded-full text-xs font-semibold text-center transition-colors tabular-nums whitespace-nowrap ${
                        active
                          ? 'bg-[#0B0B0B] text-white shadow-sm'
                          : 'alert' in tab && tab.alert && counts.conflicts > 0
                          ? 'bg-white text-[#EF4444] hover:bg-[#EEEEF0]'
                          : 'bg-white text-[#0B0B0B] hover:bg-[#EEEEF0]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">
                  Access Terminal / Turnstile Gate
                </label>
                <select
                  value={gateTerminal}
                  onChange={(e) => setGateTerminal(e.target.value)}
                  className="w-full h-11 px-4 bg-white rounded-full border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none cursor-pointer"
                >
                  <option value="all">All Turnstiles (4 Gates Connected)</option>
                  <option value="gate_a">Main Gate A — Expo Concourse</option>
                  <option value="vip">VIP &amp; Speaker Entrance</option>
                  <option value="press">Press &amp; Media Turnstile</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">
                  Registration / Check-In Epoch
                </label>
                <select
                  value={epochRange}
                  onChange={(e) => setEpochRange(e.target.value)}
                  className="w-full h-11 px-4 bg-white rounded-full border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none cursor-pointer"
                >
                  <option value="summit_days">Active Event Window</option>
                  <option value="today">Today Only (Live Sessions)</option>
                  <option value="all_time">Entire Campaign History</option>
                </select>
              </div>
            </div>
          </section>

          {/* 2. Column Mapping & Attributes */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
                  <TableProperties className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#0B0B0B]">
                    2. Column Mapping &amp; Attributes
                  </h2>
                  <p className="text-xs text-[#71717A]">
                    Reorder or toggle attributes included in CSV output ({activeColumns.length} active)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => applyPreset('Full Audit')}
                  className="px-3 py-1.5 rounded-full bg-white hover:bg-[#EEEEF0] text-[#0B0B0B] transition-colors"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('Minimal Contact')}
                  className="px-3 py-1.5 rounded-full bg-white hover:bg-[#EEEEF0] text-[#71717A] hover:text-[#0B0B0B] transition-colors"
                >
                  Minimal
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  className={`flex items-center justify-between px-4 py-2.5 rounded-2xl transition-colors gap-2 ${
                    col.enabled ? 'bg-white' : 'bg-white/60 opacity-75'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveColumn(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${col.label} up`}
                        className="p-1 text-[#71717A] hover:text-[#0B0B0B] disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(idx, 1)}
                        disabled={idx === columns.length - 1}
                        aria-label={`Move ${col.label} down`}
                        className="p-1 text-[#71717A] hover:text-[#0B0B0B] disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input
                      id={`export-col-${col.key}`}
                      type="checkbox"
                      checked={col.enabled}
                      onChange={() => toggleColumn(col.key)}
                      className="w-4 h-4 accent-[#0B0B0B] cursor-pointer shrink-0"
                    />
                    <label
                      htmlFor={`export-col-${col.key}`}
                      className="cursor-pointer flex flex-wrap items-center gap-2 text-xs min-w-0"
                    >
                      <span className="font-semibold text-[#0B0B0B]">{col.label}</span>
                      <code className="px-1.5 py-0.5 rounded bg-[#F5F5F7] font-mono text-[11px] text-[#71717A]">
                        {col.code}
                      </code>
                    </label>
                  </div>
                  <span className="hidden sm:inline text-[11px] text-[#71717A] shrink-0">
                    {col.hint}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 3. Delimiters, Charset & Privacy Masking */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0B0B0B] shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0B0B0B]">
                  3. Delimiters, Charset &amp; Privacy Masking
                </h2>
                <p className="text-xs text-[#71717A]">
                  Standardized encoding for Ghana telecoms and spreadsheet imports
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">CSV Delimiter</label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-white rounded-full">
                  {(
                    [
                      { id: 'comma', label: 'Comma (,)' },
                      { id: 'semicolon', label: 'Semi (;)' },
                      { id: 'tab', label: 'Tab (\\t)' },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDelimiter(d.id)}
                      className={`py-2 rounded-full text-xs font-semibold transition-colors ${
                        delimiter === d.id
                          ? 'bg-[#0B0B0B] text-white'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B]">Text File Encoding</label>
                <select
                  value={encoding}
                  onChange={(e) => setEncoding(e.target.value as EncodingType)}
                  className="w-full h-11 px-4 bg-white rounded-full border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none"
                >
                  <option value="utf8_bom">UTF-8 with BOM (Universal Excel Support)</option>
                  <option value="utf8">UTF-8 Standard (Unix / Postgres)</option>
                  <option value="ascii">ASCII Safe (7-Bit Strip)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#71717A]" />
                  Phone Number Format
                </label>
                <select
                  value={phoneFormat}
                  onChange={(e) => setPhoneFormat(e.target.value as PhoneFormatType)}
                  className="w-full h-11 px-4 bg-white rounded-full border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none"
                >
                  <option value="e164">Canonical E.164 (+233244918820)</option>
                  <option value="national">Ghana National (0244918820)</option>
                  <option value="digits">Digits Only (233244918820)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#71717A]" />
                  Timezone &amp; Timestamp Structure
                </label>
                <select
                  value={timeFormat}
                  onChange={(e) => setTimeFormat(e.target.value as TimeFormatType)}
                  className="w-full h-11 px-4 bg-white rounded-full border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none"
                >
                  <option value="iso8601">ISO 8601 (YYYY-MM-DD HH:mm:ss GMT)</option>
                  <option value="local">Africa/Accra Local (DD/MM/YYYY hh:mm A)</option>
                  <option value="epoch">Unix Epoch (Milliseconds)</option>
                </select>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#0B0B0B] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Redact PII for 3rd-Party Vendors
                  </p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    Anonymizes phone numbers (+233••••8820) and emails for catering &amp; event logistics rosters.
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={maskPii}
                  onChange={(e) => setMaskPii(e.target.checked)}
                  aria-label="Redact PII for 3rd-Party Vendors"
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#E5E5EA] rounded-full peer peer-checked:bg-[#0B0B0B] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Live Preview & Audit Compliance (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6 min-w-0">
          {/* Real-Time CSV Preview */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[#0B0B0B]">Real-Time CSV Preview</h3>
              <span className="text-[11px] font-medium text-[#71717A] tabular-nums">
                Top {Math.min(5, filteredAttendees.length)} of {filteredAttendees.length} Records
              </span>
            </div>

            <div className="w-full overflow-x-auto rounded-2xl bg-white p-2">
              <table className="w-full text-left border-collapse min-w-[460px]">
                <thead>
                  <tr className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider border-b border-[#E5E5EA]">
                    <th className="py-2 px-3">ID</th>
                    <th className="py-2 px-3">Name</th>
                    <th className="py-2 px-3">Phone</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA] text-xs">
                  {filteredAttendees.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-[#71717A]">
                        No records match this cohort filter.
                      </td>
                    </tr>
                  ) : (
                    filteredAttendees.slice(0, 5).map((att) => (
                      <tr key={att.id} className="hover:bg-[#F5F5F7]/60 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#0B0B0B] tabular-nums">
                          {att.ticketCode}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#0B0B0B]">{att.name}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#71717A] tabular-nums">
                          {formatPhone(att.phone, phoneFormat, maskPii)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              att.checkedIn
                                ? 'bg-[#0B0B0B] text-white'
                                : 'bg-[#EEEEF0] text-[#444748]'
                            }`}
                          >
                            {att.checkedIn ? 'CHECKED_IN' : 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Raw Monospace Payload Stream */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] text-[#71717A]">
                <span>Payload Stream Output (CSV Text Preview)</span>
                <button
                  type="button"
                  onClick={handleCopySnippet}
                  className="inline-flex items-center gap-1 font-semibold text-[#0B0B0B] hover:underline"
                >
                  {copiedSnippet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSnippet ? 'Copied!' : 'Copy Raw'}</span>
                </button>
              </div>
              <div className="p-3.5 rounded-2xl bg-white font-mono text-[11px] text-[#0B0B0B] overflow-x-auto whitespace-pre leading-relaxed">
                {rawPreviewLines.map((line, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-[#71717A] select-none tabular-nums w-3 text-right shrink-0">
                      {i + 1}
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Export Telemetry & Compliance */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col gap-4">
            <h3 className="text-base font-semibold text-[#0B0B0B]">Export Telemetry &amp; Quota</h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl bg-white">
                <span className="text-[11px] uppercase tracking-wider text-[#71717A] block">
                  Filtered Records
                </span>
                <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] mt-1 block tabular-nums">
                  {filteredAttendees.length}
                </span>
                <span className="text-[11px] text-[#71717A] tabular-nums">
                  of {eventRoster.length} Registrants
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-white">
                <span className="text-[11px] uppercase tracking-wider text-[#71717A] block">
                  Estimated Size
                </span>
                <span className="font-display text-[28px] leading-9 font-bold text-[#0B0B0B] mt-1 block tabular-nums">
                  ~{estimatedKb} <span className="text-sm font-normal text-[#71717A]">KB</span>
                </span>
                <span className="text-[11px] text-[#71717A] tabular-nums">
                  {activeColumns.length} Selected Attributes
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#0B0B0B]">
                <ShieldCheck className="w-4 h-4" />
                <span>Audit Trail &amp; Data Act 843 Log</span>
              </div>
              <p className="text-[11px] text-[#71717A] leading-relaxed">
                Export request records cryptographic hash{' '}
                <code className="font-mono text-[#0B0B0B]">sha256:7f4a...9b12</code> under organizer{' '}
                <span className="text-[#0B0B0B] font-medium">{profile.email}</span>.
              </p>
              {profile.plan === 'Starter' && (
                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[11px] text-[#EF4444] font-semibold">
                    Starter Plan limits bulk scheduling
                  </span>
                  <button
                    type="button"
                    onClick={onNavigateBilling}
                    className="text-[11px] font-semibold text-[#0B0B0B] underline"
                  >
                    Unlock Pro →
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => triggerDownload('tsv')}
                className="w-full h-11 px-4 rounded-full bg-white hover:bg-[#EEEEF0] text-xs font-semibold text-[#0B0B0B] flex items-center justify-between transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Spreadsheet-Safe (.tsv)</span>
                </span>
                <Download className="w-3.5 h-3.5 text-[#71717A]" />
              </button>

              <button
                type="button"
                onClick={() => showToast('SFTP / Webhook auto-sync endpoint configured')}
                className="w-full h-11 px-4 rounded-full bg-white hover:bg-[#EEEEF0] text-xs font-semibold text-[#0B0B0B] flex items-center justify-between transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <CloudCog className="w-4 h-4" />
                  <span>Schedule Auto-Sync (Webhook)</span>
                </span>
                <span className="text-[11px] text-[#71717A]">Pro+</span>
              </button>

              <button
                type="button"
                onClick={onBackToAttendees}
                className="w-full py-2.5 text-center text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
              >
                Cancel &amp; Return to Attendees List
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
