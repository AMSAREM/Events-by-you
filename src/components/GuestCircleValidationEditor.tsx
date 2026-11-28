import React, { useState } from 'react';
import { Check, Layers, Lock, Plus, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { EventValidationConfig } from '../types/events';
import { getCategoryPreset } from '../data/initialData';

interface GuestCircleValidationEditorProps {
  category: string;
  value: EventValidationConfig;
  onChange: (next: EventValidationConfig) => void;
  programSections?: string[];
  compact?: boolean;
}

export const GuestCircleValidationEditor: React.FC<GuestCircleValidationEditorProps> = ({
  category,
  value,
  onChange,
  programSections = [],
  compact = false,
}) => {
  const [newOption, setNewOption] = useState('');
  const includeProgramSections = value.includeProgramSections !== false;
  const displayStyle = value.displayStyle === 'buttons' ? 'buttons' : 'dropdown';

  const addOptions = (incoming: string[]) => {
    const existingLower = new Set(value.options.map((o) => o.trim().toLowerCase()));
    const additions = incoming
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !existingLower.has(item.toLowerCase()));
    if (additions.length === 0) return;
    onChange({
      ...value,
      options: [...value.options, ...additions],
    });
  };

  const handleAddSingle = () => {
    if (!newOption.trim()) return;
    const parts = newOption
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    addOptions(parts);
    setNewOption('');
  };

  const removeOption = (opt: string) => {
    onChange({
      ...value,
      options: value.options.filter((item) => item !== opt),
    });
  };

  const resetDefaults = () => {
    const preset = getCategoryPreset(category).validationConfig;
    onChange({
      ...value,
      label: preset.label,
      options: [...preset.options],
    });
  };

  const unmergedSections = programSections.filter(
    (sec) => !value.options.some((o) => o.trim().toLowerCase() === sec.trim().toLowerCase())
  );

  return (
    <div className={`${compact ? 'p-4' : 'p-4 sm:p-5'} rounded-2xl bg-white space-y-3.5 border border-[#E5E5EA]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#0B0B0B] shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-[#0B0B0B]">
              Guest Circle, Table &amp; Section Validation
            </p>
            <p className="text-[11px] text-[#71717A] leading-relaxed">
              Guests select their family circle, table, or program section during check-in &amp; QR pass registration.
            </p>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            className="w-4 h-4 accent-[#0B0B0B]"
          />
          <span className="text-[11px] font-semibold text-[#0B0B0B]">
            {value.enabled ? 'Active' : 'Off'}
          </span>
        </label>
      </div>

      {value.enabled && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                Validation Section Title
              </label>
              <input
                type="text"
                value={value.label}
                onChange={(e) => onChange({ ...value, label: e.target.value })}
                placeholder="Guest Circle & Table Validation"
                className="w-full h-10 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-medium text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#0B0B0B] mb-1">
                Public Form Style
              </label>
              <select
                value={displayStyle}
                onChange={(e) =>
                  onChange({
                    ...value,
                    displayStyle: e.target.value === 'buttons' ? 'buttons' : 'dropdown',
                  })
                }
                aria-label="Validation input display style"
                className="w-full h-10 px-3 rounded-xl bg-[#F5F5F7] text-xs font-semibold text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none cursor-pointer"
              >
                <option value="dropdown">Dropdown Menu</option>
                <option value="buttons">Quick Buttons</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[11px] font-semibold text-[#0B0B0B] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeProgramSections}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      includeProgramSections: e.target.checked,
                    })
                  }
                  className="w-3.5 h-3.5 accent-[#0B0B0B]"
                />
                <Layers className="w-3.5 h-3.5 text-[#0B0B0B]" />
                <span>Auto-include created Program Sections in validation dropdown</span>
              </label>
              {unmergedSections.length > 0 && (
                <button
                  type="button"
                  onClick={() => addOptions(unmergedSections)}
                  className="px-2.5 py-1 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-[10px] font-semibold text-[#0B0B0B] inline-flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>+ Copy {unmergedSections.length} Section{unmergedSections.length === 1 ? '' : 's'} into List</span>
                </button>
              )}
            </div>
            {programSections.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-[#71717A] mr-1">
                  {includeProgramSections ? 'Synced live into dropdown:' : 'Detected sections:'}
                </span>
                {programSections.map((sec) => (
                  <span
                    key={sec}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white border border-[#E5E5EA] text-[10px] font-semibold text-[#0B0B0B]"
                  >
                    <Layers className="w-2.5 h-2.5 text-[#71717A]" />
                    {sec}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[#71717A]">
                Any sections created in Program Schedule or imported outlines will run straight into this validation dropdown automatically.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#0B0B0B] tabular-nums">
                Circles &amp; Tables ({value.options.length})
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    addOptions(['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5'])
                  }
                  className="px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[10px] font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap"
                >
                  + Tables 1–5
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addOptions(['Table 6', 'Table 7', 'Table 8', 'Table 9', 'Table 10'])
                  }
                  className="px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[10px] font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap"
                >
                  + Tables 6–10
                </button>
                <button
                  type="button"
                  onClick={() => addOptions(['High Table / VIP'])}
                  className="px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[10px] font-semibold text-[#0B0B0B] transition-colors whitespace-nowrap"
                >
                  + High Table
                </button>
                <button
                  type="button"
                  onClick={resetDefaults}
                  className="px-2.5 py-1 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[10px] font-semibold text-[#71717A] hover:text-[#0B0B0B] inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {value.options.length === 0 ? (
                <p className="text-[11px] text-[#71717A]">
                  No circles or tables added yet. Add circles or quick tables above.
                </p>
              ) : (
                value.options.map((opt) => (
                  <span
                    key={opt}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-semibold text-[#0B0B0B]"
                  >
                    <span>{opt}</span>
                    <button
                      type="button"
                      onClick={() => removeOption(opt)}
                      aria-label={`Remove ${opt}`}
                      className="text-[#71717A] hover:text-[#EF4444] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSingle();
                  }
                }}
                placeholder="Add circle or table (e.g. Table 11, Diaspora Friends)"
                className="flex-1 h-9 px-3.5 rounded-full bg-[#F5F5F7] text-xs text-[#0B0B0B] placeholder:text-[#71717A] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddSingle}
                className="px-3.5 h-9 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-neutral-800 transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          <div className="pt-1 border-t border-[#E5E5EA] space-y-2">
            <label className="flex items-center gap-2 text-xs text-[#0B0B0B] cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(value.requireInviteCode)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    requireInviteCode: e.target.checked,
                    inviteCode: value.inviteCode || 'GUEST2026',
                  })
                }
                className="w-4 h-4 accent-[#0B0B0B]"
              />
              <Lock className="w-3.5 h-3.5 text-[#71717A]" />
              <span>
                Require private invitation passcode ({value.inviteCode?.trim() || 'GUEST2026'})
              </span>
            </label>

            {value.requireInviteCode && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={value.inviteCode ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      inviteCode: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="GUEST2026"
                  className="flex-1 h-9 px-3.5 rounded-xl bg-[#F5F5F7] text-xs font-mono uppercase text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                />
                {value.inviteCode?.trim() && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
                    <Check className="w-3.5 h-3.5" />
                    Active
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
