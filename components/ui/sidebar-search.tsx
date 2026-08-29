import { useRef, useState } from "react";
import { SearchCombobox } from "./combobox";
import { Icon } from "./icon";
import { SidebarListIconButton } from "./sidebar-list-actions";

/** Toolbar search delegates portal, dismissal, and focus behaviour to R35 shell. */
export function SidebarSearch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange(value: string): void;
}) {
  const [open, setOpen] = useState(() => value.trim().length > 0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    onValueChange("");
    setOpen(false);
  };
  return (
    <>
      <SidebarListIconButton
        ref={triggerRef}
        title={`Search ${label}`}
        aria-label={`Search ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="Search" aria-hidden />
      </SidebarListIconButton>
      <SearchCombobox
        anchorRef={triggerRef}
        ariaLabel={`Search ${label}`}
        className="ws-sidebar-search-popover"
        emptyMessage=""
        hideResults
        inputClassName="ws-sidebar-search-input"
        listboxLabel={`Search ${label}`}
        onDismiss={() => onValueChange("")}
        onOpenChange={setOpen}
        onQueryChange={onValueChange}
        onSelectionChange={() => undefined}
        open={open}
        options={[]}
        placeholder={`Search ${label}…`}
        portal
        query={value}
        searchOnly
        selectedValues={[]}
      />
    </>
  );
}
