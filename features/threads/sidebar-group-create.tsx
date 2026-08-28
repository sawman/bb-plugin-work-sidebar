import { useState } from "react";

type AddThreadGroupControlProps = {
  onAddGroup(name: string): boolean;
};

export function AddThreadGroupControl({
  onAddGroup,
}: AddThreadGroupControlProps) {
  const [name, setName] = useState<string | null>(null);
  if (name === null)
    return (
      <button className="ws-thread-group-add" onClick={() => setName("")}>
        Add group
      </button>
    );

  return (
    <form
      className="ws-thread-group-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (onAddGroup(name)) setName(null);
      }}
    >
      <input
        aria-label="Group name"
        autoFocus
        maxLength={40}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="ws-thread-group-create-actions">
        <button type="submit" disabled={!name.trim()}>
          Create
        </button>
        <button type="button" onClick={() => setName(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
