export const DEFAULT_SIDEBAR_ROW_HEIGHT = 40;
export const MIN_SIDEBAR_ROW_HEIGHT = 35;
export const MAX_SIDEBAR_ROW_HEIGHT = 60;

export const DEFAULT_TEXT_SCALE = 1;
export const MIN_TEXT_SCALE = 0.9;
export const MAX_TEXT_SCALE = 1.1;
export const TEXT_SCALE_STEP = 0.01;
export const MIN_ACCESSIBLE_TEXT_SIZE_PX = 8;

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
