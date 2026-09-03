import { useSidebarAppearancePreferences } from "./queries";
import {
  NumericAutosaveEditor,
  SettingsCard,
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
  validateSidebarRowHeight,
  validateTextScale,
} from "./sidebar-appearance";
import { GroupActivityPriorityEditor } from "./group-activity-priority-editor";
import { ExternalPrModifierEditor } from "./external-pr-modifier-editor";
import { WorkingProviderAnimationEditor } from "./working-provider-animation-editor";
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
      className={
        compact ? "ws-sidebar-row-height-editor" : "ws-sidebar-appearance-field"
      }
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
      className={
        compact ? "ws-sidebar-text-scale-editor" : "ws-sidebar-appearance-field"
      }
      cardClassName="ws-sidebar-text-scale-editor"
    />
  );
}
export function SidebarAppearanceSettings() {
  const preferences = useSidebarAppearancePreferences();
  const rowHeightVersion = useFieldSavedVersion(
    preferences.appearance.data?.rowHeight,
  );
  const textScaleVersion = useFieldSavedVersion(
    preferences.appearance.data?.textScale,
  );
  return (
    <SettingsCard
      className="ws-sidebar-appearance-settings"
      title="Sidebar appearance"
    >
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
      <GroupActivityPriorityEditor
        saved={preferences.appearance.data?.groupActivityPriority}
        pending={preferences.saveGroupActivityPriority.isPending}
        onSave={(groupActivityPriority) =>
          preferences.saveGroupActivityPriority.mutateAsync(
            groupActivityPriority,
          )
        }
      />
      <ExternalPrModifierEditor
        saved={preferences.appearance.data?.openPrLinksExternallyWithModifier}
        pending={preferences.saveOpenPrLinksExternallyWithModifier.isPending}
        onSave={(value) =>
          preferences.saveOpenPrLinksExternallyWithModifier.mutateAsync(value)
        }
      />
    </SettingsCard>
  );
}
