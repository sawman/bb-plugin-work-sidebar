#!/usr/bin/env python3
"""Verify an accepted exact stage; optionally copy with backup and readback.

Separate from patch-sync's build pipeline (BBPLUG-434). Never reloads plugins.
Default invocation is read-only. --deploy requires an unused backup directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def read_json(path):
    return json.loads(path.read_text())


def verify_file(path, expected):
    if not path.is_file():
        raise ValueError(f"Missing required artifact: {path}")
    payload = path.read_bytes()
    if len(payload) != expected["size"] or hashlib.sha256(payload).hexdigest() != expected["sha256"]:
        raise ValueError(f"Artifact size/hash mismatch: {path}")


def verify_metadata(folder, plugin, manifest):
    for name in ("server.meta.json", "app.meta.json"):
        metadata = read_json(folder / name)
        if (metadata.get("pluginId") != plugin
                or metadata.get("sdkVersion") != manifest["sdkVersion"]
                or metadata.get("builtWith") != {
                    "bbVersion": manifest["bbVersion"],
                    "pluginSdkVersion": manifest["sdkVersion"],
                }):
            raise ValueError(f"Artifact identity/version mismatch: {folder / name}")


def verify_stage(manifest, stage):
    if ({plugin["pluginId"] for plugin in manifest["plugins"]} != {"ask-user-question", "tasks"}
            or len(manifest["plugins"]) != 2):
        raise ValueError("Manifest must include Questions and Tasks exactly once")
    required = set(manifest["requiredFiles"])
    if required != {"server.js", "server.js.map", "server.meta.json", "app.js", "app.css", "app.meta.json"}:
        raise ValueError("Manifest must name all six required artifacts")
    for plugin in manifest["plugins"]:
        if plugin["installedPath"] != f"server/dist/builtin-plugins/{plugin['pluginId']}/dist":
            raise ValueError(f"Unexpected installed artifact path: {plugin['pluginId']}")
        entries = plugin["artifacts"]
        if {entry["file"] for entry in entries} != required or len(entries) != len(required):
            raise ValueError(f"Incomplete artifact manifest: {plugin['pluginId']}")
        for entry in entries:
            verify_file(stage / plugin["pluginId"] / entry["file"], entry)
        verify_metadata(stage / plugin["pluginId"], plugin["pluginId"], manifest)


def verify_baseline(manifest, baseline, app):
    for plugin in ("ask-user-question", "tasks", "automations"):
        entries = [entry for entry in baseline["artifacts"] if entry["pluginId"] == plugin]
        if not set(manifest["requiredFiles"]).issubset({entry["file"] for entry in entries}):
            raise ValueError(f"Incomplete pristine manifest: {plugin}")
        folder = app / "server/dist/builtin-plugins" / plugin / "dist"
        for entry in entries:
            verify_file(folder / entry["file"], entry)
        verify_metadata(folder, plugin, manifest)


def verify_installed(manifest, baseline, app):
    for plugin in manifest["plugins"]:
        folder = app / plugin["installedPath"]
        for entry in plugin["artifacts"]:
            verify_file(folder / entry["file"], entry)
        verify_metadata(folder, plugin["pluginId"], manifest)
    # Retirement means Automations must remain byte-for-byte pristine.
    for entry in baseline["artifacts"]:
        if entry["pluginId"] == "automations":
            verify_file(app / "server/dist/builtin-plugins/automations/dist" / entry["file"], entry)
    verify_metadata(app / "server/dist/builtin-plugins/automations/dist", "automations", manifest)


def deploy(manifest, baseline, stage, app, backup):
    verify_stage(manifest, stage)
    verify_baseline(manifest, baseline, app)
    backup.mkdir(parents=True, exist_ok=False)
    for entry in baseline["artifacts"]:
        relative = Path("server/dist/builtin-plugins") / entry["pluginId"] / "dist" / entry["file"]
        destination = backup / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(app / relative, destination)
    verify_baseline(manifest, baseline, backup)
    (backup / "pristine-manifest.json").write_text(json.dumps(baseline, indent=2) + "\n")
    try:
        for plugin in manifest["plugins"]:
            for entry in plugin["artifacts"]:
                shutil.copy2(stage / plugin["pluginId"] / entry["file"], app / plugin["installedPath"] / entry["file"])
        verify_installed(manifest, baseline, app)
    except BaseException:
        for entry in baseline["artifacts"]:
            relative = Path("server/dist/builtin-plugins") / entry["pluginId"] / "dist" / entry["file"]
            shutil.copy2(backup / relative, app / relative)
        verify_baseline(manifest, baseline, app)
        print("Copy/readback failed; pristine artifacts restored and verified")
        raise
    print(f"Copied exact verified stage; installed readback passed; backup: {backup}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--stage-root", type=Path)
    parser.add_argument("--app-root", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--verify-installed", action="store_true")
    mode.add_argument("--deploy", action="store_true")
    parser.add_argument("--backup-root", type=Path)
    args = parser.parse_args()
    manifest = read_json(args.manifest)
    baseline = read_json(args.manifest.parent / manifest["rollbackManifest"])
    stage = args.stage_root or Path(manifest["stageRoot"])
    app = args.app_root or Path(manifest["appRoot"])
    verify_stage(manifest, stage)
    if args.deploy:
        if args.backup_root is None:
            parser.error("--deploy requires an unused --backup-root")
        deploy(manifest, baseline, stage, app, args.backup_root)
    elif args.verify_installed:
        verify_installed(manifest, baseline, app)
        print("Installed readback matches every accepted stage artifact; Automations pristine")
    else:
        verify_baseline(manifest, baseline, app)
        print("All stage and pristine installed files, sizes, hashes and metadata verified")


if __name__ == "__main__":
    main()
