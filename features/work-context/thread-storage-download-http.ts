import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { safeStoragePath } from "./thread-storage-model.js";

/** Only the thread identifies the host/root; callers supply a confined relative file. */
export function registerThreadStorageDownloadRoute(bb: BbPluginApi) {
  bb.http.route("GET", "/thread-storage/download", async (context) => {
    const params = new URL(context.req.url).searchParams;
    const threadId = params.get("threadId") ?? "";
    const relativePath = params.get("path") ?? "";
    const errorHeaders = { "Cache-Control": "no-store" };
    if (!/^thr_[a-zA-Z0-9_-]{1,128}$/.test(threadId) || !safeStoragePath(relativePath)
      || params.getAll("threadId").length !== 1 || params.getAll("path").length !== 1
      || [...params.keys()].some((key) => key !== "threadId" && key !== "path")) {
      return new Response("Invalid file target", { status: 400, headers: errorHeaders });
    }
    try {
      const signal = context.req.raw.signal;
      const { hostId, storageRootPath } = await bb.sdk.threads.storageLocation({ threadId, signal });
      // These paths belong to the storage host, which may use a different OS.
      const paths = /^[a-zA-Z]:[\\/]|^\\\\/.test(storageRootPath) ? win32 : posix;
      if (!paths.isAbsolute(storageRootPath)) throw new Error("Invalid storage root");
      const file = await bb.sdk.files.read({
        hostId, rootPath: storageRootPath, path: paths.join(storageRootPath, ...relativePath.split("/")), signal,
      });
      // The host checks the real root/file boundary, rejects non-files, and caps reads.
      const bytes = Buffer.from(file.content, file.contentEncoding === "base64" ? "base64" : "utf8");
      if (bytes.length !== file.sizeBytes || bytes.length > 25 * 1024 * 1024
        || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Invalid file bytes");
      const name = relativePath.split("/").at(-1)!;
      const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(bytes), { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch {
      // Host errors may contain absolute paths; neither error bodies nor attachments expose them.
      return new Response("Could not download file", { status: 502, headers: errorHeaders });
    }
  }, { auth: "local" });
}
