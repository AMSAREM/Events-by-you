import { useCallback, useEffect, useState } from 'react';

export function useDocumentFullscreen(): {
  isFullscreen: boolean;
  canFullscreen: boolean;
  toggleFullscreen: () => void;
} {
  const [nativeFullscreen, setNativeFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(document.fullscreenElement);
  });
  const [appFullscreen, setAppFullscreen] = useState<boolean>(false);

  const canFullscreen =
    typeof document !== 'undefined' &&
    Boolean(document.fullscreenEnabled || document.documentElement?.requestFullscreen);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = Boolean(document.fullscreenElement);
      setNativeFullscreen(active);
      if (!active) {
        setAppFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const isFullscreen = nativeFullscreen || appFullscreen;

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') {
      setAppFullscreen((prev) => !prev);
      return;
    }
    if (document.fullscreenElement) {
      setAppFullscreen(false);
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (appFullscreen) {
      setAppFullscreen(false);
      return;
    }
    const target = document.documentElement;
    if (target?.requestFullscreen) {
      target
        .requestFullscreen()
        .then(() => {
          setNativeFullscreen(true);
        })
        .catch(() => {
          // Browsers or sandboxed iframes may block native fullscreen API; activate in-app fullscreen mode
          setAppFullscreen(true);
        });
      return;
    }
    setAppFullscreen(true);
  }, [appFullscreen]);

  return { isFullscreen, canFullscreen, toggleFullscreen };
}
