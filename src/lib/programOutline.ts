import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events.ts';
import {
  formatEventDateSpan,
  getEventDayCount,
  getScheduleBlockDayFromIso,
  getTodayIsoDate,
  isValidIsoDate,
  resolveIsoDateForScheduleDay,
  resolveScheduleBlockDate,
  sanitizeIsoDate,
  sanitizeScheduleSection,
} from './eventDates.ts';
import { compressFlyerImageFile } from './flyerUpload.ts';

export const MAX_PROGRAM_OUTLINE_RAW_BYTES = 2_621_440; // 2.5 MB raw limit
export const MAX_PROGRAM_OUTLINE_DATA_URL_CHARS = 4_200_000;
export const MAX_LOGO_DATA_URL_CHARS = 1_500_000;

export const ALLOWED_PROGRAM_OUTLINE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
] as const;

export type AllowedProgramOutlineMime = (typeof ALLOWED_PROGRAM_OUTLINE_MIME_TYPES)[number];

export interface ParsedProgramOutlineBlock {
  time: string;
  duration: string;
  title: string;
  stage: string;
  lead: string;
  day: ScheduleBlock['day'];
  date?: string;
  section?: string;
}

export function inferProgramOutlineMimeType(
  rawMime?: string | null,
  fileName?: string | null
): AllowedProgramOutlineMime | null {
  const mime = (rawMime || '').trim().toLowerCase().split(';')[0];
  if (mime === 'application/pdf') return 'application/pdf';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/webp') return 'image/webp';
  if (mime === 'text/csv' || mime === 'application/csv' || mime === 'application/vnd.ms-excel') {
    if (!fileName || /\.csv$/i.test(fileName) || mime !== 'application/vnd.ms-excel') {
      return 'text/csv';
    }
  }
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'text/markdown';
  if (mime === 'text/plain') {
    if (fileName && /\.csv$/i.test(fileName)) return 'text/csv';
    if (fileName && /\.md$/i.test(fileName)) return 'text/markdown';
    return 'text/plain';
  }

  const ext = (fileName || '').trim().toLowerCase();
  if (ext.endsWith('.pdf')) return 'application/pdf';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.csv')) return 'text/csv';
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) return 'text/markdown';
  if (ext.endsWith('.txt')) return 'text/plain';
  return null;
}

export function isValidProgramOutlineDataUrl(dataUrl: string): boolean {
  const clean = dataUrl.trim();
  if (!clean || clean.length > MAX_PROGRAM_OUTLINE_DATA_URL_CHARS) return false;
  return /^data:(application\/pdf|image\/(jpeg|jpg|png|webp)|text\/(plain|csv|markdown));base64,[A-Za-z0-9+/=\s]+$/i.test(
    clean
  );
}

export function sanitizeProgramOutlineFileName(fileName?: string | null, mimeType?: string): string {
  const base = (fileName || '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (base) return base;
  if (mimeType === 'application/pdf') return 'program-outline.pdf';
  if (mimeType?.startsWith('image/')) return 'program-outline.jpg';
  if (mimeType === 'text/csv') return 'program-outline.csv';
  if (mimeType === 'text/markdown') return 'program-outline.md';
  return 'program-outline.txt';
}

export function sanitizeProgramOutline(raw: unknown): EventProgramOutline | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const rawUrl = typeof rec.dataUrl === 'string' ? rec.dataUrl.trim() : '';
  if (!rawUrl || !isValidProgramOutlineDataUrl(rawUrl)) return undefined;

  const mimeMatch = rawUrl.match(/^data:([^;]+);base64,/i);
  const urlMime = inferProgramOutlineMimeType(mimeMatch?.[1], typeof rec.fileName === 'string' ? rec.fileName : undefined);
  const resolvedMime =
    urlMime ||
    inferProgramOutlineMimeType(
      typeof rec.mimeType === 'string' ? rec.mimeType : undefined,
      typeof rec.fileName === 'string' ? rec.fileName : undefined
    );
  if (!resolvedMime) return undefined;

  const fileName = sanitizeProgramOutlineFileName(
    typeof rec.fileName === 'string' ? rec.fileName : undefined,
    resolvedMime
  );
  const title =
    typeof rec.title === 'string' && rec.title.trim()
      ? rec.title.trim().slice(0, 120)
      : undefined;
  const notes =
    typeof rec.notes === 'string' && rec.notes.trim()
      ? rec.notes.trim().slice(0, 500)
      : undefined;
  const sizeBytes =
    typeof rec.sizeBytes === 'number' && Number.isFinite(rec.sizeBytes) && rec.sizeBytes > 0
      ? Math.round(rec.sizeBytes)
      : Math.round((rawUrl.length * 3) / 4);
  const uploadedAt =
    typeof rec.uploadedAt === 'string' && rec.uploadedAt.trim()
      ? rec.uploadedAt.trim().slice(0, 64)
      : new Date().toISOString();

  return {
    fileName,
    mimeType: resolvedMime,
    dataUrl: rawUrl,
    sizeBytes,
    uploadedAt,
    ...(title ? { title } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function sanitizeEventLogoUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed.length <= MAX_LOGO_DATA_URL_CHARS ? trimmed : undefined;
  }
  if (/^https?:\/\//i.test(trimmed) || (trimmed.startsWith('/') && !trimmed.startsWith('//'))) {
    return trimmed.length <= 512 ? trimmed : undefined;
  }
  return undefined;
}

export async function processEventLogoFile(file: File): Promise<string> {
  const mimeType = inferProgramOutlineMimeType(file.type, file.name);
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error('Logo must be a JPG, PNG, or WebP image file.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Logo image must be under 8 MB.');
  }
  const compressed = await compressFlyerImageFile(file);
  const clean = sanitizeEventLogoUrl(compressed);
  if (!clean) {
    throw new Error('Compressed logo exceeds 1 MB limit. Try a smaller image.');
  }
  return clean;
}

function normalizeDataUrlMimePrefix(dataUrl: string, mime: AllowedProgramOutlineMime): string {
  const idx = dataUrl.indexOf(';base64,');
  if (idx === -1) return dataUrl;
  return `data:${mime}${dataUrl.slice(idx)}`;
}

function readBinaryFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read uploaded program outline file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read program outline file.'));
    reader.readAsDataURL(file);
  });
}

function estimateBase64Bytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const b64 = dataUrl.slice(commaIdx + 1).replace(/\s+/g, '');
  return Math.max(1, Math.floor((b64.length * 3) / 4));
}

