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

function normalize(logins: readonly string[]): string[] {
  return [...new Set(logins.map((login) => login.toLocaleLowerCase()))].sort();
}

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
  const update = useUpdatePullRequestReviewers(rpc);
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
  const dirty =
    JSON.stringify(normalize(selected)) !==
    JSON.stringify(normalize(requestedReviewers));
  const save = async () => {
    try {
      await update.mutateAsync({
        repository,
        number,
        reviewers: [...selected].sort((left, right) =>
          left.localeCompare(right, undefined, { sensitivity: "base" }),
        ),
      });
      toast.success("Reviewers updated");
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update reviewers",
      );
    }
  };

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
          <button type="button" onClick={close} disabled={update.isPending}>Cancel</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || update.isPending || directory.isError}
          >
            {update.isPending ? "Saving…" : "Save reviewers"}
          </button>
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
      }}
      open
      options={options}
      placeholder="Search reviewers…"
      portal
      selectedValues={selected}
    />
  );
}
