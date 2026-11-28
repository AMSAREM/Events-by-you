import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
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
import type { EventItem, EventProgramOutline } from '../types/events';
import {
  buildProgramOutlineTextTemplate,
  decodeProgramOutlineText,
  downloadProgramOutlineTemplate,
  formatFileSizeCompact,
  isTextProgramOutline,
  parseProgramOutlineTextToBlocks,
  processEventLogoFile,
  processProgramOutlineFile,
  sanitizeProgramOutline,
  type ParsedProgramOutlineBlock,
  type ProgramOutlineTemplateFormat,
} from '../lib/programOutline';
import { getProgramOutlineKindLabel, ProgramOutlinePreviewModal } from './ProgramOutlineViewer';

interface ProgramOutlineUploadCardProps {
  outline?: EventProgramOutline;
  eventTitle?: string;
  eventContext?: Pick<EventItem, 'isoDate' | 'endIsoDate' | 'organizer' | 'venue'> | null;
  logoUrl?: string | null;
  hasScheduleBlocks?: boolean;
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

export const ProgramOutlineUploadCard: React.FC<ProgramOutlineUploadCardProps> = ({
  outline,
  eventTitle,
  eventContext,
  logoUrl,
  hasScheduleBlocks = false,
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
  const [processing, setProcessing] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const [titleInput, setTitleInput] = useState(outline?.title || '');
  const [notesInput, setNotesInput] = useState(outline?.notes || '');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedText, setPastedText] = useState('');

  useEffect(() => {
    setTitleInput(outline?.title || '');
    setNotesInput(outline?.notes || '');
  }, [outline?.fileName, outline?.title, outline?.notes]);

  useEffect(() => {
    if (!templateMenuOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(event.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTemplateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [templateMenuOpen]);

  const parsedFileBlocks = useMemo(() => {
    if (!outline || !isTextProgramOutline(outline)) return [];
    const text = decodeProgramOutlineText(outline);
    if (!text) return [];
    return parseProgramOutlineTextToBlocks(text, eventContext);
  }, [outline, eventContext]);

  const parsedPastedBlocks = useMemo(() => {
    if (!pastedText.trim()) return [];
    return parseProgramOutlineTextToBlocks(pastedText, eventContext);
  }, [pastedText, eventContext]);

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
      if (isTextProgramOutline(processed) && onImportParsedBlocks) {
        const parsed = parseProgramOutlineTextToBlocks(
          decodeProgramOutlineText(processed),
          eventContext
        );
        if (parsed.length > 0) {
          const secCount = new Set(parsed.map((p) => p.section).filter(Boolean)).size;
          setStatusMessage(
            `Uploaded ${processed.fileName}. Detected ${parsed.length} session${parsed.length === 1 ? '' : 's'}${
              secCount > 0 ? ` across ${secCount} section${secCount === 1 ? '' : 's'}` : ''
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

  const handleImportBlocks = async (blocksToImport: ParsedProgramOutlineBlock[], fromPaste = false) => {
    if (!onImportParsedBlocks || blocksToImport.length === 0) return;
    setError(null);
    setStatusMessage(null);
    setImporting(true);
    try {
      await Promise.resolve(onImportParsedBlocks(blocksToImport));
      setStatusMessage(
        `Added ${blocksToImport.length} session${blocksToImport.length === 1 ? '' : 's'} to the schedule.`
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

  const handleAttachPastedTextAsOutline = async () => {
    const clean = pastedText.trim();
    if (!clean) return;
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
            Upload Program Outline
          </h3>
          <p className="text-[11px] text-[#71717A] mt-0.5">
            Attach a PDF booklet, flyer image, or structured TXT/CSV/MD rundown (max 2.5 MB).
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
              <span>Download Template</span>
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

          {onImportParsedBlocks && parsedFileBlocks.length > 0 && (
            <div className="p-3 rounded-2xl bg-[#F5F5F7] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0B0B0B] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {parsedFileBlocks.length} session{parsedFileBlocks.length === 1 ? '' : 's'} detected in file
                  </span>
                </p>
                <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                  First: {parsedFileBlocks[0].time} · {parsedFileBlocks[0].title}
                  {parsedFileBlocks[0].section ? ` (${parsedFileBlocks[0].section})` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => void handleImportBlocks(parsedFileBlocks, false)}
                className="min-h-[40px] px-3.5 py-2 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {importing
                  ? 'Importing...'
                  : `Import ${parsedFileBlocks.length} Session${parsedFileBlocks.length === 1 ? '' : 's'} into Schedule`}
              </button>
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
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`## Day 1\n### Part 1 · Opening\n09:00 - 09:30 | Guest Arrival & Accreditation | Atrium\n09:30 - 10:30 | Opening Remarks | Main Hall | Organiser\n### Part 2 · Main Session\n11:00 - 12:15 | Keynote Address | Main Hall`}
            className="w-full p-3 rounded-2xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#71717A] tabular-nums">
              {parsedPastedBlocks.length > 0
                ? `${parsedPastedBlocks.length} session${parsedPastedBlocks.length === 1 ? '' : 's'} recognized`
                : 'Include times per line to auto-import into Schedule blocks'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isDisabled || !pastedText.trim()}
                onClick={() => void handleAttachPastedTextAsOutline()}
                className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#E5E5EA] text-[#0B0B0B] text-[11px] font-semibold transition-colors disabled:opacity-50"
              >
                Save as Document
              </button>
              {onImportParsedBlocks && parsedPastedBlocks.length > 0 && (
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => void handleImportBlocks(parsedPastedBlocks, true)}
                  className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                >
                  {importing
                    ? 'Importing...'
                    : `Import ${parsedPastedBlocks.length} Session${parsedPastedBlocks.length === 1 ? '' : 's'}`}
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
