"""Verify an exported lesson, then replay it only inside a disposable Docker container."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent


def verify():
    manifest = json.loads((ROOT / "lib.lock").read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict):
        raise ValueError("Unsupported snapshot manifest.")
    for name, expected in manifest["files"].items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid manifest path.")
        path = ROOT / relative
        if any(ROOT.joinpath(*relative.parts[:i]).is_symlink() for i in range(1, len(relative.parts) + 1)):
            raise ValueError(f"Snapshot symlinks are not supported: {name}")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Snapshot integrity check failed: {name}")
    language = manifest.get("language", "c")
    if language not in ("c", "python"):
        raise ValueError("Unsupported snapshot language.")
    source_file = "board.py" if language == "python" else ("board.cpp" if "board.cpp" in manifest["files"] else "board.c")
    for name in [source_file, "input.txt", "runner.py", "Dockerfile", "build.sh", "replay.py"]:
        if name not in manifest["files"]:
            raise ValueError(f"Manifest is missing {name}.")
    headers = set((ROOT / "lib").glob("*.h")) if (ROOT / "lib").exists() else set()
    if {str(path.relative_to(ROOT)) for path in headers} != {name for name in manifest["files"] if name.startswith("lib/")}:
        raise ValueError("Snapshot contains unexpected library headers.")
    return manifest


def main():
    manifest = verify()
    if sys.argv[1:] == ["--verify"]:
        print("Snapshot integrity verified.")
        return
    if sys.argv[1:]:
        raise ValueError("Usage: bash build.sh [--verify]")
    name = "boardroom-replay-" + uuid.uuid4().hex
    image = "boardroom-snapshot:" + hashlib.sha256((ROOT / "lib.lock").read_bytes()).hexdigest()[:24]
    subprocess.run(["docker", "build", "--network=none", "-t", image, "."], cwd=ROOT, stdout=sys.stderr, check=True, timeout=180)
    language = manifest.get("language", "c")
    source_file = "board.py" if language == "python" else ("board.cpp" if "board.cpp" in manifest["files"] else "board.c")
    payload = json.dumps({"language": language, "source": (ROOT / source_file).read_bytes().decode("utf-8"),
                          "stdin": (ROOT / "input.txt").read_bytes().decode("utf-8")}, ensure_ascii=False)
    try:
        result = subprocess.run([
            "docker", "run", "--rm", "-i", "--name", name,
            "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--pids-limit", "64",
            "--memory", "512m", "--memory-swap", "512m", "--cpus", "1",
            "--ulimit", "core=0:0", "--ulimit", "nofile=64:64", "--ulimit", "fsize=16777216:16777216",
            "--tmpfs", "/tmp:rw,exec,nosuid,size=64m,mode=1777", "--user", "65534:65534", image,
        ], input=payload, text=True, check=True, timeout=30)
        return result.returncode
    finally:
        subprocess.run(["docker", "rm", "--force", name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=False)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Snapshot replay refused: {error}", file=sys.stderr)
        sys.exit(1)
