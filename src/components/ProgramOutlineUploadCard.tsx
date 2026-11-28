import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Printer,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { EventItem, EventProgramOutline, ScheduleBlock } from '../types/events';
import {
  buildProgramOutlineTextTemplate,
  decodeProgramOutlineText,
  downloadProgramOutlineTemplate,
  formatFileSizeCompact,
  formatProgramOutlineAsCsv,
  formatProgramOutlineAsText,
  isTextProgramOutline,
  processEventLogoFile,
  processProgramOutlineFile,
  remapProgramBlocksToEvent,
  sanitizeProgramOutline,
  validateParsedOutlineBlocks,
  validateProgramOutlineImport,
  type ParsedProgramOutlineBlock,
  type ProgramOutlineTemplateFormat,
  type ProgramOutlineValidationResult,
} from '../lib/programOutline';
import { getProgramOutlineKindLabel, ProgramOutlinePreviewModal } from './ProgramOutlineViewer';

interface ProgramOutlineUploadCardProps {
  outline?: EventProgramOutline;
  eventTitle?: string;
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null;
  logoUrl?: string | null;
  hasScheduleBlocks?: boolean;
  existingBlocks?: ScheduleBlock[];
  availableEvents?: EventItem[];
  allScheduleBlocks?: ScheduleBlock[];
  currentEventId?: string;
  busy?: boolean;
  compact?: boolean;
  onSaveOutline: (next: EventProgramOutline | null) => Promise<void> | void;
  onLogoChange?: (nextLogoUrl: string | null) => Promise<void> | void;
  onOpenExportDesign?: () => void;
  onImportParsedBlocks?: (blocks: ParsedProgramOutlineBlock[]) => Promise<void> | void;
}

