import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events.ts';
import { getCategoryPreset } from '../data/initialData.ts';
import {
  compareScheduleBlocksChronological,
  formatEventDateSpan,
  groupScheduleBlocksBySection,
  sanitizeScheduleSection,
} from './eventDates.ts';
import {
  decodeProgramOutlineText,
  isTextProgramOutline,
  parseProgramOutlineTextToBlocks,
  sanitizeEventLogoUrl,
  sanitizeProgramOutline,
} from './programOutline.ts';
import { buildEventProgramUrl, buildQrSvgString, generateDeterministicQrMatrix } from './qr.tsx';
import { getContrastTextColor, getThemePresetMeta, resolveEventBrandColor } from './themeColors.ts';

export interface ResolvedProgramSheetSession {
  id: string;
  time: string;
  duration: string;
  title: string;
  stage: string;
  lead: string;
  day?: string;
  section?: string;
}

export interface ResolvedProgramSheetData {
  event: EventItem;
  flyerUrl?: string;
  logoUrl?: string;
  monogram: string;
  brandColor: string;
  brandTextColor: '#FFFFFF' | '#0B0B0B';
  surfaceBg: string;
  formattedDate: string;
  programUrl: string;
  outline?: EventProgramOutline;
  sessions: ResolvedProgramSheetSession[];
}

function deriveMonogram(label?: string | null): string {
  const words = (label || 'EV')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }
  const single = words[0] || 'EV';
  return single.slice(0, 2).toUpperCase();
}

