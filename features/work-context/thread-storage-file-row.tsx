import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { experimental_saveFile, experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { Icon } from "../../components/ui/icon";
import { ThreadStorageFileLink } from "./thread-storage-file-link";

export function ThreadStorageFileRow({ threadId, path, name }: {
  threadId: string;
  path: string;
  name: string;
}) {
  const pluginId = experimental_usePluginId();
  const href = `/api/v1/plugins/${encodeURIComponent(pluginId)}/http/thread-storage/download?${new URLSearchParams({ threadId, path })}`;
  const preparing = useRef(false);
  const download = useMutation({
    retry: false,
    mutationFn: async () => {
      try {
        // Fetch the owned binary route first so an HTTP error never becomes a saved file.
        const response = await fetch(href, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not download file");
        const blob = await response.blob();
        if (await experimental_saveFile({ fileName: name, blob }) !== "started") throw new Error("Could not start download");
      } catch {
        throw new Error("Could not download file");
      } finally {
        preparing.current = false;
      }
    },
  });
  return (
    <>
      <div className="ws-storage-file-row">
        <ThreadStorageFileLink threadId={threadId} path={path}>
          <Icon name="File" aria-hidden />
          <span className="ws-storage-name">{name}</span>
        </ThreadStorageFileLink>
        <ActionTooltip label="Download file">
          {(tooltipId) => (
            <a className="ws-icon-button" href={href} download={name} rel="noopener" aria-label={`Download ${name}`}
              aria-describedby={tooltipId} aria-disabled={download.isPending || undefined} aria-busy={download.isPending || undefined}
              onClick={(event) => {
                if (preparing.current) { event.preventDefault(); return; }
                if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                preparing.current = true;
                download.mutate();
              }}>
              <Icon name="ArrowDown" aria-hidden />
            </a>
          )}
        </ActionTooltip>
      </div>
      {download.isPending ? <p className="ws-card-note" role="status">Preparing {name}…</p> : null}
      {download.isError ? <p className="ws-card-note" role="alert">Could not download {name}. Try again.</p> : null}
    </>
  );
}