export async function processProgramOutlineFile(
  file: File,
  options?: { title?: string; notes?: string }
): Promise<EventProgramOutline> {
  const mimeType = inferProgramOutlineMimeType(file.type, file.name);
  if (!mimeType) {
    throw new Error(
      'Unsupported file type. Upload a PDF, JPG/PNG/WebP image, TXT, CSV, or Markdown (.md) program outline.'
    );
  }

  let dataUrl: string;
  if (mimeType.startsWith('image/')) {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Program image must be under 10 MB before compression.');
    }
    dataUrl = await compressFlyerImageFile(file);
    if (dataUrl.length > MAX_PROGRAM_OUTLINE_DATA_URL_CHARS) {
      throw new Error('Compressed program image exceeds 2.5 MB limit. Try a smaller resolution.');
    }
  } else {
    if (file.size > MAX_PROGRAM_OUTLINE_RAW_BYTES) {
      throw new Error(
        `Program outline file is too large (${formatFileSizeCompact(file.size)}). Maximum allowed size is 2.5 MB.`
      );
    }
    const raw = await readBinaryFileAsDataUrl(file);
    dataUrl = normalizeDataUrlMimePrefix(raw, mimeType);
  }

  const sanitized = sanitizeProgramOutline({
    fileName: file.name,
    mimeType: dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : mimeType,
    dataUrl,
    sizeBytes: estimateBase64Bytes(dataUrl),
    uploadedAt: new Date().toISOString(),
    title: options?.title,
    notes: options?.notes,
  });

  if (!sanitized) {
    throw new Error('Could not process uploaded program outline file.');
  }
  return sanitized;
}

export function isTextProgramOutline(outline?: EventProgramOutline | null): boolean {
  if (!outline) return false;
  return (
    outline.mimeType === 'text/plain' ||
    outline.mimeType === 'text/csv' ||
    outline.mimeType === 'text/markdown'
  );
}

