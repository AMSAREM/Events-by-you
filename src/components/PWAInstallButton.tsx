import React, { useState } from 'react';
import { Check, Download, Share, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { BrandMark } from './BrandLogo';

type InstallButtonVariant =
  | 'header-dark'
  | 'header-light'
  | 'hero'
  | 'rail'
  | 'menu-row'
  | 'card';

interface PWAInstallButtonProps {
  variant?: InstallButtonVariant;
  label?: string;
  className?: string;
  onActionComplete?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header-dark',
  label = 'Install App',
  className = '',
  onActionComplete,
}) => {
  const { isInstallable, isInstalled, isIOS, isInstalling, install } = usePWAInstall();
  const [showFallbackGuide, setShowFallbackGuide] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result === 'accepted') {
        setJustInstalled(true);
        onActionComplete?.();
        return;
      }
      if (result === 'dismissed') {
        return;
      }
    }
    setShowFallbackGuide(true);
  };

  const renderTrigger = () => {
    if (variant === 'rail') {
      return (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          disabled={isInstalling}
          aria-label={label}
          title={isInstallable ? 'Install Events By You on device' : 'How to install Events By You'}
          className={`w-9 h-9 lg:w-10 lg:h-10 xl:w-11 xl:h-11 rounded-full flex items-center justify-center bg-white/12 text-white hover:bg-white hover:text-[#0B0B0B] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60 ${className}`}
        >
          {justInstalled ? (
            <Check className="w-[18px] h-[18px]" />
          ) : (
            <Download className="w-[18px] h-[18px]" />
          )}
        </button>
      );
    }

    if (variant === 'menu-row') {
      return (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          disabled={isInstalling}
          className={`w-full flex items-center gap-3 p-3 rounded-2xl bg-white/10 hover:bg-white/18 text-white text-left transition-colors ${className}`}
        >
          <div className="w-8 h-8 rounded-xl bg-white text-[#0B0B0B] flex items-center justify-center shrink-0">
            <Download className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-tight">{label}</p>
            <p className="text-[10px] text-zinc-400 truncate">
              {isInstallable ? 'One-tap native install ready' : 'Add to Home Screen'}
            </p>
          </div>
        </button>
      );
    }

    if (variant === 'card') {
      return (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          disabled={isInstalling}
          className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#0B0B0B] text-white hover:bg-zinc-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${className}`}
        >
          <Download className="w-4 h-4" />
          <span>{isInstalling ? 'Installing...' : label}</span>
        </button>
      );
    }

    if (variant === 'hero') {
      return (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          disabled={isInstalling}
          className={`inline-flex items-center justify-center gap-2 bg-white/14 hover:bg-white/24 text-white border border-white/25 backdrop-blur-md text-xs font-bold px-5 py-3.5 rounded-full transition-all whitespace-nowrap shrink-0 disabled:opacity-60 ${className}`}
        >
          <Download className="w-4 h-4" />
          <span>{isInstalling ? 'Opening Install...' : label}</span>
        </button>
      );
    }

    if (variant === 'header-light') {
      return (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          disabled={isInstalling}
          aria-label={label}
          title={isInstallable ? 'Install Events By You instantly' : 'Install Events By You'}
          className={`inline-flex items-center justify-center gap-1.5 h-9 w-9 xl:w-auto xl:px-3.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${className}`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden xl:inline">{isInstalling ? 'Installing...' : label}</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => void handleInstallClick()}
        disabled={isInstalling}
        title={isInstallable ? 'Install Events By You instantly' : 'Install Events By You'}
        className={`inline-flex items-center justify-center gap-1.5 bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[#0B0B0B] text-xs font-semibold px-3 sm:px-3.5 py-2 rounded-full transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${className}`}
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{isInstalling ? 'Installing...' : label}</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  };

  return (
    <>
      {renderTrigger()}

      {showFallbackGuide && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E5E5EA] p-6 shadow-2xl text-[#0B0B0B]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandMark size={40} className="shadow-sm" />
                <div>
                  <h3 id="pwa-install-guide-title" className="text-base font-bold tracking-tight">
                    Install Events By You
                  </h3>
                  <p className="text-[11px] text-[#71717A]">
                    Offline-ready gate scanner &amp; studio shortcut
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFallbackGuide(false)}
                aria-label="Close install instructions"
                className="w-8 h-8 rounded-full border border-[#E5E5EA] flex items-center justify-center text-[#71717A] hover:text-[#0B0B0B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-4 space-y-2.5 text-xs text-[#444748]">
                <li className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F5F5F7]">
                  <span className="w-5 h-5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    Tap the{' '}
                    <strong className="inline-flex items-center gap-1 text-[#0B0B0B]">
                      <Share className="w-3.5 h-3.5" /> Share
                    </strong>{' '}
                    button in your Safari toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F5F5F7]">
                  <span className="w-5 h-5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Scroll down and select <strong className="text-[#0B0B0B]">Add to Home Screen</strong>.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2.5 text-xs text-[#444748]">
                <li className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F5F5F7]">
                  <span className="w-5 h-5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    If viewing inside an embedded preview frame, open the app directly in Chrome,
                    Edge, or Android Chrome on its main tab.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F5F5F7]">
                  <span className="w-5 h-5 rounded-full bg-[#0B0B0B] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Click the <strong className="text-[#0B0B0B]">Install App</strong> icon in the
                    address bar or browser menu (<strong className="text-[#0B0B0B]">⋮ → Install Events By You</strong>).
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowFallbackGuide(false)}
              className="mt-5 w-full py-2.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[70] flex items-center gap-2 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>Offline Mode — Cached event passes remain ready</span>
    </div>
  );
};
