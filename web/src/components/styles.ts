/**
 * Shared style constants for UI components.
 * Centralizes size, focus, error, and disabled patterns
 * so Input, Select, Textarea, Button, and FileButton stay consistent.
 */

// ─── Sizes ────────────────────────────────────────────────────────────────────

export type InputSize = "xs" | "sm" | "md";
export type ButtonSize = "xs" | "sm" | "md";

export const INPUT_SIZES: Record<InputSize, string> = {
  xs: "px-2 py-1 text-xs rounded border",
  sm: "px-3 py-1.5 text-sm rounded-md border",
  md: "px-3 py-2 text-sm rounded-md border shadow-sm",
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

// ─── Focus & Border ───────────────────────────────────────────────────────────

export const FOCUS_STYLES = "focus:outline-none focus:ring-1";

export const ERROR_BORDER =
  "border-red-300 focus:border-red-500 focus:ring-red-500";
export const DEFAULT_BORDER =
  "border-gray-300 focus:border-blue-500 focus:ring-blue-500";

// ─── State ────────────────────────────────────────────────────────────────────

export const DISABLED_STYLES = "opacity-50 cursor-not-allowed";
export const DISABLED_INPUT = "bg-gray-100 cursor-not-allowed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compose input/select/textarea class string from size + error state. */
export function getFieldClasses(size: InputSize, error?: boolean): string {
  return `block w-full ${FOCUS_STYLES} ${INPUT_SIZES[size]} ${error ? ERROR_BORDER : DEFAULT_BORDER}`;
}

/** Compose button class string from size. */
export function getButtonSizeClasses(size: ButtonSize): string {
  return BUTTON_SIZES[size];
}
