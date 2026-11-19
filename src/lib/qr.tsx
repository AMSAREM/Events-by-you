import React from 'react';

const MATRIX_SIZE = 25;

function fnv1aHash(str: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function isFinderZone(r: number, c: number, size: number): boolean {
  const inTopLeft = r < 8 && c < 8;
  const inTopRight = r < 8 && c >= size - 8;
  const inBottomLeft = r >= size - 8 && c < 8;
  return inTopLeft || inTopRight || inBottomLeft;
}

function getFinderCell(r: number, c: number): boolean {
  if (r === 7 || c === 7) return false;
  if (r === 0 || r === 6 || c === 0 || c === 6) return true;
  if (r >= 2 && r <= 4 && c >= 2 && c <= 4) return true;
  return false;
}

function isAlignmentZone(r: number, c: number, size: number): boolean {
  const ar = size - 9;
  const ac = size - 9;
  return r >= ar && r < ar + 5 && c >= ac && c < ac + 5;
}

function getAlignmentCell(r: number, c: number, size: number): boolean {
  const dr = r - (size - 9);
  const dc = c - (size - 9);
  if (dr === 0 || dr === 4 || dc === 0 || dc === 4) return true;
  if (dr === 2 && dc === 2) return true;
  return false;
}

export function generateDeterministicQrMatrix(value: string): boolean[][] {
  const normalized = value.trim() || 'EVENTSBYU-PASS';
  const h1 = fnv1aHash(normalized, 0x811c9dc5);
  const h2 = fnv1aHash(normalized.split('').reverse().join(''), 0x9e3779b9);

  const matrix: boolean[][] = Array.from({ length: MATRIX_SIZE }, () =>
    Array<boolean>(MATRIX_SIZE).fill(false)
  );

  let state = (h1 ^ h2) || 0xabcdef01;
  const nextBit = (r: number, c: number): boolean => {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    const charCode = normalized.charCodeAt((r * MATRIX_SIZE + c) % normalized.length);
    return ((state + charCode + r * 7 + c * 13) & 1) === 1;
  };

  for (let r = 0; r < MATRIX_SIZE; r++) {
    for (let c = 0; c < MATRIX_SIZE; c++) {
      // Top-left finder
      if (r < 8 && c < 8) {
        matrix[r][c] = getFinderCell(r, c);
        continue;
      }
      // Top-right finder
      if (r < 8 && c >= MATRIX_SIZE - 8) {
        matrix[r][c] = getFinderCell(r, MATRIX_SIZE - 1 - c);
        continue;
      }
      // Bottom-left finder
      if (r >= MATRIX_SIZE - 8 && c < 8) {
        matrix[r][c] = getFinderCell(MATRIX_SIZE - 1 - r, c);
        continue;
      }
      // Timing tracks
      if (r === 6 && !isFinderZone(r, c, MATRIX_SIZE)) {
        matrix[r][c] = c % 2 === 0;
        continue;
      }
      if (c === 6 && !isFinderZone(r, c, MATRIX_SIZE)) {
        matrix[r][c] = r % 2 === 0;
        continue;
      }
      // Alignment square
      if (isAlignmentZone(r, c, MATRIX_SIZE)) {
        matrix[r][c] = getAlignmentCell(r, c, MATRIX_SIZE);
        continue;
      }
      matrix[r][c] = nextBit(r, c);
    }
  }

  return matrix;
}

export function buildQrSvgString(value: string, size = 240, fg = '#0B0B0B', bg = '#FFFFFF'): string {
  const matrix = generateDeterministicQrMatrix(value);
  const quiet = 2;
  const total = MATRIX_SIZE + quiet * 2;
  const rects: string[] = [];

  for (let r = 0; r < MATRIX_SIZE; r++) {
    for (let c = 0; c < MATRIX_SIZE; c++) {
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

export function buildEventInvitationUrl(slugOrId: string, tab?: 'checkin' | 'register'): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://www.eventsbyyou.xyz';
  const base = `${origin}/e/${clean}`;
  if (tab === 'checkin') return `${base}/checkin`;
  return tab ? `${base}?tab=${tab}` : base;
}

export function buildEventOgImageUrl(slugOrId: string): string {
  const clean = encodeURIComponent(slugOrId.trim());
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://www.eventsbyyou.xyz';
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
  const quiet = 2;
  const viewBoxSize = MATRIX_SIZE + quiet * 2;

  return (
    <svg
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