export function decodeProgramOutlineText(outline?: EventProgramOutline | null): string {
  if (!outline?.dataUrl) return '';
  const marker = ';base64,';
  const idx = outline.dataUrl.indexOf(marker);
  if (idx === -1) return '';
  const b64 = outline.dataUrl.slice(idx + marker.length).trim();
  if (!b64) return '';
  try {
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

export function formatFileSizeCompact(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return 'Document';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeTimeExpression(rawTime: string): string {
  const clean = rawTime.trim().replace(/\s+/g, ' ');
  const rangeMatch = clean.match(
    /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)$/i
  );
  if (rangeMatch) {
    return `${to24HourOrKeep(rangeMatch[1])} - ${to24HourOrKeep(rangeMatch[2])}`;
  }
  return to24HourOrKeep(clean);
}

function to24HourOrKeep(token: string): string {
  const m = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return token.trim();
  let hour = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function parseProgramOutlineTextToBlocks(
  rawText: string,
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null
): ParsedProgramOutlineBlock[] {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const defaultDay: ScheduleBlock['day'] = 'Day 1';
  const defaultDate =
    sanitizeIsoDate(eventContext?.isoDate) ||
    resolveIsoDateForScheduleDay(defaultDay, eventContext ?? undefined);
  const defaultStage = eventContext?.venue?.trim() || 'Main Stage';
  const defaultLead = eventContext?.organizer?.trim() || 'Organiser';

  // Detect CSV header row if present
  const firstCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const looksLikeCsvHeader =
    firstCols.length >= 2 &&
    firstCols.some((c) => c.includes('title') || c.includes('session') || c.includes('item')) &&
    firstCols.some((c) => c.includes('time') || c.includes('hour') || c.includes('start'));

  if (looksLikeCsvHeader) {
    const idxTitle = firstCols.findIndex((c) => c.includes('title') || c.includes('session') || c.includes('item') || c.includes('program'));
    const idxTime = firstCols.findIndex((c) => c.includes('time') || c.includes('start'));
    const idxStage = firstCols.findIndex((c) => c.includes('stage') || c.includes('room') || c.includes('venue') || c.includes('hall'));
    const idxLead = firstCols.findIndex((c) => c.includes('lead') || c.includes('speaker') || c.includes('host') || c.includes('mc'));
    const idxDur = firstCols.findIndex((c) => c.includes('dur'));
    const idxDate = firstCols.findIndex((c) => c.includes('date'));
    const idxDay = firstCols.findIndex((c) => c === 'day');
    const idxSection = firstCols.findIndex(
      (c) =>
        c.includes('section') ||
        c.includes('segment') ||
        c.includes('part') ||
        c.includes('track') ||
        c.includes('group')
    );

    const blocks: ParsedProgramOutlineBlock[] = [];
    for (let r = 1; r < lines.length; r += 1) {
      const cols = splitCsvLine(lines[r]);
      const title = (cols[idxTitle] || '').trim();
      if (!title) continue;
      const rawDate = idxDate >= 0 ? sanitizeIsoDate(cols[idxDate]) : undefined;
      const rawDayCandidate = idxDay >= 0 ? cols[idxDay]?.trim() : undefined;
      const resolvedDate =
        rawDate ||
        (rawDayCandidate && /^Day\s*[1-7]$/i.test(rawDayCandidate)
          ? resolveIsoDateForScheduleDay(rawDayCandidate as ScheduleBlock['day'], eventContext ?? undefined)
          : undefined) ||
        defaultDate;
      const resolvedDay = resolvedDate
        ? getScheduleBlockDayFromIso(resolvedDate, eventContext ?? undefined, defaultDay)
        : defaultDay;
      const section = idxSection >= 0 ? sanitizeScheduleSection(cols[idxSection]) : undefined;
      blocks.push({
        time: normalizeTimeExpression(cols[idxTime] || '09:00'),
        duration: (idxDur >= 0 ? cols[idxDur]?.trim() : '') || '45m',
        title,
        stage: (idxStage >= 0 ? cols[idxStage]?.trim() : '') || defaultStage,
        lead: (idxLead >= 0 ? cols[idxLead]?.trim() : '') || defaultLead,
        day: resolvedDay,
        ...(resolvedDate ? { date: resolvedDate } : {}),
        ...(section ? { section } : {}),
      });
    }
    return blocks;
  }

  let activeDay: ScheduleBlock['day'] = defaultDay;
  let activeDate: string | undefined = defaultDate;
  let activeSection: string | undefined;
  const blocks: ParsedProgramOutlineBlock[] = [];

  for (const rawLine of lines) {
    const cleanedLine = rawLine.replace(/^[-*•]+\s+/, '').trim();
    if (!cleanedLine) continue;

    // Detect Day/Date section headings like "## Day 2 (2026-12-19)" or "Day 2:"
    const dayHeaderMatch = cleanedLine.match(/^#*\s*(Day\s*[1-7])(?:\b|[:\s-])/i);
    const isoInLine = cleanedLine.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const timeInLine = cleanedLine.match(
      /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?(?:\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?)\b/i
    );

    if (dayHeaderMatch && !timeInLine) {
      const normalizedDayLabel = dayHeaderMatch[1].replace(/\s+/g, ' ').replace(/^day/i, 'Day') as ScheduleBlock['day'];
      activeDay = normalizedDayLabel;
      activeDate =
        (isoInLine ? sanitizeIsoDate(isoInLine[1]) : undefined) ||
        resolveIsoDateForScheduleDay(normalizedDayLabel, eventContext ?? undefined) ||
        activeDate;
      activeSection = undefined;
      continue;
    }

    if (isoInLine && !timeInLine && cleanedLine.length <= 36) {
      const parsedIso = sanitizeIsoDate(isoInLine[1]);
      if (parsedIso) {
        activeDate = parsedIso;
        activeDay = getScheduleBlockDayFromIso(parsedIso, eventContext ?? undefined, activeDay);
        continue;
      }
    }

    // Detect Program Section headings like "### Part 1: Arrival", "Section: Main Program", or "[Afternoon Session]"
    const explicitSectionPrefixMatch = cleanedLine.match(/^(?:section|part|segment)\s*:\s*(.+)$/i);
    const markdownSectionMatch = cleanedLine.match(/^#{2,6}\s+(.+)$/);
    const bracketSectionMatch = cleanedLine.match(/^\[([^\]]{2,80})\]$/);
    if (!timeInLine && !cleanedLine.includes('|')) {
      const rawSectionCandidate =
        explicitSectionPrefixMatch?.[1] ||
        bracketSectionMatch?.[1] ||
        (markdownSectionMatch && !/program outline import template/i.test(markdownSectionMatch[1])
          ? markdownSectionMatch[1]
          : undefined);
      const parsedSection = sanitizeScheduleSection(rawSectionCandidate);
      if (parsedSection && !/^Day\s*[1-7]\b/i.test(parsedSection)) {
        activeSection = parsedSection;
        continue;
      }
    }

    // Pipe-delimited line: Time | Title | Stage | Lead | Optional Section
    if (cleanedLine.includes('|')) {
      const parts = cleanedLine.split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const maybeTime = /\d{1,2}(?::\d{2})?\s*(?:AM|PM)?/i.test(parts[0])
          ? normalizeTimeExpression(parts[0])
          : '09:00';
        const title = /\d/.test(parts[0]) ? parts[1] : parts[0];
        const stage = parts[2] || defaultStage;
        const lead = parts[3] || defaultLead;
        const rowSection = sanitizeScheduleSection(parts[4]) ?? activeSection;
        if (title) {
          blocks.push({
            time: maybeTime,
            duration: '45m',
            title,
            stage,
            lead,
            day: activeDay,
            ...(activeDate ? { date: activeDate } : {}),
            ...(rowSection ? { section: rowSection } : {}),
          });
          continue;
        }
      }
    }

    // Time-prefixed line: "09:00 - 09:45: Opening Keynote - Main Hall" or "10:00 AM - Welcome Prayer"
    if (timeInLine) {
      const timeStr = normalizeTimeExpression(timeInLine[1]);
      let remainder = cleanedLine
        .slice(timeInLine[0].length)
        .replace(/^[\s:|–—-]+/, '')
        .trim();
      if (!remainder) continue;

      let stage = defaultStage;
      let lead = defaultLead;
      const parenMatch = remainder.match(/\(([^)]+)\)\s*$/);
      if (parenMatch) {
        stage = parenMatch[1].trim() || defaultStage;
        remainder = remainder.slice(0, parenMatch.index).trim();
      } else if (remainder.includes('—') || remainder.includes(' - ')) {
        const subParts = remainder.split(/\s+(?:—|-)\s+/).map((s) => s.trim()).filter(Boolean);
        if (subParts.length >= 2) {
          remainder = subParts[0];
          stage = subParts[1] || defaultStage;
          if (subParts[2]) lead = subParts[2];
        }
      }

      blocks.push({
        time: timeStr,
        duration: '45m',
        title: remainder,
        stage,
        lead,
        day: activeDay,
        ...(activeDate ? { date: activeDate } : {}),
        ...(activeSection ? { section: activeSection } : {}),
      });
      continue;
    }

    // Comma-separated row without explicit header: "09:00, Opening Keynote, Main Hall"
    if (cleanedLine.includes(',')) {
      const cols = splitCsvLine(cleanedLine);
      if (cols.length >= 2 && cols[1]) {
        const timeStr = /\d{1,2}/.test(cols[0]) ? normalizeTimeExpression(cols[0]) : '09:00';
        const title = /\d{1,2}/.test(cols[0]) ? cols[1] : cols[0];
        const rowSection = sanitizeScheduleSection(cols[4]) ?? activeSection;
        blocks.push({
          time: timeStr,
          duration: '45m',
          title,
          stage: cols[2] || defaultStage,
          lead: cols[3] || defaultLead,
          day: activeDay,
          ...(activeDate ? { date: activeDate } : {}),
          ...(rowSection ? { section: rowSection } : {}),
        });
      }
    }
  }

  return blocks;
}

export interface ProgramOutlineValidationIssue {
  severity: 'error' | 'warning';
  line: number;
  field: 'date' | 'day' | 'time' | 'title' | 'duration' | 'format' | 'duplicate';
  message: string;
}

export interface ValidatedProgramOutlineBlock extends ParsedProgramOutlineBlock {
  sourceLine: number;
  isDuplicateInBatch?: boolean;
  isDuplicateExisting?: boolean;
}

export interface ProgramOutlineValidationResult {
  blocks: ValidatedProgramOutlineBlock[];
  nonDuplicateBlocks: ValidatedProgramOutlineBlock[];
  issues: ProgramOutlineValidationIssue[];
  errors: ProgramOutlineValidationIssue[];
  warnings: ProgramOutlineValidationIssue[];
  duplicateCount: number;
  outOfRangeDateCount: number;
  isValid: boolean;
  summary: {
    totalRowsDetected: number;
    validBlockCount: number;
    sectionCount: number;
    dayCount: number;
    dateRange?: { start: string; end: string };
  };
}

function hasUnbalancedCsvQuotes(line: string): boolean {
  let quotes = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') {
      if (line[i + 1] === '"') {
        i += 1;
      } else {
        quotes += 1;
      }
    }
  }
  return quotes % 2 === 1;
}

