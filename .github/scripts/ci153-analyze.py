#!/usr/bin/env python3
"""Offline analysis of the frozen PR153 ABBA artifact; standard library only.

Usage: python3 analyze-controlled.py EXTRACTED_ARTIFACT NEW_OUTPUT_DIRECTORY
The output directory must not exist and must be outside the artifact.
Exit 0: complete verified pilot (regardless of faster/slower result).
Exit 2: failed/incomplete pilot or evidence validation failure; inspect reports.
No input writes, extraction, network, subprocesses, or SDK execution.
"""

import argparse
import base64
import datetime
import difflib
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import statistics
import sys
import tarfile


ORDER = ["A1", "B1", "B2", "A2"]
ARMS = {
    "A": {
        "commit": "ea9f16e4e08d62a1f66a93d9a77f8ef5e93148f9",
        "tree": "f1e5e155f00211decafe7592e5816bd9723f85ce",
        "guards": 98,
    },
    "B": {
        "commit": "faac6a701dae92bb92a69e3fcd1e43b917d181b0",
        "tree": "31c9fbe20187e25b498ccf5a11a15d79c3a6cc28",
        "guards": 119,
    },
}
PACKAGE = {
    "bytes": 623353,
    "files": 492,
    "sha256": "cc21fbfdaacdb88f1ad22c3040e9a1bf590229ff4f048cf263fba9f578ad98e8",
    "integrity": "sha512-WbtLjSCQjsh1ERKKQA0SMeaBfVMTIw2iOhEoG+7cRQFm5xy0R1DlyhEFXgsr2/Tk3VRHWIVq/g28Kxl/pzwPMg==",
}
CONTROL = {
    "commit": "b120741037811b05ce06e92c4d35134fda0c1811",
    "tree": "f745190d69d9308cf83a7a931bcf9f889add7e47",
}
CONTROL_FILES = {
    ".github/workflows/check.yml": "5760e0e0b947be64a74e624a5f4e3f72487dae15f27ba20b8bb553844252e3ec",
    ".github/scripts/ci153-comparison.mjs": "61f251cbd935a3226103a8036427dce9db60e2205505bdf33003b10e9dad2292",
    ".github/scripts/ci153-process.mjs": "7f05182aec8602ec59ca158747b23726103d59293f5e478d32cfe2d02af6dda3",
    ".github/scripts/ci153-corpus.json": "31e8a834dbf8910b2b071a5613027539c398f2cac493879dce964f814c5ce010",
}
CASE_HASHES = {
    "attachment": "52ca32aa8d3ca09f7b666186fa33673f2502cb6d5a9445095eb046223edb4756",
    "review": "14026d1504887b966b6b85fd41bcd7ffeee6a040d6186736e52338ac7c39ddc6",
    "native": "1ba5b2735b3940e76d1b4a5311fa69bee289ed38fbdf44bfcde89a2b7c0abc1c",
    "linked": "c766831c16ec789b63722696d7ca754d8dd7e419b6c4281c21bf1cd509aa0284",
}
BUNDLES = sorted([
    "starter/main.js", "starter/styles.css", "fixture.js",
    "starter/bootstrap.js", "proof.css", "auth/auth.js",
])
POLICY_HASH = "1efb93acca0cc63bc40aa1aa3826a3d215069d55564a98ca382f5d5560e15465"
SHA = re.compile(r"^[a-f0-9]{64}$")
JSON_LIMIT = 64 * 1024 * 1024
TEXT_LIMIT = 128 * 1024 * 1024


class Invalid(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise Invalid(message)


def number(value, name, integer=False, positive=False):
    need(type(value) in (int, float), name + ": expected number, not bool/null")
    need(math.isfinite(value) and value >= 0, name + ": expected finite nonnegative")
    if integer:
        need(type(value) is int, name + ": expected integer")
    if positive:
        need(value > 0, name + ": expected positive")
    return value


def close(actual, expected, name):
    number(actual, name)
    need(math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-6),
         name + ": recomputed value differs")


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "Duplicate JSON key: " + key)
        value[key] = item
    return value


def decode_json(text):
    def nonfinite(value):
        raise Invalid("Nonfinite JSON constant: " + value)
    return json.loads(text, object_pairs_hook=unique_object, parse_constant=nonfinite)


def canonical(value, sort_keys=False):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=sort_keys, allow_nan=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def array_hash(value):
    need(isinstance(value, list), "Expected case array")
    return digest(canonical(value))


def relative_path(value):
    need(isinstance(value, str) and value, "Empty/nonstring relative path")
    need("\x00" not in value and "\\" not in value and "\n" not in value
         and "\r" not in value, "Forbidden path characters")
    path = PurePosixPath(value)
    need(not path.is_absolute() and not re.match(r"^[A-Za-z]:", value),
         "Absolute/drive path refused")
    need(all(part not in ("", ".", "..") for part in value.split("/")),
         "Noncanonical/traversal path refused: " + value)
    need(path.as_posix() == value, "Noncanonical path: " + value)
    return path.parts


def no_symlink_components(path):
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        need(not stat.S_ISLNK(current.lstat().st_mode),
             "Symlink component refused: " + str(current))
    return absolute


class Evidence:
    def __init__(self, root):
        self.root = no_symlink_components(root)
        need(self.root.is_dir(), "Artifact root must be a directory")

    def path(self, name):
        parts = relative_path(name)
        path = self.root
        for part in parts:
            path /= part
            mode = path.lstat().st_mode
            need(not stat.S_ISLNK(mode), "Symlink refused: " + name)
        need(stat.S_ISREG(path.lstat().st_mode), "Not a regular file: " + name)
        return path

    def bytes(self, name, limit=JSON_LIMIT):
        path = self.path(name)
        need(path.stat().st_size <= limit, "Read limit exceeded: " + name)
        with path.open("rb") as handle:
            data = handle.read(limit + 1)
        need(len(data) <= limit, "Read limit exceeded: " + name)
        return data

    def text(self, name, limit=TEXT_LIMIT):
        return self.bytes(name, limit).decode("utf-8")

    def json(self, name):
        value = decode_json(self.text(name, JSON_LIMIT))
        need(isinstance(value, dict), name + ": expected JSON object")
        return value

    def fingerprint(self, name):
        path = self.path(name)
        size = 0
        checksum = hashlib.sha256()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                checksum.update(chunk)
        return {"bytes": size, "sha256": checksum.hexdigest()}

    def inventory(self, prefix=""):
        directory = self.root if not prefix else self.root.joinpath(*relative_path(prefix))
        need(directory.is_dir() and not directory.is_symlink(), "Unsafe directory")
        result = []
        for entry in sorted(os.scandir(directory), key=lambda item: item.name):
            name = prefix + "/" + entry.name if prefix else entry.name
            relative_path(name)
            mode = entry.stat(follow_symlinks=False).st_mode
            need(not stat.S_ISLNK(mode), "Symlink inventory entry: " + name)
            if stat.S_ISDIR(mode):
                result.extend(self.inventory(name))
            else:
                need(stat.S_ISREG(mode), "Special inventory entry: " + name)
                result.append(name)
        return result


