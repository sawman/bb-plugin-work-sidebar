import { useId } from "react";
import { toast } from "sonner";
import { SettingsLabel, SettingsRow } from "../../components/ui/settings";
import { DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER } from "./sidebar-appearance";

export function ExternalPrModifierEditor({
  saved,
  pending,
  onSave,
}: {
  saved: boolean | undefined;
  pending: boolean;
  onSave(value: boolean): Promise<unknown>;
}) {
  const id = useId();
  const enabled = saved ?? DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER;
  return (
    <SettingsRow
      layout="inline-toggle"
      className="ws-sidebar-appearance-field"
    >
      <SettingsLabel htmlFor={id}>
        Open PRs externally with ⌘/Ctrl-click
      </SettingsLabel>
      <input
        className="ws-settings-toggle"
        id={id}
        type="checkbox"
        checked={enabled}
        disabled={pending}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          void onSave(next).then(
            () =>
              toast.success(
                next
                  ? "Modified PR links open externally"
                  : "Modified PR links follow BB",
              ),
            (error: unknown) =>
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Could not save PR link preference",
              ),
          );
        }}
      />
    </SettingsRow>
  );
}