export function resolveProgramExportData(
  event: EventItem,
  scheduleBlocks: ScheduleBlock[],
  fallbackLogoUrl?: string | null
): ResolvedProgramSheetData {
  const preset = getCategoryPreset(event.category);
  const flyerUrl = event.flyerUrl || preset.flyerUrl;
  const logoUrl =
    sanitizeEventLogoUrl(event.extraDataConfig?.logoUrl) ??
    sanitizeEventLogoUrl(fallbackLogoUrl);
  const brandColor = resolveEventBrandColor(event);
  const brandTextColor = getContrastTextColor(brandColor);
  const themeMeta = getThemePresetMeta(event.designTheme);
  const formattedDate = formatEventDateSpan(event.isoDate, event.endIsoDate, event.date);
  const programUrl = buildEventProgramUrl(event.slug || event.id);
  const outline = sanitizeProgramOutline(event.extraDataConfig?.programOutline);

  const eventBlocks = scheduleBlocks
    .filter((b) => b.eventId === event.id)
    .slice()
    .sort((a, b) => compareScheduleBlocksChronological(a, b, event));

  let sessions: ResolvedProgramSheetSession[] = eventBlocks.map((b) => {
    const cleanSection = sanitizeScheduleSection(b.section);
    return {
      id: b.id,
      time: b.time,
      duration: b.duration,
      title: b.title,
      stage: b.stage,
      lead: b.lead,
      day: b.day,
      ...(cleanSection ? { section: cleanSection } : {}),
    };
  });

  if (sessions.length === 0 && outline && isTextProgramOutline(outline)) {
    const parsed = parseProgramOutlineTextToBlocks(decodeProgramOutlineText(outline), event);
    sessions = parsed.map((b, idx) => {
      const cleanSection = sanitizeScheduleSection(b.section);
      return {
        id: `parsed-${idx}`,
        time: b.time,
        duration: b.duration,
        title: b.title,
        stage: b.stage,
        lead: b.lead,
        day: b.day,
        ...(cleanSection ? { section: cleanSection } : {}),
      };
    });
  }

  return {
    event,
    flyerUrl,
    logoUrl,
    monogram: deriveMonogram(event.organizer || event.title),
    brandColor,
    brandTextColor,
    surfaceBg: themeMeta.surfaceBg,
    formattedDate,
    programUrl,
    outline,
    sessions,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadCanvasImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const isRemoteHttp =
      /^https?:\/\//i.test(src) &&
      typeof window !== 'undefined' &&
      !src.startsWith(window.location.origin);
    if (isRemoteHttp) {
      img.crossOrigin = 'anonymous';
    }
    const timer = window.setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 3
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length >= maxLines - 1) {
        for (let j = i + 1; j < words.length; j += 1) {
          const nextCand = `${current} ${words[j]}`;
          if (ctx.measureText(`${nextCand}...`).width <= maxWidth) {
            current = nextCand;
          } else {
            current = `${current}...`;
            break;
          }
        }
        lines.push(current);
        return lines;
      }
    }
  }
  lines.push(current);
  return lines;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / Math.max(1, h);
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > boxRatio) {
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const scale = Math.min(w / Math.max(1, img.naturalWidth), h / Math.max(1, img.naturalHeight));
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

export async function exportDesignedProgramOutlinePng(
  event: EventItem,
  scheduleBlocks: ScheduleBlock[],
  fallbackLogoUrl?: string | null
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('PNG export is only available in the browser.');
  }

  const data = resolveProgramExportData(event, scheduleBlocks, fallbackLogoUrl);
  const outlineIsImage = Boolean(data.outline?.mimeType.startsWith('image/'));

  const [flyerImg, logoImg, outlineImg] = await Promise.all([
    loadCanvasImage(data.flyerUrl),
    loadCanvasImage(data.logoUrl),
    outlineIsImage ? loadCanvasImage(data.outline?.dataUrl) : Promise.resolve(null),
  ]);

  const width = 1240;
  const padX = 72;
  const contentW = width - padX * 2;
  const heroH = 510;
  const footerH = 196;

  const outlineImageBoxH = outlineImg
    ? Math.min(540, Math.max(240, Math.round((contentW * outlineImg.naturalHeight) / Math.max(1, outlineImg.naturalWidth))))
    : 0;

  const sessionRowH = 92;
  const sectionHeaderH = 44;
  const sessionsToRender = data.sessions.slice(0, 28);
  const exportGroups = groupScheduleBlocksBySection(sessionsToRender);
  const hasExportSections =
    exportGroups.length > 1 || (exportGroups.length === 1 && !exportGroups[0].isGeneral);
  const sectionHeadersCount = hasExportSections ? exportGroups.length : 0;
  const sessionsListH =
    sessionsToRender.length > 0
      ? sessionsToRender.length * sessionRowH + sectionHeadersCount * sectionHeaderH + 80
      : outlineImg
        ? 0
        : 160;
  const notesBlockH = data.outline?.notes ? 68 : 0;

  const totalHeight = Math.max(
    1754,
    heroH + 150 + notesBlockH + (outlineImageBoxH ? outlineImageBoxH + 40 : 0) + sessionsListH + footerH + 64
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize export canvas.');
  }

  // Paper base
  ctx.fillStyle = '#FAF8F5';
  ctx.fillRect(0, 0, width, totalHeight);

  // Subtle sheet frame
  ctx.strokeStyle = '#E5E2DC';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, width - 48, totalHeight - 48);

  // 1. Top Flyer Hero with Scrim + Logo Badge
  ctx.save();
  ctx.beginPath();
  ctx.rect(24, 24, width - 48, heroH);
  ctx.clip();

  ctx.fillStyle = data.surfaceBg || '#0B0B0B';
  ctx.fillRect(24, 24, width - 48, heroH);

  if (flyerImg) {
    try {
      drawImageCover(ctx, flyerImg, 24, 24, width - 48, heroH);
    } catch {
      // Keep surface background if tainted image draw fails
    }
  }

  const grad = ctx.createLinearGradient(0, 24, 0, 24 + heroH);
  grad.addColorStop(0, 'rgba(11, 11, 11, 0.42)');
  grad.addColorStop(0.5, 'rgba(11, 11, 11, 0.56)');
  grad.addColorStop(1, 'rgba(11, 11, 11, 0.94)');
  ctx.fillStyle = grad;
  ctx.fillRect(24, 24, width - 48, heroH);

  // Inner architectural hairline inside flyer hero
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  drawRoundedRectPath(ctx, 44, 44, width - 88, heroH - 40, 20);
  ctx.stroke();

  // Logo Medallion (Top Left)
  const logoSize = 96;
  const logoX = padX;
  const logoY = 66;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRectPath(ctx, logoX, logoY, logoSize, logoSize, 22);
  ctx.fill();
  ctx.strokeStyle = data.brandColor;
  ctx.lineWidth = 3;
  drawRoundedRectPath(ctx, logoX, logoY, logoSize, logoSize, 22);
  ctx.stroke();

  if (logoImg) {
    ctx.save();
    drawRoundedRectPath(ctx, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12, 16);
    ctx.clip();
    drawImageContain(ctx, logoImg, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0B0B0B';
    ctx.font = '700 32px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.monogram, logoX + logoSize / 2, logoY + logoSize / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Organizer & Label next to Logo
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 16px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  ctx.fillText(
    `${(data.event.organizer || 'Organiser').toUpperCase()}  ·  OFFICIAL PROGRAM SHEET`,
    logoX + logoSize + 24,
    logoY + 38
  );
  ctx.fillStyle = data.brandColor;
  ctx.fillRect(logoX + logoSize + 24, logoY + 54, 72, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 15px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  ctx.fillText(data.event.category || 'Event', logoX + logoSize + 24, logoY + 80);

  // Bottom Hero Title + Metadata
  ctx.fillStyle = data.brandColor;
  ctx.fillRect(padX, heroH - 178, 84, 4);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 48px "Plus Jakarta Sans", Georgia, serif';
  const titleLines = wrapTextLines(ctx, data.event.title, contentW, 2);
  let titleY = heroH - 124;
  for (const line of titleLines) {
    ctx.fillText(line, padX, titleY);
    titleY += 54;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.font = '500 19px "Plus Jakarta Sans", system-ui, sans-serif';
  const metaText = `${data.formattedDate}   ·   ${data.event.time}   ·   ${data.event.venue}, ${data.event.city}`;
  ctx.fillText(metaText.slice(0, 88), padX, heroH - 12);

  ctx.restore();

  // 2. Program Outline Section Header
  let cursorY = 24 + heroH + 56;
  ctx.fillStyle = '#0B0B0B';
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    data.outline?.title || 'Program Outline & Run of Show',
    padX,
    cursorY
  );

  ctx.fillStyle = '#71717A';
  ctx.font = '500 16px "Plus Jakarta Sans", system-ui, sans-serif';
  const subSummary = data.sessions.length > 0
    ? `${data.sessions.length} scheduled session${data.sessions.length === 1 ? '' : 's'} · ${data.event.subtitle || data.event.venue}`
    : data.outline?.fileName
      ? `Attached Document: ${data.outline.fileName}`
      : data.event.subtitle || 'Order of Proceedings';
  ctx.fillText(subSummary.slice(0, 96), padX, cursorY + 30);

  cursorY += 54;
  ctx.strokeStyle = '#E5E2DC';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, cursorY);
  ctx.lineTo(width - padX, cursorY);
  ctx.stroke();

  if (data.outline?.notes) {
    cursorY += 34;
    ctx.fillStyle = '#52525B';
    ctx.font = 'italic 17px Georgia, serif';
    const noteLines = wrapTextLines(ctx, data.outline.notes, contentW, 2);
    for (const line of noteLines) {
      ctx.fillText(line, padX, cursorY);
      cursorY += 24;
    }
  }

  // Optional uploaded image preview inside designed sheet
  if (outlineImg && outlineImageBoxH > 0) {
    cursorY += 28;
    ctx.save();
    drawRoundedRectPath(ctx, padX, cursorY, contentW, outlineImageBoxH, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E5E2DC';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.clip();
    drawImageContain(ctx, outlineImg, padX + 12, cursorY + 12, contentW - 24, outlineImageBoxH - 24);
    ctx.restore();
    cursorY += outlineImageBoxH + 20;
  }

  // 3. Program Timeline Rows (with optional Section headers)
  if (sessionsToRender.length > 0) {
    cursorY += 30;
    for (let g = 0; g < exportGroups.length; g += 1) {
      const grp = exportGroups[g];
      if (hasExportSections) {
        if (cursorY + sectionHeaderH + sessionRowH > totalHeight - footerH - 24) break;
        if (g > 0) cursorY += 8;
        ctx.fillStyle = '#EAE7E0';
        drawRoundedRectPath(ctx, padX, cursorY, contentW, 34, 8);
        ctx.fill();
        ctx.fillStyle = data.brandColor;
        ctx.fillRect(padX, cursorY + 6, 4, 22);
        ctx.fillStyle = '#0B0B0B';
        ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(grp.section.toUpperCase().slice(0, 64), padX + 16, cursorY + 22);
        cursorY += sectionHeaderH;
      }

      for (let i = 0; i < grp.blocks.length; i += 1) {
        const item = grp.blocks[i];
        if (cursorY + sessionRowH > totalHeight - footerH - 24) break;

        if (i > 0) {
          ctx.strokeStyle = '#EAE7E0';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padX, cursorY);
          ctx.lineTo(width - padX, cursorY);
          ctx.stroke();
        }

        // Time column
        ctx.fillStyle = '#0B0B0B';
        ctx.font = '700 20px "JetBrains Mono", monospace';
        ctx.fillText(item.time || '--:--', padX, cursorY + 38);

        ctx.fillStyle = '#71717A';
        ctx.font = '500 14px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(
          `${item.day ? `${item.day} · ` : ''}${item.duration || '45m'}`,
          padX,
          cursorY + 62
        );

        // Vertical accent dot
        ctx.fillStyle = data.brandColor;
        ctx.beginPath();
        ctx.arc(padX + 184, cursorY + 32, 5, 0, Math.PI * 2);
        ctx.fill();

        // Session Title & Stage/Lead
        const titleColX = padX + 212;
        ctx.fillStyle = '#0B0B0B';
        ctx.font = '600 20px "Plus Jakarta Sans", system-ui, sans-serif';
        const itemTitle = item.title.length > 58 ? `${item.title.slice(0, 55)}...` : item.title;
        ctx.fillText(itemTitle, titleColX, cursorY + 38);

        ctx.fillStyle = '#52525B';
        ctx.font = '500 15px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(`${item.stage}  ·  Led by ${item.lead}`.slice(0, 74), titleColX, cursorY + 64);

        cursorY += sessionRowH;
      }
    }
  } else if (!outlineImg) {
    cursorY += 48;
    ctx.fillStyle = '#52525B';
    ctx.font = '500 18px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      data.outline
        ? `Full program booklet attached online (${data.outline.fileName}). Scan QR code to view or download.`
        : 'Program sessions are updated live on the official event page. Scan the QR code below for details.',
      padX,
      cursorY
    );
  }

  // 4. Footer Band with Logo, Link & QR Code
  const footerY = totalHeight - 24 - footerH;
  ctx.fillStyle = '#F2EFE9';
  ctx.fillRect(24, footerY, width - 48, footerH);

  ctx.strokeStyle = '#E5E2DC';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(24, footerY);
  ctx.lineTo(width - 24, footerY);
  ctx.stroke();

  // Small Logo Stamp in Footer
  const smallLogo = 64;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRectPath(ctx, padX, footerY + 42, smallLogo, smallLogo, 14);
  ctx.fill();
  ctx.strokeStyle = '#D4D0C7';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (logoImg) {
    ctx.save();
    drawRoundedRectPath(ctx, padX + 4, footerY + 46, smallLogo - 8, smallLogo - 8, 10);
    ctx.clip();
    drawImageContain(ctx, logoImg, padX + 4, footerY + 46, smallLogo - 8, smallLogo - 8);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0B0B0B';
    ctx.font = '700 22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.monogram, padX + smallLogo / 2, footerY + 42 + smallLogo / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  const footTextX = padX + smallLogo + 22;
  ctx.fillStyle = '#0B0B0B';
  ctx.font = '700 18px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Live Program & Event Pass', footTextX, footerY + 62);

  ctx.fillStyle = '#52525B';
  ctx.font = '500 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Scan QR code to view live updates, RSVP, or download digital outline', footTextX, footerY + 86);

  ctx.fillStyle = '#0B0B0B';
  ctx.font = '600 14px "JetBrains Mono", monospace';
  ctx.fillText(data.programUrl.slice(0, 68), footTextX, footerY + 114);

  // Scannable QR Code on Bottom Right
  const qrBoxSize = 136;
  const qrX = width - padX - qrBoxSize;
  const qrY = footerY + 30;
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRectPath(ctx, qrX, qrY, qrBoxSize, qrBoxSize, 12);
  ctx.fill();
  ctx.strokeStyle = '#E5E2DC';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const matrix = generateDeterministicQrMatrix(data.programUrl);
  const modules = matrix.length;
  const cell = (qrBoxSize - 20) / Math.max(1, modules);
  ctx.fillStyle = '#0B0B0B';
  for (let r = 0; r < modules; r += 1) {
    for (let c = 0; c < modules; c += 1) {
      if (matrix[r][c]) {
        ctx.fillRect(qrX + 10 + c * cell, qrY + 10 + r * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  const safeFileSlug = (data.event.slug || data.event.id || 'event')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase();
  const filename = `${safeFileSlug}-program-outline.png`;

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });

  if (!blob) {
    throw new Error('Could not export PNG because an image source blocked canvas access. Use Print / Save PDF instead.');
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

  return filename;
}

export async function printDesignedProgramOutlineSheet(
  event: EventItem,
  scheduleBlocks: ScheduleBlock[],
  fallbackLogoUrl?: string | null
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('Print export is only available in the browser.');
  }

  const data = resolveProgramExportData(event, scheduleBlocks, fallbackLogoUrl);
  const qrSvg = buildQrSvgString(data.programUrl, 108, '#0B0B0B', '#FFFFFF');
  const outlineIsImage = Boolean(data.outline?.mimeType.startsWith('image/'));

  const printGroups = groupScheduleBlocksBySection(data.sessions);
  const showPrintSections =
    printGroups.length > 1 || (printGroups.length === 1 && !printGroups[0].isGeneral);

  const renderPrintRow = (s: ResolvedProgramSheetSession) => `
          <div class="session-row">
            <div class="session-time">
              <div class="time-val">${escapeHtml(s.time)}</div>
              <div class="time-meta">${escapeHtml(`${s.day ? `${s.day} · ` : ''}${s.duration}`)}</div>
            </div>
            <div class="session-body">
              <div class="session-title">${escapeHtml(s.title)}</div>
              <div class="session-sub">${escapeHtml(s.stage)} &middot; Led by ${escapeHtml(s.lead)}</div>
            </div>
          </div>`;

  const sessionsHtml =
    data.sessions.length > 0
      ? showPrintSections
        ? printGroups
            .map(
              (grp) => `
          <div class="section-band">${escapeHtml(grp.section)}</div>
          ${grp.blocks.map(renderPrintRow).join('')}`
            )
            .join('')
        : data.sessions.map(renderPrintRow).join('')
      : !outlineIsImage
        ? `<p class="empty-msg">${
            data.outline
              ? `Attached program document: ${escapeHtml(data.outline.fileName)}. Scan the QR code below to download or view full pages.`
              : 'Live schedule details are published on the official event page.'
          }</p>`
        : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.event.title)} - Program Outline</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Segoe UI", sans-serif;
    color: #0B0B0B;
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    border: 1px solid #E5E2DC;
    border-radius: 16px;
    overflow: hidden;
    background: #FAF8F5;
  }
  .hero {
    position: relative;
    height: 290px;
    background: ${escapeHtml(data.surfaceBg)};
    color: #FFFFFF;
    overflow: hidden;
  }
  .hero-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .hero-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(11,11,11,0.42) 0%, rgba(11,11,11,0.6) 50%, rgba(11,11,11,0.92) 100%);
  }
  .hero-inner {
    position: relative;
    z-index: 2;
    height: 100%;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .logo-bar {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo-box {
    width: 58px;
    height: 58px;
    border-radius: 14px;
    background: #FFFFFF;
    border: 2px solid ${escapeHtml(data.brandColor)};
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }
  .logo-box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 4px;
  }
  .logo-mono {
    font-family: Georgia, serif;
    font-weight: 700;
    font-size: 20px;
    color: #0B0B0B;
  }
  .org-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.88);
  }
  .cat-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.72);
    margin-top: 3px;
  }
  .accent-rule {
    width: 56px;
    height: 3px;
    background: ${escapeHtml(data.brandColor)};
    margin-bottom: 10px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1.15;
    font-weight: 800;
    color: #FFFFFF;
  }
  .hero-meta {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(255,255,255,0.86);
  }
  .body {
    padding: 24px 28px;
  }
  .section-title {
    font-size: 18px;
    font-weight: 800;
    margin: 0;
  }
  .section-sub {
    font-size: 12px;
    color: #71717A;
    margin-top: 4px;
    padding-bottom: 12px;
    border-bottom: 1px solid #E5E2DC;
  }
  .notes {
    margin: 14px 0;
    font-size: 12px;
    font-style: italic;
    color: #52525B;
  }
  .outline-img-wrap {
    margin: 14px 0;
    background: #FFFFFF;
    border: 1px solid #E5E2DC;
    border-radius: 12px;
    padding: 10px;
    text-align: center;
  }
  .outline-img-wrap img {
    max-width: 100%;
    max-height: 320px;
    object-fit: contain;
  }
  .section-band {
    margin-top: 16px;
    padding: 7px 12px;
    border-left: 3px solid ${escapeHtml(data.brandColor)};
    background: #EFECE6;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #0B0B0B;
    border-radius: 6px;
    page-break-after: avoid;
  }
  .section-band:first-child { margin-top: 8px; }
  .session-row {
    display: flex;
    gap: 18px;
    padding: 12px 0;
    border-bottom: 1px solid #ECE9E2;
    page-break-inside: avoid;
  }
  .session-row:last-child { border-bottom: none; }
  .session-time {
    width: 118px;
    flex-shrink: 0;
  }
  .time-val {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 700;
    color: #0B0B0B;
  }
  .time-meta {
    font-size: 11px;
    color: #71717A;
    margin-top: 2px;
  }
  .session-title {
    font-size: 14px;
    font-weight: 700;
    color: #0B0B0B;
  }
  .session-sub {
    font-size: 12px;
    color: #52525B;
    margin-top: 3px;
  }
  .empty-msg {
    font-size: 13px;
    color: #52525B;
    padding: 16px 0;
  }
  .footer {
    background: #F2EFE9;
    border-top: 1px solid #E5E2DC;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .footer-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .footer-logo {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: #FFFFFF;
    border: 1px solid #D4D0C7;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }
  .footer-logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 3px;
  }
  .footer-title { font-size: 12px; font-weight: 700; }
  .footer-link { font-family: ui-monospace, monospace; font-size: 10px; color: #3F3F46; word-break: break-all; margin-top: 2px; }
  .qr-box {
    padding: 6px;
    background: #FFFFFF;
    border: 1px solid #E5E2DC;
    border-radius: 10px;
    line-height: 0;
    flex-shrink: 0;
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="hero">
      ${data.flyerUrl ? `<img class="hero-bg" src="${escapeHtml(data.flyerUrl)}" alt="${escapeHtml(data.event.title)} flyer" />` : ''}
      <div class="hero-scrim"></div>
      <div class="hero-inner">
        <div class="logo-bar">
          <div class="logo-box">
            ${data.logoUrl ? `<img src="${escapeHtml(data.logoUrl)}" alt="${escapeHtml(data.event.organizer)} logo" />` : `<span class="logo-mono">${escapeHtml(data.monogram)}</span>`}
          </div>
          <div>
            <div class="org-kicker">${escapeHtml(data.event.organizer || 'Organiser')} &middot; Official Program</div>
            <div class="cat-sub">${escapeHtml(data.event.category || 'Event')}</div>
          </div>
        </div>
        <div>
          <div class="accent-rule"></div>
          <h1>${escapeHtml(data.event.title)}</h1>
          <div class="hero-meta">${escapeHtml(data.formattedDate)} &middot; ${escapeHtml(data.event.time)} &middot; ${escapeHtml(data.event.venue)}, ${escapeHtml(data.event.city)}</div>
        </div>
      </div>
    </div>
    <div class="body">
      <h2 class="section-title">${escapeHtml(data.outline?.title || 'Program Outline & Run of Show')}</h2>
      <div class="section-sub">${escapeHtml(data.event.subtitle || `${data.event.venue}, ${data.event.city}`)}</div>
      ${data.outline?.notes ? `<p class="notes">${escapeHtml(data.outline.notes)}</p>` : ''}
      ${outlineIsImage && data.outline ? `<div class="outline-img-wrap"><img src="${escapeHtml(data.outline.dataUrl)}" alt="Program outline" /></div>` : ''}
      ${sessionsHtml}
    </div>
    <div class="footer">
      <div class="footer-left">
        <div class="footer-logo">
          ${data.logoUrl ? `<img src="${escapeHtml(data.logoUrl)}" alt="Logo" />` : `<span class="logo-mono" style="font-size:14px">${escapeHtml(data.monogram)}</span>`}
        </div>
        <div>
          <div class="footer-title">Scan for Live Program &amp; Digital Pass</div>
          <div class="footer-link">${escapeHtml(data.programUrl)}</div>
        </div>
      </div>
      <div class="qr-box">${qrSvg}</div>
    </div>
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc || !iframe.contentWindow) {
    document.body.removeChild(iframe);
    throw new Error('Could not prepare print preview.');
  }
  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.querySelectorAll('img'));
    if (imgs.length === 0) {
      window.setTimeout(resolve, 120);
      return;
    }
    let remaining = imgs.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    const fallbackTimer = window.setTimeout(resolve, 2500);
    for (const img of imgs) {
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    }
    if (remaining <= 0) {
      window.clearTimeout(fallbackTimer);
      resolve();
    }
  });

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  window.setTimeout(() => {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }, 1500);
}
