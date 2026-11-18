import React, { useState } from 'react';
import { ArtworkVariant, VelocityPoint } from '../types/events';

interface PosterProps {
  variant: ArtworkVariant;
  className?: string;
}

export const MonochromePoster: React.FC<PosterProps> = ({ variant, className = 'w-14 h-14' }) => {
  return (
    <div
      className={`relative overflow-hidden bg-[#0B0B0B] text-white flex items-center justify-center shrink-0 select-none ${className}`}
      aria-hidden="true"
    >
      {variant === 'forum' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#0B0B0B" />
          <circle cx="40" cy="40" r="24" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="40" cy="40" r="14" fill="none" stroke="#71717A" strokeWidth="1" />
          <line x1="8" y1="40" x2="72" y2="40" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="40" cy="40" r="4" fill="#FFFFFF" />
        </svg>
      )}
      {variant === 'sound' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#18181B" />
          {[14, 24, 34, 44, 54, 64].map((x, idx) => {
            const heights = [18, 36, 48, 28, 42, 22];
            const h = heights[idx];
            return (
              <rect
                key={x}
                x={x}
                y={(80 - h) / 2}
                width="4"
                height={h}
                rx="2"
                fill={idx === 2 ? '#FFFFFF' : '#A1A1AA'}
              />
            );
          })}
        </svg>
      )}
      {variant === 'architecture' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#0B0B0B" />
          <path d="M12 66 L12 28 L34 14 L34 66 Z" fill="#FFFFFF" />
          <path d="M38 66 L38 22 L68 34 L68 66 Z" fill="#52525B" />
          <line x1="8" y1="66" x2="72" y2="66" stroke="#FFFFFF" strokeWidth="1.5" />
        </svg>
      )}
      {variant === 'hardware' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#141416" />
          <rect x="18" y="18" width="44" height="44" rx="8" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
          <rect x="28" y="28" width="24" height="24" rx="4" fill="#FFFFFF" />
          <circle cx="40" cy="40" r="4" fill="#0B0B0B" />
        </svg>
      )}
      {variant === 'typography' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#0B0B0B" />
          <line x1="16" y1="20" x2="64" y2="20" stroke="#52525B" strokeWidth="1" />
          <line x1="16" y1="40" x2="64" y2="40" stroke="#52525B" strokeWidth="1" />
          <line x1="16" y1="60" x2="64" y2="60" stroke="#52525B" strokeWidth="1" />
          <text x="20" y="52" fill="#FFFFFF" fontSize="34" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">
            Aa
          </text>
        </svg>
      )}
      {variant === 'spatial' && (
        <svg viewBox="0 0 80 80" className="w-full h-full">
          <rect width="80" height="80" fill="#18181B" />
          <ellipse cx="40" cy="40" rx="28" ry="12" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
          <ellipse cx="40" cy="40" rx="12" ry="28" fill="none" stroke="#71717A" strokeWidth="1.5" />
          <circle cx="40" cy="40" r="3.5" fill="#FFFFFF" />
        </svg>
      )}
    </div>
  );
};

interface CircularGaugeProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  alertThreshold?: number;
  label?: string;
}

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  value,
  size = 52,
  strokeWidth = 4.5,
  alertThreshold = 90,
  label,
}) => {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const isAlert = clamped >= alertThreshold;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E5E5EA"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isAlert ? '#EF4444' : '#0B0B0B'}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-300"
        />
      </svg>
      <span
        className={`absolute text-[11px] font-semibold tabular-nums ${
          isAlert ? 'text-[#EF4444]' : 'text-[#0B0B0B]'
        }`}
      >
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
};

interface SplineChartProps {
  data: VelocityPoint[];
  height?: number;
  showSecondary?: boolean;
}

export const SplineChart: React.FC<SplineChartProps> = ({
  data,
  height = 148,
  showSecondary = false,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(data.length - 1);

  if (data.length === 0) return null;

  const width = 320;
  const padX = 18;
  const padTop = 18;
  const padBottom = 26;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(...data.map((d) => Math.max(d.registrations, d.checkIns))) * 1.15;
  const minVal = 0;

  const getCoords = (val: number, idx: number) => {
    const x = data.length === 1 ? width / 2 : padX + (idx / (data.length - 1)) * plotW;
    const y = padTop + plotH - ((val - minVal) / (maxVal - minVal || 1)) * plotH;
    return { x, y };
  };

  const buildSmoothPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpX = (p0.x + p1.x) / 2;
      d += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const primaryPoints = data.map((d, i) => getCoords(d.registrations, i));
  const secondaryPoints = data.map((d, i) => getCoords(d.checkIns, i));
  const primaryPath = buildSmoothPath(primaryPoints);
  const secondaryPath = buildSmoothPath(secondaryPoints);

  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : data[data.length - 1];
  const activeIdx = hoveredIdx !== null ? hoveredIdx : data.length - 1;

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-2xl font-bold tracking-tight text-[#0B0B0B] tabular-nums">
            {activePoint.registrations.toLocaleString()}
          </span>
          <span className="ml-2 text-xs text-[#71717A] tabular-nums">
            registrations · {activePoint.label}
          </span>
        </div>
        <span className="text-xs font-mono text-[#71717A] tabular-nums">
          ${activePoint.revenue.toLocaleString()}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible select-none"
        role="img"
        aria-label="Registration velocity spline chart"
      >
        {/* Subtle horizontal reference grid lines */}
        {[0.25, 0.6, 0.95].map((ratio) => {
          const y = padTop + plotH * ratio;
          return (
            <line
              key={ratio}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="#E5E5EA"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}

        {showSecondary && (
          <path
            d={secondaryPath}
            fill="none"
            stroke="#A1A1AA"
            strokeWidth="1.75"
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        )}

        <path
          d={primaryPath}
          fill="none"
          stroke="#0B0B0B"
          strokeWidth="2.25"
          strokeLinecap="round"
        />

        {primaryPoints.map((pt, idx) => {
          const isActive = idx === activeIdx;
          return (
            <g key={data[idx].label}>
              {/* Vertical guide for active point */}
              {isActive && (
                <line
                  x1={pt.x}
                  x2={pt.x}
                  y1={pt.y + 5}
                  y2={height - padBottom + 2}
                  stroke="#0B0B0B"
                  strokeOpacity="0.2"
                  strokeWidth="1"
                />
              )}

              {/* X-axis label */}
              <text
                x={pt.x}
                y={height - 6}
                textAnchor="middle"
                className="text-[10px] font-medium tabular-nums"
                fill={isActive ? '#0B0B0B' : '#71717A'}
              >
                {data[idx].label}
              </text>

              {/* Anchor circle */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isActive ? 4.5 : 3.25}
                fill={isActive ? '#0B0B0B' : '#FFFFFF'}
                stroke="#0B0B0B"
                strokeWidth="2"
                className="transition-all duration-150"
              />

              {/* Hit target for pointer hover & keyboard focus */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={16}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
                onClick={() => setHoveredIdx(idx)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};
