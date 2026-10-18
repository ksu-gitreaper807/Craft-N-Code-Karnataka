"""One JSON request in, one JSON result out. Production runs only inside Docker."""

import json
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import sys
import tempfile
import time

OUTPUT_LIMIT = 16_384
ALLOWED_HEADERS = {
    "assert.h", "ctype.h", "errno.h", "float.h", "inttypes.h", "limits.h",
    "math.h", "stdbool.h", "stddef.h", "stdint.h", "stdio.h", "stdlib.h",
    "iostream", "vector", "algorithm", "queue", "stack", "list", "deque", "map", "set",
    "unordered_map", "unordered_set", "string", "array", "utility", "tuple", "numeric",
    "functional", "limits", "cmath", "cstdio", "cstdlib", "cstring", "cassert",
    "cstdint", "cstddef", "memory", "iterator", "iomanip", "sstream", "bitset", "optional",
    "bits/stdc++.h",
    "string.h", "time.h", "unistd.h", "stack.h", "linked_list.h", "queue.h", "search.h",
}
LIB = Path(__file__).resolve().parent / "lib"
FLAGS = [
    "-std=c++17", "-g", "-O0", "-Wall", "-Wextra", "-fno-omit-frame-pointer",
    "-fno-diagnostics-color", "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
]


def strip_comments(source):
    # Keep string literals and newline positions intact while removing comments.
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|/\*[\s\S]*?\*/|//[^\n]*'
    return re.sub(pattern, lambda m: re.sub(r"[^\n]", " ", m[0])
                  if m[0].startswith(("/*", "//")) else m[0], source)


def validate_source(source, language="c"):
    if language not in ("c", "python"):
        return "Choose C++ or Python."
    if not isinstance(source, str) or not source.strip():
        return "Write some code before running."
    if len(source.encode()) > 32_768 or "\0" in source:
        return "Source must be at most 32 KiB and contain no NUL characters."
    if language == "python":
        return None
    # Resolve continuations before checking includes; reject macro/absolute includes.
    normalized = strip_comments(re.sub(r"\\\r?\n", "", source))
    for match in re.finditer(r"^\s*#\s*(include\w*|import|embed)\b([^\n]*)", normalized, re.M):
        header = re.fullmatch(r"\s*<([a-z0-9_./+]+)>\s*", match[2])
        if match[1] != "include" or not header or header[1] not in ALLOWED_HEADERS:
            return "Use supported standard headers or the curated library headers; macro and file-path includes are disabled."
    return None


def runtime_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))
    resource.setrlimit(resource.RLIMIT_CPU, (3, 4))


