import { useId } from "react";
import { toast } from "sonner";
import { useSidebarAppearancePreferences } from "./queries";
import {
  NumericAutosaveEditor,
  SettingsCard,
  SettingsLabel,
  useFieldSavedVersion,
  type NumericSettingDescriptor,
  type SettingsRowLayout,
} from "./settings-editor";
import {
  DEFAULT_SIDEBAR_ROW_HEIGHT,
  DEFAULT_TEXT_SCALE,
  MAX_SIDEBAR_ROW_HEIGHT,
  MAX_TEXT_SCALE,
  MIN_SIDEBAR_ROW_HEIGHT,
  MIN_TEXT_SCALE,
  DEFAULT_WORKING_PROVIDER_ANIMATION,
  WORKING_PROVIDER_ANIMATION_SPEEDS,
  WORKING_PROVIDER_ANIMATION_STYLES,
  splitWorkingProviderAnimation,
  type WorkingProviderAnimation,
  validateSidebarRowHeight,
  validateTextScale,
} from "./sidebar-appearance";

const ROW_HEIGHT_SETTING: NumericSettingDescriptor = {
  label: "Row height",
  min: MIN_SIDEBAR_ROW_HEIGHT,
  max: MAX_SIDEBAR_ROW_HEIGHT,
  step: "0.1",
  suffix: "px",
  validate: validateSidebarRowHeight,
  successMessage: (value) => `Sidebar rows set to ${value}px`,
  initialValue: DEFAULT_SIDEBAR_ROW_HEIGHT,
};

const TEXT_SCALE_SETTING: NumericSettingDescriptor = {
  label: "Text scale",
  min: MIN_TEXT_SCALE,
  max: MAX_TEXT_SCALE,
  step: "0.01",
  suffix: "×",
  validate: validateTextScale,
  successMessage: (value) => `Text scale set to ${value}`,
  initialValue: DEFAULT_TEXT_SCALE,
};

type SidebarRowHeightEditorProps = {
  saved: number | undefined;
  savedVersion?: number;
  pending: boolean;
  compact?: boolean;
  layout?: SettingsRowLayout;
  onSave(rowHeight: number): Promise<{ rowHeight: number }>;
};

function SidebarNumericEditor({
  setting,
  saved,
  savedVersion,
  pending,
  compact,
  layout,
  onSave,
  className,
  cardClassName,
  cardTitle,
}: {
  setting: NumericSettingDescriptor;
  saved: number | undefined;
  savedVersion?: number;
  pending: boolean;
  compact: boolean;
  layout?: SettingsRowLayout;
  onSave(value: number): Promise<number>;
  className: string;
  cardClassName: string;
  cardTitle?: string;
}) {
  const editor = (
    <NumericAutosaveEditor
      setting={setting}
      saved={saved}
      savedVersion={savedVersion}
      pending={pending}
      layout={layout}
      className={className}
      onSave={onSave}
    />
  );
  return compact ? (
    editor
  ) : (
    <SettingsCard title={cardTitle} className={cardClassName}>
      {editor}
    </SettingsCard>
  );
}

export function SidebarRowHeightEditor({
  saved,
  savedVersion,
  pending,
  compact = false,
  layout,
  onSave,
}: SidebarRowHeightEditorProps) {
  return (
    <SidebarNumericEditor
      setting={ROW_HEIGHT_SETTING}
      saved={saved}
      savedVersion={savedVersion}
      pending={pending}
      compact={compact}
      layout={layout}
      onSave={async (value) => (await onSave(value)).rowHeight}
      className={compact ? "ws-sidebar-row-height-editor" : "ws-sidebar-appearance-field"}
      cardClassName="ws-sidebar-appearance-settings"
      cardTitle="Sidebar appearance"
    />
  );
}

type SidebarTextScaleEditorProps = {
  saved: number | undefined;
  savedVersion?: number;
  pending: boolean;
  compact?: boolean;
  layout?: SettingsRowLayout;
  onSave(value: number): Promise<{ textScale: number }>;
};

export function SidebarTextScaleEditor({
  saved,
  savedVersion,
  pending,
  compact = false,
  layout,
  onSave,
}: SidebarTextScaleEditorProps) {
  return (
    <SidebarNumericEditor
      setting={TEXT_SCALE_SETTING}
      saved={saved}
      savedVersion={savedVersion}
      pending={pending}
      compact={compact}
      layout={layout}
      onSave={async (value) => (await onSave(value)).textScale}
      className={compact ? "ws-sidebar-text-scale-editor" : "ws-sidebar-appearance-field"}
      cardClassName="ws-sidebar-text-scale-editor"
    />
  );
}

export function SidebarAppearanceSettings() {
  const preferences = useSidebarAppearancePreferences();
  const rowHeightVersion = useFieldSavedVersion(preferences.appearance.data?.rowHeight);
  const textScaleVersion = useFieldSavedVersion(preferences.appearance.data?.textScale);
  return (
    <SettingsCard className="ws-sidebar-appearance-settings" title="Sidebar appearance">
      <SidebarRowHeightEditor
        saved={preferences.appearance.data?.rowHeight}
        savedVersion={rowHeightVersion}
        pending={preferences.saveRowHeight.isPending}
        onSave={(rowHeight) => preferences.saveRowHeight.mutateAsync(rowHeight)}
        compact
      />
      <SidebarTextScaleEditor
        saved={preferences.appearance.data?.textScale}
        savedVersion={textScaleVersion}
        pending={preferences.saveTextScale.isPending}
        onSave={(textScale) => preferences.saveTextScale.mutateAsync(textScale)}
        compact
      />
      <WorkingProviderAnimationEditor
        saved={preferences.appearance.data?.workingProviderAnimation}
        pending={preferences.saveWorkingProviderAnimation.isPending}
        onSave={(workingProviderAnimation) =>
          preferences.saveWorkingProviderAnimation.mutateAsync(
            workingProviderAnimation,
          )
        }
      />
    </SettingsCard>
  );
}

const workingProviderAnimationLabels: Record<WorkingProviderAnimation, string> =
  {
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

function WorkingProviderAnimationEditor({
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
    void onSave(next)
      .then(() =>
        toast.success(
          `Working animation set to ${workingProviderAnimationLabels[next]}`,
        ),
      )
      .catch((error: unknown) =>
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