def manifest_integrity(evidence):
    value = evidence.json("files.json")
    need(value.get("schemaVersion") == 1, "files.json schema")
    need(value.get("excludes") == ["files.json (self-reference)"], "Unexpected exclusions")
    need(isinstance(value.get("files"), list), "Missing file entries")
    expected = {}
    for item in value["files"]:
        need(isinstance(item, dict), "Invalid file entry")
        path = item.get("path")
        relative_path(path)
        need(path != "files.json" and path not in expected, "Duplicate/self file entry")
        number(item.get("bytes"), path + " bytes", integer=True)
        need(isinstance(item.get("sha256"), str) and SHA.fullmatch(item["sha256"]),
             path + ": invalid SHA256")
        expected[path] = {"bytes": item["bytes"], "sha256": item["sha256"]}
    actual = set(evidence.inventory()) - {"files.json"}
    need(actual == set(expected),
         "Manifest member mismatch; missing=" + repr(sorted(set(expected) - actual)) +
         "; unlisted=" + repr(sorted(actual - set(expected))))
    total = 0
    for path, fingerprint in expected.items():
        need(evidence.fingerprint(path) == fingerprint, "Manifest bytes/hash mismatch: " + path)
        total += fingerprint["bytes"]
    return {"verified": True, "files": len(expected), "indexedBytes": total,
            "index": evidence.fingerprint("files.json"),
            "authenticityLimit": "This is an unsigned self-index. Parent-owned authenticated download/run receipts establish remote origin."}


def checksum_file(evidence, prefix):
    text = evidence.text(prefix + "/SHA256SUMS")
    need(text.endswith("\n"), "Truncated checksum file: " + prefix)
    names = []
    for line in text.splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([^\r\n]+)", line)
        need(match is not None, "Malformed checksum: " + prefix)
        expected, name = match.groups()
        relative_path(name)
        need(name not in names, "Duplicate checksum path: " + name)
        need(evidence.fingerprint(prefix + "/" + name)["sha256"] == expected,
             "Checksum mismatch: " + prefix + "/" + name)
        names.append(name)
    need(bool(names), "Empty checksums: " + prefix)
    return names


def input_contract(inputs):
    need(inputs.get("schemaVersion") == 1, "inputs schema")
    control = inputs.get("control", {})
    for key, expected in CONTROL.items():
        need(control.get(key) == expected, "Unexpected control " + key)
    files = control.get("files", [])
    need(len(files) == len(CONTROL_FILES), "Control file list length")
    need(len({item["path"] for item in files}) == len(files), "Duplicate control files")
    need({item["path"]: item["sha256"] for item in files} == CONTROL_FILES,
         "Diagnostic source hashes changed")
    need(inputs.get("package") == PACKAGE, "Input package identity changed")
    expected_order = [{"id": name, "arm": name[0], **ARMS[name[0]]} for name in ORDER]
    need(inputs.get("order") == expected_order, "Pinned ABBA order changed")
    need(sorted(inputs.get("changedPaths", [])) == sorted([
        "scripts/check-package.mjs", "scripts/package-checks.test.mjs",
        "scripts/packed-tail-checks.mjs", "scripts/packed-tail-worker.mjs",
    ]), "Unexpected source diff")
    runtime = inputs.get("runtime", {})
    need(re.match(r"^v24\.", runtime.get("node", "")), "Expected Node 24")
    need(runtime.get("pnpm") == "10.28.2", "Expected pnpm 10.28.2")
    need(runtime.get("runnerOS") == "Linux", "Expected Linux runner")
    need(runtime.get("timezone") == "UTC", "Unexpected timezone")
    need(runtime.get("samplerCadenceMs") == 200, "Unexpected sampler configuration")
    return {"control": control, "runtime": runtime,
            "childEnvironmentPolicy": inputs.get("childEnvironmentPolicy")}


