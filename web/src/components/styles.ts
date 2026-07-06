/**
 * Centralized style definitions for all UI components.
 * Components import class maps from here — they only contain JSX structure.
 * Change colors/spacing here to re-theme the entire app.
 *
 * Semantic color tokens (primary, danger, success, warning) are defined
 * in tailwind.config.js — this file references them.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InputSize = 'xs' | 'sm' | 'md';
export type ButtonSize = 'xs' | 'sm' | 'md';
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'ghost-dark';
export type AlertVariant = 'error' | 'success' | 'warning' | 'info';
export type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray';

// ─── Input / Select / Textarea Sizes ──────────────────────────────────────────

export const INPUT_SIZES: Record<InputSize, string> = {
  xs: 'px-2 py-1 text-xs rounded border',
  sm: 'px-3 py-1.5 text-sm rounded-md border',
  md: 'px-3 py-2 text-sm rounded-md border shadow-sm',
};

// ─── Input / Select / Textarea Focus & Borders ────────────────────────────────

export const FOCUS_STYLES = 'focus:outline-none focus:ring-1';
export const ERROR_BORDER = 'border-danger-300 focus:border-danger-500 focus:ring-danger-500';
export const DEFAULT_BORDER = 'border-gray-300 focus:border-primary-500 focus:ring-primary-500';

// ─── Disabled ─────────────────────────────────────────────────────────────────

export const DISABLED_STYLES = 'opacity-50 cursor-not-allowed';
export const DISABLED_INPUT = 'bg-gray-100 cursor-not-allowed';

// ─── Button Sizes ─────────────────────────────────────────────────────────────

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
};

// ─── Button Variants ──────────────────────────────────────────────────────────

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 shadow-sm',
  secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-primary-500 shadow-sm',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-500 shadow-sm',
  success: 'bg-success-600 text-white hover:bg-success-700 focus:ring-success-500 shadow-sm',
  ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
  'ghost-dark': 'text-gray-400 hover:text-gray-200',
};

export const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

// ─── Alert Variants ───────────────────────────────────────────────────────────

export const ALERT_VARIANTS: Record<AlertVariant, string> = {
  error: 'border-danger-200 bg-danger-50 text-danger-700',
  success: 'border-success-200 bg-success-50 text-success-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
  info: 'border-primary-200 bg-primary-50 text-primary-700',
};

export const ALERT_BASE = 'rounded-md border p-3 text-sm';

// ─── Badge Variants ───────────────────────────────────────────────────────────

export const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  green: 'bg-success-100 text-success-800',
  red: 'bg-danger-100 text-danger-800',
  yellow: 'bg-warning-100 text-warning-800',
  blue: 'bg-primary-100 text-primary-800',
  gray: 'bg-gray-100 text-gray-800',
};

export const BADGE_DOT_VARIANTS: Record<BadgeVariant, string> = {
  green: 'bg-success-500',
  red: 'bg-danger-500',
  yellow: 'bg-warning-500',
  blue: 'bg-primary-500',
  gray: 'bg-gray-400',
};

export const BADGE_BASE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium';

// ─── Card ─────────────────────────────────────────────────────────────────────

export const CARD_BASE = 'bg-white rounded-lg border border-gray-200';
export const CARD_HEADER = 'text-sm font-medium text-gray-900 mb-4';

// ─── FormField ────────────────────────────────────────────────────────────────

export const FORM_LABEL = 'block text-sm font-medium text-gray-700';
export const FORM_REQUIRED = 'text-danger-500 ml-0.5';
export const FORM_DESCRIPTION = 'mt-0.5 text-xs text-gray-500';
export const FORM_ERROR = 'mt-1 text-sm text-danger-600';

// ─── FileButton ───────────────────────────────────────────────────────────────

export const FILE_BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer';

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

export const DIALOG_OVERLAY = 'fixed inset-0 bg-black/50';
export const DIALOG_PANEL = 'relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl';
export const DIALOG_TITLE = 'text-lg font-semibold text-gray-900';
export const DIALOG_MESSAGE = 'mt-2 text-sm text-gray-600';

// ─── StatusDot ─────────────────────────────────────────────────────────────────

export type StatusDotColor = 'green' | 'red' | 'yellow' | 'gray';

export const STATUS_DOT_COLORS: Record<StatusDotColor, string> = {
  green: 'bg-green-400',
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  gray: 'bg-gray-400',
};

export const STATUS_DOT_BASE = 'inline-block w-2 h-2 rounded-full';

// ─── StatusBarItem ────────────────────────────────────────────────────────────

export const STATUS_BAR_ITEM_BASE = 'flex items-center gap-1.5';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compose input/select/textarea class string from size + error state. */
export function getFieldClasses(size: InputSize, error?: boolean): string {
  return `block w-full ${FOCUS_STYLES} ${INPUT_SIZES[size]} ${error ? ERROR_BORDER : DEFAULT_BORDER}`;
}

// ─── LogPanel (dark terminal theme) ───────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-success-400',
  warn: 'text-warning-400',
  error: 'text-danger-400',
};

export const LOG_LEVEL_BTN: Record<LogLevel, { active: string; inactive: string }> = {
  debug: { active: 'bg-gray-600 text-gray-200', inactive: 'text-gray-500 hover:text-gray-300' },
  info: { active: 'bg-success-800 text-success-200', inactive: 'text-gray-500 hover:text-gray-300' },
  warn: { active: 'bg-warning-800 text-warning-200', inactive: 'text-gray-500 hover:text-gray-300' },
  error: { active: 'bg-danger-800 text-danger-200', inactive: 'text-gray-500 hover:text-gray-300' },
};

export const LOG_PANEL_BASE = 'fixed bottom-7 left-0 right-0 z-40 border-t border-gray-700';
export const LOG_TOOLBAR = 'flex items-center justify-between px-3 py-1 bg-gray-800 text-gray-300 text-xs';
export const LOG_CONTENT = 'h-48 overflow-y-auto px-3 py-1 font-mono text-xs bg-gray-900 text-gray-200';
export const LOG_ENTRY_TIMESTAMP = 'text-gray-500';
export const LOG_ENTRY_SOURCE = 'text-cyan-300';
export const LOG_TOOLBAR_BTN = 'text-gray-400 hover:text-gray-200';
export const LOG_AUTOSCROLL_BTN = 'text-primary-400 hover:text-primary-300';
