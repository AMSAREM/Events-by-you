import React, { useEffect, useState } from 'react';
import { Check, Palette, RotateCcw } from 'lucide-react';
import type { DesignTheme } from '../types/events';
import {
  CURATED_BRAND_COLORS,
  THEME_PRESETS,
  getContrastTextColor,
  getThemePresetMeta,
  hexWithAlpha,
  normalizeHexColor,
} from '../lib/themeColors';

interface ThemeColorPickerProps {
  designTheme: DesignTheme;
  brandColor?: string;
  onChangeTheme: (theme: DesignTheme) => void;
  onChangeBrandColor: (color: string | undefined) => void;
  compact?: boolean;
  title?: string;
}

export const ThemeColorPicker: React.FC<ThemeColorPickerProps> = ({
  designTheme,
  brandColor,
  onChangeTheme,
  onChangeBrandColor,
  compact = false,
  title = 'Event Theme & Brand Colors',
}) => {
  const activePreset = getThemePresetMeta(designTheme);
  const resolvedBrand = normalizeHexColor(brandColor) || activePreset.defaultBrandColor;
  const contrastText = getContrastTextColor(resolvedBrand);
  const [hexDraft, setHexDraft] = useState(resolvedBrand);

  useEffect(() => {
    setHexDraft(resolvedBrand);
  }, [resolvedBrand]);

  const handleHexInputChange = (val: string) => {
    setHexDraft(val);
    const normalized = normalizeHexColor(val);
    if (normalized) {
      onChangeBrandColor(normalized);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#0B0B0B]" />
          <span className="text-xs font-semibold text-[#0B0B0B]">{title}</span>
        </div>
        {brandColor && (
          <button
            type="button"
            onClick={() => onChangeBrandColor(undefined)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#71717A] hover:text-[#0B0B0B] transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset to {activePreset.label}</span>
          </button>
        )}
      </div>

      {/* 1. Editorial Layout Theme Presets */}
      <div className={`grid grid-cols-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-4'} gap-2`}>
        {THEME_PRESETS.map((preset) => {
          const isSelected = designTheme === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChangeTheme(preset.id)}
              className={`p-2.5 rounded-2xl border text-left transition-all flex flex-col gap-2 ${
                isSelected
                  ? 'border-[#0B0B0B] bg-white ring-2 ring-[#0B0B0B]/15 shadow-sm'
                  : 'border-[#E5E5EA] bg-white hover:border-[#0B0B0B]/50'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center -space-x-1">
                  {preset.swatchPreview.map((swatch, idx) => (
                    <span
                      key={idx}
                      className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </div>
                {isSelected && (
                  <span className="w-4 h-4 rounded-full bg-[#0B0B0B] text-white flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-[#0B0B0B] block truncate">
                  {preset.label}
                </span>
                {!compact && (
                  <span className="text-[10px] text-[#71717A] block truncate">
                    {preset.description}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 2. Brand Accent Color Swatches + Custom Color Wheel */}
      <div className="p-3.5 rounded-2xl bg-white border border-[#E5E5EA] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-semibold text-[#0B0B0B] block">
              Primary Event Brand Color
            </span>
            <span className="text-[10px] text-[#71717A]">
              Applied to RSVP CTA buttons, flyer badges, occupancy bar, and share cards
            </span>
          </div>

          {/* Native Color Wheel + Hex Field */}
          <div className="flex items-center gap-2">
            <label
              className="relative flex items-center gap-1.5 px-2.5 h-8 rounded-full border border-[#E5E5EA] hover:border-[#0B0B0B] cursor-pointer bg-[#F5F5F7] transition-colors"
              title="Open full color picker"
            >
              <input
                type="color"
                value={resolvedBrand}
                onChange={(e) => {
                  const next = normalizeHexColor(e.target.value);
                  if (next) {
                    setHexDraft(next);
                    onChangeBrandColor(next);
                  }
                }}
                aria-label="Choose custom brand color"
                className="w-5 h-5 rounded-full border-0 p-0 bg-transparent cursor-pointer"
              />
              <span className="text-[11px] font-semibold text-[#0B0B0B]">Pick Color</span>
            </label>
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => handleHexInputChange(e.target.value)}
              maxLength={7}
              aria-label="Brand hex color"
              placeholder="#0B0B0B"
              className="w-22 h-8 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] focus:border-[#0B0B0B] focus:outline-none text-[11px] font-mono font-semibold text-[#0B0B0B] uppercase text-center"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {CURATED_BRAND_COLORS.map((swatch) => {
            const active = resolvedBrand === swatch.hex;
            const checkColor = getContrastTextColor(swatch.hex);
            return (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => onChangeBrandColor(swatch.hex)}
                title={`${swatch.name} (${swatch.hex})`}
                aria-label={`${swatch.name} ${swatch.hex}`}
                className={`group relative w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center border ${
                  active ? 'ring-2 ring-offset-2 ring-[#0B0B0B] border-transparent scale-105' : 'border-black/15'
                }`}
                style={{ backgroundColor: swatch.hex, color: checkColor }}
              >
                {active && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>

        {/* Live Brand Preview Strip */}
        {!compact && (
          <div
            className="rounded-xl p-3 border flex flex-wrap items-center justify-between gap-2"
            style={{
              backgroundColor: activePreset.surfaceBg,
              color: activePreset.surfaceText,
              borderColor: hexWithAlpha(resolvedBrand, 0.35),
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0"
                style={{ backgroundColor: resolvedBrand, color: contrastText }}
              >
                Live Preview
              </span>
              <span className="text-[11px] font-medium truncate opacity-85">
                {activePreset.label} · {resolvedBrand}
              </span>
            </div>
            <span
              className="px-3 py-1 rounded-full text-[11px] font-bold shrink-0"
              style={{ backgroundColor: resolvedBrand, color: contrastText }}
            >
              Claim Pass →
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