function parseSingleClockTokenStrict(token: string): {
  ok: boolean;
  minutes: number;
  normalized: string;
  reason?: string;
} {
  const clean = token.trim();
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return {
      ok: false,
      minutes: -1,
      normalized: clean,
      reason: `Unrecognized time "${clean}". Use HH:MM (e.g. 09:00 or 9:30 AM).`,
    };
  }
  let hour = Number(match[1]);
  const mins = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isInteger(mins) || mins < 0 || mins > 59) {
    return {
      ok: false,
      minutes: -1,
      normalized: clean,
      reason: `Minutes out of range in "${clean}" (must be 00–59).`,
    };
  }
  if (meridiem) {
    if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
      return {
        ok: false,
        minutes: -1,
        normalized: clean,
        reason: `12-hour clock must be 1–12 before ${meridiem} in "${clean}".`,
      };
    }
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  } else if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return {
      ok: false,
      minutes: -1,
      normalized: clean,
      reason: `Hour out of range in "${clean}" (must be 00–23).`,
    };
  }

  return {
    ok: true,
    minutes: hour * 60 + mins,
    normalized: `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
  };
}

function validateTimeExpressionStrict(rawTime: string): {
  ok: boolean;
  normalized: string;
  error?: string;
  warning?: string;
} {
  const clean = rawTime.trim().replace(/\s+/g, ' ');
  if (!clean) {
    return {
      ok: false,
      normalized: '',
      error: 'Missing session time (use e.g. 09:00 or 09:00 - 09:45).',
    };
  }

  const rangeMatch = clean.match(
    /^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i
  );
  if (rangeMatch && /\d/.test(rangeMatch[1]) && /\d/.test(rangeMatch[2])) {
    const startParsed = parseSingleClockTokenStrict(rangeMatch[1]);
    const endParsed = parseSingleClockTokenStrict(rangeMatch[2]);
    if (!startParsed.ok) {
      return { ok: false, normalized: clean, error: startParsed.reason };
    }
    if (!endParsed.ok) {
      return { ok: false, normalized: clean, error: endParsed.reason };
    }
    const normalized = `${startParsed.normalized} - ${endParsed.normalized}`;
    if (endParsed.minutes <= startParsed.minutes) {
      return {
        ok: true,
        normalized,
        warning: `End time (${endParsed.normalized}) is not after start time (${startParsed.normalized}). Check AM/PM or order.`,
      };
    }
    return { ok: true, normalized };
  }

  const single = parseSingleClockTokenStrict(clean);
  if (!single.ok) {
    return { ok: false, normalized: clean, error: single.reason };
  }
  return { ok: true, normalized: single.normalized };
}

function buildDuplicateSessionKey(
  item: Pick<ParsedProgramOutlineBlock, 'date' | 'day' | 'time' | 'title'>
): string {
  const scope = sanitizeIsoDate(item.date) || item.day || 'Day 1';
  const normTime = item.time.trim().toLowerCase().replace(/\s+/g, ' ');
  const normTitle = item.title.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${scope}|${normTime}|${normTitle}`;
}