def rss_analysis(evidence, prefix, command):
    path = evidence.path(prefix + ".rss.ndjson")
    peaks = 0
    max_processes = 0
    count = 0
    previous = None
    first = None
    final = None
    gaps = []
    cpu_ticks = {}
    process_fields = {
        "pid", "ppid", "group", "session", "startTicks",
        "userTicks", "systemTicks", "rssKiB",
    }
    host_fields = {
        "memAvailableKiB", "swapTotalKiB", "swapFreeKiB",
        "swapInPages", "swapOutPages", "hostOomKills",
    }
    with path.open("rb") as handle:
        for raw in handle:
            need(raw.endswith(b"\n"), prefix + ": truncated RSS line")
            need(len(raw) <= 8 * 1024 * 1024, prefix + ": oversized RSS line")
            row = decode_json(raw.decode("utf-8"))
            need(isinstance(row, dict), prefix + ": RSS object required")
            need(set(row) == {"elapsedMs", "rssKiB", "processes"} | host_fields,
                 prefix + ": unexpected RSS fields")
            elapsed = number(row["elapsedMs"], prefix + " RSS time")
            if previous is not None:
                need(elapsed >= previous, prefix + ": nonmonotonic RSS time")
                gaps.append(elapsed - previous)
            previous = elapsed
            number(row["rssKiB"], prefix + " RSS", integer=True)
            need(isinstance(row["processes"], list), prefix + ": process array required")
            pids = set()
            summed = 0
            for process in row["processes"]:
                need(isinstance(process, dict) and set(process) == process_fields,
                     prefix + ": unexpected process fields")
                for key in process_fields:
                    number(process[key], prefix + " " + key, integer=True)
                need(process["pid"] > 0 and process["pid"] not in pids,
                     prefix + ": invalid/duplicate PID")
                pids.add(process["pid"])
                summed += process["rssKiB"]
                identity = (process["pid"], process["startTicks"])
                ticks = process["userTicks"] + process["systemTicks"]
                need(ticks >= cpu_ticks.get(identity, 0), prefix + ": CPU tick regression")
                cpu_ticks[identity] = ticks
            for key in host_fields:
                number(row[key], prefix + " " + key, integer=True)
            need(summed == row["rssKiB"], prefix + ": RSS sum mismatch")
            peaks = max(peaks, summed)
            max_processes = max(max_processes, len(pids))
            count += 1
            first = first or row
            final = row
    need(count > 0, prefix + ": empty RSS trace")
    for key in ("scans", "peakSampledRssKiB", "maxOwnedProcesses"):
        number(command.get(key), prefix + " " + key, integer=True)
    need(command.get("scans") == count, prefix + ": scan count mismatch")
    need(command.get("peakSampledRssKiB") == peaks, prefix + ": peak mismatch")
    need(command.get("maxOwnedProcesses") == max_processes, prefix + ": process peak mismatch")
    need(final["elapsedMs"] <= command["elapsedMs"] + 1e-6,
         prefix + ": RSS extends beyond command receipt")
    if command.get("drainConfirmed"):
        need(final["processes"] == [] and final["rssKiB"] == 0,
             prefix + ": claimed drain without empty final snapshot")
    sampler = number(command.get("samplerMs"), prefix + " sampler wall")
    need(sampler <= command["elapsedMs"] + 1e-6, prefix + ": sampler exceeds command")
    for label, row in [("initialHostMemory", first), ("finalHostMemory", final)]:
        memory = command.get(label, {})
        need(set(memory) == host_fields, prefix + ": host memory fields")
        # Initial receipt is sampled just before spawn, not the first RSS row.
        for key in host_fields:
            number(memory[key], prefix + " " + label + "/" + key, integer=True)
        if label == "finalHostMemory":
            need(memory == {key: row[key] for key in host_fields},
                 prefix + ": final host memory differs")
    return {
        "trace": prefix + ".rss.ndjson", "samples": count,
        "peakSampledRssKiB": peaks, "peakSampledRssMiB": peaks / 1024,
        "maximumOwnedProcesses": max_processes,
        "maxObservedSampleGapMs": max(gaps, default=0),
        "medianObservedSampleGapMs": statistics.median(gaps) if gaps else None,
        "observerWallMs": sampler,
        "observerWallPercentOfCommand": 100 * sampler / command["elapsedMs"],
        "samplerCpuTimeMs": None,
        "observedChildCpuTicksByIdentitySum": sum(cpu_ticks.values()),
        "clockTicksPerSecond": None,
        "hostCounters": {key: {"firstObserved": first[key], "lastObserved": final[key]}
                         for key in sorted(host_fields)},
        "limits": [
            "Sampler CPU time and CLK_TCK were not recorded. samplerMs is synchronous observer wall effort, not CPU time or isolated added latency.",
            "This is sampled summed process RSS, not cgroup/physical peak: shared pages double-count; between-sample and short-lived descendants can be missed.",
            "Observed child CPU ticks are incomplete snapshots; no seconds conversion is invented.",
            "Host memory/swap/OOM counters are VM-wide; changes do not establish command causality.",
            "A 200ms target cadence includes scan/write overhead and shorter drain samples; observed gaps are reported.",
        ],
    }


def command_analysis(evidence, sample_id, embedded):
    name = embedded.get("name")
    need(name in ("install", "check", "native", "linked"), "Unexpected command name")
    prefix = sample_id + "/" + name
    value = evidence.json(prefix + ".receipt.json")
    need(value == embedded, prefix + ": embedded/standalone receipt mismatch")
    command, args = value.get("command"), value.get("args")
    need(isinstance(args, list) and all(isinstance(item, str) for item in args),
         prefix + ": command arguments required")
    if name in ("check", "native"):
        need(command == "pnpm" and args == ["check" if name == "check" else "check:browser"],
             prefix + ": actual validation command changed")
    elif name == "install":
        need(command == "pnpm" and len(args) == 4
             and args[:3] == ["install", "--frozen-lockfile", "--store-dir"],
             prefix + ": frozen independent install command changed")
        store = PurePosixPath(args[3])
        need(store.is_absolute() and ".." not in store.parts and
             store.parts[-3:] == ("sdk-ci153-execution", sample_id, "pnpm-store"),
             prefix + ": unexpected fresh store path")
    else:
        need(isinstance(command, str) and PurePosixPath(command).is_absolute()
             and PurePosixPath(command).name == "node" and len(args) == 2
             and args[0] == "scripts/check-linked-records-browser.mjs",
             prefix + ": linked validation command changed")
        destination = PurePosixPath(args[1])
        need(destination.is_absolute() and ".." not in destination.parts and
             destination.parts[-5:] ==
             ("sdk-ci153-execution", sample_id, "outputs", "native", "linked-records"),
             prefix + ": unexpected linked output path")
    number(value.get("elapsedMs"), prefix + " elapsed", positive=True)
    if value.get("commandCloseMs") is not None:
        number(value["commandCloseMs"], prefix + " close")
        need(value["commandCloseMs"] <= value["elapsedMs"], prefix + ": close after elapsed")
    success = all([
        type(value.get("exitCode")) is int and value["exitCode"] == 0,
        value.get("exitSignal") is None,
        value.get("reason") is None, value.get("spawnError") is None,
        value.get("observerError") is None, value.get("captureError") is None,
        value.get("drainConfirmed") is True, value.get("alive") == [],
        value.get("commandCloseMs") is not None,
    ])
    need(type(value.get("readErrors")) is int and value["readErrors"] >= 0,
         prefix + ": invalid readErrors")
    number(value.get("reparentedObservations"), prefix + " reparenting", integer=True)
    for suffix in ("stdout.log", "stderr.log", "combined.log"):
        evidence.path(prefix + "." + suffix)
    return {
        "name": name, "success": success,
        "elapsedMs": value["elapsedMs"], "commandCloseMs": value.get("commandCloseMs"),
        "startedAt": value.get("startedAt"), "endedAt": value.get("endedAt"),
        "exitCode": value.get("exitCode"), "exitSignal": value.get("exitSignal"),
        "reason": value.get("reason"), "spawnError": value.get("spawnError"),
        "observerError": value.get("observerError"), "captureError": value.get("captureError"),
        "drainConfirmed": value.get("drainConfirmed"), "alive": value.get("alive"),
        "readErrors": value["readErrors"],
        "reparentedObservations": value["reparentedObservations"],
        "memory": rss_analysis(evidence, prefix, value),
    }


