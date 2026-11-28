import React, { useMemo, useState } from 'react';
import { Download, Eye, FileSpreadsheet, FileText, Image as ImageIcon, X } from 'lucide-react';
import type { EventProgramOutline } from '../types/events';
import {
  decodeProgramOutlineText,
  formatFileSizeCompact,
  isTextProgramOutline,
} from '../lib/programOutline';

export function getProgramOutlineKindLabel(mimeType?: string): string {
  if (mimeType === 'application/pdf') return 'PDF Document';
  if (mimeType?.startsWith('image/')) return 'Image';
  if (mimeType === 'text/csv') return 'CSV Schedule';
  if (mimeType === 'text/markdown') return 'Markdown';
  return 'Text Outline';
}

interface ProgramOutlinePreviewModalProps {
  outline: EventProgramOutline | null;
  eventTitle?: string;
  onClose: () => void;
}

export const ProgramOutlinePreviewModal: React.FC<ProgramOutlinePreviewModalProps> = ({
  outline,
  eventTitle,
  onClose,
}) => {
  const decodedText = useMemo(
    () => (outline && isTextProgramOutline(outline) ? decodeProgramOutlineText(outline) : ''),
    [outline]
  );

  if (!outline) return null;

  const isImage = outline.mimeType.startsWith('image/');
  const isPdf = outline.mimeType === 'application/pdf';
  const displayTitle = outline.title || outline.fileName || 'Program Outline';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${displayTitle}`}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-white rounded-[28px] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E5EA] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-[#0B0B0B] truncate">
              {displayTitle}
            </h3>
            <p className="text-[11px] text-[#71717A] truncate">
              {eventTitle ? `${eventTitle} · ` : ''}
              {getProgramOutlineKindLabel(outline.mimeType)} · {formatFileSizeCompact(outline.sizeBytes)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={outline.dataUrl}
              download={outline.fileName}
              className="px-3.5 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 inline-flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close outline preview"
              className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] flex items-center justify-center text-[#0B0B0B] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 bg-[#F5F5F7]">
          {outline.notes && (
            <div className="mb-3 px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA] text-xs text-[#444748]">
              {outline.notes}
            </div>
          )}

          {isImage && (
            <div className="flex justify-center">
              <img
                src={outline.dataUrl}
                alt={displayTitle}
                className="max-w-full max-h-[68vh] rounded-2xl object-contain bg-white shadow-sm"
              />
            </div>
          )}

          {isPdf && (
            <div className="space-y-3">
              <object
                data={outline.dataUrl}
                type="application/pdf"
                className="w-full h-[64vh] rounded-2xl bg-white border border-[#E5E5EA]"
              >
                <div className="p-8 text-center bg-white rounded-2xl border border-[#E5E5EA] space-y-3">
                  <FileText className="w-10 h-10 text-[#0B0B0B] mx-auto" />
                  <div>
                    <p className="text-sm font-semibold text-[#0B0B0B]">
                      Inline PDF preview is unavailable on this browser
                    </p>
                    <p className="text-xs text-[#71717A] mt-1">
                      Download the official PDF booklet to view all pages cleanly on your device.
                    </p>
                  </div>
                  <a
                    href={outline.dataUrl}
                    download={outline.fileName}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download {outline.fileName}</span>
                  </a>
                </div>
              </object>
            </div>
          )}

          {!isImage && !isPdf && (
            <div className="rounded-2xl bg-white border border-[#E5E5EA] p-4 sm:p-5 overflow-x-auto">
              <pre className="text-xs sm:text-[13px] leading-relaxed font-mono text-[#0B0B0B] whitespace-pre-wrap break-words">
                {decodedText || 'No readable text content found in outline.'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface PublicProgramOutlineCardProps {
  outline: EventProgramOutline;
  eventTitle?: string;
  compact?: boolean;
}

export const PublicProgramOutlineCard: React.FC<PublicProgramOutlineCardProps> = ({
  outline,
  eventTitle,
  compact = false,
}) => {
  const [previewOpen, setPreviewOpen] = useState(false);

  const isImage = outline.mimeType.startsWith('image/');
  const isCsv = outline.mimeType === 'text/csv';
  const displayTitle = outline.title || 'Official Program Outline';

  return (
    <>
      <div
        className={`bg-white rounded-[24px] shadow-sm border border-[#E5E5EA]/70 ${
          compact ? 'p-3.5' : 'p-4 sm:p-5'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {isImage ? (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="w-12 h-12 rounded-2xl overflow-hidden bg-[#F5F5F7] shrink-0 border border-[#E5E5EA] hover:opacity-90 transition-opacity"
                aria-label={`Preview ${displayTitle}`}
              >
                <img
                  src={outline.dataUrl}
                  alt={displayTitle}
                  className="w-full h-full object-cover"
                />
              </button>
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                {isCsv ? (
                  <FileSpreadsheet className="w-5 h-5" />
                ) : isImage ? (
                  <ImageIcon className="w-5 h-5" />
                ) : (
                  <FileText className="w-5 h-5" />
                )}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-[#0B0B0B] truncate">
                  {displayTitle}
                </p>
                <span className="px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[10px] font-semibold text-[#444748] shrink-0">
                  {getProgramOutlineKindLabel(outline.mimeType)}
                </span>
              </div>
              <p className="text-[11px] text-[#71717A] truncate mt-0.5">
                {outline.fileName} · {formatFileSizeCompact(outline.sizeBytes)}
              </p>
              {outline.notes && (
                <p className="text-xs text-[#444748] mt-1 line-clamp-2">{outline.notes}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="px-3.5 py-2 rounded-full bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View</span>
            </button>
            <a
              href={outline.dataUrl}
              download={outline.fileName}
              className="px-3.5 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
          </div>
        </div>
      </div>

      <ProgramOutlinePreviewModal
        outline={previewOpen ? outline : null}
        eventTitle={eventTitle}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
};