function validateBlocksAgainstEventContext(
  blocks: ValidatedProgramOutlineBlock[],
  issues: ProgramOutlineValidationIssue[],
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  existingBlocks?: ReadonlyArray<Pick<ScheduleBlock, 'date' | 'day' | 'time' | 'title'>>
): ProgramOutlineValidationResult {
  const existingKeys = new Set<string>();
  if (Array.isArray(existingBlocks)) {
    for (const eb of existingBlocks) {
      const resolvedDate = resolveScheduleBlockDate(eb, eventContext ?? undefined);
      existingKeys.add(
        buildDuplicateSessionKey({
          date: resolvedDate,
          day: eb.day,
          time: eb.time,
          title: eb.title,
        })
      );
    }
  }

  const eventStart = sanitizeIsoDate(eventContext?.isoDate);
  const eventEnd = sanitizeIsoDate(eventContext?.endIsoDate) || eventStart;
  const eventDayCount = getEventDayCount(eventContext);
  const spanLabel = eventStart ? formatEventDateSpan(eventStart, eventEnd) : undefined;

  const seenKeys = new Set<string>();
  let duplicateCount = 0;
  let outOfRangeDateCount = 0;

  for (const blk of blocks) {
    const resolvedDate = sanitizeIsoDate(blk.date);
    if (eventStart && eventEnd && resolvedDate) {
      if (resolvedDate < eventStart || resolvedDate > eventEnd) {
        outOfRangeDateCount += 1;
        issues.push({
          severity: 'warning',
          line: blk.sourceLine,
          field: 'date',
          message: `Session "${blk.title}" is dated ${resolvedDate}, outside event dates (${spanLabel}).`,
        });
      }
    }

    const dayNumMatch = /^Day\s+(\d+)$/i.exec(blk.day || '');
    if (eventStart && dayNumMatch) {
      const num = Number(dayNumMatch[1]);
      if (num > eventDayCount) {
        issues.push({
          severity: 'warning',
          line: blk.sourceLine,
          field: 'day',
          message: `Session "${blk.title}" references ${blk.day}, but this event is configured for ${eventDayCount} day${eventDayCount === 1 ? '' : 's'} (${spanLabel}).`,
        });
      }
    }

    const key = buildDuplicateSessionKey(blk);
    if (existingKeys.has(key)) {
      blk.isDuplicateExisting = true;
      duplicateCount += 1;
      issues.push({
        severity: 'warning',
        line: blk.sourceLine,
        field: 'duplicate',
        message: `"${blk.title}" (${blk.time}${resolvedDate ? ` · ${resolvedDate}` : ''}) already exists in your event schedule.`,
      });
    } else if (seenKeys.has(key)) {
      blk.isDuplicateInBatch = true;
      duplicateCount += 1;
      issues.push({
        severity: 'warning',
        line: blk.sourceLine,
        field: 'duplicate',
        message: `Duplicate row "${blk.title}" (${blk.time}${resolvedDate ? ` · ${resolvedDate}` : ''}) inside this outline.`,
      });
    } else {
      seenKeys.add(key);
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const nonDuplicateBlocks = blocks.filter(
    (b) => !b.isDuplicateExisting && !b.isDuplicateInBatch
  );

  const dates = blocks
    .map((b) => sanitizeIsoDate(b.date))
    .filter((d): d is string => Boolean(d))
    .sort();
  const sectionCount = new Set(blocks.map((b) => b.section).filter(Boolean)).size;
  const dayCount = new Set(blocks.map((b) => b.date || b.day)).size;

  return {
    blocks,
    nonDuplicateBlocks,
    issues,
    errors,
    warnings,
    duplicateCount,
    outOfRangeDateCount,
    isValid: errors.length === 0 && blocks.length > 0,
    summary: {
      totalRowsDetected: blocks.length,
      validBlockCount: blocks.length,
      sectionCount,
      dayCount,
      ...(dates.length > 0 ? { dateRange: { start: dates[0], end: dates[dates.length - 1] } } : {}),
    },
  };
}

export function validateProgramOutlineImport(
  rawText: string,
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  existingBlocks?: ReadonlyArray<Pick<ScheduleBlock, 'date' | 'day' | 'time' | 'title'>>
): ProgramOutlineValidationResult {
  const issues: ProgramOutlineValidationIssue[] = [];
  const rawLines = rawText.replace(/^\uFEFF/, '').split(/\r?\n/);
  const indexedLines = rawLines
    .map((text, idx) => ({ text: text.trim(), line: idx + 1 }))
    .filter((entry) => Boolean(entry.text));

  if (indexedLines.length === 0) {
    issues.push({
      severity: 'error',
      line: 0,
      field: 'format',
      message: 'Program outline is empty. Upload a file or paste session lines to import.',
    });
    return validateBlocksAgainstEventContext([], issues, eventContext, existingBlocks);
  }

  const defaultDay: ScheduleBlock['day'] = 'Day 1';
  const defaultDate =
    sanitizeIsoDate(eventContext?.isoDate) ||
    resolveIsoDateForScheduleDay(defaultDay, eventContext ?? undefined);
  const defaultStage = eventContext?.venue?.trim() || 'Main Stage';
  const defaultLead = eventContext?.organizer?.trim() || 'Organiser';

  const firstCols = splitCsvLine(indexedLines[0].text).map((c) => c.toLowerCase());
  const looksLikeCsvHeader =
    firstCols.length >= 2 &&
    firstCols.some((c) => c.includes('title') || c.includes('session') || c.includes('item')) &&
    firstCols.some((c) => c.includes('time') || c.includes('hour') || c.includes('start'));

  const blocks: ValidatedProgramOutlineBlock[] = [];

  if (looksLikeCsvHeader) {
    const idxTitle = firstCols.findIndex(
      (c) => c.includes('title') || c.includes('session') || c.includes('item') || c.includes('program')
    );
    const idxTime = firstCols.findIndex((c) => c.includes('time') || c.includes('start'));
    const idxStage = firstCols.findIndex(
      (c) => c.includes('stage') || c.includes('room') || c.includes('venue') || c.includes('hall')
    );
    const idxLead = firstCols.findIndex(
      (c) => c.includes('lead') || c.includes('speaker') || c.includes('host') || c.includes('mc')
    );
    const idxDur = firstCols.findIndex((c) => c.includes('dur'));
    const idxDate = firstCols.findIndex((c) => c.includes('date'));
    const idxDay = firstCols.findIndex((c) => c === 'day');
    const idxSection = firstCols.findIndex(
      (c) =>
        c.includes('section') ||
        c.includes('segment') ||
        c.includes('part') ||
        c.includes('track') ||
        c.includes('group')
    );

    for (let r = 1; r < indexedLines.length; r += 1) {
      const { text: lineText, line } = indexedLines[r];
      if (hasUnbalancedCsvQuotes(lineText)) {
        issues.push({
          severity: 'error',
          line,
          field: 'format',
          message: `Line ${line}: Unclosed quotation mark in CSV row.`,
        });
        continue;
      }

      const cols = splitCsvLine(lineText);
      const title = (cols[idxTitle] || '').trim();
      if (!title) {
        issues.push({
          severity: 'error',
          line,
          field: 'title',
          message: `Line ${line}: Missing session title.`,
        });
        continue;
      }

      const rawTimeCell = idxTime >= 0 ? (cols[idxTime] || '').trim() : '';
      const timeValidation = validateTimeExpressionStrict(rawTimeCell);
      if (!timeValidation.ok) {
        issues.push({
          severity: 'error',
          line,
          field: 'time',
          message: `Line ${line} ("${title}"): ${timeValidation.error}`,
        });
        continue;
      }
      if (timeValidation.warning) {
        issues.push({
          severity: 'warning',
          line,
          field: 'time',
          message: `Line ${line} ("${title}"): ${timeValidation.warning}`,
        });
      }

      let explicitDate: string | undefined;
      if (idxDate >= 0) {
        const rawDateCell = (cols[idxDate] || '').trim();
        if (rawDateCell) {
          if (!isValidIsoDate(rawDateCell)) {
            issues.push({
              severity: 'error',
              line,
              field: 'date',
              message: `Line ${line} ("${title}"): Invalid date "${rawDateCell}". Use YYYY-MM-DD format (e.g. 2026-12-18).`,
            });
            continue;
          }
          explicitDate = rawDateCell;
        }
      }

      let explicitDay: ScheduleBlock['day'] | undefined;
      if (idxDay >= 0) {
        const rawDayCell = (cols[idxDay] || '').trim();
        if (rawDayCell) {
          const dayNumMatch = rawDayCell.match(/^Day\s*(\d+)$/i);
          if (dayNumMatch) {
            const dayNum = Number(dayNumMatch[1]);
            if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 7) {
              issues.push({
                severity: 'error',
                line,
                field: 'day',
                message: `Line ${line} ("${title}"): Day "${rawDayCell}" is invalid. Use Day 1–Day 7 or Mon–Sun.`,
              });
              continue;
            }
            explicitDay = `Day ${dayNum}` as ScheduleBlock['day'];
          } else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i.test(rawDayCell)) {
            explicitDay = (rawDayCell.slice(0, 1).toUpperCase() +
              rawDayCell.slice(1, 3).toLowerCase()) as ScheduleBlock['day'];
          } else {
            issues.push({
              severity: 'error',
              line,
              field: 'day',
              message: `Line ${line} ("${title}"): Unrecognized day "${rawDayCell}". Use Day 1–Day 7 or Mon–Sun.`,
            });
            continue;
          }
        }
      }

      if (explicitDate && explicitDay && eventContext?.isoDate) {
        const expectedDateForDay = resolveIsoDateForScheduleDay(explicitDay, eventContext);
        if (expectedDateForDay && expectedDateForDay !== explicitDate) {
          issues.push({
            severity: 'warning',
            line,
            field: 'day',
            message: `Line ${line} ("${title}"): ${explicitDay} usually maps to ${expectedDateForDay}, which differs from Date column ${explicitDate}.`,
          });
        }
      }

      const resolvedDate =
        explicitDate ||
        (explicitDay
          ? resolveIsoDateForScheduleDay(explicitDay, eventContext ?? undefined)
          : undefined) ||
        defaultDate;

      const resolvedDay = resolvedDate
        ? getScheduleBlockDayFromIso(
            resolvedDate,
            eventContext ?? undefined,
            explicitDay ?? defaultDay
          )
        : explicitDay ?? defaultDay;

      const rawDuration = idxDur >= 0 ? (cols[idxDur] || '').trim() : '';
      if (
        rawDuration &&
        !/^\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i.test(rawDuration)
      ) {
        issues.push({
          severity: 'warning',
          line,
          field: 'duration',
          message: `Line ${line} ("${title}"): Unusual duration "${rawDuration}" (expected e.g. 30m, 1h).`,
        });
      }

      const section = idxSection >= 0 ? sanitizeScheduleSection(cols[idxSection]) : undefined;
      blocks.push({
        sourceLine: line,
        time: timeValidation.normalized,
        duration: rawDuration || '45m',
        title,
        stage: (idxStage >= 0 ? cols[idxStage]?.trim() : '') || defaultStage,
        lead: (idxLead >= 0 ? cols[idxLead]?.trim() : '') || defaultLead,
        day: resolvedDay,
        ...(resolvedDate ? { date: resolvedDate } : {}),
        ...(section ? { section } : {}),
      });
    }

    if (blocks.length === 0 && issues.every((i) => i.severity !== 'error')) {
      issues.push({
        severity: 'error',
        line: 0,
        field: 'format',
        message: 'No valid session rows were found below the CSV header.',
      });
    }

    return validateBlocksAgainstEventContext(blocks, issues, eventContext, existingBlocks);
  }

  let activeDay: ScheduleBlock['day'] = defaultDay;
  let activeDate: string | undefined = defaultDate;
  let activeSection: string | undefined;

  for (const { text: rawLine, line } of indexedLines) {
    const cleanedLine = rawLine.replace(/^[-*•]+\s+/, '').trim();
    if (!cleanedLine) continue;
    if (/^#\s+.*program outline import template/i.test(cleanedLine)) continue;

    // Detect malformed Day numbers like "Day 8" or "Day 0"
    const anyDayHeaderMatch = cleanedLine.match(/^#*\s*Day\s*(\d+)(?:\b|[:\s-])/i);
    const timeInLine = cleanedLine.match(
      /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?(?:\s*[-–—to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?)\b/i
    );

    if (anyDayHeaderMatch && !timeInLine) {
      const dayNum = Number(anyDayHeaderMatch[1]);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 7) {
        issues.push({
          severity: 'error',
          line,
          field: 'day',
          message: `Line ${line}: Day ${anyDayHeaderMatch[1]} is out of supported range (Day 1–Day 7).`,
        });
        continue;
      }

      const normalizedDayLabel = `Day ${dayNum}` as ScheduleBlock['day'];
      const parenDateMatch = cleanedLine.match(/\(([^)]+)\)/);
      const isoCandidateMatch = cleanedLine.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/);
      let parsedHeadingDate: string | undefined;

      if (isoCandidateMatch) {
        const candidate = isoCandidateMatch[1].replace(/\//g, '-');
        if (!isValidIsoDate(candidate)) {
          issues.push({
            severity: 'error',
            line,
            field: 'date',
            message: `Line ${line}: Invalid calendar date "${isoCandidateMatch[1]}" in day header.`,
          });
          continue;
        }
        parsedHeadingDate = candidate;
      } else if (parenDateMatch && /\d/.test(parenDateMatch[1])) {
        issues.push({
          severity: 'error',
          line,
          field: 'date',
          message: `Line ${line}: Unrecognized date "${parenDateMatch[1]}" in day header (expected YYYY-MM-DD).`,
        });
        continue;
      }

      if (parsedHeadingDate && eventContext?.isoDate) {
        const expectedDate = resolveIsoDateForScheduleDay(normalizedDayLabel, eventContext);
        if (expectedDate && expectedDate !== parsedHeadingDate) {
          issues.push({
            severity: 'warning',
            line,
            field: 'day',
            message: `Line ${line}: ${normalizedDayLabel} maps to ${expectedDate}, which differs from header date ${parsedHeadingDate}.`,
          });
        }
      }

      activeDay = normalizedDayLabel;
      activeDate =
        parsedHeadingDate ||
        resolveIsoDateForScheduleDay(normalizedDayLabel, eventContext ?? undefined) ||
        activeDate;
      activeSection = undefined;
      continue;
    }

    const isoLineCandidate = cleanedLine.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/);
    if (isoLineCandidate) {
      const norm = isoLineCandidate[1].replace(/\//g, '-');
      if (!isValidIsoDate(norm)) {
        issues.push({
          severity: 'error',
          line,
          field: 'date',
          message: `Line ${line}: Invalid calendar date "${cleanedLine}". Use valid YYYY-MM-DD.`,
        });
        continue;
      }
      activeDate = norm;
      activeDay = getScheduleBlockDayFromIso(norm, eventContext ?? undefined, activeDay);
      continue;
    }

    const explicitSectionPrefixMatch = cleanedLine.match(/^(?:section|part|segment)\s*:\s*(.+)$/i);
    const markdownSectionMatch = cleanedLine.match(/^#{2,6}\s+(.+)$/);
    const bracketSectionMatch = cleanedLine.match(/^\[([^\]]{2,80})\]$/);
    if (!timeInLine && !cleanedLine.includes('|')) {
      const rawSectionCandidate =
        explicitSectionPrefixMatch?.[1] ||
        bracketSectionMatch?.[1] ||
        (markdownSectionMatch && !/program outline import template/i.test(markdownSectionMatch[1])
          ? markdownSectionMatch[1]
          : undefined);
      const parsedSection = sanitizeScheduleSection(rawSectionCandidate);
      if (parsedSection && !/^Day\s*\d+\b/i.test(parsedSection)) {
        activeSection = parsedSection;
        continue;
      }
    }

    if (cleanedLine.includes('|')) {
      const parts = cleanedLine.split('|').map((p) => p.trim());
      if (parts.length >= 2) {
        const firstIsTimeLike = /\d{1,2}(?::\d{2})?/.test(parts[0]);
        if (!firstIsTimeLike) {
          issues.push({
            severity: 'error',
            line,
            field: 'time',
            message: `Line ${line}: First column "${parts[0]}" must be a time slot (e.g. 09:00 - 09:45).`,
          });
          continue;
        }
        const timeCheck = validateTimeExpressionStrict(parts[0]);
        if (!timeCheck.ok) {
          issues.push({
            severity: 'error',
            line,
            field: 'time',
            message: `Line ${line}: ${timeCheck.error}`,
          });
          continue;
        }
        if (timeCheck.warning) {
          issues.push({
            severity: 'warning',
            line,
            field: 'time',
            message: `Line ${line}: ${timeCheck.warning}`,
          });
        }
        const title = (parts[1] || '').trim();
        if (!title) {
          issues.push({
            severity: 'error',
            line,
            field: 'title',
            message: `Line ${line}: Missing session title after time "${parts[0]}".`,
          });
          continue;
        }
        const stage = parts[2] || defaultStage;
        const lead = parts[3] || defaultLead;
        const rowSection = sanitizeScheduleSection(parts[4]) ?? activeSection;
        blocks.push({
          sourceLine: line,
          time: timeCheck.normalized,
          duration: '45m',
          title,
          stage,
          lead,
          day: activeDay,
          ...(activeDate ? { date: activeDate } : {}),
          ...(rowSection ? { section: rowSection } : {}),
        });
        continue;
      }
    }

    if (timeInLine) {
      const timeCheck = validateTimeExpressionStrict(timeInLine[1]);
      if (!timeCheck.ok) {
        issues.push({
          severity: 'error',
          line,
          field: 'time',
          message: `Line ${line}: ${timeCheck.error}`,
        });
        continue;
      }
      if (timeCheck.warning) {
        issues.push({
          severity: 'warning',
          line,
          field: 'time',
          message: `Line ${line}: ${timeCheck.warning}`,
        });
      }
      let remainder = cleanedLine
        .slice(timeInLine[0].length)
        .replace(/^[\s:|–—-]+/, '')
        .trim();
      if (!remainder) {
        issues.push({
          severity: 'error',
          line,
          field: 'title',
          message: `Line ${line}: Missing session title after time "${timeInLine[1]}".`,
        });
        continue;
      }

      let stage = defaultStage;
      let lead = defaultLead;
      const parenMatch = remainder.match(/\(([^)]+)\)\s*$/);
      if (parenMatch) {
        stage = parenMatch[1].trim() || defaultStage;
        remainder = remainder.slice(0, parenMatch.index).trim();
      } else if (remainder.includes('—') || remainder.includes(' - ')) {
        const subParts = remainder.split(/\s+(?:—|-)\s+/).map((s) => s.trim()).filter(Boolean);
        if (subParts.length >= 2) {
          remainder = subParts[0];
          stage = subParts[1] || defaultStage;
          if (subParts[2]) lead = subParts[2];
        }
      }

      blocks.push({
        sourceLine: line,
        time: timeCheck.normalized,
        duration: '45m',
        title: remainder,
        stage,
        lead,
        day: activeDay,
        ...(activeDate ? { date: activeDate } : {}),
        ...(activeSection ? { section: activeSection } : {}),
      });
      continue;
    }

    if (cleanedLine.includes(',')) {
      if (hasUnbalancedCsvQuotes(cleanedLine)) {
        issues.push({
          severity: 'error',
          line,
          field: 'format',
          message: `Line ${line}: Unclosed quotation mark in row.`,
        });
        continue;
      }
      const cols = splitCsvLine(cleanedLine);
      if (cols.length >= 2 && cols[1]) {
        const timeCheck = validateTimeExpressionStrict(cols[0]);
        if (!timeCheck.ok) {
          issues.push({
            severity: 'error',
            line,
            field: 'time',
            message: `Line ${line}: ${timeCheck.error}`,
          });
          continue;
        }
        const rowSection = sanitizeScheduleSection(cols[4]) ?? activeSection;
        blocks.push({
          sourceLine: line,
          time: timeCheck.normalized,
          duration: '45m',
          title: cols[1],
          stage: cols[2] || defaultStage,
          lead: cols[3] || defaultLead,
          day: activeDay,
          ...(activeDate ? { date: activeDate } : {}),
          ...(rowSection ? { section: rowSection } : {}),
        });
        continue;
      }
    }

    if (!cleanedLine.startsWith('#')) {
      issues.push({
        severity: 'warning',
        line,
        field: 'format',
        message: `Line ${line}: Could not detect a valid time & title ("${cleanedLine.slice(0, 42)}") — skipped.`,
      });
    }
  }

  if (blocks.length === 0 && issues.every((i) => i.severity !== 'error')) {
    issues.push({
      severity: 'error',
      line: 0,
      field: 'format',
      message:
        'No valid program sessions found. Format lines as "09:00 - 09:45 | Title | Stage | Lead" or use a CSV template.',
    });
  }

  return validateBlocksAgainstEventContext(blocks, issues, eventContext, existingBlocks);
}

