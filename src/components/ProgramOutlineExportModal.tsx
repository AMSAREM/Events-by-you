import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Loader2,
  Printer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { EventItem, ScheduleBlock } from '../types/events';
import { groupScheduleBlocksBySection } from '../lib/eventDates';
import { processEventLogoFile, sanitizeEventLogoUrl } from '../lib/programOutline';
import {
  exportDesignedProgramOutlinePng,
  printDesignedProgramOutlineSheet,
  resolveProgramExportData,
} from '../lib/programOutlineExport';
import { DeterministicQrSvg } from '../lib/qr';

interface ProgramOutlineExportModalProps {
  open: boolean;
  event: EventItem | null;
  scheduleBlocks: ScheduleBlock[];
  fallbackLogoUrl?: string | null;
  canEditLogo?: boolean;
  onUpdateLogo?: (nextLogoUrl: string | null) => Promise<void> | void;
  onClose: () => void;
}

export const ProgramOutlineExportModal: React.FC<ProgramOutlineExportModalProps> = ({
  open,
  event,
  scheduleBlocks,
  fallbackLogoUrl,
  canEditLogo = false,
  onUpdateLogo,
  onClose,
}) => {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const sheetData = useMemo(() => {
    if (!event) return null;
    return resolveProgramExportData(event, scheduleBlocks, fallbackLogoUrl);
  }, [event, scheduleBlocks, fallbackLogoUrl]);

  const sheetGroups = useMemo(
    () => (sheetData ? groupScheduleBlocksBySection(sheetData.sessions) : []),
    [sheetData]
  );
  const showSheetSections =
    sheetGroups.length > 1 || (sheetGroups.length === 1 && !sheetGroups[0].isGeneral);

  if (!open || !event || !sheetData) return null;

  const cleanFallbackAvatar = sanitizeEventLogoUrl(fallbackLogoUrl);
  const outlineIsImage = Boolean(sheetData.outline?.mimeType.startsWith('image/'));

  const handleDownloadPng = async () => {
    setError(null);
    setStatusMessage(null);
    setExportingPng(true);
    try {
      const fileName = await exportDesignedProgramOutlinePng(
        event,
        scheduleBlocks,
        fallbackLogoUrl
      );
      setStatusMessage(`Downloaded ${fileName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export designed PNG.');
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrintSheet = async () => {
    setError(null);
    setStatusMessage(null);
    setPrinting(true);
    try {
      await printDesignedProgramOutlineSheet(event, scheduleBlocks, fallbackLogoUrl);
      setStatusMessage('Opened print & PDF save dialog.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open print layout.');
    } finally {
      setPrinting(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard?.writeText(sheetData.programUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  const handleUploadLogo = async (file: File) => {
    if (!onUpdateLogo) return;
    setError(null);
    setStatusMessage(null);
    setSavingLogo(true);
    try {
      const processed = await processEventLogoFile(file);
      await Promise.resolve(onUpdateLogo(processed));
      setStatusMessage('Updated event logo on the program design.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload event logo.');
    } finally {
      setSavingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleUseFallbackLogo = async () => {
    if (!onUpdateLogo || !cleanFallbackAvatar) return;
    setError(null);
    setSavingLogo(true);
    try {
      await Promise.resolve(onUpdateLogo(cleanFallbackAvatar));
      setStatusMessage('Applied studio profile logo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update logo.');
    } finally {
      setSavingLogo(false);
    }
  };

  const handleClearLogo = async () => {
    if (!onUpdateLogo) return;
    setError(null);
    setSavingLogo(true);
    try {
      await Promise.resolve(onUpdateLogo(null));
      setStatusMessage('Switched to monogram emblem.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear event logo.');
    } finally {
      setSavingLogo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B0B0B]/70 backdrop-blur-sm p-2.5 sm:p-6">
      <div className="w-full max-w-4xl max-h-[94dvh] rounded-2xl sm:rounded-3xl bg-white border border-[#E5E5EA] shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E5EA] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-[#0B0B0B] truncate">
              Designed Program Outline
            </h2>
            <p className="text-[11px] text-[#71717A] truncate mt-0.5">
              Combines event flyer, logo mark, run of show, and attendee QR link
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close program export modal"
            className="w-10 h-10 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#F5F5F7] p-3 sm:p-6 space-y-4">
          {canEditLogo && onUpdateLogo && (
            <div className="rounded-2xl bg-white border border-[#E5E5EA] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl border border-[#E5E5EA] bg-[#FAF8F5] flex items-center justify-center overflow-hidden shrink-0">
                  {sheetData.logoUrl ? (
                    <img
                      src={sheetData.logoUrl}
                      alt="Event logo preview"
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <span className="font-serif font-bold text-xs text-[#0B0B0B]">
                      {sheetData.monogram}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#0B0B0B]">
                    Event Logo Mark
                  </p>
                  <p className="text-[11px] text-[#71717A] truncate">
                    {sheetData.logoUrl
                      ? 'Appears in the flyer header badge & program footer'
                      : 'Upload PNG/JPG/WebP logo or use your organizer monogram'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadLogo(f);
                  }}
                />
                <button
                  type="button"
                  disabled={savingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  className="h-8 px-3 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingLogo ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{sheetData.logoUrl ? 'Change Logo' : 'Upload Logo'}</span>
                </button>
                {cleanFallbackAvatar && event.extraDataConfig?.logoUrl !== cleanFallbackAvatar && (
                  <button
                    type="button"
                    disabled={savingLogo}
                    onClick={() => void handleUseFallbackLogo()}
                    className="h-8 px-3 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold disabled:opacity-50"
                  >
                    Use Studio Logo
                  </button>
                )}
                {event.extraDataConfig?.logoUrl && (
                  <button
                    type="button"
                    disabled={savingLogo}
                    onClick={() => void handleClearLogo()}
                    aria-label="Remove custom event logo"
                    className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#EF4444]/10 hover:text-[#EF4444] text-[#71717A] flex items-center justify-center disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Editorial Designed Program Sheet Live Preview */}
          <div className="mx-auto max-w-2xl rounded-2xl bg-[#FAF8F5] border border-[#E5E2DC] shadow-sm overflow-hidden">
            {/* Hero with Flyer + Logo Medallion */}
            <div
              className="relative h-60 sm:h-68 overflow-hidden text-white"
              style={{ backgroundColor: sheetData.surfaceBg }}
            >
              {sheetData.flyerUrl && (
                <img
                  src={sheetData.flyerUrl}
                  alt={`${event.title} flyer`}
                  className="absolute inset-0 w-full h-full object-cover object-center"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B0B]/45 via-[#0B0B0B]/55 to-[#0B0B0B]/95" />
              <div className="absolute inset-3 rounded-xl border border-white/20 pointer-events-none" />

              <div className="relative z-10 h-full p-6 flex flex-col justify-between">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm"
                    style={{ border: `2.5px solid ${sheetData.brandColor}` }}
                  >
                    {sheetData.logoUrl ? (
                      <img
                        src={sheetData.logoUrl}
                        alt={`${event.organizer} logo`}
                        className="w-full h-full object-contain p-1.5"
                      />
                    ) : (
                      <span className="font-serif font-bold text-lg text-[#0B0B0B]">
                        {sheetData.monogram}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/85 truncate">
                      {event.organizer} · Official Program
                    </p>
                    <div
                      className="w-12 h-0.5 my-1.5"
                      style={{ backgroundColor: sheetData.brandColor }}
                    />
                    <p className="text-[11px] text-white/75 truncate">
                      {event.category}
                    </p>
                  </div>
                </div>

                <div>
                  <div
                    className="w-14 h-1 mb-2.5"
                    style={{ backgroundColor: sheetData.brandColor }}
                  />
                  <h3 className="font-display text-xl sm:text-2xl font-bold text-white leading-tight line-clamp-2 text-balance">
                    {event.title}
                  </h3>
                  <p className="text-xs text-white/85 mt-1.5 truncate">
                    {sheetData.formattedDate} · {event.time} · {event.venue}, {event.city}
                  </p>
                </div>
              </div>
            </div>

            {/* Outline Body */}
            <div className="p-4 sm:p-6 space-y-4">
              <div className="pb-3 border-b border-[#E5E2DC]">
                <h4 className="text-base font-bold text-[#0B0B0B]">
                  {sheetData.outline?.title || 'Program Outline & Run of Show'}
                </h4>
                <p className="text-xs text-[#71717A] mt-0.5">
                  {sheetData.sessions.length > 0
                    ? `${sheetData.sessions.length} scheduled session${sheetData.sessions.length === 1 ? '' : 's'} · ${event.subtitle || event.venue}`
                    : sheetData.outline?.fileName
                      ? `Attached Document: ${sheetData.outline.fileName}`
                      : event.subtitle || 'Order of Proceedings'}
                </p>
              </div>

              {sheetData.outline?.notes && (
                <p className="text-xs italic text-[#52525B]">
                  {sheetData.outline.notes}
                </p>
              )}

              {outlineIsImage && sheetData.outline && (
                <div className="rounded-xl bg-white border border-[#E5E2DC] p-2.5">
                  <img
                    src={sheetData.outline.dataUrl}
                    alt={sheetData.outline.title || sheetData.outline.fileName}
                    className="w-full max-h-72 object-contain rounded-lg"
                  />
                </div>
              )}

              {sheetData.sessions.length > 0 ? (
                <div className="space-y-4">
                  {sheetGroups.map((group, groupIdx) => (
                    <div key={group.section || `group-${groupIdx}`}>
                      {showSheetSections && (
                        <div
                          className="mb-2 px-3 py-1.5 rounded-lg bg-[#EFECE6] text-[11px] font-bold uppercase tracking-[0.1em] text-[#0B0B0B] flex items-center justify-between gap-2"
                          style={{ borderLeft: `3px solid ${sheetData.brandColor}` }}
                        >
                          <span className="truncate">{group.section}</span>
                          <span className="text-[10px] font-medium text-[#52525B] tabular-nums shrink-0">
                            {group.blocks.length}
                          </span>
                        </div>
                      )}
                      <div className="divide-y divide-[#EAE7E0]">
                        {group.blocks.map((session) => (
                          <div
                            key={session.id}
                            className="py-3 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-4"
                          >
                            <div className="flex items-center gap-2 sm:block sm:w-28 shrink-0">
                              <p className="font-mono text-xs font-bold text-[#0B0B0B] tabular-nums">
                                {session.time}
                              </p>
                              <p className="text-[11px] text-[#71717A] sm:mt-0.5 tabular-nums">
                                {session.day ? `${session.day} · ` : ''}
                                {session.duration}
                              </p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs sm:text-sm font-semibold text-[#0B0B0B] break-words">
                                {session.title}
                              </p>
                              <p className="text-[11px] text-[#52525B] mt-0.5 break-words">
                                {session.stage} · Led by {session.lead}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !outlineIsImage ? (
                <p className="text-xs text-[#52525B] py-2">
                  {sheetData.outline
                    ? `Full booklet (${sheetData.outline.fileName}) is linked below via the scannable QR code.`
                    : 'Program sessions appear here as soon as schedule blocks or a text/CSV outline are added.'}
                </p>
              ) : null}
            </div>

            {/* Footer Stamp with Logo + Link + QR */}
            <div className="px-6 py-4 bg-[#F2EFE9] border-t border-[#E5E2DC] flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white border border-[#D4D0C7] flex items-center justify-center overflow-hidden shrink-0">
                  {sheetData.logoUrl ? (
                    <img
                      src={sheetData.logoUrl}
                      alt="Footer logo"
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <span className="font-serif font-bold text-xs text-[#0B0B0B]">
                      {sheetData.monogram}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0B0B0B]">
                    Live Program &amp; Attendee Pass
                  </p>
                  <p className="text-[10px] font-mono text-[#52525B] truncate mt-0.5">
                    {sheetData.programUrl}
                  </p>
                </div>
              </div>
              <div className="p-1.5 rounded-lg bg-white border border-[#E5E2DC] shrink-0">
                <DeterministicQrSvg value={sheetData.programUrl} size={68} />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-[#EF4444] text-center">{error}</p>
          )}
          {statusMessage && !error && (
            <p className="text-xs font-medium text-[#0B0B0B] text-center">{statusMessage}</p>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-[#E5E5EA] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="min-h-[40px] px-4 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Program Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Program Link</span>
              </>
            )}
          </button>

          <div className="grid grid-cols-2 sm:flex items-center gap-2">
            <button
              type="button"
              disabled={printing || exportingPng}
              onClick={() => void handlePrintSheet()}
              className="min-h-[40px] px-3 sm:px-4 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] bg-white text-[#0B0B0B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
            >
              {printing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5" />
              )}
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              disabled={exportingPng || printing}
              onClick={() => void handleDownloadPng()}
              className="min-h-[40px] px-3 sm:px-4 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
            >
              {exportingPng ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Download PNG</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
