import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Info,
  Laptop,
  Lock,
  LogOut,
  MessageSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Unlock,
  Verified,
  Wallet,
} from 'lucide-react';
import {
  validateStrictEmail,
  validateStrictPassword,
  validateStrictPhoneE164,
} from '../data/initialData';
import { api } from '../lib/api';
import { EventItem, OrganizerProfile, SystemAlert } from '../types/events';

interface SettingsScreenProps {
  profile: OrganizerProfile;
  events?: EventItem[];
  alerts: SystemAlert[];
  onUpdateProfile: (profile: OrganizerProfile) => void;
  onResolveAlert: (id: string) => void;
  onOpenPlans: () => void;
  onSignOut: () => void;
  onResetDemoData: () => void;
}

const DEFAULT_AVATAR_URL =
  '/src/assets/images/flyer_corporate_gala_1795075792816.jpg';

const TOPUP_BUNDLES = [
  {
    id: '100',
    credits: 100,
    label: '100 SMS Credits',
    sub: 'Standard broadcast pack',
    priceGhs: 'GHS 45',
    popular: false,
  },
  {
    id: '500',
    credits: 500,
    label: '500 SMS Credits',
    sub: 'Ideal for conference updates',
    priceGhs: 'GHS 200',
    popular: true,
  },
  {
    id: '2000',
    credits: 2000,
    label: '2,000 SMS Credits',
    sub: 'Bulk tier (20% savings)',
    priceGhs: 'GHS 720',
    popular: false,
  },
];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  profile,
  events = [],
  alerts,
  onUpdateProfile,
  onResolveAlert,
  onOpenPlans,
  onSignOut,
  onResetDemoData,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [studio, setStudio] = useState(profile.studio);
  const [email, setEmail] = useState(profile.email);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [replyToEmail, setReplyToEmail] = useState(
    profile.replyToEmail ?? 'support@techleaders.africa'
  );
  const [timezone, setTimezone] = useState(profile.timezone ?? 'Africa/Accra');
  const [threshold, setThreshold] = useState(profile.capacityAlertThreshold);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    profile.avatarUrl === '' ? null : profile.avatarUrl ?? DEFAULT_AVATAR_URL
  );
  const [avatarError, setAvatarError] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(
    profile.twoFactorEnabled ?? true
  );
  const [senderId, setSenderId] = useState(profile.senderId ?? 'TECHLEADERS');

  // Test SMS Dispatcher
  const [testPhone, setTestPhone] = useState('24 890 1124');
  const [testDispatching, setTestDispatching] = useState(false);
  const [testReceipt, setTestReceipt] = useState<string | null>(null);

  // Password inline form
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [lastPasswordLabel, setLastPasswordLabel] = useState('Manage your Supabase creator password');

  // Wallet & Webhook
  const [selectedBundleId, setSelectedBundleId] = useState('500');
  const [webhookSuffix, setWebhookSuffix] = useState('4F98');

  // Session & Toast controls
  const [confirmReset, setConfirmReset] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    setName(profile.name);
    setRole(profile.role);
    setStudio(profile.studio);
    setEmail(profile.email);
    setPhone(profile.phone ?? '');
    setReplyToEmail(profile.replyToEmail ?? 'support@techleaders.africa');
    setTimezone(profile.timezone ?? 'Africa/Accra');
    setThreshold(profile.capacityAlertThreshold);
    setAvatarUrl(profile.avatarUrl === '' ? null : profile.avatarUrl ?? DEFAULT_AVATAR_URL);
    setTwoFactorEnabled(profile.twoFactorEnabled ?? true);
    setSenderId(profile.senderId ?? 'TECHLEADERS');
  }, [profile]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      showToast('Full legal name must be at least 2 characters.');
      return;
    }
    let normalizedEmail = profile.email;
    if (email.trim()) {
      const emailCheck = validateStrictEmail(email);
      if (!emailCheck.ok) {
        showToast(emailCheck.error);
        return;
      }
      normalizedEmail = emailCheck.normalized;
    }
    let normalizedPhone = profile.phone;
    if (phone.trim()) {
      const phoneCheck = validateStrictPhoneE164(phone, 'GH');
      if (!phoneCheck.ok) {
        showToast(phoneCheck.error);
        return;
      }
      normalizedPhone = phoneCheck.normalized;
      setPhone(phoneCheck.normalized);
    }

    const firstName = name.trim().split(' ')[0] || profile.firstName;
    onUpdateProfile({
      ...profile,
      name: name.trim() || profile.name,
      firstName,
      role: role.trim() || profile.role,
      studio: studio.trim() || profile.studio,
      email: normalizedEmail,
      phone: normalizedPhone,
      replyToEmail: replyToEmail.trim() || 'support@techleaders.africa',
      timezone,
      capacityAlertThreshold: threshold,
      avatarUrl: avatarUrl ?? '',
      twoFactorEnabled,
      senderId,
    });
    showToast('Organiser profile & configurations saved.');
  };

  const handleDiscard = () => {
    setName(profile.name);
    setRole(profile.role);
    setStudio(profile.studio);
    setEmail(profile.email);
    setPhone(profile.phone ?? '');
    setReplyToEmail(profile.replyToEmail ?? 'support@techleaders.africa');
    setTimezone(profile.timezone ?? 'Africa/Accra');
    setThreshold(profile.capacityAlertThreshold);
    setAvatarUrl(profile.avatarUrl === '' ? null : profile.avatarUrl ?? DEFAULT_AVATAR_URL);
    setAvatarError(false);
    setTwoFactorEnabled(profile.twoFactorEnabled ?? true);
    setSenderId(profile.senderId ?? 'TECHLEADERS');
    showToast('Unsaved changes discarded.');
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarUrl(reader.result);
        setAvatarError(false);
        showToast('Profile photo updated. Click Save Changes to persist.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendTestSms = () => {
    if (profile.smsCredits <= 0) {
      showToast('No SMS credits remaining. Top up your wallet first.');
      return;
    }
    setTestDispatching(true);
    setTimeout(() => {
      const receiptId = `ARK-${Math.floor(10000 + Math.random() * 89999)}-OK`;
      setTestDispatching(false);
      setTestReceipt(`Sent successfully via MTN Ghana routing. Delivery receipt: ${receiptId}.`);
      onUpdateProfile({
        ...profile,
        smsCredits: Math.max(0, profile.smsCredits - 1),
      });
      showToast(`1 test credit dispatched to +233 ${testPhone.trim()}`);
    }, 650);
  };

  const handleBuyBundle = () => {
    const bundle = TOPUP_BUNDLES.find((b) => b.id === selectedBundleId) ?? TOPUP_BUNDLES[1];
    onUpdateProfile({
      ...profile,
      smsCredits: profile.smsCredits + bundle.credits,
    });
    showToast(`Credited +${bundle.credits.toLocaleString()} SMS (${bundle.priceGhs}) via Paystack MoMo.`);
  };

  const handleCopyWebhook = () => {
    const endpoint = 'https://api.eventsapp.africa/v1/arkesel-callback';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(endpoint).catch(() => {});
    }
    showToast('Webhook endpoint copied to clipboard.');
  };

  const handleRotateWebhook = () => {
    const chars = 'ABCDEF0123456789';
    let next = '';
    for (let i = 0; i < 4; i += 1) {
      next += chars[Math.floor(Math.random() * chars.length)];
    }
    setWebhookSuffix(next);
    showToast('Arkesel signing secret rotated.');
  };

  const handleConfirmReset = () => {
    onResetDemoData();
    setConfirmReset(false);
    showToast('Workspace restored to default events, schedule, and attendees.');
  };

  const unresolved = alerts.filter((a) => !a.resolved);
  const isFree = profile.plan === 'Starter';
  const liveEventCount = events.filter((e) => e.status === 'live' || e.status === 'upcoming').length;
  const primaryEvent = events[0];
  const primaryRegistered = primaryEvent?.registered ?? 42;
  const primaryCap = isFree ? 50 : primaryEvent?.capacity ?? 500;
  const attendeeCapPct = Math.min(100, Math.round((primaryRegistered / Math.max(1, primaryCap)) * 100));

  const smsBaseAllotment = isFree ? 20 : 2000;
  const smsPct = Math.min(100, Math.round((profile.smsCredits / Math.max(1, smsBaseAllotment)) * 100));
  const strokeDasharray = `${smsPct}, 100`;

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6 pb-12">
      {/* Feedback Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0B0B0B] text-white px-5 py-3 rounded-full text-xs font-semibold flex items-center gap-2.5 shadow-xl">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Action & Context Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[#71717A] text-xs font-semibold uppercase tracking-wider">
            <span>Creator Studio</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-[#0B0B0B]">Settings &amp; Account</span>
          </div>
          <h1 className="font-display text-[28px] sm:text-[36px] leading-tight font-bold tracking-[-0.03em] text-[#0B0B0B]">
            Settings &amp; Plan Limits
          </h1>
          <p className="text-sm text-[#71717A] max-w-2xl">
            Manage your organiser profile, Arkesel SMS sender IDs, Ghana telecom routing, credit
            balance, and plan capabilities.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={handleDiscard}
            className="px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#EEEEF0] text-xs font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all whitespace-nowrap"
          >
            <Check className="w-4 h-4" />
            <span>Save Changes</span>
          </button>
        </div>
      </div>

      {/* Main Asymmetric 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Primary Configuration Forms (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Organiser Profile Card */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div>
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest block">
                  Account Identity
                </span>
                <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                  Organiser Profile
                </h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-semibold px-3 py-1 bg-[#0B0B0B] text-white rounded-full uppercase">
                  RBAC: {profile.appRole ?? 'organizer'}
                </span>
                <span className="text-xs font-mono font-semibold px-3 py-1 bg-[#EEEEF0] rounded-full text-[#0B0B0B]">
                  ID: ORG-GH-7841
                </span>
              </div>
            </div>

            {/* Avatar Block */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-white mb-6 border border-[#E5E5EA]/70">
              <div className="relative w-16 h-16 rounded-full overflow-hidden bg-[#E8E8EA] shrink-0 flex items-center justify-center">
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt={`${name} organiser profile`}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-base font-bold text-[#0B0B0B]">{initials || 'JM'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-base font-semibold text-[#0B0B0B] truncate">{name}</div>
                <p className="text-[13px] text-[#71717A] leading-snug">
                  Primary account owner. Visible on public ticketing receipts &amp; invitations.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-xs font-semibold hover:bg-[#EEEEF0] transition-colors"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAvatarUrl(null);
                    showToast('Profile photo removed.');
                  }}
                  className="px-3 py-1.5 rounded-full text-[#71717A] text-xs font-semibold hover:text-[#EF4444] transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Form Inputs Grid */}
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Full Legal Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Primary Email
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className="w-full pl-4 pr-24 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                    />
                    <span className="absolute right-2 top-2 px-2.5 py-0.5 rounded-full bg-[#EEEEF0] text-[#0B0B0B] text-[11px] font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0B0B0B]" />
                      {email.trim() ? 'Linked' : 'Optional'}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                  Mobile Phone Number (Auth &amp; Authorisation)
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+233 24 123 4567"
                    className="w-full pl-4 pr-28 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all tabular-nums"
                  />
                  <span
                    className={`absolute right-2 top-2 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 ${
                      profile.phoneVerified
                        ? 'bg-[#0B0B0B] text-white'
                        : 'bg-[#EEEEF0] text-[#71717A]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        profile.phoneVerified ? 'bg-emerald-400' : 'bg-[#71717A]'
                      }`}
                    />
                    {profile.phoneVerified ? 'Verified' : 'Unverified'}
                  </span>
                </div>
                <p className="text-[11px] text-[#71717A] mt-1">
                  Used for SMS OTP sign-in, password recovery, and RBAC permission enforcement.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Organisation / Brand Name
                  </label>
                  <input
                    type="text"
                    value={studio}
                    onChange={(e) => setStudio(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Support Reply-To Email
                  </label>
                  <input
                    type="email"
                    value={replyToEmail}
                    onChange={(e) => setReplyToEmail(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                  />
                  <p className="text-[11px] text-[#71717A] mt-1">
                    Attendees reply directly here via Resend transactionals.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Operational Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all cursor-pointer"
                  >
                    <option value="Africa/Accra">Africa/Accra (GMT +00:00 - Ghana Standard)</option>
                    <option value="Africa/Lagos">Africa/Lagos (WAT +01:00 - West Africa)</option>
                    <option value="Africa/Nairobi">Africa/Nairobi (EAT +03:00 - East Africa)</option>
                    <option value="UTC">Coordinated Universal Time (UTC)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                    Role / Title
                  </label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#E5E5EA]/70 text-sm text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B] transition-all"
                  />
                </div>
              </div>

              {/* Capacity Alert Threshold */}
              <div className="pt-3 border-t border-[#E5E5EA]">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label htmlFor="threshold-range" className="text-xs font-semibold text-[#0B0B0B]">
                      Capacity Ceiling Alert Threshold
                    </label>
                    <p className="text-[11px] text-[#71717A]">
                      Highlights events in red when registration occupancy crosses this percentage.
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold text-[#0B0B0B] tabular-nums">
                    {threshold}%
                  </span>
                </div>
                <input
                  id="threshold-range"
                  type="range"
                  min={70}
                  max={99}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-[#0B0B0B] cursor-pointer"
                />
              </div>
            </form>
          </section>

          {/* SMS Sender ID & Arkesel Carrier Integration */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
              <div>
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest block">
                  Telecommunications &amp; Routing
                </span>
                <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                  SMS Sender ID &amp; Arkesel v2 Gateway
                </h2>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#EEEEF0] rounded-full text-[#0B0B0B] self-start">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                <span className="text-xs font-semibold">Gateway Connected</span>
              </div>
            </div>

            {/* Sender ID Registry Cards */}
            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={() => {
                  setSenderId('TECHLEADERS');
                  showToast('Primary Sender ID set to TECHLEADERS');
                }}
                className={`w-full text-left flex items-center justify-between p-4 rounded-2xl bg-white border transition-colors ${
                  senderId === 'TECHLEADERS' ? 'border-[#0B0B0B]' : 'border-[#E5E5EA]/70'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#0B0B0B] shrink-0">
                    <MessageSquare className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold tracking-wider text-[#0B0B0B] font-mono">
                        TECHLEADERS
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8E8EA] text-[#0B0B0B] uppercase font-semibold">
                        Primary
                      </span>
                    </div>
                    <p className="text-xs text-[#71717A] mt-0.5">
                      11 Alphanumeric characters • Registered with Ghana NCA &amp; Arkesel
                    </p>
                  </div>
                </div>
                <Verified className="w-5 h-5 text-[#0B0B0B] shrink-0" />
              </button>

              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/80 border border-[#E5E5EA]/50 opacity-85 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#F5F5F7] flex items-center justify-center text-[#71717A] shrink-0">
                    <Clock className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold tracking-wider text-[#0B0B0B] font-mono">
                        AFRICATECH
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F5F5F7] text-[#71717A] uppercase font-semibold">
                        Pending NCA Audit
                      </span>
                    </div>
                    <p className="text-xs text-[#71717A] mt-0.5">
                      Submitted on 28 Feb 2026 • Expected review: 24-48 hrs
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-[#71717A] whitespace-nowrap shrink-0">
                  Under Review
                </span>
              </div>
            </div>

            {/* Compliance Note Box */}
            <div className="p-3.5 rounded-2xl bg-[#EEEEF0]/70 mb-6 flex gap-3 items-start">
              <Info className="w-4 h-4 text-[#71717A] shrink-0 mt-0.5" />
              <p className="text-xs text-[#71717A] leading-relaxed">
                Per Ghana National Communications Authority (NCA) compliance and Arkesel v2 specs,
                custom Sender IDs must be strictly pre-cleared for MTN, Telecel, and AT networks.
                Spaces and symbols are disallowed.
              </p>
            </div>

            {/* Inline Test Dispatcher */}
            <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]/70 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                  Direct Carrier Test Dispatcher
                </span>
                <span className="text-[11px] font-medium text-[#71717A]">
                  Deducts 1 SMS Credit
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center font-mono text-xs text-[#71717A]">
                    GH (+233)
                  </span>
                  <input
                    type="text"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="24 123 4567"
                    className="w-full pl-24 pr-4 py-2.5 rounded-xl bg-[#F5F5F7] text-[#0B0B0B] font-mono text-xs focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                  />
                </div>
                <button
                  type="button"
                  disabled={testDispatching}
                  onClick={handleSendTestSms}
                  className="px-5 py-2.5 rounded-xl bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{testDispatching ? 'Dispatching...' : 'Send Test SMS'}</span>
                </button>
              </div>
              {testReceipt && (
                <p className="text-xs text-emerald-700 font-medium">{testReceipt}</p>
              )}
            </div>
          </section>

          {/* Security & Active Logins Card */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="mb-6">
              <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest block">
                Authentication Guard
              </span>
              <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                Security &amp; Active Logins
              </h2>
            </div>

            <div className="space-y-4">
              {/* Password Row */}
              <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]/70 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-[#0B0B0B]">Master Password</div>
                    <p className="text-xs text-[#71717A]">{lastPasswordLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasswordOpen((p) => !p)}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] text-[#0B0B0B] text-xs font-semibold hover:bg-[#EEEEF0] transition-colors self-start sm:self-auto"
                  >
                    {passwordOpen ? 'Close' : 'Update Password'}
                  </button>
                </div>

                {passwordOpen && (
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 chars, 1 uppercase, 1 number"
                      className="flex-1 h-10 px-4 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:outline-none focus:ring-1 focus:ring-[#0B0B0B]"
                    />
                    <button
                      type="button"
                      disabled={updatingPassword}
                      onClick={async () => {
                        const pwCheck = validateStrictPassword(newPassword);
                        if (!pwCheck.ok) {
                          showToast(pwCheck.error);
                          return;
                        }
                        setUpdatingPassword(true);
                        try {
                          await api.auth.updatePassword(newPassword);
                          setNewPassword('');
                          setPasswordOpen(false);
                          setLastPasswordLabel('Updated in Supabase Auth just now');
                          showToast('Creator password updated in Supabase Auth.');
                        } catch (err) {
                          showToast(
                            err instanceof Error ? err.message : 'Unable to update password.'
                          );
                        } finally {
                          setUpdatingPassword(false);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-[#0B0B0B] text-white text-xs font-semibold whitespace-nowrap disabled:opacity-60"
                    >
                      {updatingPassword ? 'Updating...' : 'Confirm Update'}
                    </button>
                  </div>
                )}
              </div>

              {/* 2FA Row */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white border border-[#E5E5EA]/70 gap-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-[#0B0B0B]">
                    Two-Factor Authentication (2FA)
                  </div>
                  <p className="text-xs text-[#71717A]">
                    Secured via Authenticator TOTP App
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={twoFactorEnabled}
                  onClick={() => {
                    const next = !twoFactorEnabled;
                    setTwoFactorEnabled(next);
                    showToast(next ? '2FA TOTP enabled.' : '2FA TOTP disabled.');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    twoFactorEnabled ? 'bg-[#0B0B0B]' : 'bg-[#D9DADC]'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Active Session Details */}
              <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]/70">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#0B0B0B]">Current Session</span>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-[#EEEEF0] rounded-full text-[#0B0B0B]">
                    30m Idle Timeout Active
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Laptop className="w-5 h-5 text-[#71717A] shrink-0" />
                  <div className="text-xs">
                    <div className="font-semibold text-[#0B0B0B]">Authenticated Browser Session</div>
                    <div className="text-[#71717A]">
                      Automatically locks and signs out after 30 minutes of inactivity (with a 60-second warning).
                    </div>
                  </div>
                </div>
              </div>

              {/* Session & Demo Data Controls */}
              <div className="p-4 rounded-2xl bg-white border border-[#E5E5EA]/70 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="px-4 py-2 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#0B0B0B] text-xs font-semibold hover:border-[#0B0B0B] transition-colors inline-flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out to Home
                </button>

                {confirmReset ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmReset}
                      className="px-4 py-2 rounded-full bg-[#EF4444] text-white text-xs font-semibold hover:bg-red-600 transition-colors"
                    >
                      Confirm Restore Defaults
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      className="px-3.5 py-2 rounded-full bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="px-4 py-2 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[#71717A] hover:text-[#0B0B0B] hover:border-[#0B0B0B] text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore Demo Data
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: SMS Wallet, Plan Capacity & Webhook Specs (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* SMS Credit Balance Card */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest">
                Arkesel SMS Wallet
              </span>
              <span className="px-2.5 py-1 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold tracking-wider">
                LIVE CARRIER
              </span>
            </div>

            {/* Big Metric & Circular Progress */}
            <div className="flex items-end justify-between p-4 rounded-2xl bg-white border border-[#E5E5EA]/70 mb-5">
              <div>
                <div className="font-display text-[32px] font-bold text-[#0B0B0B] tracking-[-0.02em] leading-none mb-1 tabular-nums">
                  {profile.smsCredits.toLocaleString()}
                </div>
                <div className="text-xs text-[#71717A]">SMS Credits Available</div>
              </div>

              <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-[#E8E8EA]"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                  />
                  <path
                    className="text-[#0B0B0B]"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray={strokeDasharray}
                    strokeLinecap="round"
                    strokeWidth="3.5"
                  />
                </svg>
                <span className="absolute text-[11px] font-bold text-[#0B0B0B] tabular-nums">
                  {smsPct}%
                </span>
              </div>
            </div>

            <div className="space-y-1.5 mb-5 text-xs text-[#71717A]">
              <div className="flex justify-between">
                <span>Allotment baseline:</span>
                <span className="font-mono text-[#0B0B0B] tabular-nums">
                  {smsBaseAllotment.toLocaleString()} Credits
                </span>
              </div>
              <div className="flex justify-between">
                <span>Active sender route:</span>
                <span className="font-mono text-[#0B0B0B]">{senderId}</span>
              </div>
              <div className="flex justify-between pt-0.5 text-[11px]">
                <span>GSM-7 standard rate:</span>
                <span>1 credit / 160 chars</span>
              </div>
            </div>

            {/* Quick Top Up Packages Selection */}
            <div className="space-y-2 mb-5">
              <div className="text-xs font-semibold text-[#0B0B0B] uppercase tracking-wider">
                Top-up Bundles (MoMo / Card)
              </div>
              {TOPUP_BUNDLES.map((b) => {
                const selected = selectedBundleId === b.id;
                return (
                  <label
                    key={b.id}
                    className={`flex items-center justify-between p-3.5 rounded-2xl bg-white cursor-pointer transition-all ${
                      selected ? 'ring-1 ring-[#0B0B0B]' : 'border border-[#E5E5EA]/70 hover:bg-[#F9F9FB]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="topup_pack"
                        checked={selected}
                        onChange={() => setSelectedBundleId(b.id)}
                        className="accent-[#0B0B0B] w-4 h-4"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#0B0B0B]">{b.label}</span>
                          {b.popular && (
                            <span className="px-2 py-0.5 rounded-full bg-[#0B0B0B] text-white text-[10px] font-semibold">
                              Popular
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#71717A]">{b.sub}</div>
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-xs text-[#0B0B0B] tabular-nums">
                      {b.priceGhs}
                    </span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleBuyBundle}
              className="w-full py-3 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <Wallet className="w-4 h-4" />
              <span>Buy SMS Credits (Paystack / MoMo)</span>
            </button>
          </section>

          {/* Plan Capacity & Database Limits */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest block">
                  Quota Tracker
                </span>
                <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                  Current Plan: {profile.plan === 'Starter' ? 'Free Tier' : profile.plan}
                </h2>
              </div>
              <span className="text-xs font-semibold px-3 py-1 bg-[#EEEEF0] rounded-full text-[#0B0B0B]">
                Active
              </span>
            </div>

            {/* Quota Progress Bars */}
            <div className="space-y-4 mb-5">
              <div className="p-3.5 rounded-2xl bg-white border border-[#E5E5EA]/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-[#0B0B0B]">Published Active Events</span>
                  <span className="font-mono font-semibold text-[#0B0B0B] tabular-nums">
                    {isFree ? `${Math.min(1, liveEventCount)} of 1 Maxed` : `${liveEventCount} / Unlimited`}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#E8E8EA] overflow-hidden">
                  <div
                    className="h-full bg-[#0B0B0B] rounded-full"
                    style={{ width: isFree ? '100%' : '35%' }}
                  />
                </div>
                <p className="text-[11px] text-[#71717A]">
                  {isFree
                    ? 'Free organizers can run 1 live registration page simultaneously.'
                    : 'Unlimited concurrent event registrations enabled.'}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white border border-[#E5E5EA]/70 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-[#0B0B0B]">Attendees Per Event Cap</span>
                  <span className="font-mono text-[#0B0B0B] tabular-nums">
                    {primaryRegistered} of {primaryCap} ({attendeeCapPct}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#E8E8EA] overflow-hidden">
                  <div
                    className="h-full bg-[#0B0B0B] rounded-full"
                    style={{ width: `${attendeeCapPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#71717A]">
                  {Math.max(0, primaryCap - primaryRegistered)} registrations remaining on{' '}
                  {primaryEvent?.title ?? 'featured event'}.
                </p>
              </div>
            </div>

            {/* Feature Capability Matrix */}
            <div className="space-y-1 mb-5">
              {[
                { label: 'Custom SMS Templates', locked: isFree, tag: 'Locked', okTag: 'Unlocked' },
                { label: 'Attendee CSV Export', locked: isFree, tag: 'Pro Feature', okTag: 'Unlimited' },
                { label: 'SMS Post-Event Thank-You', locked: isFree, tag: 'Pro Feature', okTag: 'Active' },
                {
                  label: 'Public Footer Watermark',
                  locked: false,
                  tag: isFree ? 'Included (Free)' : 'White-Labeled',
                  okTag: 'White-Labeled',
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between py-2 border-b last:border-b-0 border-[#E5E5EA] text-xs"
                >
                  <span className="text-[#71717A]">{row.label}</span>
                  <span
                    className={`flex items-center gap-1 font-semibold ${
                      row.locked ? 'text-[#71717A]' : 'text-[#0B0B0B]'
                    }`}
                  >
                    {row.locked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        {row.tag}
                      </>
                    ) : (
                      <>
                        {row.label !== 'Public Footer Watermark' && <Unlock className="w-3.5 h-3.5" />}
                        {isFree ? row.tag : row.okTag}
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Upgrade Callout Banner */}
            <div className="p-5 rounded-2xl bg-[#0B0B0B] text-white space-y-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span className="text-[11px] text-zinc-400 uppercase tracking-wider block">
                    {isFree ? 'Scale to Unlimited' : 'Subscription Active'}
                  </span>
                  <div className="font-display text-xl font-bold tracking-tight">
                    {isFree ? 'Upgrade to Pro' : 'Pro Organizer Active'}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-display text-[32px] font-bold font-mono leading-none tabular-nums">
                    $19
                  </span>
                  <span className="text-[11px] text-zinc-400 block">/ month</span>
                </div>
              </div>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                  <span>Unlimited active events &amp; unlimited attendees</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                  <span>Multiple Custom Sender IDs &amp; Full CSV Export</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                  <span>Remove all EventsApp platform watermarks</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={onOpenPlans}
                className="w-full mt-2 py-2.5 rounded-full bg-white text-[#0B0B0B] text-xs font-semibold hover:bg-[#EEEEF0] transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <span>{isFree ? 'Upgrade to Pro Now' : 'Manage Plan & Credits'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>

          {/* Developer & Arkesel Webhook Specifications */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 transition-all hover:bg-white hover:border hover:border-[#E5E5EA] hover:shadow-md border border-transparent">
            <div className="mb-3">
              <span className="text-[11px] font-medium text-[#71717A] uppercase tracking-widest block">
                API Integration
              </span>
              <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                Arkesel Delivery Webhook
              </h2>
            </div>
            <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
              Real-time DLR (Delivery Status Reports) are ingested via this verified HTTPS gateway
              hook.
            </p>
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-white border border-[#E5E5EA]/70 flex items-center justify-between gap-2 overflow-hidden">
                <span className="font-mono text-xs text-[#0B0B0B] truncate select-all">
                  https://api.eventsapp.africa/v1/arkesel-callback
                </span>
                <button
                  type="button"
                  onClick={handleCopyWebhook}
                  title="Copy endpoint"
                  className="p-1.5 rounded-xl bg-[#F5F5F7] text-[#0B0B0B] hover:bg-[#EEEEF0] transition-colors shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-[#71717A] font-mono">
                  Secret signing token: •••••••••••••{webhookSuffix}
                </span>
                <button
                  type="button"
                  onClick={handleRotateWebhook}
                  className="text-xs font-semibold text-[#0B0B0B] hover:underline"
                >
                  Rotate Token
                </button>
              </div>
            </div>
          </section>

          {/* Active Operational Alerts */}
          <section className="bg-[#F5F5F7] rounded-3xl p-6 border border-transparent">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#0B0B0B]">
                Active Operational Alerts ({unresolved.length})
              </h3>
              <ShieldCheck className="w-4 h-4 text-[#71717A]" />
            </div>
            {unresolved.length === 0 ? (
              <p className="text-xs text-[#71717A]">All operational alerts resolved.</p>
            ) : (
              <div className="space-y-2.5">
                {unresolved.map((a) => (
                  <div key={a.id} className="p-3 rounded-2xl bg-white border border-[#E5E5EA]">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#0B0B0B]">{a.title}</p>
                        <button
                          type="button"
                          onClick={() => onResolveAlert(a.id)}
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#0B0B0B] hover:underline"
                        >
                          <Check className="w-3 h-3" />
                          Mark Resolved
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