export function validateParsedOutlineBlocks(
  parsedBlocks: ReadonlyArray<ParsedProgramOutlineBlock>,
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  existingBlocks?: ReadonlyArray<Pick<ScheduleBlock, 'date' | 'day' | 'time' | 'title'>>
): ProgramOutlineValidationResult {
  const issues: ProgramOutlineValidationIssue[] = [];
  const validated: ValidatedProgramOutlineBlock[] = [];

  parsedBlocks.forEach((blk, idx) => {
    const line = idx + 1;
    const title = (blk.title || '').trim();
    if (!title) {
      issues.push({
        severity: 'error',
        line,
        field: 'title',
        message: `Row ${line}: Missing session title.`,
      });
      return;
    }
    const timeCheck = validateTimeExpressionStrict(blk.time || '');
    if (!timeCheck.ok) {
      issues.push({
        severity: 'error',
        line,
        field: 'time',
        message: `Row ${line} ("${title}"): ${timeCheck.error}`,
      });
      return;
    }
    if (timeCheck.warning) {
      issues.push({
        severity: 'warning',
        line,
        field: 'time',
        message: `Row ${line} ("${title}"): ${timeCheck.warning}`,
      });
    }
    if (blk.date && !isValidIsoDate(blk.date)) {
      issues.push({
        severity: 'error',
        line,
        field: 'date',
        message: `Row ${line} ("${title}"): Invalid date "${blk.date}".`,
      });
      return;
    }
    validated.push({
      ...blk,
      title,
      time: timeCheck.normalized,
      sourceLine: line,
    });
  });

  if (validated.length === 0 && issues.every((i) => i.severity !== 'error')) {
    issues.push({
      severity: 'error',
      line: 0,
      field: 'format',
      message: 'No program blocks available to copy or import.',
    });
  }

  return validateBlocksAgainstEventContext(validated, issues, eventContext, existingBlocks);
}

