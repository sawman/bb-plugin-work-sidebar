import { experimental_FileLink } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";

/** Keep preview, context menu and all modifier navigation in the host. */
export function ThreadStorageFileLink({ threadId, path, children }: {
  threadId: string;
  path: string;
  children: ReactNode;
}) {
  const FileLink = experimental_FileLink;
  return (
    <FileLink className="ws-storage-row" target={{ kind: "thread-storage", threadId, path }}>
      {children}
    </FileLink>
  );
}