def log_cases(evidence, sample_id):
    log = re.sub(r"\x1b\[[0-9;]*m", "", evidence.text(sample_id + "/check.combined.log"))
    expected = [3, 2299, 624, ARMS[sample_id[0]]["guards"]]
    for name, totals in [("tests", expected), ("pass", expected)] + [
        (name, [0, 0, 0, 0]) for name in ("fail", "cancelled", "skipped", "todo")
    ]:
        values = [int(item) for item in re.findall(
            r"^(?:#|ℹ)\s+" + name + r"\s+(\d+)\s*$", log, re.MULTILINE)]
        need(values == totals, sample_id + ": incorrect Node " + name + " summaries")
    lines = [line.strip() for line in log.splitlines()]
    attachment = [line for line in lines
                  if re.fullmatch(r"Packed attachment (upload|Review): .+ passed", line)]
    review = [line for line in lines
              if re.fullmatch(r"\[packed review \d+/51\] .+: passed", line)]
    need(len(attachment) == 90 and array_hash(attachment) == CASE_HASHES["attachment"],
         sample_id + ": attachment identities/order differ")
    need(len(review) == 51 and array_hash(review) == CASE_HASHES["review"],
         sample_id + ": prepared-review identities/order differ")
    for text in [
        "104 installed attachment-review checkpoints and 90 copied-starter attachment-review cases",
        "51 actual packed browser prepared-review cases",
        "Installed select compiler: 1318 checks passed.",
        "full browser/UI examples typecheck/build passed (" + PACKAGE["integrity"] + ")",
    ]:
        need(text in log, sample_id + ": missing summary " + text)
    need(lines.count("2 actual packed browser combined empty-hiding/Review cases") == 1,
         sample_id + ": combined cases missing/duplicated")
    return {"expected": expected, "attachmentCases": 90, "reviewCases": 51, "combined": 2}


def artifacts_analysis(evidence, sample_id, inputs):
    base = sample_id + "/"
    source = {key: ARMS[sample_id[0]][key] for key in ("commit", "tree")}
    package = evidence.json(base + "package/artifact-receipt.json")
    need(package.get("source") == source, sample_id + ": package source")
    need(package.get("schemaVersion") == 1, sample_id + ": package schema")
    need(package.get("verification", {}).get("outcome") == "passed"
         and package["verification"].get("browserPortalChecks") == 85,
         sample_id + ": package verification")
    for key, value in PACKAGE.items():
        need(package.get("package", {}).get(key) == value, sample_id + ": package " + key)
    ci = package.get("ci", {})
    need("workflowSha" not in ci and "pullRequestHeadSha" not in ci,
         sample_id + ": unrelated diagnostic SHA leaked")
    for key in ("repository", "event", "runId", "runAttempt"):
        need(ci.get(key) == inputs.get("control", {}).get(key), sample_id + ": CI " + key)
    filename = package["package"].get("filename")
    need(filename == "miniextensions-sdk-0.1.0-alpha.0.tgz", sample_id + ": archive name")
    archive_name = base + "package/" + filename
    need(evidence.fingerprint(archive_name) ==
         {"bytes": PACKAGE["bytes"], "sha256": PACKAGE["sha256"]},
         sample_id + ": archive bytes")
    archive_bytes = evidence.bytes(archive_name)
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode("ascii")
    need(integrity == PACKAGE["integrity"], sample_id + ": archive integrity")
    members = set()
    regular_count = 0
    with tarfile.open(evidence.path(archive_name), "r:gz") as archive:
        for member in archive:
            relative_path(member.name)
            need(member.name.startswith("package/") and member.name not in members,
                 sample_id + ": unsafe/duplicate archive member")
            need(member.isfile() or member.isdir(), sample_id + ": archive link/special member")
            members.add(member.name)
            regular_count += int(member.isfile())
    need(regular_count == PACKAGE["files"], sample_id + ": packed file count")
    checksum_file(evidence, base + "package")
    manifest_name = base + "proof/manifest.json"
    manifest = evidence.json(manifest_name)
    need(manifest.get("source") == source, sample_id + ": proof source")
    need(manifest.get("package", {}).get("sha256") == PACKAGE["sha256"]
         and manifest["package"].get("bytes") == PACKAGE["bytes"], sample_id + ": proof package")
    need("workflowSha" not in manifest.get("ci", {})
         and "pullRequestHeadSha" not in manifest.get("ci", {}), sample_id + ": proof CI SHA")
    outputs = {}
    for entry in manifest.get("outputs", []):
        path = entry.get("path")
        relative_path(path)
        need(path not in outputs, sample_id + ": duplicate proof output")
        number(entry.get("bytes"), path + " bytes", integer=True)
        need(isinstance(entry.get("sha256"), str) and SHA.fullmatch(entry["sha256"]),
             sample_id + ": output hash format")
        actual = evidence.fingerprint(base + "proof/" + path)
        need(actual == {"bytes": entry["bytes"], "sha256": entry["sha256"]},
             sample_id + ": proof output mismatch " + path)
        outputs[path] = actual
    need(sorted(path for path in outputs if path.endswith((".js", ".css"))) == BUNDLES,
         sample_id + ": unexpected JS/CSS path set")
    proof_checksums = checksum_file(evidence, base + "proof")
    need(set(proof_checksums) == set(outputs) | {"manifest.json"},
         sample_id + ": proof checksum members")
    actual_proof_files = set(path[len(base + "proof/"):]
                             for path in evidence.inventory(sample_id + "/proof"))
    need(actual_proof_files == set(outputs) | {"manifest.json", "SHA256SUMS"},
         sample_id + ": unexpected proof files")
    native = evidence.json(base + "native/native-receipt.json")
    need(native.get("schemaVersion") == 1 and native.get("status") == "passed",
         sample_id + ": native status")
    need(native.get("source") == source and native.get("package") == manifest["package"],
         sample_id + ": native source/package")
    need(native.get("ci") == manifest.get("ci"), sample_id + ": native CI provenance")
    need(native.get("fixtureManifestSha256") == evidence.fingerprint(manifest_name)["sha256"],
         sample_id + ": fixture manifest binding")
    results = native.get("results", [])
    need(array_hash([item.get("name") for item in results]) == CASE_HASHES["native"]
         and all(item.get("status") == "passed" for item in results),
         sample_id + ": native seven")
    need(native.get("network") == [], sample_id + ": native network")
    need(native.get("cleanup") ==
         {"browser": "completed", "server": "completed", "consumer": "completed"},
         sample_id + ": native cleanup")
    need(native.get("fileChooserOwnerRegressions", {}).get("checks") == 20,
         sample_id + ": chooser regressions")
    declaration = native.get("fixtureDeclarationCheck", {})
    need(declaration.get("status") == "passed" and
         declaration.get("missingScopeRegression") == "rejected",
         sample_id + ": declaration regression")
    attachment = native.get("attachmentPresentation", {})
    need(attachment.get("status") == "passed" and attachment.get("errors") == []
         and attachment.get("external") == [], sample_id + ": attachment presentation")
    need([item.get("name") for item in attachment.get("captures", [])] ==
         ["selected", "uploading", "accepted", "uncertain", "narrow"],
         sample_id + ": presentation captures")
    need("native-receipt.json" in checksum_file(evidence, base + "native"),
         sample_id + ": native checksum binding")
    linked = evidence.json(base + "native/linked-records/receipt.json")
    need(linked.get("head") == source["commit"] and
         linked.get("sha256") == PACKAGE["sha256"] and
         linked.get("integrity") == PACKAGE["integrity"], sample_id + ": linked package/source")
    need(array_hash(linked.get("cases")) == CASE_HASHES["linked"], sample_id + ": linked eleven")
    for key, value in {"reads": 1, "searches": 2, "pages": 1, "saves": 0,
                       "rowActivations": 0, "submits": 0}.items():
        need(type(linked.get(key)) is int and linked[key] == value,
             sample_id + ": linked counter " + key)
    for key in ("externalRequests", "transports", "errors"):
        need(linked.get(key) == [], sample_id + ": linked " + key)
    coverage = evidence.json(base + "coverage/source-metrics.json")
    need(set(coverage.get("groups", {})) == {"unit", "component", "combined"},
         sample_id + ": coverage groups")
    policy = {}
    for group, data in coverage["groups"].items():
        scopes = data.get("scopes", {})
        need(bool(scopes), sample_id + ": coverage scopes")
        policy[group] = {}
        for name, scope in scopes.items():
            policy[group][name] = scope.get("minimum", {})
            for metric, minimum in scope["minimum"].items():
                number(minimum, "coverage minimum")
                actual = number(scope.get("actual", {}).get(metric), "coverage actual")
                need(actual >= minimum, sample_id + ": coverage floor " + group + "/" + name)
    need(digest(canonical(policy, sort_keys=True)) == POLICY_HASH,
         sample_id + ": coverage thresholds changed")
    cases = log_cases(evidence, sample_id)
    return {"cases": cases, "archive": archive_name,
            "package": package["package"], "proofOutputs": outputs,
            "proofManifest": manifest, "native": 7, "linked": 11,
            "coveragePolicySha256": POLICY_HASH}


