import { experimental_Diff, experimental_SourceCode } from "@get-bb/plugin-sdk/app";
import type { WorkingTreeFileDiff } from "./schemas.js";

function isPatch(patch: string): boolean {
  return patch.startsWith("diff --git ") || patch.includes("\n@@ ") || patch.startsWith("@@ ");
}

/** Keeps experimental host renderer signatures out of Changes feature views. */
export function HostWorkingTreeRenderer({ file }: { file: Extract<WorkingTreeFileDiff, { kind: "patch" }> }) {
  const Diff = experimental_Diff;
  const SourceCode = experimental_SourceCode;
  if (isPatch(file.patch))
    return <Diff
      patch={file.patch}
      path={file.path}
      view="unified"
      overflow="wrap"
      showLineNumbers
    />;
  return <SourceCode content={file.patch} path={file.path} overflow="wrap" />;
}
