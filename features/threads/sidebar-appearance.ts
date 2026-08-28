export const DEFAULT_SIDEBAR_ROW_HEIGHT = 45;
export const MIN_SIDEBAR_ROW_HEIGHT = 40;
export const MAX_SIDEBAR_ROW_HEIGHT = 60;

const TENTH_PIXEL = /^\d+(?:\.\d)?$/;

export function validateSidebarRowHeight(value: string):
  | { value: number; error: null }
  | { value: null; error: string } {
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