def sample_analysis(evidence, sample_id, inputs, embedded):
    result = {"id": sample_id, "arm": sample_id[0], "verified": False,
              "issues": [], "commands": [], "observedFailure": None}
    receipt = None
    try:
        receipt = evidence.json(sample_id + "/sample-receipt.json")
        result["recordedStatus"] = receipt.get("status")
        result["observedFailure"] = {key: receipt.get(key) for key in
                                     ("error", "stagingError", "cleanup") if receipt.get(key) is not None}
        need(receipt.get("id") == sample_id and receipt.get("arm") == sample_id[0],
             sample_id + ": identity mismatch")
        for key in ("commit", "tree"):
            need(receipt.get(key) == ARMS[sample_id[0]][key], sample_id + ": source " + key)
        if embedded is not None:
            need(receipt == embedded, sample_id + ": comparison/sample receipt mismatch")
        else:
            result["issues"].append("No comparison.json sample binding")
        commands = receipt.get("commands")
        need(isinstance(commands, list), sample_id + ": command array required")
        names = [item.get("name") for item in commands]
        need(names == ["install", "check", "native", "linked"][:len(names)]
             and len(names) <= 4, sample_id + ": unexpected command order")
        for command in commands:
            try:
                result["commands"].append(command_analysis(evidence, sample_id, command))
            except Exception as error:
                result["issues"].append(str(error))
                result["commands"].append({
                    "name": command.get("name"), "success": False,
                    "receipt": command, "verificationError": str(error),
                })
        cleanup_ms = number(receipt.get("cleanupMs"), sample_id + " cleanup")
        for key in ("evidenceStagingMs", "totalObservedSampleMs"):
            number(receipt.get(key), sample_id + " " + key)
        total = sum(number(command.get("elapsedMs"), sample_id + " command elapsed")
                    for command in commands) + cleanup_ms
        close(receipt.get("primaryValidationMs"), total, sample_id + " primary")
        install = next((command["elapsedMs"] for command in commands
                        if command.get("name") == "install"), 0)
        close(receipt.get("validationWithoutInstallMs"), total - install,
              sample_id + " without install")
        peak = max([command.get("peakSampledRssKiB", 0) for command in commands] or [0])
        close(receipt.get("peakSampledRssKiB"), peak, sample_id + " peak RSS")
        result.update({
            "primaryValidationMs": total, "withoutInstallMs": total - install,
            "cleanupMs": cleanup_ms, "evidenceStagingMs": receipt["evidenceStagingMs"],
            "totalObservedSampleMs": receipt["totalObservedSampleMs"],
            "peakSampledRssKiB": peak, "peakSampledRssMiB": peak / 1024,
            "cleanup": receipt.get("cleanup"),
        })
        try:
            result["artifacts"] = artifacts_analysis(evidence, sample_id, inputs)
            expected_correctness = {
                **result["artifacts"]["cases"],
                "package": result["artifacts"]["package"], "native": 7, "linked": 11,
            }
            need(receipt.get("correctness") == expected_correctness,
                 sample_id + ": correctness receipt mismatch")
        except Exception as error:
            result["issues"].append(str(error))
        if receipt.get("status") == "passed":
            need(names == ["install", "check", "native", "linked"],
                 sample_id + ": passed with missing commands")
            need(all(command.get("success") for command in result["commands"]),
                 sample_id + ": passed with unsuccessful/unverified command")
            need(receipt.get("cleanup", {}).get("status") == "completed" and
                 receipt["cleanup"].get("drainConfirmed") is True,
                 sample_id + ": incomplete cleanup")
            need(receipt.get("error") is None and receipt.get("stagingError") is None,
                 sample_id + ": passed with error")
            result["verified"] = not result["issues"]
    except Exception as error:
        result["issues"].append(str(error))
    # A timeout/cancellation can leave command receipts without a final sample
    # receipt. Preserve those observations, but never promote them to a sample pass.
    if not result["commands"]:
        for name in ("install", "check", "native", "linked"):
            receipt_name = sample_id + "/" + name + ".receipt.json"
            if (evidence.root / receipt_name).exists() or (evidence.root / receipt_name).is_symlink():
                try:
                    command = evidence.json(receipt_name)
                    observed = command_analysis(evidence, sample_id, command)
                    observed["sampleBindingMissing"] = True
                    result["commands"].append(observed)
                except Exception as error:
                    result["commands"].append({"name": name, "success": False,
                                               "verificationError": str(error)})
                    result["issues"].append(str(error))
    return result


