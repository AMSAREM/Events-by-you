import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events.ts';
import {
  getScheduleBlockDayFromIso,
  resolveIsoDateForScheduleDay,
  sanitizeIsoDate,
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
      blocks.push({
        time: normalizeTimeExpression(cols[idxTime] || '09:00'),
        duration: (idxDur >= 0 ? cols[idxDur]?.trim() : '') || '45m',
        title,
        stage: (idxStage >= 0 ? cols[idxStage]?.trim() : '') || defaultStage,
        lead: (idxLead >= 0 ? cols[idxLead]?.trim() : '') || defaultLead,
        day: resolvedDay,
        ...(resolvedDate ? { date: resolvedDate } : {}),
      });
    }
    return blocks;
  }

  let activeDay: ScheduleBlock['day'] = defaultDay;
  let activeDate: string | undefined = defaultDate;
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

    // Pipe-delimited line: Time | Title | Stage | Lead
    if (cleanedLine.includes('|')) {
      const parts = cleanedLine.split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const maybeTime = /\d{1,2}(?::\d{2})?\s*(?:AM|PM)?/i.test(parts[0])
          ? normalizeTimeExpression(parts[0])
          : '09:00';
        const title = /\d/.test(parts[0]) ? parts[1] : parts[0];
        const stage = parts[2] || defaultStage;
        const lead = parts[3] || defaultLead;
        if (title) {
          blocks.push({
            time: maybeTime,
            duration: '45m',
            title,
            stage,
            lead,
            day: activeDay,
            ...(activeDate ? { date: activeDate } : {}),
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
      });
      continue;
    }

    // Comma-separated row without explicit header: "09:00, Opening Keynote, Main Hall"
    if (cleanedLine.includes(',')) {
      const cols = splitCsvLine(cleanedLine);
      if (cols.length >= 2 && cols[1]) {
        const timeStr = /\d{1,2}/.test(cols[0]) ? normalizeTimeExpression(cols[0]) : '09:00';
        const title = /\d{1,2}/.test(cols[0]) ? cols[1] : cols[0];
        blocks.push({
          time: timeStr,
          duration: '45m',
          title,
          stage: cols[2] || defaultStage,
          lead: cols[3] || defaultLead,
          day: activeDay,
          ...(activeDate ? { date: activeDate } : {}),
        });
      }
    }
  }

  return blocks;
}