function encodeUtf8ToBase64DataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:text/plain;base64,${btoa(binary)}`;
}

async function copyStringToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback
  }
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', 'true');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try {
      const copied = document.execCommand('copy');
      document.body.removeChild(el);
      return copied;
    } catch {
      document.body.removeChild(el);
      return false;
    }
  }
  return false;
}

export const ProgramOutlineUploadCard: React.FC<ProgramOutlineUploadCardProps> = ({
  outline,
  eventTitle,
  eventContext,
  logoUrl,
  hasScheduleBlocks = false,
  existingBlocks = [],
  availableEvents = [],
  allScheduleBlocks = [],
  currentEventId,
  busy = false,
  compact = false,
  onSaveOutline,
  onLogoChange,
  onOpenExportDesign,
  onImportParsedBlocks,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  const [processing, setProcessing] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);

  const [titleInput, setTitleInput] = useState(outline?.title || '');
  const [notesInput, setNotesInput] = useState(outline?.notes || '');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [skipFileDuplicates, setSkipFileDuplicates] = useState(true);
  const [skipPasteDuplicates, setSkipPasteDuplicates] = useState(true);

  const [showCopyEventPanel, setShowCopyEventPanel] = useState(false);
  const [selectedSourceEventId, setSelectedSourceEventId] = useState('');
  const [remapCopyDates, setRemapCopyDates] = useState(true);
  const [skipCopyDuplicates, setSkipCopyDuplicates] = useState(true);
  const [copyOutlineDocToo, setCopyOutlineDocToo] = useState(true);

  useEffect(() => {
    setTitleInput(outline?.title || '');
    setNotesInput(outline?.notes || '');
  }, [outline?.fileName, outline?.title, outline?.notes]);

  useEffect(() => {
    if (!templateMenuOpen && !copyMenuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(event.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
      if (
        copyMenuRef.current &&
        !copyMenuRef.current.contains(event.target as Node)
      ) {
        setCopyMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTemplateMenuOpen(false);
        setCopyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [templateMenuOpen, copyMenuOpen]);

  const fileValidation = useMemo<ProgramOutlineValidationResult | null>(() => {
    if (!outline || !isTextProgramOutline(outline)) return null;
    const text = decodeProgramOutlineText(outline);
    if (!text.trim()) return null;
    return validateProgramOutlineImport(text, eventContext, existingBlocks);
  }, [outline, eventContext, existingBlocks]);

  const pasteValidation = useMemo<ProgramOutlineValidationResult | null>(() => {
    if (!pastedText.trim()) return null;
    return validateProgramOutlineImport(pastedText, eventContext, existingBlocks);
  }, [pastedText, eventContext, existingBlocks]);

  const copySourceCandidates = useMemo(() => {
    const counts = new Map<string, ScheduleBlock[]>();
    for (const blk of allScheduleBlocks) {
      const list = counts.get(blk.eventId) ?? [];
      list.push(blk);
      counts.set(blk.eventId, list);
    }
    return availableEvents
      .filter((evt) => evt.id !== currentEventId)
      .map((evt) => ({
        event: evt,
        blocks: counts.get(evt.id) ?? [],
        hasOutlineDoc: Boolean(evt.extraDataConfig?.programOutline),
      }))
      .filter((item) => item.blocks.length > 0 || item.hasOutlineDoc);
  }, [availableEvents, allScheduleBlocks, currentEventId]);

  useEffect(() => {
    if (copySourceCandidates.length === 0) {
      setSelectedSourceEventId('');
      return;
    }
    if (!copySourceCandidates.some((c) => c.event.id === selectedSourceEventId)) {
      setSelectedSourceEventId(copySourceCandidates[0].event.id);
    }
  }, [copySourceCandidates, selectedSourceEventId]);

  const selectedSourceCandidate = useMemo(
    () => copySourceCandidates.find((c) => c.event.id === selectedSourceEventId) ?? null,
    [copySourceCandidates, selectedSourceEventId]
  );

  const remappedCopyBlocks = useMemo(() => {
    if (!selectedSourceCandidate || selectedSourceCandidate.blocks.length === 0) return [];
    return remapProgramBlocksToEvent(
      selectedSourceCandidate.blocks,
      selectedSourceCandidate.event,
      eventContext ?? undefined,
      remapCopyDates
    );
  }, [selectedSourceCandidate, eventContext, remapCopyDates]);

  const copyValidation = useMemo<ProgramOutlineValidationResult | null>(() => {
    if (!selectedSourceCandidate || remappedCopyBlocks.length === 0) return null;
    return validateParsedOutlineBlocks(remappedCopyBlocks, eventContext, existingBlocks);
  }, [selectedSourceCandidate, remappedCopyBlocks, eventContext, existingBlocks]);

  const canCopyCurrentToClipboard =
    existingBlocks.length > 0 || Boolean(outline && isTextProgramOutline(outline));

  const metadataDirty = Boolean(
    outline &&
      ((titleInput.trim() || undefined) !== (outline.title || undefined) ||
        (notesInput.trim() || undefined) !== (outline.notes || undefined))
  );

  const handleSelectedFile = async (file: File) => {
    setError(null);
    setStatusMessage(null);
    setProcessing(true);
    try {
      const processed = await processProgramOutlineFile(file, {
        title: titleInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
      });
      await Promise.resolve(onSaveOutline(processed));
      if (isTextProgramOutline(processed)) {
        const validation = validateProgramOutlineImport(
          decodeProgramOutlineText(processed),
          eventContext,
          existingBlocks
        );
        if (validation.errors.length > 0) {
          setStatusMessage(
            `Uploaded ${processed.fileName}. Found ${validation.errors.length} validation error${
              validation.errors.length === 1 ? '' : 's'
            } to review before importing sessions.`
          );
          return;
        }
        if (validation.blocks.length > 0) {
          setStatusMessage(
            `Uploaded ${processed.fileName}. Validated ${validation.blocks.length} session${
              validation.blocks.length === 1 ? '' : 's'
            }${
              validation.warnings.length > 0
                ? ` (${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'})`
                : ''
            } ready to import.`
          );
          return;
        }
      }
      setStatusMessage(`Uploaded ${processed.fileName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload program outline.');
    } finally {
      setProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveMetadata = async () => {
    if (!outline) return;
    setError(null);
    setStatusMessage(null);
    setProcessing(true);
    try {
      const updated = sanitizeProgramOutline({
        ...outline,
        title: titleInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
      });
      if (!updated) {
        throw new Error('Could not update outline metadata.');
      }
      await Promise.resolve(onSaveOutline(updated));
      setStatusMessage('Updated outline title and notes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save outline details.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveOutline = async () => {
    setError(null);
    setStatusMessage(null);
    setProcessing(true);
    try {
      await Promise.resolve(onSaveOutline(null));
      setTitleInput('');
      setNotesInput('');
      setStatusMessage('Removed program outline.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove program outline.');
    } finally {
      setProcessing(false);
    }
  };

  const handleImportValidated = async (
    validation: ProgramOutlineValidationResult,
    skipDups: boolean,
    fromPaste = false
  ) => {
    if (!onImportParsedBlocks) return;
    if (validation.errors.length > 0) {
      setError(
        `Fix ${validation.errors.length} validation error${
          validation.errors.length === 1 ? '' : 's'
        } before importing.`
      );
      return;
    }
    const chosen = skipDups ? validation.nonDuplicateBlocks : validation.blocks;
    if (chosen.length === 0) {
      setError('All detected rows are duplicates. Uncheck duplicate skipping to import anyway.');
      return;
    }

    const cleanBlocks: ParsedProgramOutlineBlock[] = chosen.map((b) => ({
      time: b.time,
      duration: b.duration,
      title: b.title,
      stage: b.stage,
      lead: b.lead,
      day: b.day,
      ...(b.date ? { date: b.date } : {}),
      ...(b.section ? { section: b.section } : {}),
    }));

    setError(null);
    setStatusMessage(null);
    setImporting(true);
    try {
      await Promise.resolve(onImportParsedBlocks(cleanBlocks));
      setStatusMessage(
        `Added ${cleanBlocks.length} validated session${cleanBlocks.length === 1 ? '' : 's'} to the schedule.`
      );
      if (fromPaste) {
        setShowPasteBox(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import parsed sessions.');
    } finally {
      setImporting(false);
    }
  };

  const handleCopyFromAnotherEvent = async () => {
    if (!selectedSourceCandidate) return;
    setError(null);
    setStatusMessage(null);

    const hasBlocksToCopy = selectedSourceCandidate.blocks.length > 0;
    const sourceOutline = selectedSourceCandidate.event.extraDataConfig?.programOutline;

    if (hasBlocksToCopy && copyValidation && copyValidation.errors.length > 0) {
      setError(
        `Fix or review ${copyValidation.errors.length} validation error${
          copyValidation.errors.length === 1 ? '' : 's'
        } in the source schedule before copying.`
      );
      return;
    }

    const blocksToImport = copyValidation
      ? skipCopyDuplicates
        ? copyValidation.nonDuplicateBlocks
        : copyValidation.blocks
      : [];

    if (hasBlocksToCopy && blocksToImport.length === 0 && !(copyOutlineDocToo && sourceOutline)) {
      setError(
        'All sessions from this event already match your schedule. Uncheck duplicate skipping or copy the document.'
      );
      return;
    }

    setImporting(true);
    try {
      let copiedDoc = false;
      if (copyOutlineDocToo && sourceOutline) {
        const cloned = sanitizeProgramOutline({
          ...sourceOutline,
          uploadedAt: new Date().toISOString(),
        });
        if (cloned) {
          await Promise.resolve(onSaveOutline(cloned));
          copiedDoc = true;
        }
      }

      if (onImportParsedBlocks && blocksToImport.length > 0) {
        const cleanBlocks: ParsedProgramOutlineBlock[] = blocksToImport.map((b) => ({
          time: b.time,
          duration: b.duration,
          title: b.title,
          stage: b.stage,
          lead: b.lead,
          day: b.day,
          ...(b.date ? { date: b.date } : {}),
          ...(b.section ? { section: b.section } : {}),
        }));
        await Promise.resolve(onImportParsedBlocks(cleanBlocks));
      }

      const parts: string[] = [];
      if (blocksToImport.length > 0) {
        parts.push(
          `${blocksToImport.length} session${blocksToImport.length === 1 ? '' : 's'}`
        );
      }
      if (copiedDoc) {
        parts.push('attached booklet/file');
      }
      setStatusMessage(
        `Copied ${parts.join(' and ')} from "${selectedSourceCandidate.event.title}".`
      );
      setShowCopyEventPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to copy outline from event.');
    } finally {
      setImporting(false);
    }
  };

  const handleCopyCurrentOutlineToClipboard = async (format: 'text' | 'csv') => {
    setCopyMenuOpen(false);
    setError(null);
    let content = '';
    if (existingBlocks.length > 0) {
      content =
        format === 'csv'
          ? formatProgramOutlineAsCsv(existingBlocks, eventContext)
          : formatProgramOutlineAsText(existingBlocks, eventContext, eventTitle);
    } else if (outline && isTextProgramOutline(outline)) {
      content = decodeProgramOutlineText(outline);
    }

    if (!content.trim()) {
      setError('No schedule blocks or text outline available to copy.');
      return;
    }

    const copied = await copyStringToClipboard(content);
    if (copied) {
      setStatusMessage(
        `Copied current program outline (${format.toUpperCase()}) to clipboard.`
      );
    } else {
      setError('Clipboard copy failed — download the template or select text manually.');
    }
  };

  const handleAttachPastedTextAsOutline = async () => {
    const clean = pastedText.trim();
    if (!clean) return;
    if (pasteValidation && pasteValidation.errors.length > 0) {
      setError(
        `Fix ${pasteValidation.errors.length} validation error${
          pasteValidation.errors.length === 1 ? '' : 's'
        } before saving this outline.`
      );
      return;
    }
    setError(null);
    setStatusMessage(null);
    setProcessing(true);
    try {
      const dataUrl = encodeUtf8ToBase64DataUrl(clean);
      const created = sanitizeProgramOutline({
        fileName: 'program-outline.txt',
        mimeType: 'text/plain',
        dataUrl,
        sizeBytes: clean.length,
        uploadedAt: new Date().toISOString(),
        title: titleInput.trim() || 'Program Outline',
        notes: notesInput.trim() || undefined,
      });
      if (!created) {
        throw new Error('Pasted outline exceeds size limit (2.5 MB).');
      }
      await Promise.resolve(onSaveOutline(created));
      setShowPasteBox(false);
      setStatusMessage('Saved pasted outline as downloadable program document.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save pasted outline.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSelectedLogo = async (file: File) => {
    if (!onLogoChange) return;
    setError(null);
    setStatusMessage(null);
    setSavingLogo(true);
    try {
      const processedLogo = await processEventLogoFile(file);
      await Promise.resolve(onLogoChange(processedLogo));
      setStatusMessage('Updated event logo for designed program exports.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload event logo.');
    } finally {
      setSavingLogo(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  const handleDownloadTemplate = (format: ProgramOutlineTemplateFormat) => {
    setError(null);
    const { fileName } = downloadProgramOutlineTemplate(format, eventContext, eventTitle);
    setTemplateMenuOpen(false);
    setStatusMessage(
      `Downloaded ${fileName}. Fill in your sessions and upload or drop it here to import.`
    );
  };

  const handleLoadSampleInPasteBox = () => {
    setError(null);
    setPastedText(buildProgramOutlineTextTemplate(eventContext, eventTitle));
    setStatusMessage('Loaded sample outline format — edit lines below and import.');
  };

  const renderValidationReport = (
    validation: ProgramOutlineValidationResult,
    skipDups: boolean,
    setSkipDups: (next: boolean) => void
  ) => {
    const hasIssues = validation.errors.length > 0 || validation.warnings.length > 0;
    const effectiveCount = skipDups ? validation.nonDuplicateBlocks.length : validation.blocks.length;

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-[#0B0B0B] flex items-center gap-1.5">
            {validation.errors.length === 0 ? (
              <Check className="w-3.5 h-3.5 text-[#0D3822]" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-[#EF4444]" />
            )}
            <span>
              {validation.errors.length === 0
                ? `${effectiveCount} session${effectiveCount === 1 ? '' : 's'} validated (${validation.summary.dayCount} day${validation.summary.dayCount === 1 ? '' : 's'}${validation.summary.sectionCount > 0 ? ` · ${validation.summary.sectionCount} section${validation.summary.sectionCount === 1 ? '' : 's'}` : ''})`
                : `${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'} detected — fix before importing`}
            </span>
          </span>
          {validation.summary.dateRange && (
            <span className="font-mono text-[10px] text-[#71717A]">
              {validation.summary.dateRange.start}
              {validation.summary.dateRange.end !== validation.summary.dateRange.start
                ? ` → ${validation.summary.dateRange.end}`
                : ''}
            </span>
          )}
        </div>

        {hasIssues && (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {validation.errors.map((issue, idx) => (
              <div
                key={`err-${idx}`}
                className="px-2.5 py-1.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/25 text-[11px] text-[#B91C1C] flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{issue.message}</span>
              </div>
            ))}
            {validation.warnings.map((issue, idx) => (
              <div
                key={`warn-${idx}`}
                className="px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        {validation.duplicateCount > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-[#0B0B0B] cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              checked={skipDups}
              onChange={(e) => setSkipDups(e.target.checked)}
              className="rounded border-[#D4D4D8] text-[#0B0B0B] focus:ring-[#0B0B0B]"
            />
            <span>
              Skip {validation.duplicateCount} duplicate session
              {validation.duplicateCount === 1 ? '' : 's'} already in batch or schedule
            </span>
          </label>
        )}
      </div>
    );
  };

  const isDisabled = busy || processing || importing || savingLogo;

  return (
    <div
      className={`rounded-2xl bg-white border border-[#E5E5EA] ${
        compact ? 'p-3.5 space-y-3' : 'p-4 sm:p-5 space-y-3.5'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.md"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleSelectedFile(f);
        }}
      />
      {onLogoChange && (
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleSelectedLogo(f);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs sm:text-sm font-bold text-[#0B0B0B]">
            Program Outline &amp; Import Tools
          </h3>
          <p className="text-[11px] text-[#71717A] mt-0.5">
            Attach a PDF/image booklet, upload or paste validated schedules, or copy an existing event outline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full">
          {onOpenExportDesign && (outline || hasScheduleBlocks) && (
            <button
              type="button"
              disabled={isDisabled}
              onClick={onOpenExportDesign}
              className="min-h-[38px] px-3 py-1.5 rounded-full border border-[#0B0B0B] bg-white hover:bg-[#F5F5F7] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Export Flyer + Logo Sheet</span>
            </button>
          )}

          {canCopyCurrentToClipboard && (
            <div ref={copyMenuRef} className="relative">
              <button
                type="button"
                disabled={isDisabled}
                aria-expanded={copyMenuOpen}
                aria-haspopup="menu"
                onClick={() => setCopyMenuOpen((prev) => !prev)}
                className="min-h-[38px] px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Outline</span>
                <ChevronDown className="w-3 h-3 text-[#71717A]" />
              </button>

              {copyMenuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-[min(15rem,calc(100vw-2.5rem))] rounded-2xl bg-white border border-[#E5E5EA] shadow-xl p-1.5 z-30 space-y-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleCopyCurrentOutlineToClipboard('text')}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F5F7] transition-colors flex items-start gap-2.5"
                  >
                    <FileText className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[#0B0B0B]">Copy as Formatted Text</p>
                      <p className="text-[10px] text-[#71717A]">
                        Ready to paste into WhatsApp, Email, or another event
                      </p>
                    </div>
                  </button>
                  {existingBlocks.length > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleCopyCurrentOutlineToClipboard('csv')}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F5F7] transition-colors flex items-start gap-2.5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-[#0B0B0B]">Copy as CSV Rows</p>
                        <p className="text-[10px] text-[#71717A]">
                          Spreadsheet columns with dates &amp; sections
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {availableEvents.length > 1 && (
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => {
                setError(null);
                setShowCopyEventPanel((v) => !v);
              }}
              className="min-h-[38px] px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{showCopyEventPanel ? 'Close Event Copy' : 'Copy from Event'}</span>
            </button>
          )}

          <div ref={templateMenuRef} className="relative">
            <button
              type="button"
              disabled={isDisabled}
              aria-expanded={templateMenuOpen}
              aria-haspopup="menu"
              onClick={() => setTemplateMenuOpen((prev) => !prev)}
              className="min-h-[38px] px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Template</span>
              <ChevronDown className="w-3 h-3 text-[#71717A]" />
            </button>

            {templateMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-[min(16rem,calc(100vw-2.5rem))] rounded-2xl bg-white border border-[#E5E5EA] shadow-xl p-1.5 z-30 space-y-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleDownloadTemplate('csv')}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F5F5F7] transition-colors flex items-start gap-2.5"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#0B0B0B]">
                      Spreadsheet Template (.csv)
                    </p>
                    <p className="text-[10px] text-[#71717A]">
                      Excel &amp; Google Sheets with Sections column
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleDownloadTemplate('txt')}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F5F5F7] transition-colors flex items-start gap-2.5"
                >
                  <FileText className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#0B0B0B]">
                      Text Outline Template (.txt)
                    </p>
                    <p className="text-[10px] text-[#71717A]">
                      Section headings &amp; pipe-delimited cues
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleDownloadTemplate('md')}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F5F5F7] transition-colors flex items-start gap-2.5"
                >
                  <FileText className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#0B0B0B]">
                      Markdown Template (.md)
                    </p>
                    <p className="text-[10px] text-[#71717A]">
                      Multi-day &amp; section headers (###)
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => setShowPasteBox((v) => !v)}
            className="min-h-[38px] px-3 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            {showPasteBox ? 'Hide Paste Box' : 'Paste Text'}
          </button>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[38px] px-3.5 py-1.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {processing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>{outline ? 'Replace File' : 'Choose File'}</span>
          </button>
        </div>
      </div>

      {showCopyEventPanel && (
        <div className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-[#0B0B0B]">Copy Outline from Existing Event</p>
              <p className="text-[11px] text-[#71717A]">
                Reuse sessions and/or attached booklet from another event in your studio.
              </p>
            </div>
          </div>

          {copySourceCandidates.length === 0 ? (
            <p className="text-xs text-[#71717A] bg-white rounded-xl p-3 border border-[#E5E5EA]">
              None of your other events currently have schedule sessions or an attached program outline yet.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717A] mb-1">
                    Source Event
                  </label>
                  <select
                    value={selectedSourceEventId}
                    onChange={(e) => setSelectedSourceEventId(e.target.value)}
                    className="w-full h-9 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
                  >
                    {copySourceCandidates.map((cand) => (
                      <option key={cand.event.id} value={cand.event.id}>
                        {cand.event.title} ({cand.blocks.length} sessions
                        {cand.hasOutlineDoc ? ' + file' : ''})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-center gap-1.5 pt-1">
                  <label className="flex items-center gap-2 text-[11px] text-[#0B0B0B] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remapCopyDates}
                      onChange={(e) => setRemapCopyDates(e.target.checked)}
                      className="rounded border-[#D4D4D8] text-[#0B0B0B] focus:ring-[#0B0B0B]"
                    />
                    <span>Remap days &amp; dates onto this event&apos;s calendar</span>
                  </label>
                  {selectedSourceCandidate?.hasOutlineDoc && (
                    <label className="flex items-center gap-2 text-[11px] text-[#0B0B0B] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={copyOutlineDocToo}
                        onChange={(e) => setCopyOutlineDocToo(e.target.checked)}
                        className="rounded border-[#D4D4D8] text-[#0B0B0B] focus:ring-[#0B0B0B]"
                      />
                      <span>
                        Also copy attached file (
                        {selectedSourceCandidate.event.extraDataConfig?.programOutline?.fileName})
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {copyValidation && (
                <div className="p-3 rounded-xl bg-white border border-[#E5E5EA]">
                  {renderValidationReport(
                    copyValidation,
                    skipCopyDuplicates,
                    setSkipCopyDuplicates
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCopyEventPanel(false)}
                  className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    isDisabled ||
                    !selectedSourceCandidate ||
                    Boolean(copyValidation && copyValidation.errors.length > 0)
                  }
                  onClick={() => void handleCopyFromAnotherEvent()}
                  className="min-h-[36px] px-4 py-1.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>
                    {importing
                      ? 'Copying...'
                      : copyValidation
                        ? `Copy ${
                            skipCopyDuplicates
                              ? copyValidation.nonDuplicateBlocks.length
                              : copyValidation.blocks.length
                          } Session${
                            (skipCopyDuplicates
                              ? copyValidation.nonDuplicateBlocks.length
                              : copyValidation.blocks.length) === 1
                              ? ''
                              : 's'
                          }${
                            copyOutlineDocToo && selectedSourceCandidate?.hasOutlineDoc
                              ? ' + File'
                              : ''
                          }`
                        : 'Copy Attached Outline File'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {onLogoChange && (
        <div className="p-2.5 rounded-2xl bg-[#F5F5F7] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white border border-[#E5E5EA] flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Event logo" className="w-full h-full object-contain p-1" />
              ) : (
                <ImageIcon className="w-4 h-4 text-[#71717A]" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#0B0B0B] truncate">
                Event Logo for Exported Program Design
              </p>
              <p className="text-[10px] text-[#71717A] truncate">
                {logoUrl
                  ? 'Custom logo active on Flyer + Program Outline exports'
                  : 'Optional PNG/JPG/WebP mark (uses organizer monogram if unset)'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => logoInputRef.current?.click()}
              className="px-3 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              {savingLogo ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              <span>{logoUrl ? 'Change Logo' : 'Upload Logo'}</span>
            </button>
            {logoUrl && (
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => void Promise.resolve(onLogoChange(null))}
                aria-label="Remove event logo"
                className="w-7 h-7 rounded-full bg-white hover:bg-[#EF4444]/10 hover:text-[#EF4444] text-[#71717A] flex items-center justify-center transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {!outline && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleSelectedFile(dropped);
          }}
          onClick={() => !isDisabled && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isDisabled) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`rounded-2xl border border-dashed px-4 py-4 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-[#0B0B0B] bg-[#F5F5F7]'
              : 'border-[#D4D4D8] bg-[#F5F5F7]/60 hover:bg-[#F5F5F7]'
          }`}
        >
          <p className="text-xs font-semibold text-[#0B0B0B]">
            Drop your program file here or click to browse
          </p>
          <p className="text-[11px] text-[#71717A] mt-0.5">
            Supports PDF, JPG, PNG, WebP, CSV, TXT, and Markdown
          </p>
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-2.5 flex flex-wrap items-center justify-center gap-2"
          >
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => handleDownloadTemplate('csv')}
              className="px-2.5 py-1 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              <span>CSV Import Template</span>
            </button>
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => handleDownloadTemplate('txt')}
              className="px-2.5 py-1 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              <span>Text Outline Template</span>
            </button>
          </div>
        </div>
      )}

      {outline && (
        <div className="space-y-3">
          <div className="p-3 rounded-2xl bg-[#F5F5F7] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {outline.mimeType.startsWith('image/') ? (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="w-11 h-11 rounded-xl overflow-hidden bg-white border border-[#E5E5EA] shrink-0"
                  aria-label="Preview uploaded program image"
                >
                  <img
                    src={outline.dataUrl}
                    alt={outline.title || outline.fileName}
                    className="w-full h-full object-cover"
                  />
                </button>
              ) : (
                <div className="w-11 h-11 rounded-xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                  {outline.mimeType === 'text/csv' ? (
                    <FileSpreadsheet className="w-5 h-5" />
                  ) : outline.mimeType.startsWith('image/') ? (
                    <ImageIcon className="w-5 h-5" />
                  ) : (
                    <FileText className="w-5 h-5" />
                  )}
                </div>
              )}

              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0B0B0B] truncate">
                  {outline.title || outline.fileName}
                </p>
                <p className="text-[11px] text-[#71717A] truncate">
                  {outline.fileName} · {getProgramOutlineKindLabel(outline.mimeType)} ·{' '}
                  {formatFileSizeCompact(outline.sizeBytes)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="px-3 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview</span>
              </button>
              <a
                href={outline.dataUrl}
                download={outline.fileName}
                className="px-3 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
              <button
                type="button"
                disabled={isDisabled}
                onClick={handleRemoveOutline}
                aria-label="Remove program outline"
                className="w-8 h-8 rounded-full bg-white hover:bg-[#EF4444]/10 hover:text-[#EF4444] text-[#71717A] flex items-center justify-center transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Public label (e.g. Order of Service Booklet)"
              className="h-9 px-3.5 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Optional note for guests (e.g. Doors open at 8:30 AM)"
                className="flex-1 h-9 px-3.5 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
              />
              {metadataDirty && (
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={handleSaveMetadata}
                  className="h-9 px-3.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 hover:bg-zinc-800"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              )}
            </div>
          </div>

          {onImportParsedBlocks && fileValidation && (
            <div className="p-3 rounded-2xl bg-[#F5F5F7] space-y-2.5">
              {renderValidationReport(
                fileValidation,
                skipFileDuplicates,
                setSkipFileDuplicates
              )}
              {fileValidation.blocks.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-[#E5E5EA]">
                  <p className="text-[11px] text-[#71717A] truncate flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#0B0B0B]" />
                    <span>
                      First: {fileValidation.blocks[0].time} · {fileValidation.blocks[0].title}
                      {fileValidation.blocks[0].section ? ` (${fileValidation.blocks[0].section})` : ''}
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={
                      isDisabled ||
                      fileValidation.errors.length > 0 ||
                      (skipFileDuplicates
                        ? fileValidation.nonDuplicateBlocks.length === 0
                        : fileValidation.blocks.length === 0)
                    }
                    onClick={() => void handleImportValidated(fileValidation, skipFileDuplicates, false)}
                    className="min-h-[38px] px-3.5 py-2 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {importing
                      ? 'Importing...'
                      : `Import ${
                          skipFileDuplicates
                            ? fileValidation.nonDuplicateBlocks.length
                            : fileValidation.blocks.length
                        } Session${
                          (skipFileDuplicates
                            ? fileValidation.nonDuplicateBlocks.length
                            : fileValidation.blocks.length) === 1
                            ? ''
                            : 's'
                        } into Schedule`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showPasteBox && (
        <div className="p-3.5 rounded-2xl bg-[#F5F5F7] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-[#0B0B0B]">
              Paste Program Outline Lines
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isDisabled}
                onClick={handleLoadSampleInPasteBox}
                className="min-h-[34px] px-2.5 py-1 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[10px] font-semibold text-[#0B0B0B] transition-colors disabled:opacity-50"
              >
                Insert Sample Template
              </button>
              <span className="text-[10px] font-mono text-[#71717A]">
                ### Section Name · 09:00 - 09:45 | Title | Stage
              </span>
            </div>
          </div>
          <textarea
            rows={5}
            value={pastedText}
            onChange={(e) => {
              setPastedText(e.target.value);
              if (error) setError(null);
            }}
            placeholder={`## Day 1\n### Part 1 · Opening\n09:00 - 09:30 | Guest Arrival & Accreditation | Atrium\n09:30 - 10:30 | Opening Remarks | Main Hall | Organiser\n### Part 2 · Main Session\n11:00 - 12:15 | Keynote Address | Main Hall`}
            className="w-full p-3 rounded-2xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
          />
          {pasteValidation && (
            <div className="p-3 rounded-xl bg-white border border-[#E5E5EA]">
              {renderValidationReport(
                pasteValidation,
                skipPasteDuplicates,
                setSkipPasteDuplicates
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#71717A] tabular-nums">
              {pasteValidation
                ? `${pasteValidation.blocks.length} session${
                    pasteValidation.blocks.length === 1 ? '' : 's'
                  } recognized`
                : 'Include times per line to validate and import into Schedule blocks'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  isDisabled ||
                  !pastedText.trim() ||
                  Boolean(pasteValidation && pasteValidation.errors.length > 0)
                }
                onClick={() => void handleAttachPastedTextAsOutline()}
                className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold transition-colors disabled:opacity-50"
              >
                Save as Document
              </button>
              {onImportParsedBlocks && pasteValidation && pasteValidation.blocks.length > 0 && (
                <button
                  type="button"
                  disabled={
                    isDisabled ||
                    pasteValidation.errors.length > 0 ||
                    (skipPasteDuplicates
                      ? pasteValidation.nonDuplicateBlocks.length === 0
                      : pasteValidation.blocks.length === 0)
                  }
                  onClick={() => void handleImportValidated(pasteValidation, skipPasteDuplicates, true)}
                  className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                >
                  {importing
                    ? 'Importing...'
                    : `Import ${
                        skipPasteDuplicates
                          ? pasteValidation.nonDuplicateBlocks.length
                          : pasteValidation.blocks.length
                      } Session${
                        (skipPasteDuplicates
                          ? pasteValidation.nonDuplicateBlocks.length
                          : pasteValidation.blocks.length) === 1
                          ? ''
                          : 's'
                      }`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs font-medium text-[#EF4444]">{error}</p>
      )}
      {statusMessage && !error && (
        <p className="text-xs font-medium text-[#0B0B0B]">{statusMessage}</p>
      )}

      <ProgramOutlinePreviewModal
        outline={previewOpen && outline ? outline : null}
        eventTitle={eventTitle}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
};