def bytes_equal(evidence, names):
    handles = []
    try:
        handles = [evidence.path(name).open("rb") for name in names]
        while True:
            chunks = [handle.read(1024 * 1024) for handle in handles]
            if any(chunk != chunks[0] for chunk in chunks[1:]):
                return False
            if not chunks[0]:
                return True
    finally:
        for handle in handles:
            handle.close()


def metadata_differences(left, right, path=""):
    if type(left) is type(right) and isinstance(left, dict):
        result = []
        for key in sorted(set(left) | set(right)):
            pointer = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in left or key not in right:
                result.append({"path": pointer, "before": left.get(key), "after": right.get(key)})
            else:
                result.extend(metadata_differences(left[key], right[key], pointer))
        return result
    if type(left) is type(right) and isinstance(left, list) and len(left) == len(right):
        return [difference for index, (a, b) in enumerate(zip(left, right))
                for difference in metadata_differences(a, b, path + "/" + str(index))]
    return [] if left == right else [{"path": path, "before": left, "after": right}]


def cross_sample(evidence, samples):
    available = [sample for sample in samples if "artifacts" in sample]
    result = {"availableSamples": [sample["id"] for sample in available],
              "allFourAvailable": len(available) == 4, "bundles": [],
              "nonBundleProofDifferences": [], "provenanceMetadataDifferences": [],
              "archiveByteParity": False, "unexplainedNonBundleDifferences": [],
              "unexplainedManifestDifferences": []}
    if len(available) < 2:
        return result
    ids = [sample["id"] for sample in available]
    archives = [sample["artifacts"]["archive"] for sample in available]
    result["archiveByteParity"] = bytes_equal(evidence, archives)
    for path in BUNDLES:
        names = [sample_id + "/proof/" + path for sample_id in ids]
        result["bundles"].append({
            "path": path, "byteIdentical": bytes_equal(evidence, names),
            "samples": {sample_id: evidence.fingerprint(name)
                        for sample_id, name in zip(ids, names)},
        })
    first = available[0]
    union = set().union(*(set(sample["artifacts"]["proofOutputs"]) for sample in available))
    for path in sorted(union - set(BUNDLES)):
        values = {sample["id"]: sample["artifacts"]["proofOutputs"].get(path)
                  for sample in available}
        if len({json.dumps(item, sort_keys=True) for item in values.values()}) != 1:
            entry = {"path": path, "samples": values,
                     "classification": "provenance-bearing README" if path == "README.md"
                     else "unexplained non-bundle output difference"}
            if path == "README.md":
                entry["exactLineDifferences"] = []
                before = evidence.text(first["id"] + "/proof/README.md").splitlines()
                for sample in available[1:]:
                    after = evidence.text(sample["id"] + "/proof/README.md").splitlines()
                    diff = list(difflib.unified_diff(
                        before, after, fromfile=first["id"], tofile=sample["id"], n=1))
                    entry["exactLineDifferences"].append({"sample": sample["id"], "diff": diff})
                    shas = [ARMS[arm][key] for arm in ("A", "B") for key in ("commit", "tree")]
                    changed = [line[1:] for line in diff
                               if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))]
                    if any(not any(sha in line for sha in shas) for line in changed):
                        entry["classification"] = "unexplained README content difference"
            result["nonBundleProofDifferences"].append(entry)
            if entry["classification"] != "provenance-bearing README":
                result["unexplainedNonBundleDifferences"].append(entry)
    for sample in available[1:]:
        before = first["artifacts"]["proofManifest"]
        after = sample["artifacts"]["proofManifest"]
        differences = metadata_differences(before, after)
        allowed = {"/source/commit", "/source/tree"}
        for index, output in enumerate(before.get("outputs", [])):
            if output.get("path") == "README.md":
                allowed.update({"/outputs/" + str(index) + "/sha256",
                                "/outputs/" + str(index) + "/bytes"})
        unexpected = [entry for entry in differences if entry["path"] not in allowed]
        if unexpected:
            result["unexplainedManifestDifferences"].append({
                "sample": sample["id"], "differences": unexpected})
        result["provenanceMetadataDifferences"].append({
            "baseline": first["id"], "sample": sample["id"],
            "manifestBytes": {
                first["id"]: evidence.fingerprint(first["id"] + "/proof/manifest.json"),
                sample["id"]: evidence.fingerprint(sample["id"] + "/proof/manifest.json"),
            },
            "checksumBytes": {
                first["id"]: evidence.fingerprint(first["id"] + "/proof/SHA256SUMS"),
                sample["id"]: evidence.fingerprint(sample["id"] + "/proof/SHA256SUMS"),
            },
            "manifestFieldDifferences": differences,
        })
    result["allBundlesIdentical"] = all(item["byteIdentical"] for item in result["bundles"])
    return result


