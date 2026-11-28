import React from 'react';
import QRCode from 'qrcode';

export function generateDeterministicQrMatrix(value: string): boolean[][] {
  const normalized = value.trim() || 'EVENTSBYU-PASS';
  let qr: ReturnType<typeof QRCode.create>;
  try {
    qr = QRCode.create(normalized, { errorCorrectionLevel: 'M' });
  } catch {
    qr = QRCode.create(normalized.slice(0, 1024) || 'EVENTSBYU-PASS', {
      errorCorrectionLevel: 'L',
    });
  }

  const size = qr.modules.size;
  const data = qr.modules.data;
  const matrix: boolean[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => Boolean(data[r * size + c]))
  );
  return matrix;
}

export function buildQrSvgString(value: string, size = 240, fg = '#0B0B0B', bg = '#FFFFFF'): string {
  const matrix = generateDeterministicQrMatrix(value);
  const moduleCount = matrix.length;
  const quiet = 4;
  const total = moduleCount + quiet * 2;
  const rects: string[] = [];

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" />`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><g fill="${fg}">${rects.join('')}</g></svg>`;
}

export function downloadQrSvg(value: string, filename = 'event-gate-pass-qr.svg'): void {
  if (typeof window === 'undefined') return;
  const svg = buildQrSvgString(value, 600);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function buildEventInvitationUrl(
  slugOrId: string,
  tab?: 'checkin' | 'walkin' | 'register' | 'gifts' | 'polls' | 'program'
): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz';
  const base = `${origin}/e/${clean}`;
  if (tab === 'checkin') return `${base}/checkin`;
  if (tab === 'walkin') return `${base}/walkin`;
  if (tab === 'gifts') return `${base}/gifts`;
  if (tab === 'polls') return `${base}/polls`;
  if (tab === 'program') return `${base}/program`;
  return tab ? `${base}?tab=${tab}` : base;
}

export function buildEventProgramUrl(
  slugOrId: string,
  originOverride?: string
): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    originOverride?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz');
  return `${origin}/e/${clean}/program`;
}

export function buildWalkInRegistrationUrl(slugOrId: string): string {
  return buildEventInvitationUrl(slugOrId, 'walkin');
}

export function extractPassLookupToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Handle URLs like https://.../e/slug/checkin?pass=EV-8801 or ?code=...
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?')) {
    try {
      const parsed = new URL(trimmed, 'https://eventsbyyou.xyz');
      const fromQuery =
        parsed.searchParams.get('pass')?.trim() ||
        parsed.searchParams.get('code')?.trim() ||
        parsed.searchParams.get('ticket')?.trim();
      if (fromQuery) return fromQuery;
    } catch {
      // Fall through to pipe / raw handling
    }
  }

  // Handle attendee personal pass QR format: `${ticketCode}|${slug}|${phone}`
  if (trimmed.includes('|')) {
    const firstPart = trimmed.split('|')[0]?.trim();
    if (firstPart) return firstPart;
  }

  return trimmed;
}

export function isEventInvitationOrWalkInUrl(
  raw: string
): { type: 'checkin' | 'walkin' | 'event'; slug?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/e/')) return null;
  try {
    const parsed = new URL(trimmed, 'https://eventsbyyou.xyz');
    if (parsed.searchParams.get('pass') || parsed.searchParams.get('code')) {
      return null;
    }
    const match = parsed.pathname.match(/^\/e\/([^/]+)(?:\/(checkin|walk-?in))?\/?$/i);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]);
    const sub = (match[2] || '').toLowerCase();
    if (sub === 'checkin') return { type: 'checkin', slug };
    if (sub === 'walkin' || sub === 'walk-in') return { type: 'walkin', slug };
    return { type: 'event', slug };
  } catch {
    return null;
  }
}

export function buildGiftDeskUrl(slugOrId: string, deskToken: string): string {
  const base = buildEventInvitationUrl(slugOrId, 'gifts');
  const cleanToken = deskToken.trim();
  return cleanToken ? `${base}?desk=${encodeURIComponent(cleanToken)}` : base;
}

export function buildEventCameraUrl(
  slugOrId: string,
  guestName?: string,
  originOverride?: string
): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    originOverride?.replace(/\/+$/, '') ||
    (typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz');
  const base = `${origin}/e/${clean}/camera`;
  const trimmedGuest = guestName?.trim();
  return trimmedGuest ? `${base}?guest=${encodeURIComponent(trimmedGuest)}` : base;
}

export function buildEventOgImageUrl(slugOrId: string): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://eventsbyyou.xyz';
  return `${origin}/api/og/event/${clean}`;
}

interface DeterministicQrSvgProps {
  value: string;
  size?: number;
  className?: string;
  fgColor?: string;
  bgColor?: string;
  label?: string;
}

export const DeterministicQrSvg: React.FC<DeterministicQrSvgProps> = ({
  value,
  size = 160,
  className = '',
  fgColor = '#0B0B0B',
  bgColor = '#FFFFFF',
  label,
}) => {
  const matrix = React.useMemo(() => generateDeterministicQrMatrix(value), [value]);
  const moduleCount = matrix.length;
  const quiet = 4;
  const viewBoxSize = moduleCount + quiet * 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label || `QR pass for ${value}`}
      className={className}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill={bgColor} />
      <g fill={fgColor}>
        {matrix.map((row, r) =>
          row.map((filled, c) =>
            filled ? (
              <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} />
            ) : null
          )
        )}
      </g>
    </svg>
  );
};
