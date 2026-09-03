import { DEFAULT_TEXT_SCALE } from "../../shared/text-scale";
import {
  DEFAULT_GROUP_ACTIVITY_PRIORITY,
  normalizeGroupActivityPriority,
  type GroupActivityPriority,
} from "./group-activity-priority";

export { DEFAULT_TEXT_SCALE } from "../../shared/text-scale";

export const DEFAULT_SIDEBAR_ROW_HEIGHT = 40;
export const MIN_SIDEBAR_ROW_HEIGHT = 35;
export const MAX_SIDEBAR_ROW_HEIGHT = 60;

export const MIN_TEXT_SCALE = 0.9;
export const MAX_TEXT_SCALE = 1.1;
export const TEXT_SCALE_STEP = 0.01;
export const MINIMUM_TEXT_ROLE_SIZE_REM = 0.7;
export const MIN_ACCESSIBLE_TEXT_SIZE_PX = 10;
export const WORKING_PROVIDER_ANIMATION_STYLES = ["none", "spin", "bounce", "sheen", "pulse"] as const;
export const WORKING_PROVIDER_ANIMATION_SPEEDS = ["slow", "medium", "fast"] as const;
export type WorkingProviderAnimationStyle = (typeof WORKING_PROVIDER_ANIMATION_STYLES)[number];
export type WorkingProviderAnimationSpeed = (typeof WORKING_PROVIDER_ANIMATION_SPEEDS)[number];
export const WORKING_PROVIDER_ANIMATIONS = [
  "none",
  // Kept for persisted settings from the earlier single-select UI.
  "sheen",
  "pulse",
  ...WORKING_PROVIDER_ANIMATION_STYLES.filter((style) => style !== "none").flatMap((style) =>
    WORKING_PROVIDER_ANIMATION_SPEEDS.map((speed) => `${speed}-${style}`),
  ),
] as const;
export type WorkingProviderAnimation =
  (typeof WORKING_PROVIDER_ANIMATIONS)[number];
export const DEFAULT_WORKING_PROVIDER_ANIMATION: WorkingProviderAnimation =
  "slow-spin";
/** Cmd-click (or Ctrl-click off macOS) keeps ordinary PR navigation intact
 * while requesting the desktop host's external-browser route. */
export const DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER = true;
export {
  DEFAULT_GROUP_ACTIVITY_PRIORITY,
  normalizeGroupActivityPriority,
  type GroupActivityPriority,
} from "./group-activity-priority";

export function splitWorkingProviderAnimation(value: WorkingProviderAnimation): {
  style: WorkingProviderAnimationStyle;
  speed: WorkingProviderAnimationSpeed;
} {
  if (value === "none") return { style: "none", speed: "slow" };
  if (value === "sheen" || value === "pulse") return { style: value, speed: "slow" };
  const [speed, style] = value.split("-") as [WorkingProviderAnimationSpeed, WorkingProviderAnimationStyle];
  return { style, speed };
}

const TENTH_PIXEL = /^\d+(?:\.\d)?$/;
const HUNDREDTH_MULTIPLIER = /^\d+(?:\.\d{1,2})?$/;

export function validateSidebarRowHeight(
  value: string,
): { value: number; error: null } | { value: null; error: string } {
  const normalized = value.trim();
  if (!TENTH_PIXEL.test(normalized)) {
    return {
      value: null,
      error: "Enter a number with at most one decimal place.",
    };
  }
  const parsed = Number(normalized);
  if (parsed < MIN_SIDEBAR_ROW_HEIGHT || parsed > MAX_SIDEBAR_ROW_HEIGHT) {
    return {
      value: null,
      error: `Enter a value from ${MIN_SIDEBAR_ROW_HEIGHT} to ${MAX_SIDEBAR_ROW_HEIGHT}px.`,
    };
  }
  return { value: parsed, error: null };
}

export function normalizeSidebarRowHeight(value: unknown): number {
  const candidate =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  const result = validateSidebarRowHeight(candidate);
  return result.value ?? DEFAULT_SIDEBAR_ROW_HEIGHT;
}

export function validateTextScale(
  value: string,
): { value: number; error: null } | { value: null; error: string } {
  const normalized = value.trim();
  if (!HUNDREDTH_MULTIPLIER.test(normalized)) {
    return {
      value: null,
      error: "Enter a multiplier with at most two decimal places.",
    };
  }
  const parsed = Number(normalized);
  if (parsed < MIN_TEXT_SCALE || parsed > MAX_TEXT_SCALE) {
    return {
      value: null,
      error: `Enter a value from ${MIN_TEXT_SCALE} to ${MAX_TEXT_SCALE}.`,
    };
  }
  return { value: parsed, error: null };
}

export function normalizeTextScale(value: unknown): number {
  const candidate =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  const result = validateTextScale(candidate);
  return result.value ?? DEFAULT_TEXT_SCALE;
}

export function normalizeWorkingProviderAnimation(
  value: unknown,
): WorkingProviderAnimation {
  return typeof value === "string" &&
    (WORKING_PROVIDER_ANIMATIONS as readonly string[]).includes(value)
    ? (value as WorkingProviderAnimation)
    : DEFAULT_WORKING_PROVIDER_ANIMATION;
}

export function normalizeOpenPrLinksExternallyWithModifier(
  value: unknown,
): boolean {
  return typeof value === "boolean"
    ? value
    : DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER;
}
