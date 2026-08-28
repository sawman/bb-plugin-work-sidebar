import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";

type AddThreadGroupControlProps = {
  onAddGroup(name: string): boolean;
};

export function AddThreadGroupControl({
  onAddGroup,
}: AddThreadGroupControlProps) {
  const [name, setName] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setName(null);
    triggerRef.current?.focus();
  };
  const create = () => {
    if (name?.trim() && onAddGroup(name)) close();
  };
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      create();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ws-thread-group-add"
        title="Add group"
        aria-label="Add group"
        aria-expanded={name !== null}
        onClick={() => setName((current) => (current === null ? "" : null))}
      >
        <Icon name="Plus" aria-hidden />
      </button>
      {name !== null && (
        <form
          className="ws-thread-group-create"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            aria-label="Group name"
            autoFocus
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleNameKeyDown}
          />
        </form>
      )}
    </>
  );
}