def metrics(samples, comparison):
    need([sample["id"] for sample in samples] == ORDER, "Missing/out-of-order samples")
    need(all(sample["verified"] for sample in samples), "Not all samples verified")
    result = {"arms": {}, "pairs": []}
    for arm in ("A", "B"):
        own = [sample for sample in samples if sample["arm"] == arm]
        values = [sample["primaryValidationMs"] for sample in own]
        result["arms"][arm] = {
            "samples": [sample["id"] for sample in own], "valuesMs": values,
            "meanMs": statistics.mean(values), "medianMs": statistics.median(values),
            "rangeMs": sorted(values),
            "meanWithoutInstallMs": statistics.mean(sample["withoutInstallMs"] for sample in own),
            "peakSampledRssMiB": max(sample["peakSampledRssMiB"] for sample in own),
            "meanObserverWallMs": statistics.mean(
                sum(command["memory"]["observerWallMs"] for command in sample["commands"])
                for sample in own),
            "commandWallMs": {},
        }
        for command_name in ("install", "check", "native", "linked"):
            timings = [next(command["elapsedMs"] for command in sample["commands"]
                            if command["name"] == command_name) for sample in own]
            result["arms"][arm]["commandWallMs"][command_name] = {
                "valuesMs": timings, "meanMs": statistics.mean(timings),
                "medianMs": statistics.median(timings), "rangeMs": sorted(timings),
            }
        for name, key in (("cleanupWallMs", "cleanupMs"),
                          ("evidenceStagingWallMs", "evidenceStagingMs")):
            timings = [sample[key] for sample in own]
            result["arms"][arm][name] = {
                "valuesMs": timings, "meanMs": statistics.mean(timings),
                "rangeMs": sorted(timings),
            }
        recorded = comparison.get("means", {}).get(arm, {})
        for key in ("samples", "valuesMs", "rangeMs"):
            need(recorded.get(key) == result["arms"][arm][key], "Recorded arm " + key + " differs")
        for key in ("meanMs", "medianMs"):
            close(recorded.get(key), result["arms"][arm][key], "Recorded arm " + key)
    for a, b in [("A1", "B1"), ("A2", "B2")]:
        left = next(sample for sample in samples if sample["id"] == a)
        right = next(sample for sample in samples if sample["id"] == b)
        result["pairs"].append({"a": a, "b": b,
                                "savedMs": left["primaryValidationMs"] - right["primaryValidationMs"]})
    recorded_pairs = comparison.get("paired", [])
    need(len(recorded_pairs) == 2, "Recorded pairs missing")
    for actual, expected in zip(recorded_pairs, result["pairs"]):
        need(actual.get("a") == expected["a"] and actual.get("b") == expected["b"],
             "Recorded pair identity")
        # A slower candidate produces negative deltas; do not reject those.
        need(type(actual.get("savedMs")) in (int, float) and math.isfinite(actual["savedMs"]),
             "Invalid signed paired delta")
        need(math.isclose(actual["savedMs"], expected["savedMs"], rel_tol=1e-9, abs_tol=1e-6),
             "Recorded paired delta differs")
    a, b = result["arms"]["A"]["meanMs"], result["arms"]["B"]["meanMs"]
    result["meanSavedMs"] = a - b
    result["meanReductionPercent"] = 100 * (1 - b / a)
    for key in ("meanSavedMs", "meanReductionPercent"):
        value = comparison.get(key)
        need(type(value) in (int, float) and math.isfinite(value)
             and math.isclose(value, result[key], rel_tol=1e-9, abs_tol=1e-6),
             "Recorded signed " + key + " differs")
    result["consistentFasterCandidatePairs"] = all(pair["savedMs"] > 0 for pair in result["pairs"])
    result["consistentSlowerCandidatePairs"] = all(pair["savedMs"] < 0 for pair in result["pairs"])
    result["candidateMeanFaster"] = b < a
    result["withinArmSpreadsMs"] = {arm: value["rangeMs"][1] - value["rangeMs"][0]
                                   for arm, value in result["arms"].items()}
    result["differenceComparableToSpread"] = abs(a - b) <= max(result["withinArmSpreadsMs"].values())
    return result


def markdown(report):
    lines = ["# PR153 controlled validation analysis", "",
             "Status: " + report["status"] + ".", ""]
    lines.append("This is a same-VM A→B→B→A pilot of pinned EA9 and faac full validation. "
                 "It does not establish independent whole-job or billed-minute savings.")
    lines.extend(["", "| Sample | Recorded outcome | Verified | Full validation s | Without install s | Peak sampled RSS MiB |",
                  "| --- | --- | --- | ---: | ---: | ---: |"])
    for sample in report.get("samples", []):
        def value(key, scale=1):
            item = sample.get(key)
            return "-" if item is None else format(item / scale, ".3f")
        lines.append("| " + " | ".join([
            sample["id"], str(sample.get("recordedStatus", "incomplete")),
            "yes" if sample.get("verified") else "no",
            value("primaryValidationMs", 1000), value("withoutInstallMs", 1000),
            value("peakSampledRssMiB"),
        ]) + " |")
    metric = report.get("metrics")
    if metric:
        lines.extend(["",
                      "Mean full validation: A " + format(metric["arms"]["A"]["meanMs"] / 1000, ".3f") +
                      " s; B " + format(metric["arms"]["B"]["meanMs"] / 1000, ".3f") +
                      " s. Signed reduction: " + format(metric["meanSavedMs"] / 1000, ".3f") +
                      " s / " + format(metric["meanReductionPercent"], ".3f") + "%.",
                      "Adjacent pair signed savings: " +
                      ", ".join(pair["a"] + "/" + pair["b"] + " " +
                                format(pair["savedMs"] / 1000, ".3f") + " s"
                                for pair in metric["pairs"]) + ".",
                      "Positive savings mean B was faster; negative values mean B was slower. "
                      "Two samples per arm are descriptive, not a reliable population estimate."])
        if not report.get("fullPerformanceComparisonAllowed"):
            lines.extend(["", "These are observed receipt-derived metrics only. Measurement/evidence "
                          "qualifications block a full comparison claim; they are not an SDK test failure."])
        if metric["consistentSlowerCandidatePairs"] and not metric["differenceComparableToSpread"]:
            lines.extend(["", "The candidate was slower in both adjacent comparisons in this pilot."])
        elif not metric["consistentFasterCandidatePairs"] or metric["differenceComparableToSpread"]:
            lines.extend(["", "Order/spread check: inconclusive for a repeatable hosted benefit; "
                          "do not select favorable rows."])
    else:
        lines.extend(["", "No full performance claim: the pilot or its evidence is failed, "
                      "incomplete, inconsistent, or not fully verified. Observed rows remain above."])
    cross = report.get("crossSample", {})
    lines.extend(["", "Archive byte parity across available validated samples: " +
                  str(cross.get("archiveByteParity", False)).lower() + ". "
                  "All four available: " + str(cross.get("allFourAvailable", False)).lower() + ".",
                  "JS/CSS bundles: " + str(len(cross.get("bundles", []))) +
                  " compared by relative path and actual bytes; equality=" +
                  str(cross.get("allBundlesIdentical", False)).lower() + ". "
                  "Exact non-bundle/provenance differences are listed in analysis.json without normalization.",
                  "", "Memory is sampled summed process RSS; shared pages double-count and short-lived/"
                  "between-sample peaks may be missed. Observer wall effort is recorded per command; "
                  "sampler CPU time was not collected. Swap/OOM counters are VM-wide.",
                  "", "Timing includes install/check/native/linked command close and observed drainage "
                  "plus verified cleanup. Shared setup/checkouts, parsing, staging and uploads are excluded."])
    issues = report.get("issues", [])
    if issues:
        lines.extend(["", "Evidence issues:"])
        lines.extend("- " + str(issue).replace("\n", " ") for issue in issues[:30])
        if len(issues) > 30:
            lines.append("- Additional issues are retained in analysis.json.")
    for sample in report.get("samples", []):
        if sample.get("observedFailure"):
            lines.extend(["", sample["id"] + " recorded failure/cleanup: " +
                          json.dumps(sample["observedFailure"], ensure_ascii=False, sort_keys=True)])
    lines.extend(["", "The unsigned artifact index verifies local integrity. Authenticated GitHub run/"
                  "artifact origin remains bound by the parent's separate transfer receipts.", ""])
    return "\n".join(lines)


