import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  QrCode,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { EventItem, GiftTableAttendantLink } from '../types/events';
import { formatEventDateSpan } from '../lib/eventDates';
import { buildGiftDeskUrl, DeterministicQrSvg, downloadQrSvg } from '../lib/qr';

interface GiftAttendantLinksCardProps {
  event: EventItem;
  canManage: boolean;
  onCreateLink: (
    eventId: string,
    payload: { attendantName: string; roleLabel?: string; phone?: string }
  ) => Promise<GiftTableAttendantLink | void>;
  onToggleLink: (eventId: string, linkId: string, active?: boolean) => Promise<void>;
  onDeleteLink: (eventId: string, linkId: string) => Promise<void>;
  onPreviewDeskLink?: (slugOrId: string, token: string) => void;
  onToast?: (msg: string) => void;
}

export const GiftAttendantLinksCard: React.FC<GiftAttendantLinksCardProps> = ({
  event,
  canManage,
  onCreateLink,
  onToggleLink,
  onDeleteLink,
  onPreviewDeskLink,
  onToast,
}) => {
  const [attendantName, setAttendantName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedQrId, setExpandedQrId] = useState<string | null>(null);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);

  const links = event.extraDataConfig?.attendantLinks ?? [];
  const slugOrId = event.slug || event.id;

  const notify = (msg: string) => {
    if (onToast) onToast(msg);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attendantName.trim()) {
      setFormError('Enter the name of the person who will man the Gift Table.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await onCreateLink(event.id, {
        attendantName: attendantName.trim(),
        roleLabel: roleLabel.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setAttendantName('');
      setRoleLabel('');
      setPhone('');
      notify('Gift Table attendant link created');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create attendant link.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (link: GiftTableAttendantLink) => {
    const url = buildGiftDeskUrl(slugOrId, link.token);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedId(link.id);
    setTimeout(() => setCopiedId((curr) => (curr === link.id ? null : curr)), 2000);
    notify(`Copied Gift Desk link for ${link.attendantName}`);
  };

  const handleToggle = async (link: GiftTableAttendantLink) => {
    setBusyLinkId(link.id);
    setFormError(null);
    try {
      await onToggleLink(event.id, link.id, !link.active);
      notify(
        !link.active
          ? `Resumed Gift Desk link for ${link.attendantName}`
          : `Paused Gift Desk link for ${link.attendantName}`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to update attendant link.');
    } finally {
      setBusyLinkId(null);
    }
  };

  const handleDelete = async (link: GiftTableAttendantLink) => {
    setBusyLinkId(link.id);
    setFormError(null);
    try {
      await onDeleteLink(event.id, link.id);
      if (expandedQrId === link.id) setExpandedQrId(null);
      notify(`Removed Gift Desk link for ${link.attendantName}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to delete attendant link.');
    } finally {
      setBusyLinkId(null);
    }
  };

  const buildWhatsAppHref = (link: GiftTableAttendantLink, deskUrl: string) => {
    const formattedDate = formatEventDateSpan(event.isoDate, event.endIsoDate, event.date);
    const text = `Hello ${link.attendantName}, you have been appointed to man the Gift Table for ${event.title} (${formattedDate}). Open your dedicated Gift Desk link to record gifts, cash envelopes & MoMo receipts: ${deskUrl}`;
    const digits = (link.phone || '').replace(/\D/g, '');
    return digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  return (
    <section className="bg-white rounded-[28px] border border-[#E5E5EA]/80 p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#71717A]">
            <UserCheck className="w-3.5 h-3.5 text-[#0B0B0B]" />
            Appointed Gift Table Attendants
          </span>
          <h3 className="font-display text-lg font-bold text-[#0B0B0B] tracking-[-0.02em] mt-0.5">
            Create Desk Links for People Manning the Gift Table
          </h3>
          <p className="text-xs text-[#71717A] mt-0.5 leading-relaxed">
            Share a dedicated Gift Desk link with ushers, family representatives, or MoMo receivers. Each entry logs under their name without granting studio access.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F7] text-[11px] font-semibold text-[#0B0B0B] shrink-0 self-start">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="tabular-nums">
            {links.filter((l) => l.active).length} active links
          </span>
        </span>
      </div>

      {canManage && (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]/70 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#0B0B0B]">
              Appoint Gift Table Attendant / Receiver
            </span>
            <span className="text-[10px] font-mono text-[#71717A]">
              No login required for attendant
            </span>
          </div>

          {formError && (
            <p className="text-xs text-red-600 font-medium">{formError}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              required
              value={attendantName}
              onChange={(e) => setAttendantName(e.target.value)}
              placeholder="Attendant full name *"
              aria-label="Attendant full name"
              className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-medium text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
            />
            <input
              type="text"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="Desk role (optional)"
              aria-label="Desk role"
              className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="WhatsApp / phone (optional)"
              aria-label="Attendant phone number"
              className="h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B] focus:outline-none focus:border-[#0B0B0B]"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{creating ? 'Generating Link...' : 'Create Gift Desk Link'}</span>
            </button>
          </div>
        </form>
      )}

      {links.length === 0 ? (
        <div className="p-6 rounded-2xl bg-[#F5F5F7] text-center space-y-1">
          <p className="text-xs font-semibold text-[#0B0B0B]">
            No attendant links generated yet
          </p>
          <p className="text-[11px] text-[#71717A]">
            Add an attendant above to generate a unique desk URL and QR pass for receiving gifts at the venue.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const deskUrl = buildGiftDeskUrl(slugOrId, link.token);
            const showQr = expandedQrId === link.id;
            const isBusy = busyLinkId === link.id;
            const whatsappHref = buildWhatsAppHref(link, deskUrl);

            return (
              <div
                key={link.id}
                className={`p-4 rounded-2xl border transition-colors space-y-3 ${
                  link.active
                    ? 'bg-[#F5F5F7] border-[#E5E5EA]'
                    : 'bg-zinc-50 border-dashed border-[#D4D4D8] opacity-80'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#0B0B0B]">
                        {link.attendantName}
                      </span>
                      {link.roleLabel && (
                        <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-semibold text-[#52525B]">
                          {link.roleLabel}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          link.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-zinc-200 text-zinc-700'
                        }`}
                      >
                        {link.active ? 'Active' : 'Paused'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono font-semibold text-[#0B0B0B] tabular-nums">
                        {link.recordedCount ?? 0} gifts logged
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#71717A]">
                      {link.phone && (
                        <span className="font-mono text-[#0B0B0B]">{link.phone}</span>
                      )}
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#52525B] break-all">
                        <Link2 className="w-3 h-3 shrink-0" />
                        /e/{slugOrId}/gifts?desk={link.token}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(link)}
                      className="px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors"
                    >
                      {copiedId === link.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedQrId(showQr ? null : link.id)}
                      className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                        showQr
                          ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                          : 'bg-white border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B]'
                      }`}
                    >
                      <QrCode className="w-3 h-3" />
                      <span>QR</span>
                    </button>

                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors"
                    >
                      <MessageCircle className="w-3 h-3" />
                      <span>WhatsApp</span>
                    </a>

                    {onPreviewDeskLink && (
                      <button
                        type="button"
                        onClick={() => onPreviewDeskLink(slugOrId, link.token)}
                        className="px-3 py-1.5 rounded-full bg-[#0B0B0B] text-white hover:bg-neutral-800 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open Desk</span>
                      </button>
                    )}

                    {canManage && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleToggle(link)}
                          title={link.active ? 'Pause link' : 'Resume link'}
                          className="px-2.5 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[11px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          {link.active ? (
                            <>
                              <PauseCircle className="w-3 h-3" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="w-3 h-3" />
                              <span>Resume</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDelete(link)}
                          aria-label={`Delete link for ${link.attendantName}`}
                          title="Delete attendant link"
                          className="w-7 h-7 rounded-full bg-white border border-[#E5E5EA] hover:border-red-500 hover:text-red-600 text-[#71717A] flex items-center justify-center disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {showQr && (
                  <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA] flex flex-col sm:flex-row items-center gap-4">
                    <div className="p-2.5 rounded-2xl bg-white border border-[#E5E5EA] shrink-0">
                      <DeterministicQrSvg
                        value={deskUrl}
                        size={132}
                        label={`Gift Desk QR for ${link.attendantName}`}
                      />
                    </div>
                    <div className="space-y-2 text-center sm:text-left min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#0B0B0B]">
                        {link.attendantName}&apos;s Dedicated Gift Desk QR
                      </p>
                      <p className="text-[11px] text-[#71717A] break-all font-mono">
                        {deskUrl}
                      </p>
                      <div className="flex flex-wrap justify-center sm:justify-start gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            downloadQrSvg(
                              deskUrl,
                              `${event.slug || event.id}-gift-desk-${link.attendantName
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '-')}.svg`
                            )
                          }
                          className="px-3.5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-semibold inline-flex items-center gap-1.5"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download Desk QR</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
