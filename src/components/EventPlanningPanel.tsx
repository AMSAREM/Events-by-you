import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { EVENT_CATEGORIES } from '../data/initialData';
import {
  formatEventDateSpan,
  formatIsoDateShort,
  getEventDateSlots,
  sanitizeIsoDate,
} from '../lib/eventDates';
import {
  computeEventReadiness,
  formatPlanningMoney,
  mergeStarterPlanningTemplate,
  PLANNING_BUDGET_CATEGORIES,
  PLANNING_PHASES,
  PLANNING_ROLE_SUGGESTIONS,
} from '../lib/planningTemplates';
import type {
  EventItem,
  EventPlanningConfig,
  PlanningBudgetCategory,
  PlanningBudgetItem,
  PlanningBudgetStatus,
  PlanningPriority,
  PlanningTask,
  PlanningTaskPhase,
  PlanningTeamRole,
  PlanningVendor,
  PlanningVendorStatus,
} from '../types/events';

type PlanningSubTab = 'checklist' | 'budget' | 'vendors' | 'team';

interface EventPlanningPanelProps {
  event: EventItem;
  organizerName: string;
  onUpdateEvent?: (updated: EventItem) => Promise<void> | void;
  onSavePlanning?: (eventId: string, planningConfig: EventPlanningConfig) => Promise<void> | void;
  canEdit?: boolean;
  onOpenEventWorkspace?: () => void;
}

const VENDOR_STATUS_LABELS: Record<PlanningVendorStatus, string> = {
  sourcing: 'Sourcing',
  quoted: 'Quoted',
  confirmed: 'Confirmed',
  paid: 'Paid',
};

const BUDGET_STATUS_LABELS: Record<PlanningBudgetStatus, string> = {
  planned: 'Planned',
  deposit_paid: 'Deposit Paid',
  settled: 'Settled',
};

const NEXT_BUDGET_STATUS: Record<PlanningBudgetStatus, PlanningBudgetStatus> = {
  planned: 'deposit_paid',
  deposit_paid: 'settled',
  settled: 'planned',
};

