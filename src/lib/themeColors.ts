import type { DesignTheme, EventItem } from '../types/events.ts';

export interface ThemePresetMeta {
  id: DesignTheme;
  label: string;
  description: string;
  surfaceBg: string;
  surfaceText: string;
  defaultBrandColor: string;
  swatchPreview: [string, string, string];
}

export const THEME_PRESETS: ThemePresetMeta[] = [
  {
    id: 'obsidian-gold',
    label: 'Obsidian Gold',
    description: 'Deep black & champagne gold',
    surfaceBg: '#09090B',
    surfaceText: '#FFFFFF',
    defaultBrandColor: '#D4AF37',
    swatchPreview: ['#09090B', '#D4AF37', '#FFFFFF'],
  },
  {
    id: 'editorial-ivory',
    label: 'Editorial Ivory',
    description: 'Warm parchment & espresso',
    surfaceBg: '#F6F1E9',
    surfaceText: '#161412',
    defaultBrandColor: '#6B4E3D',
    swatchPreview: ['#F6F1E9', '#6B4E3D', '#161412'],
  },
  {
    id: 'swiss-grid',
    label: 'Swiss Grid',
    description: 'Crisp monochrome contrast',
    surfaceBg: '#FFFFFF',
    surfaceText: '#0B0B0B',
    defaultBrandColor: '#0B0B0B',
    swatchPreview: ['#FFFFFF', '#0B0B0B', '#E5E5EA'],
  },
  {
    id: 'warm-monochrome',
    label: 'Monochrome',
    description: 'Charcoal slate & silver',
    surfaceBg: '#141416',
    surfaceText: '#FFFFFF',
    defaultBrandColor: '#52525B',
    swatchPreview: ['#141416', '#52525B', '#F4F4F5'],
  },
];

export const CURATED_BRAND_COLORS: { name: string; hex: string }[] = [
  { name: 'Obsidian', hex: '#0B0B0B' },
  { name: 'Royal Gold', hex: '#C59B27' },
  { name: 'Emerald', hex: '#0F766E' },
  { name: 'Crimson', hex: '#9F1239' },
  { name: 'Royal Indigo', hex: '#3730A3' },
  { name: 'Cobalt Blue', hex: '#1D4ED8' },
  { name: 'Terracotta', hex: '#C2410C' },
  { name: 'Imperial Plum', hex: '#6B21A8' },
  { name: 'Champagne', hex: '#A17C47' },
  { name: 'Forest', hex: '#166534' },
];

export function normalizeHexColor(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(prefixed)) {
    return prefixed.toUpperCase();
  }
  if (/^#[0-9A-Fa-f]{3}$/.test(prefixed)) {
    const r = prefixed[1];
    const g = prefixed[2];
    const b = prefixed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return undefined;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex) || '#0B0B0B';
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function getContrastTextColor(hex: string): '#FFFFFF' | '#0B0B0B' {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.36 ? '#0B0B0B' : '#FFFFFF';
}

export function getThemePresetMeta(theme?: DesignTheme): ThemePresetMeta {
  return THEME_PRESETS.find((t) => t.id === theme) ?? THEME_PRESETS[0];
}

export function resolveEventBrandColor(
  event?: Pick<EventItem, 'brandColor' | 'designTheme' | 'extraDataConfig'> | null
): string {
  const explicit =
    normalizeHexColor(event?.brandColor) ||
    normalizeHexColor(event?.extraDataConfig?.brandColor);
  if (explicit) return explicit;
  return getThemePresetMeta(event?.designTheme).defaultBrandColor;
}
