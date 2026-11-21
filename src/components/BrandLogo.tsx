import React, { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 36, className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const gradId = `eby-grad-${uid}`;
  const clipId = `eby-clip-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 block ${className}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#AEFC3B" />
          <stop offset="52%" stopColor="#7BF66E" />
          <stop offset="100%" stopColor="#48F09F" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M256 124C202.98 124 160 166.98 160 220C160 278.5 224.5 349.5 248.8 380.2C252.5 384.9 259.5 384.9 263.2 380.2C287.5 349.5 352 278.5 352 220C352 166.98 309.02 124 256 124Z" />
        </clipPath>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${gradId})`} />
      <g clipPath={`url(#${clipId})`}>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M256 124C202.98 124 160 166.98 160 220C160 278.5 224.5 349.5 248.8 380.2C252.5 384.9 259.5 384.9 263.2 380.2C287.5 349.5 352 278.5 352 220C352 166.98 309.02 124 256 124ZM256 262C232.8 262 214 243.2 214 220C214 196.8 232.8 178 256 178C279.2 178 298 196.8 298 220C298 243.2 279.2 262 256 262Z"
          fill="#0D3822"
        />
        <path
          d="M256 262C232.8 262 214 243.2 214 220C214 258 230 306 256 385C244 334 246 290 256 262Z"
          fill="#072214"
          fillOpacity="0.55"
        />
      </g>
    </svg>
  );
};

interface BrandLogoProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  subtitle?: string;
  subtitleClassName?: string;
  className?: string;
}

export const OFFICIAL_BRAND_LOGO_SRC =
  '/assets/aistudio/WhatsApp_Image_2026-11-21_at_18.27.46_55a48938.jpeg';

export const BrandOfficialBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`relative overflow-hidden rounded-2xl bg-[#133A25] border border-[#24593C] shadow-sm aspect-[16/5] ${className}`}
  >
    <img
      src={OFFICIAL_BRAND_LOGO_SRC}
      alt="Events By You (eventsbyyou.xyz) official brand logo"
      className="w-full h-full object-cover object-center scale-[1.24]"
    />
  </div>
);

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'light',
  size = 'md',
  subtitle,
  subtitleClassName = '',
  className = '',
}) => {
  const iconSize = size === 'sm' ? 30 : size === 'lg' ? 40 : 34;
  const wordSize =
    size === 'sm'
      ? 'text-[15px]'
      : size === 'lg'
        ? 'text-[20px]'
        : 'text-[17px]';
  const xyzSize =
    size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]';

  const primaryTextColor = variant === 'dark' ? 'text-white' : 'text-[#0D3822]';
  const secondaryTextColor = variant === 'dark' ? 'text-white/90' : 'text-[#1A1C1D]/80';
  const xyzColor = variant === 'dark' ? 'text-[#7AF750]' : 'text-[#16A34A]';

  return (
    <div className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      <BrandMark size={iconSize} className="shadow-[0_2px_8px_rgba(13,56,34,0.16)]" />
      <div className="flex flex-col min-w-0">
        <div className={`relative inline-flex items-baseline font-display tracking-[-0.03em] leading-none whitespace-nowrap ${wordSize}`}>
          <span className={`font-bold ${primaryTextColor}`}>events</span>
          <span className={`font-normal ${secondaryTextColor}`}>byyou</span>
          <sup
            className={`ml-0.5 font-semibold tracking-normal leading-none -top-[0.45em] ${xyzSize} ${xyzColor}`}
          >
            .xyz
          </sup>
        </div>
        {subtitle && (
          <span className={`text-[11px] font-medium whitespace-nowrap mt-0.5 truncate ${subtitleClassName}`}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
