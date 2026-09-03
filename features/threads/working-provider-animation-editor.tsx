import { useId } from "react";
import { toast } from "sonner";
import { SettingsLabel } from "../../components/ui/settings";
import {
  DEFAULT_WORKING_PROVIDER_ANIMATION,
  WORKING_PROVIDER_ANIMATION_SPEEDS,
  WORKING_PROVIDER_ANIMATION_STYLES,
  splitWorkingProviderAnimation,
  type WorkingProviderAnimation,
} from "./sidebar-appearance";

const animationLabels: Record<WorkingProviderAnimation, string> = {
  none: "No motion",
  ...Object.fromEntries(
    WORKING_PROVIDER_ANIMATION_STYLES.filter(
      (style) => style !== "none",
    ).flatMap((style) =>
      WORKING_PROVIDER_ANIMATION_SPEEDS.map((speed) => [
        `${speed}-${style}`,
        `${speed[0]!.toUpperCase()}${speed.slice(1)} ${style}`,
      ]),
    ),
  ),
} as Record<WorkingProviderAnimation, string>;

export function WorkingProviderAnimationEditor({
  saved,
  pending,
  onSave,
}: {
  saved: WorkingProviderAnimation | undefined;
  pending: boolean;
  onSave(value: WorkingProviderAnimation): Promise<unknown>;
}) {
  const id = useId();
  const value = saved ?? DEFAULT_WORKING_PROVIDER_ANIMATION;
  const { style, speed } = splitWorkingProviderAnimation(value);
  const save = (nextStyle: typeof style, nextSpeed: typeof speed) => {
    const next =
      nextStyle === "none"
        ? "none"
        : (`${nextSpeed}-${nextStyle}` as WorkingProviderAnimation);
    void onSave(next).then(
      () => toast.success(`Working animation set to ${animationLabels[next]}`),
      (error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save working provider animation",
        ),
    );
  };
  return (
    <fieldset className="ws-sidebar-appearance-field ws-working-animation-field">
      <legend>Working provider animation</legend>
      <div className="ws-working-animation-controls">
        <SettingsLabel htmlFor={`${id}-style`}>Style</SettingsLabel>
        <select
          id={`${id}-style`}
          value={style}
          disabled={pending}
          onChange={(event) =>
            save(event.currentTarget.value as typeof style, speed)
          }
        >
          {WORKING_PROVIDER_ANIMATION_STYLES.map((item) => (
            <option key={item} value={item}>
              {item === "none"
                ? "None"
                : item[0]!.toUpperCase() + item.slice(1)}
            </option>
          ))}
        </select>
        <SettingsLabel htmlFor={`${id}-speed`}>Speed</SettingsLabel>
        <select
          id={`${id}-speed`}
          value={speed}
          disabled={pending || style === "none"}
          onChange={(event) =>
            save(style, event.currentTarget.value as typeof speed)
          }
        >
          {WORKING_PROVIDER_ANIMATION_SPEEDS.map((item) => (
            <option key={item} value={item}>
              {item[0]!.toUpperCase() + item.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
