import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("artifact_verifier", Path(__file__).with_name("verify-artifacts.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ArtifactVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.stage = self.root / "stage"
        self.backup = self.root / "backup"
        self.manifest = {"bbVersion": "0.47.1", "sdkVersion": "0.6.79", "requiredFiles": [
            "server.js", "server.js.map", "server.meta.json", "app.js", "app.css", "app.meta.json"], "plugins": []}
        self.baseline = {"artifacts": []}
        for plugin in ("ask-user-question", "tasks", "automations"):
            relative = f"server/dist/builtin-plugins/{plugin}/dist"
            metadata = json.dumps({"pluginId": plugin, "sdkVersion": "0.6.79", "builtWith": {
                "bbVersion": "0.47.1", "pluginSdkVersion": "0.6.79"}}).encode()
            entries = []
            for name in self.manifest["requiredFiles"]:
                payload = metadata if name.endswith("meta.json") else b"pristine"
                target = self.app / relative / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                self.baseline["artifacts"].append({"pluginId": plugin, "file": name,
                    "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
                if plugin != "automations":
                    staged = self.stage / plugin / name
                    staged.parent.mkdir(parents=True, exist_ok=True)
                    payload = metadata if name.endswith("meta.json") else b"patched"
                    staged.write_bytes(payload)
                    entries.append({"file": name, "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
            if entries:
                self.manifest["plugins"].append({"pluginId": plugin, "installedPath": relative, "artifacts": entries})

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_stage_file_blocks_before_backup_or_writes(self):
        (self.stage / "tasks/app.css").unlink()
        with self.assertRaisesRegex(ValueError, "Missing required"):
            verifier.deploy(self.manifest, self.baseline, self.stage, self.app, self.backup)
        self.assertFalse(self.backup.exists())
        verifier.verify_baseline(self.manifest, self.baseline, self.app)

    def test_incomplete_pristine_install_blocks_before_writes(self):
        (self.app / "server/dist/builtin-plugins/tasks/dist/app.css").unlink()
        with self.assertRaisesRegex(ValueError, "Missing required"):
            verifier.deploy(self.manifest, self.baseline, self.stage, self.app, self.backup)
        self.assertFalse(self.backup.exists())
        self.assertEqual((self.app / "server/dist/builtin-plugins/tasks/dist/server.js").read_bytes(), b"pristine")

    def test_copy_and_readback_preserve_complete_backup(self):
        verifier.deploy(self.manifest, self.baseline, self.stage, self.app, self.backup)
        verifier.verify_installed(self.manifest, self.baseline, self.app)
        verifier.verify_baseline(self.manifest, self.baseline, self.backup)

    def test_corrupt_readback_restores_all_pristine_artifacts(self):
        original_copy = verifier.shutil.copy2
        corrupted = False

        def copy_with_corruption(source, destination):
            nonlocal corrupted
            result = original_copy(source, destination)
            if not corrupted and Path(destination) == self.app / "server/dist/builtin-plugins/tasks/dist/server.js":
                Path(destination).write_bytes(b"corrupted")
                corrupted = True
            return result

        with patch.object(verifier.shutil, "copy2", side_effect=copy_with_corruption):
            with self.assertRaisesRegex(ValueError, "size/hash mismatch"):
                verifier.deploy(self.manifest, self.baseline, self.stage, self.app, self.backup)
        verifier.verify_baseline(self.manifest, self.baseline, self.app)


if __name__ == "__main__":
    unittest.main()
