import { useCallback, useMemo, useState, type RefObject } from "react";
import { toast } from "sonner";
import { SearchCombobox } from "../../components/ui/combobox";
import { Icon } from "../../components/ui/icon";
import {
  usePullRequestReviewers,
  useUpdatePullRequestReviewers,
  type PullRequestRpc,
} from "./queries";
import type { PullRequestReviewerContract } from "./schemas";

export function PullRequestReviewerPicker({
  rpc,
  repository,
  number,
  title,
  requestedReviewers,
  anchorRef,
  onClose,
}: {
  rpc: PullRequestRpc;
  repository: string;
  number: number;
  title: string;
  requestedReviewers: readonly string[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const directory = usePullRequestReviewers(rpc, repository, true);
  const update = useUpdatePullRequestReviewers(rpc, {
    onSuccess: () => toast.success("Reviewers saved"),
    onError: (error) => toast.error(error.message),
  });
  const [selected, setSelected] = useState<string[]>([...requestedReviewers]);
  const close = useCallback(() => {
    onClose();
    requestAnimationFrame(() => anchorRef.current?.focus());
  }, [anchorRef, onClose]);
  const options = useMemo(() => {
    const byLogin = new Map<string, PullRequestReviewerContract>();
    for (const reviewer of directory.data ?? [])
      byLogin.set(reviewer.login.toLocaleLowerCase(), reviewer);
    for (const login of requestedReviewers)
      if (!byLogin.has(login.toLocaleLowerCase()))
        byLogin.set(login.toLocaleLowerCase(), { login, name: null, avatarUrl: null });
    return [...byLogin.values()]
      .sort((left, right) =>
        left.login.localeCompare(right.login, undefined, { sensitivity: "base" }),
      )
      .map((reviewer) => ({
        value: reviewer.login,
        label: reviewer.login,
        detail: reviewer.name ?? undefined,
        leading: <Icon name={selected.includes(reviewer.login) ? "Check" : "User"} />,
      }));
  }, [directory.data, requestedReviewers, selected]);
  const save = (reviewers: string[]) =>
    update.mutate({
      repository,
      number,
      reviewers: [...reviewers].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ),
    });

  return (
    <SearchCombobox
      anchorRef={anchorRef}
      ariaLabel="Search reviewers"
      autoFocus
      busy={directory.isPending}
      closeOnSelect={false}
      emptyMessage="No matching reviewers."
      error={directory.isError ? { message: directory.error.message } : null}
      footer={
        <>
          {update.isError ? <div className="ws-search-shell-error" role="alert">{update.error.message}</div> : null}
          <span className="ws-search-shell-status" aria-live="polite">
            {update.isPending ? "Saving reviewers…" : "Changes save automatically"}
          </span>
          <button type="button" onClick={close}>Close</button>
        </>
      }
      header={
        <span>
          <strong>Reviewers for PR #{number}</strong>
          <small>{title}</small>
        </span>
      }
      listboxLabel="Available reviewers"
      multiple
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onRetry={() => void directory.refetch()}
      onSelectionChange={(values) => {
        update.reset();
        setSelected(values);
        save(values);
      }}
      open
      options={options}
      placeholder="Search reviewers…"
      portal
      selectedValues={selected}
    />
  );
}
