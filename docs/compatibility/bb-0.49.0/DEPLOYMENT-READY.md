# BB 0.49.0 deployment boundary

Worker staging only. Root owns review, deployment, final acceptance and task
completion. No installed bundle writes, built-in reload, BB restart or UI changes
occurred in this audit. SDK/Sidebar migration and its own validation belong to
BBPLUG-466; its owner supplies SIDEBAR-SDK.md for integration.

Use only exact BB 0.49.0 / SDK 0.6.132 and immutable source
`7b26cae79ec978fafd0a5db0e8517e94f12eb8f4`. Source and artifact results are in the
[audit](README.md). Pristine rollback for all three plugin sets is
[version-pinned in Git](../../../bb-plugins/rollback/bb-0.49.0/README.md).
Automations is retired and has no overrides. No core artifact or BB restart is required.

## Questions disposal gate

**Require zero pending/resolving Questions forms before any Questions artifact
write and again immediately before Questions reload.** Never auto-answer,
cancel, dismiss or re-ask user forms to manufacture zero. Forms, drafts,
navigation, theme and zoom must remain intact. If forms remain, defer Questions.
This gate does not authorize unrelated Tasks/Sidebar deployment by itself.

Exact 0.49 source confirms the hazard: plugin-runtime disposal aborts plugin tool
calls and interrupts owned plugin interactions; DB interruption covers both
`pending` and `resolving`. The local ACP queue is in plugin memory and does not
survive disposal. Artifact rollback cannot restore that queue. Source links and
hashes are pinned in [source-manifest.json](source-manifest.json).

Supported native inventory uses `bb thread list --include-hidden --json` without
project/environment/parent filters, then `bb thread interactions list <id> --json`
for every returned unarchived thread across all projects. Both commands return
bare arrays in 0.49, with no pagination. Shipped list route/service includes
both pending and resolving interactions. Do not substitute Sidebar state or a
raw/private database read. Help and exact CLI/route/service source were checked.

Root can run the following read-only recipe in its existing environment, with
a fresh output path. It stores metadata only; failed/missing/unexpected reads
block the gate. It also rejects a changed thread inventory during the sweep.
The outcome is point-in-time evidence, not a lock against new questions: root
must choose a quiet write/reload window and repeat immediately before reload.

```sh
export BB_QUESTIONS_GATE_OUT="$BB_THREAD_STORAGE/questions-zero-form-before-write.json"
python3 - <<'GATE'
import datetime
import json
import os
from pathlib import Path
import subprocess

def read_native(arguments):
    result = subprocess.run(["bb", *arguments, "--json"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Native read failed: {' '.join(arguments)}")
    payload = json.loads(result.stdout)
    if not isinstance(payload, list):
        raise RuntimeError(f"Expected native array: {' '.join(arguments)}")
    return payload

gate_path = Path(os.environ["BB_QUESTIONS_GATE_OUT"])
if gate_path.exists():
    raise RuntimeError("Use a fresh gate output path")
record = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "passed": False, "threads": [], "questions": []}
try:
    version = subprocess.run(["bb", "--version"], capture_output=True, text=True)
    if version.returncode or version.stdout.strip() != "0.49.0":
        raise RuntimeError("Questions gate requires the verified BB 0.49.0 CLI")
    threads = read_native(["thread", "list", "--include-hidden"])
    thread_ids = []
    for thread in threads:
        thread_id = thread["id"]
        if not isinstance(thread_id, str) or not thread_id.startswith("thr_"):
            raise RuntimeError("Malformed thread identity")
        if thread.get("archivedAt") is not None:
            raise RuntimeError("Unexpected archived thread in unarchived inventory")
        thread_ids.append(thread_id)
        record["threads"].append(thread_id)
        for interaction in read_native(["thread", "interactions", "list", thread_id]):
            origin = interaction.get("origin", {})
            if (origin.get("kind") == "plugin" and
                    origin.get("pluginId") == "ask-user-question" and
                    interaction["status"] in ("pending", "resolving")):
                record["questions"].append({"threadId": thread_id,
                    "interactionId": interaction["id"], "status": interaction["status"],
                    "origin": {key: origin[key] for key in ("kind", "pluginId", "rendererId")}})
    after_ids = [thread["id"] for thread in read_native(["thread", "list", "--include-hidden"])]
    if len(set(thread_ids)) != len(thread_ids) or set(after_ids) != set(thread_ids):
        raise RuntimeError("Thread inventory changed or contains duplicates; defer writes")
    if record["questions"]:
        raise RuntimeError(f"Questions forms remain: {len(record['questions'])}; defer writes/reload")
    record["passed"] = True
except Exception as error:
    record["error"] = str(error)
finally:
    record["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    gate_path.write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"passed": record["passed"], "threadsRead": len(record["threads"]),
                  "questionsRemaining": len(record["questions"]), "record": str(gate_path)}))
if not record["passed"]:
    raise SystemExit(1)
GATE
```

Use a second fresh filename for the pre-reload pass. Root has not run this
inventory as part of the worker audit. Existing active Questions are preserved.

## Verification and deployment

The mandatory artifact verifier is separate from sync and never reloads plugins.
The accepted manifest checks six required files for each patched plugin and the
complete pristine installed set for all three, including untouched files.
`--deploy` is valid only for an exact pristine matching installation, with an
unused backup directory. Its backup and readback cover the full set. If installed
bytes changed after this audit, stop and reconcile before writes.

```sh
BB_PATCH_SOURCE_ROOT=/Users/matthewsaw/.bb/patch-sources/desktop-v0.49.0 npm run bb-plugins:sync -- --keep-workspace
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.49.0/artifact-manifest.json
```

A fresh stage must be compared with the accepted manifest via `--stage-root`;
hash differences require review. Never use sync's historical unchecked
`--deploy` path, which skips absent artifacts.

Only root, after review, all source/SDK/artifact gates and the zero-form gate:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.49.0/artifact-manifest.json --deploy --backup-root "$HOME/.bb/patch-backups/bb-0.49.0-reviewed-467"
PYTHONDONTWRITEBYTECODE=1 python3 bb-plugins/verify-artifacts.py docs/compatibility/bb-0.49.0/artifact-manifest.json --verify-installed
# Repeat zero-form inventory immediately before this reload:
bb plugin reload ask-user-question
bb plugin reload tasks
```

These commands are a reviewable root recipe, not worker actions or a deployment
claim. Reloads can dispose active plugin work; root owns timing and acceptance.
Restore the matching rollback archives or verified full-set backup on failure,
verify every member and exact directory membership, then apply the same Questions
disposal gate before its reload. Git rollback boundary is clean worker base
`3ce2f2e226f1c5421780ddc91acd5a6f37fb74b6`; reverting the bounded candidate
removes catalog/docs/patch changes but does not restore installed bytes.

Live 0.49 acceptance remains root-owned: ACP per-answer auto-delivery with
unanswered queue retained, rendered form pointer/keyboard use, Tasks scoped RPC
and dispatch parenting, both Sidebar surfaces, themes and interaction states.
Historical 0.47 acceptance does not certify 0.49. No new live forms or destructive
disposal probes are required for this worker's source audit.