export function formatProgramOutlineAsText(
  blocks: ReadonlyArray<Pick<ScheduleBlock, 'day' | 'date' | 'section' | 'time' | 'title' | 'stage' | 'lead'>>,
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  eventTitle?: string
): string {
  const cleanTitle = (eventTitle || 'Event').replace(/[|]/g, '-').trim();
  if (blocks.length === 0) return `# ${cleanTitle} — Program Outline\n`;

  const groupedByDay = new Map<string, typeof blocks[number][]>();
  for (const row of blocks) {
    const resolvedIso = resolveScheduleBlockDate(row, eventContext ?? undefined);
    const key = resolvedIso ? `${row.day} (${resolvedIso})` : row.day;
    const list = groupedByDay.get(key) ?? [];
    list.push(row);
    groupedByDay.set(key, list);
  }

  const lines: string[] = [`# ${cleanTitle} — Program Outline`];
  for (const [dayLabel, dayRows] of groupedByDay.entries()) {
    lines.push('');
    lines.push(`## ${dayLabel}`);
    let lastSection = '';
    for (const row of dayRows) {
      const sec = sanitizeScheduleSection(row.section) || '';
      if (sec && sec !== lastSection) {
        lines.push(`### ${sec}`);
        lastSection = sec;
      }
      lines.push(`${row.time} | ${row.title} | ${row.stage} | ${row.lead}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function formatProgramOutlineAsCsv(
  blocks: ReadonlyArray<Pick<ScheduleBlock, 'day' | 'date' | 'section' | 'time' | 'duration' | 'title' | 'stage' | 'lead'>>,
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate'> | null
): string {
  const header = ['Day', 'Date', 'Section', 'Time', 'Duration', 'Title', 'Stage', 'Lead'].join(',');
  const lines = blocks.map((row) => {
    const resolvedIso = resolveScheduleBlockDate(row, eventContext ?? undefined) || '';
    return [
      escapeCsvCell(row.day),
      escapeCsvCell(resolvedIso),
      escapeCsvCell(sanitizeScheduleSection(row.section) || ''),
      escapeCsvCell(row.time),
      escapeCsvCell(row.duration || '45m'),
      escapeCsvCell(row.title),
      escapeCsvCell(row.stage),
      escapeCsvCell(row.lead),
    ].join(',');
  });
  return `${header}\n${lines.join('\n')}\n`;
}

export function remapProgramBlocksToEvent(
  sourceBlocks: ReadonlyArray<ScheduleBlock>,
  sourceEvent?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  targetEvent?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  remapDates = true
): ParsedProgramOutlineBlock[] {
  const sourceStart = sanitizeIsoDate(sourceEvent?.isoDate);
  const targetStart = sanitizeIsoDate(targetEvent?.isoDate);

  return sourceBlocks.map((blk) => {
    const sourceDate = resolveScheduleBlockDate(blk, sourceEvent ?? undefined);
    let nextDate = sourceDate;
    let nextDay = blk.day;

    if (remapDates && targetEvent) {
      const dayNumMatch = /^Day\s+(\d+)$/i.exec(blk.day || '');
      if (dayNumMatch) {
        nextDay = `Day ${Number(dayNumMatch[1])}` as ScheduleBlock['day'];
        nextDate = resolveIsoDateForScheduleDay(nextDay, targetEvent) ?? targetStart;
      } else if (sourceStart && sourceDate && targetStart) {
        const offsetDays = Math.max(
          0,
          Math.round(
            (Date.parse(`${sourceDate}T00:00:00Z`) - Date.parse(`${sourceStart}T00:00:00Z`)) /
              86_400_000
          )
        );
        const targetMs = Date.parse(`${targetStart}T00:00:00Z`) + offsetDays * 86_400_000;
        nextDate = new Date(targetMs).toISOString().slice(0, 10);
        nextDay = getScheduleBlockDayFromIso(nextDate, targetEvent, blk.day);
      } else if (targetStart) {
        nextDate = resolveIsoDateForScheduleDay(blk.day, targetEvent) ?? targetStart;
        nextDay = nextDate
          ? getScheduleBlockDayFromIso(nextDate, targetEvent, blk.day)
          : blk.day;
      }
    }

    const cleanSection = sanitizeScheduleSection(blk.section);
    return {
      time: blk.time,
      duration: blk.duration || '45m',
      title: blk.title,
      stage: blk.stage || targetEvent?.venue?.trim() || 'Main Stage',
      lead: blk.lead || targetEvent?.organizer?.trim() || 'Organiser',
      day: nextDay,
      ...(nextDate ? { date: nextDate } : {}),
      ...(cleanSection ? { section: cleanSection } : {}),
    };
  });
}

function escapeCsvCell(value: string): string {
  const clean = value.replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(clean)) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

export type ProgramOutlineTemplateFormat = 'csv' | 'txt' | 'md';

function buildTemplateSampleRows(
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null
): Array<{
  day: ScheduleBlock['day'];
  date: string;
  section: string;
  time: string;
  duration: string;
  title: string;
  stage: string;
  lead: string;
}> {
  const day1Iso = sanitizeIsoDate(eventContext?.isoDate) || getTodayIsoDate();
  const stage = eventContext?.venue?.trim() || 'Main Auditorium';
  const lead = eventContext?.organizer?.trim() || 'Program Lead';
  const dayCount = getEventDayCount(eventContext);

  const rows: Array<{
    day: ScheduleBlock['day'];
    date: string;
    section: string;
    time: string;
    duration: string;
    title: string;
    stage: string;
    lead: string;
  }> = [
    {
      day: 'Day 1',
      date: day1Iso,
      section: 'Part 1 · Arrival & Welcome',
      time: '09:00 - 09:30',
      duration: '30m',
      title: 'Guest Arrival & QR Check-In',
      stage: `${stage} Atrium`,
      lead: 'Hospitality Team',
    },
    {
      day: 'Day 1',
      date: day1Iso,
      section: 'Part 1 · Arrival & Welcome',
      time: '09:30 - 10:15',
      duration: '45m',
      title: 'Opening Welcome & Introductions',
      stage,
      lead,
    },
    {
      day: 'Day 1',
      date: day1Iso,
      section: 'Part 2 · Main Program',
      time: '10:15 - 11:15',
      duration: '60m',
      title: 'Main Session / Keynote Address',
      stage,
      lead: 'Keynote Speaker',
    },
    {
      day: 'Day 1',
      date: day1Iso,
      section: 'Part 3 · Closing & Networking',
      time: '11:30 - 12:30',
      duration: '60m',
      title: 'Closing Remarks & Networking',
      stage,
      lead,
    },
  ];

  if (dayCount > 1) {
    const day2Iso =
      resolveIsoDateForScheduleDay('Day 2', eventContext ?? undefined) || day1Iso;
    rows.push(
      {
        day: 'Day 2',
        date: day2Iso,
        section: 'Day 2 · Morning & Grand Finale',
        time: '09:00 - 09:45',
        duration: '45m',
        title: 'Day 2 Morning Check-In & Recap',
        stage,
        lead,
      },
      {
        day: 'Day 2',
        date: day2Iso,
        section: 'Day 2 · Morning & Grand Finale',
        time: '10:00 - 11:30',
        duration: '90m',
        title: 'Grand Finale Session',
        stage,
        lead: 'Host Committee',
      }
    );
  }

  return rows;
}

export function buildProgramOutlineCsvTemplate(
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null
): string {
  const rows = buildTemplateSampleRows(eventContext);
  const header = ['Day', 'Date', 'Section', 'Time', 'Duration', 'Title', 'Stage', 'Lead'].join(',');
  const lines = rows.map((row) =>
    [
      escapeCsvCell(row.day),
      escapeCsvCell(row.date),
      escapeCsvCell(row.section),
      escapeCsvCell(row.time),
      escapeCsvCell(row.duration),
      escapeCsvCell(row.title),
      escapeCsvCell(row.stage),
      escapeCsvCell(row.lead),
    ].join(',')
  );
  return `${header}\n${lines.join('\n')}\n`;
}

export function buildProgramOutlineTextTemplate(
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  eventTitle?: string
): string {
  const rows = buildTemplateSampleRows(eventContext);
  const cleanTitle = (eventTitle || 'Event').replace(/[|]/g, '-').trim();
  const groupedByDay = new Map<string, typeof rows>();

  for (const row of rows) {
    const key = `${row.day} (${row.date})`;
    const list = groupedByDay.get(key) ?? [];
    list.push(row);
    groupedByDay.set(key, list);
  }

  const sections: string[] = [`# ${cleanTitle} — Program Outline Import Template`];
  for (const [dayLabel, dayRows] of groupedByDay.entries()) {
    sections.push('');
    sections.push(`## ${dayLabel}`);
    let lastSection = '';
    for (const row of dayRows) {
      if (row.section && row.section !== lastSection) {
        sections.push(`### ${row.section}`);
        lastSection = row.section;
      }
      sections.push(`${row.time} | ${row.title} | ${row.stage} | ${row.lead}`);
    }
  }
  sections.push('');
  return sections.join('\n');
}

export function downloadProgramOutlineTemplate(
  format: ProgramOutlineTemplateFormat = 'csv',
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null,
  eventTitle?: string
): { fileName: string } {
  const slugBase = (eventTitle || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const prefix = slugBase ? `${slugBase}-` : '';

  const isCsv = format === 'csv';
  const ext = isCsv ? 'csv' : format === 'md' ? 'md' : 'txt';
  const fileName = `${prefix}program-outline-template.${ext}`;

  const rawBody = isCsv
    ? `\uFEFF${buildProgramOutlineCsvTemplate(eventContext)}`
    : buildProgramOutlineTextTemplate(eventContext, eventTitle);

  const mimeType = isCsv
    ? 'text/csv;charset=utf-8;'
    : format === 'md'
      ? 'text/markdown;charset=utf-8;'
      : 'text/plain;charset=utf-8;';

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([rawBody], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { fileName };
}
