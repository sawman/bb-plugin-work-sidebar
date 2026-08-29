import {
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/ui/icon";
import { SidebarListIconButton } from "@/components/ui/sidebar-list-actions";
import { BbUrlLink } from "@/components/ui/url-link";
import { SidebarRowHeightEditor } from "./sidebar-appearance-settings";
import {
  ThreadGroupOrderSettings,
  type ThreadGroupSettingsProps,
} from "./sidebar-group-order-settings";

type ThreadListSettingsProps = {
  rowHeight: number | undefined;
  rowHeightPending: boolean;
  onSaveRowHeight(rowHeight: number): Promise<{ rowHeight: number }>;
  groups?: ThreadGroupSettingsProps;
};

export function ThreadListSettings({
  rowHeight,
  rowHeightPending,
  onSaveRowHeight,
  groups,
}: ThreadListSettingsProps) {
  const [open, setOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeSettings = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node))
        closeSettings({ restoreFocus: false });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSettings();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div className="ws-thread-settings" ref={settingsRef}>
      <SidebarListIconButton
        ref={triggerRef}
        title="Thread list settings"
        aria-label="Thread list settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="Wrench" aria-hidden />
      </SidebarListIconButton>
      {open && (
        <div
          ref={dialogRef}
          className="ws-thread-settings-menu"
          role="dialog"
          aria-label="Thread list settings"
          tabIndex={-1}
        >
          <div
            className="ws-thread-appearance-settings"
            role="group"
            aria-label="Appearance"
          >
            <SidebarRowHeightEditor
              saved={rowHeight}
              pending={rowHeightPending}
              onSave={onSaveRowHeight}
              compact
            />
            <BbUrlLink
              className="ws-thread-settings-link"
              href="/settings/plugins/work-sidebar"
              aria-label="Open Work Sidebar settings"
              onClick={() => closeSettings({ restoreFocus: false })}
            >
              Plugin settings
            </BbUrlLink>
          </div>
          {groups ? <ThreadGroupOrderSettings settings={groups} /> : null}
        </div>
      )}
    </div>
  );
}