export const EventPlanningPanel: React.FC<EventPlanningPanelProps> = ({
  event,
  organizerName,
  onUpdateEvent,
  onSavePlanning,
  canEdit = true,
  onOpenEventWorkspace,
}) => {
  const [subTab, setSubTab] = useState<PlanningSubTab>('checklist');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Template application controls
  const [templateCategory, setTemplateCategory] = useState<string>(
    event.extraDataConfig?.planningConfig?.appliedTemplateCategory || event.category || 'Events'
  );
  const [confirmTemplateModal, setConfirmTemplateModal] = useState(false);

  // Multi-day specific date filter & note draft
  const [activeDateFilter, setActiveDateFilter] = useState<'all' | 'pre-event' | string>('all');
  const [dayNoteDraft, setDayNoteDraft] = useState('');

  // Checklist filters & add state
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [taskPhaseFilter, setTaskPhaseFilter] = useState<'all' | PlanningTaskPhase>('all');
  const [taskQuery, setTaskQuery] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPhase, setNewTaskPhase] = useState<PlanningTaskPhase>('Venue & Permits');
  const [newTaskPriority, setNewTaskPriority] = useState<PlanningPriority>('high');
  const [newTaskDue, setNewTaskDue] = useState('T-7 Days');
  const [newTaskDueDate, setNewTaskDueDate] = useState<string>('');
  const [newTaskAssignee, setNewTaskAssignee] = useState(organizerName || 'Organiser');

  // Budget add & edit state
  const [editingTargetBudget, setEditingTargetBudget] = useState(false);
  const [targetBudgetDraft, setTargetBudgetDraft] = useState('');
  const [addingBudget, setAddingBudget] = useState(false);
  const [newBudgetTitle, setNewBudgetTitle] = useState('');
  const [newBudgetCategory, setNewBudgetCategory] = useState<PlanningBudgetCategory>('Venue');
  const [newBudgetEstimated, setNewBudgetEstimated] = useState('');
  const [newBudgetActual, setNewBudgetActual] = useState('');
  const [newBudgetDeposit, setNewBudgetDeposit] = useState('');
  const [newBudgetStatus, setNewBudgetStatus] = useState<PlanningBudgetStatus>('planned');
  const [newBudgetVendor, setNewBudgetVendor] = useState('');

  // Vendors filters & add state
  const [vendorStatusFilter, setVendorStatusFilter] = useState<'all' | PlanningVendorStatus>('all');
  const [vendorQuery, setVendorQuery] = useState('');
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorService, setNewVendorService] = useState('');
  const [newVendorContact, setNewVendorContact] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [newVendorFee, setNewVendorFee] = useState('');
  const [newVendorArrival, setNewVendorArrival] = useState('07:30 AM');
  const [newVendorServiceDate, setNewVendorServiceDate] = useState<string>(
    () => sanitizeIsoDate(event.isoDate) ?? ''
  );
  const [newVendorStatus, setNewVendorStatus] = useState<PlanningVendorStatus>('quoted');
  const [newVendorNotes, setNewVendorNotes] = useState('');

  // Team & Ushers add & inline edit state
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleMember, setNewRoleMember] = useState('');
  const [newRoleTitle, setNewRoleTitle] = useState('Gate Check-In Lead');
  const [newRoleStation, setNewRoleStation] = useState('');
  const [newRoleShift, setNewRoleShift] = useState('08:00 AM - 04:00 PM');
  const [newRoleShiftDate, setNewRoleShiftDate] = useState<string>(
    () => sanitizeIsoDate(event.isoDate) ?? ''
  );
  const [newRolePhone, setNewRolePhone] = useState('');
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');

  const eventDateSlots = useMemo(() => getEventDateSlots(event), [event]);

  useEffect(() => {
    const startIso = sanitizeIsoDate(event.isoDate) ?? '';
    setActiveDateFilter('all');
    setDayNoteDraft('');
    setNewVendorServiceDate(startIso);
    setNewRoleShiftDate(startIso);
  }, [event.id, event.isoDate]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
  };

  const currentConfig: EventPlanningConfig = useMemo(() => {
    const existing = event.extraDataConfig?.planningConfig;
    const defaultEventDates = eventDateSlots.map((slot) => slot.isoDate);
    if (existing) {
      return {
        appliedTemplateCategory: existing.appliedTemplateCategory || event.category || 'Events',
        currency: existing.currency === 'USD' ? 'USD' : 'GHS',
        targetBudget: Number(existing.targetBudget) || 0,
        eventDates:
          Array.isArray(existing.eventDates) && existing.eventDates.length > 0
            ? existing.eventDates
            : defaultEventDates.length > 0
              ? defaultEventDates
              : undefined,
        dayScheduleNotes:
          existing.dayScheduleNotes && typeof existing.dayScheduleNotes === 'object'
            ? { ...existing.dayScheduleNotes }
            : undefined,
        tasks: Array.isArray(existing.tasks) ? existing.tasks : [],
        budgetItems: Array.isArray(existing.budgetItems) ? existing.budgetItems : [],
        vendors: Array.isArray(existing.vendors) ? existing.vendors : [],
        teamRoles: Array.isArray(existing.teamRoles) ? existing.teamRoles : [],
        updatedAt: existing.updatedAt,
      };
    }
    return {
      appliedTemplateCategory: event.category || 'Events',
      currency: event.category?.toLowerCase() === 'corporate' || event.category?.toLowerCase() === 'tech' ? 'USD' : 'GHS',
      targetBudget: 0,
      ...(defaultEventDates.length > 0 ? { eventDates: defaultEventDates } : {}),
      tasks: [],
      budgetItems: [],
      vendors: [],
      teamRoles: [],
    };
  }, [event.extraDataConfig?.planningConfig, event.category, eventDateSlots]);

  const readiness = useMemo(() => computeEventReadiness(event), [event]);

  const persistPlanningConfig = async (nextConfig: EventPlanningConfig, feedback?: string) => {
    if ((!onSavePlanning && !onUpdateEvent) || !canEdit) return;
    setSaveError(null);
    setSaving(true);
    const stampedConfig: EventPlanningConfig = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (onSavePlanning) {
        await onSavePlanning(event.id, stampedConfig);
      } else if (onUpdateEvent) {
        const existingExtra = event.extraDataConfig ?? {
          enableGiftTable: false,
          customFields: [],
        };
        await onUpdateEvent({
          ...event,
          extraDataConfig: {
            ...existingExtra,
            planningConfig: stampedConfig,
          },
        });
      }
      if (feedback) showToast(feedback);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save planning changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyTemplate = async (mode: 'replace' | 'append') => {
    setConfirmTemplateModal(false);
    const merged = mergeStarterPlanningTemplate(
      currentConfig,
      templateCategory || event.category || 'Events',
      mode,
      organizerName || event.organizer,
      event.venue,
      { isoDate: event.isoDate, endIsoDate: event.endIsoDate }
    );
    await persistPlanningConfig(
      merged,
      mode === 'replace'
        ? `${templateCategory} starter plan loaded`
        : `${templateCategory} starter items merged`
    );
  };

  const handleSaveDayScheduleNote = (isoDate: string, note: string) => {
    const trimmed = note.trim();
    const nextNotes = { ...(currentConfig.dayScheduleNotes ?? {}) };
    if (trimmed) {
      nextNotes[isoDate] = trimmed;
    } else {
      delete nextNotes[isoDate];
    }
    void persistPlanningConfig(
      {
        ...currentConfig,
        eventDates:
          currentConfig.eventDates && currentConfig.eventDates.length > 0
            ? currentConfig.eventDates
            : eventDateSlots.map((s) => s.isoDate),
        dayScheduleNotes: Object.keys(nextNotes).length > 0 ? nextNotes : undefined,
      },
      `Date note updated for ${formatIsoDateShort(isoDate, true)}`
    );
  };

  // --- Checklist Handlers ---
  const filteredTasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return currentConfig.tasks.filter((task) => {
      const matchesStatus =
        taskStatusFilter === 'all' ||
        (taskStatusFilter === 'completed' ? task.completed : !task.completed);
      const matchesPhase = taskPhaseFilter === 'all' || task.phase === taskPhaseFilter;
      const matchesDate =
        activeDateFilter === 'all' ||
        (activeDateFilter === 'pre-event'
          ? !task.dueDate
          : task.dueDate === activeDateFilter);
      const matchesQuery =
        !q ||
        task.title.toLowerCase().includes(q) ||
        task.assignee.toLowerCase().includes(q) ||
        task.dueLabel.toLowerCase().includes(q) ||
        (task.dueDate && task.dueDate.includes(q));
      return matchesStatus && matchesPhase && matchesDate && matchesQuery;
    });
  }, [currentConfig.tasks, taskStatusFilter, taskPhaseFilter, activeDateFilter, taskQuery]);

  const handleToggleTask = (taskId: string) => {
    const nextTasks = currentConfig.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            completed: !task.completed,
            completedAt: !task.completed ? new Date().toISOString() : undefined,
          }
        : task
    );
    void persistPlanningConfig({ ...currentConfig, tasks: nextTasks });
  };

  const handleUpdateTaskDate = (taskId: string, nextDateRaw: string) => {
    const cleanDate = sanitizeIsoDate(nextDateRaw);
    const nextTasks = currentConfig.tasks.map((task) =>
      task.id === taskId ? { ...task, dueDate: cleanDate } : task
    );
    void persistPlanningConfig(
      { ...currentConfig, tasks: nextTasks },
      cleanDate ? `Task assigned to ${formatIsoDateShort(cleanDate, true)}` : 'Task date cleared'
    );
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const cleanDueDate = sanitizeIsoDate(newTaskDueDate);
    const item: PlanningTask = {
      id: `tsk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      title: newTaskTitle.trim(),
      phase: newTaskPhase,
      priority: newTaskPriority,
      dueLabel:
        newTaskDue.trim() ||
        (cleanDueDate ? formatIsoDateShort(cleanDueDate, true) : 'Before Event'),
      ...(cleanDueDate ? { dueDate: cleanDueDate } : {}),
      assignee: newTaskAssignee.trim() || organizerName || 'Organiser',
      completed: false,
    };
    setNewTaskTitle('');
    setAddingTask(false);
    void persistPlanningConfig(
      { ...currentConfig, tasks: [item, ...currentConfig.tasks] },
      'Preparation task added'
    );
  };

  const handleDeleteTask = (taskId: string) => {
    void persistPlanningConfig(
      {
        ...currentConfig,
        tasks: currentConfig.tasks.filter((t) => t.id !== taskId),
      },
      'Task removed'
    );
  };

  // --- Budget Handlers ---
  const handleSwitchCurrency = (currency: 'GHS' | 'USD') => {
    if (currency === currentConfig.currency) return;
    void persistPlanningConfig(
      { ...currentConfig, currency },
      `Budget currency set to ${currency}`
    );
  };

  const handleSaveTargetBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Math.max(0, Number(targetBudgetDraft) || 0);
    setEditingTargetBudget(false);
    void persistPlanningConfig(
      { ...currentConfig, targetBudget: parsed },
      'Target budget updated'
    );
  };

  const handleAddBudgetItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBudgetTitle.trim()) return;
    const item: PlanningBudgetItem = {
      id: `bdg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      title: newBudgetTitle.trim(),
      category: newBudgetCategory,
      estimatedCost: Math.max(0, Number(newBudgetEstimated) || 0),
      actualCost: Math.max(0, Number(newBudgetActual) || 0),
      depositPaid: Math.max(0, Number(newBudgetDeposit) || 0),
      status: newBudgetStatus,
      vendorName: newBudgetVendor.trim() || undefined,
    };
    setNewBudgetTitle('');
    setNewBudgetEstimated('');
    setNewBudgetActual('');
    setNewBudgetDeposit('');
    setNewBudgetVendor('');
    setAddingBudget(false);
    void persistPlanningConfig(
      { ...currentConfig, budgetItems: [...currentConfig.budgetItems, item] },
      'Budget line added'
    );
  };

  const handleCycleBudgetStatus = (itemId: string) => {
    const nextItems = currentConfig.budgetItems.map((item) => {
      if (item.id !== itemId) return item;
      const nextStatus = NEXT_BUDGET_STATUS[item.status];
      const settledCost = item.actualCost > 0 ? item.actualCost : item.estimatedCost;
      return {
        ...item,
        status: nextStatus,
        actualCost: nextStatus === 'settled' && item.actualCost === 0 ? settledCost : item.actualCost,
        depositPaid: nextStatus === 'settled' ? settledCost : item.depositPaid,
      };
    });
    void persistPlanningConfig({ ...currentConfig, budgetItems: nextItems });
  };

  const handleUpdateBudgetField = (
    itemId: string,
    field: 'actualCost' | 'depositPaid',
    rawVal: string
  ) => {
    const parsed = Math.max(0, Number(rawVal) || 0);
    const nextItems = currentConfig.budgetItems.map((item) =>
      item.id === itemId ? { ...item, [field]: parsed } : item
    );
    void persistPlanningConfig({ ...currentConfig, budgetItems: nextItems });
  };

  const handleDeleteBudgetItem = (itemId: string) => {
    void persistPlanningConfig(
      {
        ...currentConfig,
        budgetItems: currentConfig.budgetItems.filter((b) => b.id !== itemId),
      },
      'Budget item deleted'
    );
  };

  const budgetCategoryBreakdown = useMemo(() => {
    const map = new Map<PlanningBudgetCategory, number>();
    currentConfig.budgetItems.forEach((item) => {
      const val = item.actualCost > 0 ? item.actualCost : item.estimatedCost;
      map.set(item.category, (map.get(item.category) ?? 0) + val);
    });
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
    return Array.from(map.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        pct: total > 0 ? Math.round((amount / total) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [currentConfig.budgetItems]);

  // --- Vendor Handlers ---
  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    return currentConfig.vendors.filter((v) => {
      const matchesStatus = vendorStatusFilter === 'all' || v.status === vendorStatusFilter;
      const matchesDate =
        activeDateFilter === 'all' ||
        activeDateFilter === 'pre-event' ||
        v.serviceDate === activeDateFilter;
      const matchesQuery =
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.serviceCategory.toLowerCase().includes(q) ||
        v.contactPerson.toLowerCase().includes(q) ||
        (v.serviceDate && v.serviceDate.includes(q));
      return matchesStatus && matchesDate && matchesQuery;
    });
  }, [currentConfig.vendors, vendorStatusFilter, activeDateFilter, vendorQuery]);

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim()) return;
    const cleanServiceDate = sanitizeIsoDate(newVendorServiceDate);
    const vendor: PlanningVendor = {
      id: `vnd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: newVendorName.trim(),
      serviceCategory: newVendorService.trim() || 'Supplier',
      contactPerson: newVendorContact.trim() || 'Account Rep',
      phone: newVendorPhone.trim() || 'Not provided',
      email: newVendorEmail.trim() || undefined,
      quotedFee: Math.max(0, Number(newVendorFee) || 0),
      status: newVendorStatus,
      arrivalWindow: newVendorArrival.trim() || undefined,
      ...(cleanServiceDate ? { serviceDate: cleanServiceDate } : {}),
      notes: newVendorNotes.trim() || undefined,
    };
    setNewVendorName('');
    setNewVendorService('');
    setNewVendorContact('');
    setNewVendorPhone('');
    setNewVendorEmail('');
    setNewVendorFee('');
    setNewVendorNotes('');
    setAddingVendor(false);
    void persistPlanningConfig(
      { ...currentConfig, vendors: [...currentConfig.vendors, vendor] },
      'Vendor contact added'
    );
  };

  const handleVendorServiceDateChange = (vendorId: string, nextDateRaw: string) => {
    const cleanDate = sanitizeIsoDate(nextDateRaw);
    const nextVendors = currentConfig.vendors.map((v) =>
      v.id === vendorId ? { ...v, serviceDate: cleanDate } : v
    );
    void persistPlanningConfig(
      { ...currentConfig, vendors: nextVendors },
      cleanDate
        ? `Vendor arrival assigned to ${formatIsoDateShort(cleanDate, true)}`
        : 'Vendor date cleared'
    );
  };

  const handleVendorStatusChange = (vendorId: string, status: PlanningVendorStatus) => {
    const nextVendors = currentConfig.vendors.map((v) =>
      v.id === vendorId ? { ...v, status } : v
    );
    void persistPlanningConfig({ ...currentConfig, vendors: nextVendors });
  };

  const handleDeleteVendor = (vendorId: string) => {
    void persistPlanningConfig(
      {
        ...currentConfig,
        vendors: currentConfig.vendors.filter((v) => v.id !== vendorId),
      },
      'Vendor removed'
    );
  };

  // --- Team & Usher Handlers ---
  const filteredTeamRoles = useMemo(() => {
    return currentConfig.teamRoles.filter((role) => {
      if (activeDateFilter === 'all' || activeDateFilter === 'pre-event') return true;
      return role.shiftDate === activeDateFilter;
    });
  }, [currentConfig.teamRoles, activeDateFilter]);

  const handleAddRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleTitle.trim()) return;
    const cleanShiftDate = sanitizeIsoDate(newRoleShiftDate);
    const role: PlanningTeamRole = {
      id: `rol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      memberName: newRoleMember.trim() || 'Unassigned — Assign Lead',
      roleTitle: newRoleTitle.trim(),
      station: newRoleStation.trim() || 'Main Hall',
      shiftWindow: newRoleShift.trim() || 'Full Event',
      ...(cleanShiftDate ? { shiftDate: cleanShiftDate } : {}),
      phone: newRolePhone.trim() || undefined,
      briefed: false,
    };
    setNewRoleMember('');
    setNewRoleStation('');
    setNewRolePhone('');
    setAddingRole(false);
    void persistPlanningConfig(
      { ...currentConfig, teamRoles: [...currentConfig.teamRoles, role] },
      'Team role added'
    );
  };

  const handleRoleShiftDateChange = (roleId: string, nextDateRaw: string) => {
    const cleanDate = sanitizeIsoDate(nextDateRaw);
    const nextRoles = currentConfig.teamRoles.map((r) =>
      r.id === roleId ? { ...r, shiftDate: cleanDate } : r
    );
    void persistPlanningConfig(
      { ...currentConfig, teamRoles: nextRoles },
      cleanDate
        ? `Shift assigned to ${formatIsoDateShort(cleanDate, true)}`
        : 'Shift date cleared'
    );
  };

  const handleToggleRoleBriefed = (roleId: string) => {
    const nextRoles = currentConfig.teamRoles.map((r) =>
      r.id === roleId ? { ...r, briefed: !r.briefed } : r
    );
    void persistPlanningConfig({ ...currentConfig, teamRoles: nextRoles });
  };

  const handleSaveRoleMemberName = (roleId: string) => {
    const nextName = editingMemberName.trim();
    setEditingRoleId(null);
    if (!nextName) return;
    const nextRoles = currentConfig.teamRoles.map((r) =>
      r.id === roleId ? { ...r, memberName: nextName } : r
    );
    void persistPlanningConfig(
      { ...currentConfig, teamRoles: nextRoles },
      'Assigned lead updated'
    );
  };

  const handleDeleteRole = (roleId: string) => {
    void persistPlanningConfig(
      {
        ...currentConfig,
        teamRoles: currentConfig.teamRoles.filter((r) => r.id !== roleId),
      },
      'Team assignment removed'
    );
  };

  const copyContact = (value: string, label: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    showToast(`${label} copied`);
  };

  return (
    <div className="space-y-6">
      {/* Feedback Toast / Save Error */}
      {(toastMsg || saveError) && (
        <div
          className={`px-4 py-3 rounded-2xl border text-xs font-medium flex items-center justify-between gap-3 ${
            saveError
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-[#0B0B0B] border-[#0B0B0B] text-white'
          }`}
        >
          <span>{saveError || toastMsg}</span>
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setToastMsg(null);
            }}
            aria-label="Dismiss notification"
            className="opacity-75 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Event Context & Template Bar */}
      <div className="p-4 sm:p-5 rounded-3xl bg-[#F5F5F7] border border-[#E5E5EA] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#71717A]">
            <span className="font-semibold text-[#0B0B0B]">{event.category}</span>
            <span aria-hidden="true">·</span>
            <span>{formatEventDateSpan(event.isoDate, event.endIsoDate, event.date)}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{event.venue}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#0B0B0B] truncate">
              {event.title}
            </h2>
            <span
              className={`text-xs font-semibold inline-flex items-center gap-1 ${
                readiness.statusLabel === 'Gate Ready'
                  ? 'text-[#16A34A]'
                  : readiness.statusLabel === 'Almost Ready'
                    ? 'text-[#D97706]'
                    : 'text-[#52525B]'
              }`}
            >
              {readiness.statusLabel === 'Gate Ready' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
              {readiness.statusLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canEdit && (
            <>
              <select
                value={templateCategory}
                onChange={(e) => setTemplateCategory(e.target.value)}
                aria-label="Select starter planning template category"
                className="min-h-[40px] px-3.5 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
              >
                {EVENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat} Kit
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (readiness.hasPlan) {
                    setConfirmTemplateModal((prev) => !prev);
                  } else {
                    void handleApplyTemplate('replace');
                  }
                }}
                className="min-h-[40px] px-4 py-2 rounded-full bg-white border border-[#E5E5EA] hover:border-[#0B0B0B] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
                <span>{readiness.hasPlan ? 'Load Kit' : 'Apply Starter Kit'}</span>
              </button>
            </>
          )}
          {onOpenEventWorkspace && (
            <button
              type="button"
              onClick={onOpenEventWorkspace}
              className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <span>Event Studio</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Inline Template Merge Confirmation Banner */}
      {confirmTemplateModal && canEdit && (
        <div className="p-4 rounded-2xl bg-white border border-[#0B0B0B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#0B0B0B]">
            <p className="font-semibold">Apply the {templateCategory} starter kit?</p>
            <p className="text-[#71717A] mt-0.5">
              Append new starter items alongside your edits, or replace the entire plan with fresh {templateCategory} defaults.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleApplyTemplate('append')}
              className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 whitespace-nowrap"
            >
              Append Missing
            </button>
            <button
              type="button"
              onClick={() => void handleApplyTemplate('replace')}
              className="min-h-[38px] px-4 py-1.5 rounded-full bg-white border border-[#E5E5EA] hover:border-[#DC2626] text-[#DC2626] text-xs font-semibold whitespace-nowrap"
            >
              Replace Plan
            </button>
            <button
              type="button"
              onClick={() => setConfirmTemplateModal(false)}
              className="min-h-[38px] px-3 py-1.5 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Single-Elevation Readiness & Financial Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="p-4 sm:p-5 rounded-3xl bg-white border border-[#E5E5EA] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#71717A]">
            <span className="font-medium">Preparation Readiness</span>
            <ClipboardCheck className="w-4 h-4 text-[#0B0B0B]" />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] font-mono tabular-nums">
                {readiness.scorePct}%
              </span>
              <span className="text-xs text-[#71717A] tabular-nums">
                {readiness.completedTasks} / {readiness.totalTasks} tasks
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#F5F5F7] mt-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  readiness.scorePct >= 90 ? 'bg-[#16A34A]' : 'bg-[#0B0B0B]'
                }`}
                style={{ width: `${readiness.scorePct}%` }}
              />
            </div>
            <p className="text-[11px] text-[#71717A] mt-2 tabular-nums">
              {readiness.highPriorityRemaining > 0
                ? `${readiness.highPriorityRemaining} high-priority remaining`
                : readiness.totalTasks > 0
                  ? 'All high-priority tasks verified'
                  : 'Apply a starter kit to begin'}
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-white border border-[#E5E5EA] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#71717A]">
            <span className="font-medium">Budget &amp; Spend</span>
            <DollarSign className="w-4 h-4 text-[#0B0B0B]" />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] font-mono tabular-nums truncate">
                {formatPlanningMoney(
                  readiness.actualTotal > 0 ? readiness.actualTotal : readiness.estimatedTotal,
                  readiness.currency
                )}
              </span>
              <span className="text-xs text-[#71717A] font-mono tabular-nums shrink-0">
                / {formatPlanningMoney(readiness.targetBudget, readiness.currency)}
              </span>
            </div>
            <p
              className={`text-[11px] font-medium mt-3 font-mono tabular-nums ${
                readiness.variance < 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'
              }`}
            >
              {readiness.variance < 0
                ? `${formatPlanningMoney(Math.abs(readiness.variance), readiness.currency)} over target`
                : `${formatPlanningMoney(readiness.variance, readiness.currency)} remaining`}
              {' · '}
              {formatPlanningMoney(readiness.depositsPaid, readiness.currency)} paid
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-white border border-[#E5E5EA] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#71717A]">
            <span className="font-medium">Vendors &amp; Venue</span>
            <Store className="w-4 h-4 text-[#0B0B0B]" />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] font-mono tabular-nums">
                {readiness.confirmedVendors} / {readiness.totalVendors}
              </span>
              <span className="text-xs text-[#71717A]">confirmed</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-3 tabular-nums">
              {readiness.totalVendors - readiness.confirmedVendors > 0
                ? `${readiness.totalVendors - readiness.confirmedVendors} awaiting quote or contract`
                : readiness.totalVendors > 0
                  ? 'All tracked vendors locked in'
                  : 'No vendors added yet'}
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-3xl bg-white border border-[#E5E5EA] flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#71717A]">
            <span className="font-medium">Crew &amp; Ushers</span>
            <Users className="w-4 h-4 text-[#0B0B0B]" />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold text-[#0B0B0B] font-mono tabular-nums">
                {readiness.briefedCrew} / {readiness.totalCrew}
              </span>
              <span className="text-xs text-[#71717A]">briefed</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-3 tabular-nums">
              {readiness.totalCrew > 0
                ? `${readiness.totalCrew} station assignments active`
                : 'Assign gate & usher leads'}
            </p>
          </div>
        </div>
      </div>

      {/* Empty Zero-State Prompt when no plan data exists yet */}
      {!readiness.hasPlan && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-[#E5E5EA] flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-xl">
            <h3 className="font-display text-lg font-bold text-[#0B0B0B]">
              Start preparing {event.title}
            </h3>
            <p className="text-xs sm:text-sm text-[#71717A] leading-relaxed">
              Generate a tailored {templateCategory} preparation checklist, budget baseline, vendor list, and gate crew roster in one click, or build your plan item by item below.
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleApplyTemplate('replace')}
                className="min-h-[42px] px-5 py-2.5 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Layers className="w-4 h-4" />
                <span>Load {templateCategory} Starter Plan</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubTab('checklist');
                  setAddingTask(true);
                }}
                className="min-h-[42px] px-4 py-2.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-[#0B0B0B] text-xs font-semibold whitespace-nowrap"
              >
                Add Custom Task
              </button>
            </div>
          )}
        </div>
      )}

      {/* Event Date Schedule Filter & Day Notes Strip */}
      {eventDateSlots.length > 0 && (
        <div className="p-4 sm:p-5 rounded-3xl bg-white border border-[#E5E5EA] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B0B0B]">
              <Calendar className="w-4 h-4" />
              <span>
                {eventDateSlots.length > 1
                  ? `Multi-Day Schedule Dates (${eventDateSlots.length} Days)`
                  : 'Event Calendar Date'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
              <button
                type="button"
                onClick={() => setActiveDateFilter('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeDateFilter === 'all'
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                All Dates
              </button>
              <button
                type="button"
                onClick={() => setActiveDateFilter('pre-event')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeDateFilter === 'pre-event'
                    ? 'bg-[#0B0B0B] text-white'
                    : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                }`}
              >
                Pre-Event
              </button>
              {eventDateSlots.map((slot) => (
                <button
                  key={slot.isoDate}
                  type="button"
                  onClick={() => {
                    setActiveDateFilter(slot.isoDate);
                    setDayNoteDraft(currentConfig.dayScheduleNotes?.[slot.isoDate] ?? '');
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    activeDateFilter === slot.isoDate
                      ? 'bg-[#0B0B0B] text-white'
                      : 'bg-[#F5F5F7] text-[#71717A] hover:text-[#0B0B0B]'
                  }`}
                >
                  {slot.fullLabel}
                </button>
              ))}
            </div>
          </div>

          {activeDateFilter !== 'all' && activeDateFilter !== 'pre-event' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveDayScheduleNote(activeDateFilter, dayNoteDraft);
              }}
              className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-[#E5E5EA]"
            >
              <input
                type="text"
                disabled={!canEdit}
                value={dayNoteDraft}
                onChange={(e) => setDayNoteDraft(e.target.value)}
                placeholder={`Schedule highlight or gate note for ${formatIsoDateShort(activeDateFilter, true)}...`}
                className="flex-1 h-9 px-3.5 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
              />
              {canEdit && (
                <button
                  type="submit"
                  className="h-9 px-4 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800 whitespace-nowrap shrink-0"
                >
                  Save Date Note
                </button>
              )}
            </form>
          )}
        </div>
      )}

      {/* Segmented Sub-View Switcher */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA] overflow-x-auto">
        {(
          [
            {
              id: 'checklist',
              label: 'Checklist',
              count: `${readiness.completedTasks}/${readiness.totalTasks}`,
              icon: ClipboardCheck,
            },
            {
              id: 'budget',
              label: 'Budget Tracker',
              count: `${currentConfig.budgetItems.length}`,
              icon: DollarSign,
            },
            {
              id: 'vendors',
              label: 'Vendors & Venue',
              count: `${readiness.totalVendors}`,
              icon: Store,
            },
            {
              id: 'team',
              label: 'Team & Ushers',
              count: `${readiness.totalCrew}`,
              icon: Users,
            },
          ] as const
        ).map((tab) => {
          const active = subTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-white text-[#0B0B0B] shadow-xs border border-[#E5E5EA]'
                  : 'text-[#71717A] hover:text-[#0B0B0B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span className="text-[11px] font-mono tabular-nums opacity-75">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* ==================== SUB-VIEW 1: CHECKLIST ==================== */}
      {subTab === 'checklist' && (
        <section className="rounded-3xl bg-white border border-[#E5E5EA] overflow-hidden">
          {/* Phase Progress Strip */}
          {readiness.totalTasks > 0 && (
            <div className="p-4 sm:p-5 border-b border-[#E5E5EA] grid grid-cols-2 sm:grid-cols-5 gap-3">
              {readiness.phaseBreakdown.map((item) => {
                const activePhase = taskPhaseFilter === item.phase;
                const pct = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
                return (
                  <button
                    key={item.phase}
                    type="button"
                    onClick={() =>
                      setTaskPhaseFilter((prev) => (prev === item.phase ? 'all' : item.phase))
                    }
                    className={`p-3 rounded-2xl border text-left transition-colors ${
                      activePhase
                        ? 'bg-[#0B0B0B] text-white border-[#0B0B0B]'
                        : 'bg-[#F5F5F7] text-[#0B0B0B] border-transparent hover:border-[#E5E5EA]'
                    }`}
                  >
                    <p className="text-[11px] font-semibold truncate">{item.phase}</p>
                    <p
                      className={`text-[11px] font-mono tabular-nums mt-1 ${
                        activePhase ? 'text-zinc-300' : 'text-[#71717A]'
                      }`}
                    >
                      {item.completed}/{item.total} ({pct}%)
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter & Add Toolbar */}
          <div className="p-4 sm:p-5 border-b border-[#E5E5EA] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-1 rounded-xl bg-[#F5F5F7]">
                {(['all', 'pending', 'completed'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setTaskStatusFilter(status)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                      taskStatusFilter === status
                        ? 'bg-white text-[#0B0B0B] shadow-xs'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  placeholder="Search tasks or leads..."
                  className="w-full h-10 pl-8 pr-3 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingTask((prev) => !prev)}
                className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Task</span>
              </button>
            )}
          </div>

          {/* Add Task Form */}
          {addingTask && canEdit && (
            <form
              onSubmit={handleAddTask}
              className="p-4 sm:p-5 bg-[#F5F5F7] border-b border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
            >
              <div className="lg:col-span-4">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Task Description</label>
                <input
                  type="text"
                  required
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="e.g. Confirm generator fuel & soundcheck"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Phase</label>
                <select
                  value={newTaskPhase}
                  onChange={(e) => setNewTaskPhase(e.target.value as PlanningTaskPhase)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                >
                  {PLANNING_PHASES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Priority</label>
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value as PlanningPriority)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="lg:col-span-4 grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Due Label</label>
                  <input
                    type="text"
                    value={newTaskDue}
                    onChange={(e) => setNewTaskDue(e.target.value)}
                    placeholder="T-7 Days"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Specific Date</label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    aria-label="Task due date"
                    className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Owner</label>
                  <input
                    type="text"
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                    placeholder="Lead"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B] focus:border-[#0B0B0B] focus:outline-none"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-12 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingTask(false)}
                  className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800"
                >
                  Save Task
                </button>
              </div>
            </form>
          )}

          {/* Task List */}
          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0B0B0B]">
                {currentConfig.tasks.length === 0
                  ? 'No preparation tasks created yet'
                  : 'No tasks match your current filter'}
              </p>
              <p className="text-xs text-[#71717A]">
                {currentConfig.tasks.length === 0
                  ? 'Add a task above or apply a category starter kit to generate your checklist.'
                  : 'Clear your phase or status filter to view all tasks.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E5E5EA]">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="px-4 sm:px-5 py-3.5 flex items-start sm:items-center justify-between gap-3 hover:bg-[#F5F5F7]/60 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => handleToggleTask(task.id)}
                      aria-label={task.completed ? `Mark "${task.title}" pending` : `Mark "${task.title}" completed`}
                      className={`mt-0.5 sm:mt-0 w-7 h-7 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        task.completed
                          ? 'bg-[#16A34A] border-[#16A34A] text-white'
                          : 'bg-white border-[#D4D4D8] hover:border-[#0B0B0B] text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-medium ${
                          task.completed ? 'line-through text-[#71717A]' : 'text-[#0B0B0B]'
                        }`}
                      >
                        {task.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#71717A] mt-0.5">
                        <span>{task.phase}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{task.dueLabel}</span>
                        {task.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums font-semibold text-[#0B0B0B]">
                              {formatIsoDateShort(task.dueDate, true)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{task.assignee}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold inline-flex items-center gap-1 ${
                            task.completed
                              ? 'text-[#16A34A]'
                              : task.priority === 'high'
                                ? 'text-[#DC2626]'
                                : task.priority === 'medium'
                                  ? 'text-[#D97706]'
                                  : 'text-[#71717A]'
                          }`}
                        >
                          {!task.completed && task.priority === 'high' && (
                            <AlertCircle className="w-3 h-3" />
                          )}
                          {task.completed
                            ? 'Completed'
                            : `${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)} Priority`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canEdit && (
                      <input
                        type="date"
                        value={task.dueDate ?? ''}
                        aria-label={`Assign calendar date for ${task.title}`}
                        onChange={(e) => handleUpdateTaskDate(task.id, e.target.value)}
                        className="h-8 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-mono text-[#0B0B0B] focus:bg-white focus:border-[#0B0B0B] focus:outline-none"
                      />
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                        aria-label={`Delete task ${task.title}`}
                        className="w-9 h-9 rounded-full hover:bg-red-50 text-[#71717A] hover:text-[#DC2626] flex items-center justify-center shrink-0 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ==================== SUB-VIEW 2: BUDGET TRACKER ==================== */}
      {subTab === 'budget' && (
        <section className="rounded-3xl bg-white border border-[#E5E5EA] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#E5E5EA] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs text-[#71717A]">Target Event Budget</p>
                {editingTargetBudget && canEdit ? (
                  <form onSubmit={handleSaveTargetBudget} className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min="0"
                      value={targetBudgetDraft}
                      onChange={(e) => setTargetBudgetDraft(e.target.value)}
                      className="w-36 h-9 px-3 rounded-xl bg-[#F5F5F7] border border-[#0B0B0B] text-sm font-mono font-bold text-[#0B0B0B]"
                    />
                    <button
                      type="submit"
                      className="h-9 px-3.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-display text-xl font-bold text-[#0B0B0B] font-mono tabular-nums">
                      {formatPlanningMoney(readiness.targetBudget, currentConfig.currency)}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetBudgetDraft(String(readiness.targetBudget || 0));
                          setEditingTargetBudget(true);
                        }}
                        className="text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B] underline"
                      >
                        Edit Target
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="h-8 w-px bg-[#E5E5EA] hidden sm:block" />

              <div>
                <p className="text-xs text-[#71717A]">Estimated Total</p>
                <p className="font-mono tabular-nums text-base font-bold text-[#0B0B0B] mt-0.5">
                  {formatPlanningMoney(readiness.estimatedTotal, currentConfig.currency)}
                </p>
              </div>

              <div>
                <p className="text-xs text-[#71717A]">Deposits Paid</p>
                <p className="font-mono tabular-nums text-base font-bold text-[#16A34A] mt-0.5">
                  {formatPlanningMoney(readiness.depositsPaid, currentConfig.currency)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <div className="inline-flex items-center p-1 rounded-xl bg-[#F5F5F7]">
                  {(['GHS', 'USD'] as const).map((curr) => (
                    <button
                      key={curr}
                      type="button"
                      onClick={() => handleSwitchCurrency(curr)}
                      className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold font-mono transition-colors ${
                        currentConfig.currency === curr
                          ? 'bg-white text-[#0B0B0B] shadow-xs'
                          : 'text-[#71717A] hover:text-[#0B0B0B]'
                      }`}
                    >
                      {curr}
                    </button>
                  ))}
                </div>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => setAddingBudget((prev) => !prev)}
                  className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Expense</span>
                </button>
              )}
            </div>
          </div>

          {/* Category Breakdown */}
          {budgetCategoryBreakdown.length > 0 && (
            <div className="p-4 sm:p-5 border-b border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {budgetCategoryBreakdown.slice(0, 4).map((cat) => (
                <div key={cat.category} className="p-3 rounded-2xl bg-[#F5F5F7]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#0B0B0B] truncate">{cat.category}</span>
                    <span className="font-mono tabular-nums text-[#71717A]">{cat.pct}%</span>
                  </div>
                  <p className="font-mono tabular-nums text-sm font-bold text-[#0B0B0B] mt-1">
                    {formatPlanningMoney(cat.amount, currentConfig.currency)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Add Expense Form */}
          {addingBudget && canEdit && (
            <form
              onSubmit={handleAddBudgetItem}
              className="p-4 sm:p-5 bg-[#F5F5F7] border-b border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
            >
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Expense Item</label>
                <input
                  type="text"
                  required
                  value={newBudgetTitle}
                  onChange={(e) => setNewBudgetTitle(e.target.value)}
                  placeholder="e.g. Reception Lighting"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Category</label>
                <select
                  value={newBudgetCategory}
                  onChange={(e) => setNewBudgetCategory(e.target.value as PlanningBudgetCategory)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                >
                  {PLANNING_BUDGET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                  Estimated ({currentConfig.currency})
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newBudgetEstimated}
                  onChange={(e) => setNewBudgetEstimated(e.target.value)}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                  Actual ({currentConfig.currency})
                </label>
                <input
                  type="number"
                  min="0"
                  value={newBudgetActual}
                  onChange={(e) => setNewBudgetActual(e.target.value)}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-1">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Deposit</label>
                <input
                  type="number"
                  min="0"
                  value={newBudgetDeposit}
                  onChange={(e) => setNewBudgetDeposit(e.target.value)}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Status</label>
                <select
                  value={newBudgetStatus}
                  onChange={(e) => setNewBudgetStatus(e.target.value as PlanningBudgetStatus)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                >
                  <option value="planned">Planned</option>
                  <option value="deposit_paid">Deposit Paid</option>
                  <option value="settled">Settled</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-12 flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={newBudgetVendor}
                  onChange={(e) => setNewBudgetVendor(e.target.value)}
                  placeholder="Optional linked vendor name"
                  className="flex-1 max-w-sm h-9 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAddingBudget(false)}
                    className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="min-h-[38px] px-5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800"
                  >
                    Save Expense
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Budget Table */}
          {currentConfig.budgetItems.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0B0B0B]">No budget line items logged</p>
              <p className="text-xs text-[#71717A]">
                Add expenses above or load a starter template to populate estimated event costs.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E5E5EA] text-[11px] font-semibold text-[#71717A]">
                    <th className="py-3 px-4 sm:px-5">Line Item</th>
                    <th className="py-3 px-3 text-right">Estimated</th>
                    <th className="py-3 px-3 text-right">Actual</th>
                    <th className="py-3 px-3 text-right">Paid</th>
                    <th className="py-3 px-3">Status</th>
                    {canEdit && <th className="py-3 px-4 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5EA] text-xs">
                  {currentConfig.budgetItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F5F5F7]/60 transition-colors">
                      <td className="py-3 px-4 sm:px-5 min-w-[200px]">
                        <p className="font-semibold text-[#0B0B0B]">{item.title}</p>
                        <p className="text-[11px] text-[#71717A] mt-0.5">
                          {item.category}
                          {item.vendorName ? ` · ${item.vendorName}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#52525B] whitespace-nowrap">
                        {formatPlanningMoney(item.estimatedCost, currentConfig.currency)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            aria-label={`Actual cost for ${item.title}`}
                            defaultValue={item.actualCost}
                            onBlur={(e) => {
                              if (Number(e.target.value) !== item.actualCost) {
                                handleUpdateBudgetField(item.id, 'actualCost', e.target.value);
                              }
                            }}
                            className="w-24 h-8 px-2 text-right rounded-lg bg-[#F5F5F7] border border-transparent focus:bg-white focus:border-[#0B0B0B] font-mono tabular-nums text-xs text-[#0B0B0B]"
                          />
                        ) : (
                          <span className="font-mono tabular-nums">
                            {formatPlanningMoney(item.actualCost, currentConfig.currency)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            aria-label={`Deposit paid for ${item.title}`}
                            defaultValue={item.depositPaid}
                            onBlur={(e) => {
                              if (Number(e.target.value) !== item.depositPaid) {
                                handleUpdateBudgetField(item.id, 'depositPaid', e.target.value);
                              }
                            }}
                            className="w-24 h-8 px-2 text-right rounded-lg bg-[#F5F5F7] border border-transparent focus:bg-white focus:border-[#0B0B0B] font-mono tabular-nums text-xs text-[#0B0B0B]"
                          />
                        ) : (
                          <span className="font-mono tabular-nums">
                            {formatPlanningMoney(item.depositPaid, currentConfig.currency)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleCycleBudgetStatus(item.id)}
                          title="Click to advance payment status"
                          className={`min-h-[32px] px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                            item.status === 'settled'
                              ? 'bg-emerald-50 text-[#16A34A] border border-emerald-200'
                              : item.status === 'deposit_paid'
                                ? 'bg-amber-50 text-[#D97706] border border-amber-200'
                                : 'bg-[#F5F5F7] text-[#52525B] border border-[#E5E5EA]'
                          }`}
                        >
                          {BUDGET_STATUS_LABELS[item.status]}
                        </button>
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteBudgetItem(item.id)}
                            aria-label={`Delete expense ${item.title}`}
                            className="w-8 h-8 rounded-full hover:bg-red-50 text-[#71717A] hover:text-[#DC2626] inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ==================== SUB-VIEW 3: VENDORS & VENUE ==================== */}
      {subTab === 'vendors' && (
        <section className="rounded-3xl bg-white border border-[#E5E5EA] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#E5E5EA] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-1 rounded-xl bg-[#F5F5F7] overflow-x-auto">
                {(['all', 'sourcing', 'quoted', 'confirmed', 'paid'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setVendorStatusFilter(status)}
                    className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                      vendorStatusFilter === status
                        ? 'bg-white text-[#0B0B0B] shadow-xs'
                        : 'text-[#71717A] hover:text-[#0B0B0B]'
                    }`}
                  >
                    {status === 'all' ? 'All' : VENDOR_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[180px] flex-1">
                <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={vendorQuery}
                  onChange={(e) => setVendorQuery(e.target.value)}
                  placeholder="Search vendors or contacts..."
                  className="w-full h-10 pl-8 pr-3 rounded-xl bg-[#F5F5F7] text-xs text-[#0B0B0B] focus:bg-white focus:ring-1 focus:ring-[#0B0B0B] focus:outline-none"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingVendor((prev) => !prev)}
                className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add Vendor</span>
              </button>
            )}
          </div>

          {addingVendor && canEdit && (
            <form
              onSubmit={handleAddVendor}
              className="p-4 sm:p-5 bg-[#F5F5F7] border-b border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
            >
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Vendor / Venue Name</label>
                <input
                  type="text"
                  required
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="e.g. Kempinski Ballroom"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Service Category</label>
                <input
                  type="text"
                  value={newVendorService}
                  onChange={(e) => setNewVendorService(e.target.value)}
                  placeholder="Catering, Sound, Venue"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Contact Person</label>
                <input
                  type="text"
                  value={newVendorContact}
                  onChange={(e) => setNewVendorContact(e.target.value)}
                  placeholder="e.g. Ama Boateng"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                  placeholder="+233 24 555 0100"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                  placeholder="bookings@vendor.com"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">
                  Quote ({currentConfig.currency})
                </label>
                <input
                  type="number"
                  min="0"
                  value={newVendorFee}
                  onChange={(e) => setNewVendorFee(e.target.value)}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Service Date</label>
                <input
                  type="date"
                  value={newVendorServiceDate}
                  onChange={(e) => setNewVendorServiceDate(e.target.value)}
                  aria-label="Vendor service date"
                  className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Arrival Time</label>
                <input
                  type="text"
                  value={newVendorArrival}
                  onChange={(e) => setNewVendorArrival(e.target.value)}
                  placeholder="07:30 AM"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Status</label>
                <select
                  value={newVendorStatus}
                  onChange={(e) => setNewVendorStatus(e.target.value as PlanningVendorStatus)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                >
                  <option value="sourcing">Sourcing</option>
                  <option value="quoted">Quoted</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Setup Notes</label>
                <input
                  type="text"
                  value={newVendorNotes}
                  onChange={(e) => setNewVendorNotes(e.target.value)}
                  placeholder="Loading bay or power notes"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-12 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingVendor(false)}
                  className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800"
                >
                  Save Vendor
                </button>
              </div>
            </form>
          )}

          {filteredVendors.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0B0B0B]">No vendors in this view</p>
              <p className="text-xs text-[#71717A]">
                Track venue managers, catering teams, sound engineers, and setup arrival dates here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E5E5EA]">
              {filteredVendors.map((vendor) => (
                <div
                  key={vendor.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-[#F5F5F7]/60 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-[#0B0B0B]">{vendor.name}</h4>
                      <span
                        className={`text-xs font-semibold ${
                          vendor.status === 'confirmed' || vendor.status === 'paid'
                            ? 'text-[#16A34A]'
                            : vendor.status === 'quoted'
                              ? 'text-[#D97706]'
                              : 'text-[#71717A]'
                        }`}
                      >
                        · {VENDOR_STATUS_LABELS[vendor.status]}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#71717A]">
                      <span>{vendor.serviceCategory}</span>
                      <span aria-hidden="true">·</span>
                      <span>{vendor.contactPerson}</span>
                      {vendor.serviceDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0B0B0B]">
                            {formatIsoDateShort(vendor.serviceDate, true)}
                          </span>
                        </>
                      )}
                      {vendor.arrivalWindow && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">Setup {vendor.arrivalWindow}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums font-semibold text-[#0B0B0B]">
                        {formatPlanningMoney(vendor.quotedFee, currentConfig.currency)}
                      </span>
                    </div>
                    {vendor.notes && (
                      <p className="text-xs text-[#52525B]">{vendor.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {canEdit && (
                      <input
                        type="date"
                        value={vendor.serviceDate ?? ''}
                        aria-label={`Service date for ${vendor.name}`}
                        onChange={(e) => handleVendorServiceDateChange(vendor.id, e.target.value)}
                        className="min-h-[36px] px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-mono text-[#0B0B0B]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => copyContact(vendor.phone, `${vendor.name} phone`)}
                      className="min-h-[36px] px-3 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-mono text-[#0B0B0B] inline-flex items-center gap-1.5"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{vendor.phone}</span>
                    </button>
                    {vendor.email && (
                      <button
                        type="button"
                        onClick={() => copyContact(vendor.email!, `${vendor.name} email`)}
                        className="min-h-[36px] px-3 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8EA] text-xs font-semibold text-[#0B0B0B] inline-flex items-center gap-1.5"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Email</span>
                      </button>
                    )}
                    {canEdit && (
                      <select
                        aria-label={`Contract status for ${vendor.name}`}
                        value={vendor.status}
                        onChange={(e) =>
                          handleVendorStatusChange(vendor.id, e.target.value as PlanningVendorStatus)
                        }
                        className="min-h-[36px] px-3 rounded-full bg-white border border-[#E5E5EA] text-xs font-semibold text-[#0B0B0B]"
                      >
                        <option value="sourcing">Sourcing</option>
                        <option value="quoted">Quoted</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="paid">Paid</option>
                      </select>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteVendor(vendor.id)}
                        aria-label={`Remove vendor ${vendor.name}`}
                        className="w-9 h-9 rounded-full hover:bg-red-50 text-[#71717A] hover:text-[#DC2626] flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ==================== SUB-VIEW 4: TEAM & USHERS ==================== */}
      {subTab === 'team' && (
        <section className="rounded-3xl bg-white border border-[#E5E5EA] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#E5E5EA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#0B0B0B]">
                Day-Of Team &amp; Usher Assignments
              </h3>
              <p className="text-xs text-[#71717A] mt-0.5">
                Assign gate leads, seating ushers, gift desk attendants, and AV operators before doors open.
              </p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingRole((prev) => !prev)}
                className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B0B0B] hover:bg-zinc-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Assign Role</span>
              </button>
            )}
          </div>

          {addingRole && canEdit && (
            <form
              onSubmit={handleAddRole}
              className="p-4 sm:p-5 bg-[#F5F5F7] border-b border-[#E5E5EA] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
            >
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Role Title</label>
                <input
                  type="text"
                  required
                  list="planning-role-suggestions"
                  value={newRoleTitle}
                  onChange={(e) => setNewRoleTitle(e.target.value)}
                  placeholder="Gate Check-In Lead"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
                <datalist id="planning-role-suggestions">
                  {PLANNING_ROLE_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Assigned Member</label>
                <input
                  type="text"
                  value={newRoleMember}
                  onChange={(e) => setNewRoleMember(e.target.value)}
                  placeholder="e.g. Kwame Mensah"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Station / Gate</label>
                <input
                  type="text"
                  value={newRoleStation}
                  onChange={(e) => setNewRoleStation(e.target.value)}
                  placeholder="VIP Entrance"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Shift Date</label>
                <input
                  type="date"
                  value={newRoleShiftDate}
                  onChange={(e) => setNewRoleShiftDate(e.target.value)}
                  aria-label="Crew shift date"
                  className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Shift Window</label>
                <input
                  type="text"
                  value={newRoleShift}
                  onChange={(e) => setNewRoleShift(e.target.value)}
                  placeholder="08:00 AM - 04:00 PM"
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-[#0B0B0B] mb-1">Phone</label>
                <input
                  type="tel"
                  value={newRolePhone}
                  onChange={(e) => setNewRolePhone(e.target.value)}
                  placeholder="+233 24 ..."
                  className="w-full h-10 px-3.5 rounded-xl bg-white border border-[#E5E5EA] text-xs font-mono text-[#0B0B0B]"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-12 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingRole(false)}
                  className="min-h-[38px] px-4 py-1.5 rounded-full text-xs font-semibold text-[#71717A] hover:text-[#0B0B0B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-5 py-1.5 rounded-full bg-[#0B0B0B] text-white text-xs font-semibold hover:bg-zinc-800"
                >
                  Save Assignment
                </button>
              </div>
            </form>
          )}

          {filteredTeamRoles.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-[#0B0B0B]">
                {currentConfig.teamRoles.length === 0
                  ? 'No team assignments yet'
                  : 'No crew shifts assigned to this date'}
              </p>
              <p className="text-xs text-[#71717A]">
                Add gate leads, ushers, or stage coordinators above to verify day-of coverage.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E5E5EA]">
              {filteredTeamRoles.map((role) => {
                const isUnassigned = role.memberName.toLowerCase().startsWith('unassigned');
                return (
                  <div
                    key={role.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F5F5F7]/60 transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[#0B0B0B]">{role.roleTitle}</span>
                        <span aria-hidden="true" className="text-[#71717A]">·</span>
                        {editingRoleId === role.id && canEdit ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSaveRoleMemberName(role.id);
                            }}
                            className="inline-flex items-center gap-1.5"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={editingMemberName}
                              onChange={(e) => setEditingMemberName(e.target.value)}
                              placeholder="Enter member name"
                              className="h-8 px-2.5 rounded-lg bg-white border border-[#0B0B0B] text-xs text-[#0B0B0B]"
                            />
                            <button
                              type="submit"
                              className="h-8 px-2.5 rounded-lg bg-[#0B0B0B] text-white text-[11px] font-semibold"
                            >
                              Save
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              setEditingRoleId(role.id);
                              setEditingMemberName(isUnassigned ? '' : role.memberName);
                            }}
                            className={`text-xs font-semibold underline-offset-2 ${
                              isUnassigned
                                ? 'text-[#D97706] underline'
                                : 'text-[#0B0B0B] hover:underline'
                            }`}
                          >
                            {role.memberName}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#71717A]">
                        <span>{role.station}</span>
                        {role.shiftDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums font-semibold text-[#0B0B0B]">
                              {formatIsoDateShort(role.shiftDate, true)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{role.shiftWindow}</span>
                        {role.phone && (
                          <>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => copyContact(role.phone!, `${role.memberName} phone`)}
                              className="font-mono hover:text-[#0B0B0B] underline"
                            >
                              {role.phone}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canEdit && (
                        <input
                          type="date"
                          value={role.shiftDate ?? ''}
                          aria-label={`Shift date for ${role.roleTitle}`}
                          onChange={(e) => handleRoleShiftDateChange(role.id, e.target.value)}
                          className="h-9 px-2.5 rounded-full bg-[#F5F5F7] border border-[#E5E5EA] text-[11px] font-mono text-[#0B0B0B]"
                        />
                      )}
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handleToggleRoleBriefed(role.id)}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                          role.briefed
                            ? 'bg-emerald-50 text-[#16A34A] border border-emerald-200'
                            : 'bg-[#F5F5F7] text-[#52525B] border border-[#E5E5EA] hover:border-[#0B0B0B]'
                        }`}
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>{role.briefed ? 'Briefed' : 'Mark Briefed'}</span>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRole(role.id)}
                          aria-label={`Remove ${role.roleTitle}`}
                          className="w-9 h-9 rounded-full hover:bg-red-50 text-[#71717A] hover:text-[#DC2626] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