def run_phase(command, cwd, stdin="", timeout=5, runtime=False, detect_leaks=True):
    env = {
        **os.environ,
        "LC_ALL": "C",
        "ASAN_OPTIONS": f"detect_leaks={int(detect_leaks)}:abort_on_error=0:color=never",
        "UBSAN_OPTIONS": "print_stacktrace=1:halt_on_error=1:color=never",
    }
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(
            command, cwd=cwd, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
            start_new_session=True, env=env,
            preexec_fn=runtime_limits if runtime else None,
        )
        timed_out = False
        try:
            process.communicate(stdin.encode(), timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        finally:
            # Reap descendants too, including a child left behind by an exited parent.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        output_size = stdout.tell() + stderr.tell()
        stdout.seek(0)
        stderr.seek(0)
        out = stdout.read(OUTPUT_LIMIT).decode("utf-8", "replace")
        err = stderr.read(OUTPUT_LIMIT).decode("utf-8", "replace")
        return {
            "stdout": out, "stderr": err, "exitCode": process.returncode,
            "timedOut": timed_out,
            "outputLimited": output_size >= OUTPUT_LIMIT or process.returncode == -signal.SIGXFSZ,
        }


def parse_diagnostics(compiler_output, runtime_output):
    diagnostics = []
    for match in re.finditer(r"board\.c(?:pp)?:(\d+):(\d+): (fatal error|error|warning|note): ([^\n]+)", compiler_output):
        if match[3] == "note":
            continue
        diagnostics.append({
            "line": int(match[1]), "column": int(match[2]),
            "severity": "warning" if match[3] == "warning" else "error",
            "message": match[4], "kind": "compiler",
        })
    contract = re.search(r"\[(stack|linked_list|queue|search)\] CONTRACT: (.+), board line (\d+)", runtime_output)
    if contract:
        diagnostics.append({
            "line": int(contract[3]), "severity": "error", "kind": "contract",
            "message": f"{contract[1]}: {contract[2]}",
        })
    else:
        summary = re.search(r"(?:ERROR: (?:AddressSanitizer|LeakSanitizer):|runtime error:) ([^\n]+)", runtime_output)
        # For library failures the first board.cpp (or historical board.c) frame is the teacher's callsite.
        locations = re.finditer(r"board\.c(?:pp)?:(\d+)(?::(\d+))?", runtime_output)
        seen = set()
        for match in locations:
            line = int(match[1])
            if line in seen:
                continue
            seen.add(line)
            diagnostics.append({
                "line": line, "column": int(match[2] or 1), "severity": "error",
                "kind": "runtime", "message": summary[1] if summary else "Runtime diagnostic at this board line.",
            })
    return diagnostics


def teaching_notes(source):
    code = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', ' ', strip_comments(source))
    notes = []
    if re.search(r"\b(?:malloc|calloc|realloc)\s*\(", code):
        notes.append({"title": "Two places, one pointer", "body":
                      "A local pointer lives on the stack; its allocated buffer has dynamic storage. "
                      "The printed addresses come from this run. AddressSanitizer changes allocation layout, "
                      "so these addresses do not identify glibc brk or mmap regions."})
    if re.search(r"\bfree\s*\(", code):
        notes.append({"title": "After free", "body":
                      "The allocation is no longer yours to access. Other pointers to it also become dangling. "
                      "Setting one pointer to NULL does not repair its aliases."})
    if re.search(r"\brealloc\s*\(", code):
        notes.append({"title": "Keep the old allocation on failure", "body":
                      "realloc may move the buffer and invalidate old aliases. If it fails, the original "
                      "allocation remains valid; assign the result to a temporary pointer before replacing the owner."})
    if re.search(r"\bstack_(?:push|pop)\s*\(", code):
        notes.append({"title": "A visible abstraction", "body":
                      "stack_push grows a heap buffer with realloc; stack_pop requires a nonempty stack. "
                      "The caller must initialize the stack and release its buffer with stack_free."})
    if re.search(r"\bscanf\s*\(", code):
        notes.append({"title": "Input is a contract too", "body":
                      "Check scanf's return value before using its outputs. Blue text supplies stdin; "
                      "when it is exhausted, the program receives EOF."})
    if re.search(r"\bfgets\s*\(", code):
        notes.append({"title": "Bounded line input", "body":
                      "fgets reads at most size - 1 characters and appends a NUL byte. Check for NULL at EOF "
                      "and remember that a trailing newline may remain in the buffer."})
    if re.search(r"\bmemcpy\s*\(", code):
        notes.append({"title": "Copies need valid ranges", "body":
                      "memcpy needs readable and writable ranges for its byte count. The ranges must not "
                      "overlap; use memmove when they may overlap."})
    if re.search(r"\blist_(?:push_front|push_back|insert|erase|pop_front)\s*\(", code):
        notes.append({"title": "Follow the links", "body":
                      "Each list node owns a value and a link to the next node. Front and tail insertion are O(1); "
                      "index-based operations traverse the list. list_free releases all remaining nodes."})
    if re.search(r"\bqueue_(?:push|pop)\s*\(", code):
        notes.append({"title": "First in, first out", "body":
                      "The queue wraps around a circular buffer and grows when full. Push is amortized O(1); "
                      "front and pop are O(1). queue_free releases the buffer."})
    if re.search(r"(?<![:\w])(?:binary_search|lower_bound|upper_bound)\s*\(", code):
        notes.append({"title": "Halve the search space", "body":
                      "These searches require an ascending sorted array. Each step halves the remaining interval. "
                      "binary_search returns the first match or -1; bounds locate the start and end of equal values."})
    return notes


def python_diagnostics(output):
    message = output.strip().splitlines()[-1] if output.strip() else "Python error at this line."
    kind = "compiler" if re.search(r"(?:SyntaxError|IndentationError|TabError):", output) else "runtime"
    lines = dict.fromkeys(int(match[1]) for match in re.finditer(r'File "[^"\n]*board\.py", line (\d+)', output))
    return [{"line": line, "column": 1, "severity": "error", "kind": kind, "message": message} for line in lines]


def execute_python(source, stdin, result):
    try:
        compile(source, "board.py", "exec")
    except (SyntaxError, ValueError, RecursionError) as error:
        result.update(status="compile_error", compilerOutput=f'{type(error).__name__}: {error}')
        if isinstance(error, SyntaxError):
            result["diagnostics"] = [{"line": error.lineno or 1, "column": error.offset or 1,
                                      "severity": "error", "kind": "compiler", "message": f'{type(error).__name__}: {error.msg}'}]
        return result
    with tempfile.TemporaryDirectory(prefix="board-") as work:
        path = Path(work, "board.py")
        path.write_text(source, encoding="utf-8")
        run = run_phase([sys.executable, "-I", "-B", "-u", str(path)], work, stdin, runtime=True)
        result.update(stdout=run["stdout"], stderr=run["stderr"], exitCode=run["exitCode"],
                      diagnostics=python_diagnostics(run["stderr"]))
        result["status"] = ("timeout" if run["timedOut"] or run["exitCode"] == -signal.SIGXCPU else
                            "output_limit" if run["outputLimited"] else
                            "success" if run["exitCode"] == 0 else "runtime_error")
    return result


def execute(payload, lib=LIB, *, detect_leaks=True):
    started = time.monotonic()
    result = {
        "status": "invalid_source", "stdout": "", "stderr": "", "compilerOutput": "",
        "diagnostics": [], "notes": [], "exitCode": None, "durationMs": 0,
    }
    source = payload.get("source")
    stdin = payload.get("stdin", "")
    language = payload.get("language", "c")
    error = validate_source(source, language)
    if not isinstance(stdin, str) or len(stdin.encode()) > 8192 or "\0" in stdin:
        error = "Input must be text of at most 8 KiB without NUL characters."
    if error:
        result["stderr"] = error
        return result
    if language == "python":
        result = execute_python(source, stdin, result)
        result["durationMs"] = round((time.monotonic() - started) * 1000)
        return result
    result["notes"] = teaching_notes(source)
    with tempfile.TemporaryDirectory(prefix="board-") as work:
        Path(work, "board.cpp").write_text(source, encoding="utf-8")
        compile_result = run_phase(
            ["g++", *FLAGS, "-I", str(lib), "board.cpp", "-o", "board", "-lm"], work, timeout=10,
        )
        result["compilerOutput"] = compile_result["stdout"] + compile_result["stderr"]
        result["diagnostics"] = parse_diagnostics(result["compilerOutput"], "")
        if compile_result["timedOut"]:
            result.update(status="timeout", stderr="Compilation exceeded 10 seconds.")
        elif compile_result["outputLimited"]:
            result.update(status="output_limit", stderr="Compiler output exceeded the limit.")
        elif compile_result["exitCode"] != 0:
            result["status"] = "compile_error"
        else:
            run = run_phase([str(Path(work, "board"))], work, stdin, runtime=True, detect_leaks=detect_leaks)
            result.update(stdout=run["stdout"], stderr=run["stderr"], exitCode=run["exitCode"])
            result["diagnostics"] = parse_diagnostics(result["compilerOutput"], run["stderr"])
            if run["timedOut"] or run["exitCode"] == -signal.SIGXCPU:
                result["status"] = "timeout"
            elif run["outputLimited"]:
                result["status"] = "output_limit"
            else:
                result["status"] = "success" if run["exitCode"] == 0 else "runtime_error"
    result["durationMs"] = round((time.monotonic() - started) * 1000)
    return result


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(65_537)
        if len(raw) > 65_536:
            raise ValueError("Request exceeds 64 KiB.")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("Expected a JSON object.")
        print(json.dumps(execute(request)))
    except (ValueError, OSError) as exc:
        print(json.dumps({"status": "runner_error", "error": str(exc)}))
        sys.exit(1)