def analyze(evidence):
    report = {"schemaVersion": 1, "status": "FAILED_OR_INCOMPLETE", "issues": [],
              "samples": [], "fullPerformanceComparisonAllowed": False}
    try:
        report["integrity"] = manifest_integrity(evidence)
    except Exception as error:
        report["integrity"] = {"verified": False, "error": str(error)}
        report["issues"].append("File integrity: " + str(error))
    unexpected = sorted(path.name for path in evidence.root.iterdir()
                        if path.name not in set(ORDER) | {"inputs.json", "comparison.json", "files.json"})
    if unexpected:
        report["issues"].append("Unexpected artifact root members: " + repr(unexpected))
    inputs = {}
    comparison = {}
    try:
        inputs = evidence.json("inputs.json")
        report["inputs"] = input_contract(inputs)
    except Exception as error:
        report["issues"].append("Inputs: " + str(error))
    try:
        comparison = evidence.json("comparison.json")
        need(comparison.get("schemaVersion") == 1, "comparison schema")
        report["recordedPilot"] = {key: comparison.get(key) for key in
                                   ("status", "error", "interrupted", "elapsedMs", "primaryBoundary")}
    except Exception as error:
        report["issues"].append("Comparison: " + str(error))
    bindings = {}
    recorded_samples = comparison.get("samples", [])
    if not isinstance(recorded_samples, list):
        report["issues"].append("comparison.samples is not an array")
        recorded_samples = []
    for sample in recorded_samples:
        if not isinstance(sample, dict):
            report["issues"].append("comparison sample is not an object")
            continue
        name = sample.get("id")
        if name not in ORDER or name in bindings:
            report["issues"].append("Invalid/duplicate comparison sample: " + repr(name))
        else:
            bindings[name] = sample
    if comparison.get("samples") and list(bindings) != ORDER[:len(bindings)]:
        report["issues"].append("Observed sample order is not an ABBA prefix")
    for name in ORDER:
        directory = evidence.root / name
        if directory.exists() or directory.is_symlink():
            sample = sample_analysis(evidence, name, inputs, bindings.get(name))
            report["samples"].append(sample)
            report["issues"].extend(name + ": " + issue for issue in sample["issues"])
    missing = [name for name in ORDER if name not in {sample["id"] for sample in report["samples"]}]
    report["unobservedSamples"] = missing
    try:
        report["crossSample"] = cross_sample(evidence, report["samples"])
    except Exception as error:
        report["issues"].append("Cross-sample bytes: " + str(error))
    cross = report.get("crossSample", {})
    all_validations_verified = (
        [sample["id"] for sample in report["samples"]] == ORDER and
        all(sample["verified"] for sample in report["samples"])
    )
    report["allRecordedSdkValidationsVerified"] = all_validations_verified
    if all_validations_verified:
        try:
            report["metrics"] = metrics(report["samples"], comparison)
        except Exception as error:
            report["issues"].append("Recalculated metrics: " + str(error))
    report["measurementQualifications"] = {
        "unexplainedManifestDifferences": cross.get("unexplainedManifestDifferences", []),
        "unexplainedNonBundleDifferences": cross.get("unexplainedNonBundleDifferences", []),
        "bundleDifferences": [item for item in cross.get("bundles", [])
                              if not item.get("byteIdentical")],
    }
    eligible = all([
        report.get("integrity", {}).get("verified") is True,
        "inputs" in report, comparison.get("status") == "passed",
        comparison.get("interrupted") is False, comparison.get("error") is None,
        list(bindings) == ORDER, not missing, len(report["samples"]) == 4,
        all(sample["verified"] for sample in report["samples"]),
        cross.get("allFourAvailable") is True, cross.get("archiveByteParity") is True,
        cross.get("allBundlesIdentical") is True,
        not cross.get("unexplainedNonBundleDifferences"), not report["issues"],
        not cross.get("unexplainedManifestDifferences"),
        "metrics" in report,
    ])
    if eligible:
        report["fullPerformanceComparisonAllowed"] = True
        report["status"] = "VERIFIED_COMPLETE_PILOT"
    elif all_validations_verified and "metrics" in report:
        report["status"] = "COMPLETE_WITH_MEASUREMENT_QUALIFICATIONS"
    report["interpretation"] = (
        "All four actual full validations verified; report signed outcomes and memory/order limits."
        if report["fullPerformanceComparisonAllowed"] else
        "Recorded SDK validations passed; measurement/evidence qualifications prevent a full comparison claim. Observed signed metrics remain available."
        if all_validations_verified and "metrics" in report else
        "Failed/incomplete/unverified evidence: retain observed rows and failures; no four-arm performance claim.")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact_directory")
    parser.add_argument("new_output_directory")
    args = parser.parse_args()
    root = no_symlink_components(args.artifact_directory)
    output = Path(os.path.abspath(args.new_output_directory))
    need(not output.exists() and not output.is_symlink(), "Output directory must not exist")
    parent = no_symlink_components(output.parent)
    output = parent / output.name
    need(root != output and root not in output.parents, "Output must be outside input")
    output.mkdir(mode=0o755)
    try:
        evidence = Evidence(root)
        report = analyze(evidence)
    except Exception as error:
        report = {"schemaVersion": 1, "status": "FAILED_OR_INCOMPLETE",
                  "issues": [str(error)], "samples": [],
                  "fullPerformanceComparisonAllowed": False}
    report["analysisProvenance"] = {
        "inputDirectory": str(root),
        "createdAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "analyzerSha256": digest(Path(__file__).read_bytes()),
        "python": sys.version.split()[0],
        "inputWrites": False, "networkOrSubprocesses": False,
    }
    for name, content in [
        ("analysis.json", json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"),
        ("analysis.md", markdown(report)),
    ]:
        with (output / name).open("x", encoding="utf-8") as handle:
            handle.write(content)
    print(str(output / "analysis.json"))
    print(str(output / "analysis.md"))
    return 0 if report["fullPerformanceComparisonAllowed"] else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Invalid, OSError) as error:
        print("Refused: " + str(error), file=sys.stderr)
        sys.exit(2)
