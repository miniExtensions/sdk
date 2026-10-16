#!/usr/bin/env python3
"""Recovery-only proposal. Read one existing artifact; never rerun SDK checks."""
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "miniExtensions/sdk"
REPOSITORY_ID = 1396673399
RUN_ID = 38846205835
ARTIFACT_ID = 12024613652
ORIGINAL_HEAD = "b120741037811b05ce06e92c4d35134fda0c1811"
ZIP_BYTES = 2253549988
ZIP_SHA256 = "d327bd39171ffdf19a4b352e3efb95f6c466d013fdcee7fd3cf9e68926b012be"
ANALYZER_SHA256 = "ebfbc49c2e13338d20002bbebb275f8ff3bd1711c6fa9945998b3c2d7f7b3f02"
GIB = 1024 ** 3
MAX_EXPANDED = 3 * GIB
MAX_EXPORT = 256 * 1024 ** 2
CHUNK = 1024 ** 2
DEADLINE = time.monotonic() + 420


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def budget(finalizing=False):
    require(time.monotonic() < DEADLINE + (60 if finalizing else 0), "Recovery time budget exhausted")


def sha(path, finalizing=False):
    result = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            budget(finalizing=finalizing)
            data = source.read(CHUNK)
            if not data:
                break
            result.update(data)
    return result.hexdigest()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def decode(data):
    def reject(_):
        raise RuntimeError("Nonfinite JSON")
    return json.loads(data, object_pairs_hook=pairs, parse_constant=reject)


def write(path, value):
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, allow_nan=False)
        output.write("\n")


def member_path(name):
    require(isinstance(name, str) and name and not any(c in name for c in "\\\x00\r\n"),
            "Unsafe artifact path")
    path = PurePosixPath(name)
    require(not path.is_absolute() and not re.match(r"^[A-Za-z]:", name),
            "Absolute artifact path")
    require(all(part not in ("", ".", "..") for part in name.split("/"))
            and path.as_posix() == name, "Noncanonical artifact path")
    return path.parts


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, target):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def api(path, token, redirect=False):
    require(path in (
        "/repos/" + REPOSITORY + "/actions/artifacts/" + str(ARTIFACT_ID),
        "/repos/" + REPOSITORY + "/actions/artifacts/" + str(ARTIFACT_ID) + "/zip",
        "/repos/" + REPOSITORY + "/actions/runs/" + str(RUN_ID),
    ), "Unscoped API path")
    budget()
    request = urllib.request.Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "sdk-ci153-evidence-recovery",
    })
    try:
        response = OPENER.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        if redirect and error.code == 302:
            location = error.headers.get("Location")
            error.close()
            require(isinstance(location, str), "Missing signed download location")
            return location
        code = error.code
        error.close()
        raise RuntimeError("Scoped GitHub read rejected; HTTP " + str(code)) from None
    except Exception:
        raise RuntimeError("Scoped GitHub read failed") from None
    with response:
        require(not redirect and response.status == 200, "Unexpected GitHub API response")
        data = response.read(CHUNK + 1)
        require(len(data) <= CHUNK, "Oversized metadata response")
        return decode(data)


def download(location, destination):
    parsed = urllib.parse.urlsplit(location)
    host = parsed.hostname or ""
    require(parsed.scheme == "https" and parsed.username is None and parsed.password is None
            and parsed.port in (None, 443) and not parsed.fragment, "Unsafe signed location")
    require(host.endswith(".blob.core.windows.net")
            or host.endswith(".actions.githubusercontent.com")
            or host.endswith(".githubusercontent.com"), "Unexpected artifact storage host")
    # Fresh unauthenticated request: never forward API authorization/cookies.
    request = urllib.request.Request(location, headers={
        "Accept": "application/octet-stream", "User-Agent": "sdk-ci153-evidence-recovery",
    })
    try:
        response = OPENER.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        raise RuntimeError("Artifact storage read rejected; HTTP " + str(code)) from None
    except Exception:
        raise RuntimeError("Artifact storage read failed") from None
    checksum = hashlib.sha256()
    count = 0
    with response, destination.open("xb") as output:
        require(response.status == 200, "Unexpected storage response")
        length = response.headers.get("Content-Length")
        require(length is None or int(length) == ZIP_BYTES, "Storage length changed")
        while True:
            budget()
            data = response.read(CHUNK)
            if not data:
                break
            count += len(data)
            require(count <= ZIP_BYTES, "Artifact exceeded pinned length")
            checksum.update(data)
            output.write(data)
    require(count == ZIP_BYTES and checksum.hexdigest() == ZIP_SHA256,
            "Original complete ZIP size/SHA256 mismatch")
    return {"bytes": count, "sha256": checksum.hexdigest(),
            "completeZipVerifiedBeforeZipParsing": True,
            "signedLocationPersisted": False, "apiAuthorizationForwarded": False}


def extract_verified(archive, destination):
    # Called only after the complete ZIP byte digest has matched the saved log.
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        require(0 < len(entries) <= 100000, "ZIP entry limit")
        expanded = sum(item.file_size for item in entries)
        require(expanded <= MAX_EXPANDED, "Expanded artifact limit")
        require(shutil.disk_usage(destination.parent).free >= expanded + MAX_EXPORT + GIB,
                "Insufficient disk for verified extraction and export")
        seen = set()
        files = {}
        for item in entries:
            budget()
            name = item.filename[:-1] if item.is_dir() else item.filename
            member_path(name)
            key = name.casefold()
            require(key not in seen, "Duplicate/case-colliding ZIP path")
            seen.add(key)
            require(not item.flag_bits & 1, "Encrypted ZIP entry")
            mode = item.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR),
                    "ZIP symlink/special entry")
            require(item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    "Unsupported ZIP compression")
            if not item.is_dir():
                files[item.filename] = item
        index_names = [name for name in files
                       if name == "files.json" or name.endswith("/files.json")]
        require(len(index_names) == 1, "Ambiguous original file index")
        prefix = index_names[0][:-len("files.json")]
        require(all(name.startswith(prefix) for name in files), "Mixed ZIP roots")
        index_info = files[index_names[0]]
        require(index_info.file_size <= 64 * CHUNK, "Index size limit")
        index_bytes = source.read(index_info)
        index = decode(index_bytes)
        require(index.get("schemaVersion") == 1
                and index.get("excludes") == ["files.json (self-reference)"],
                "Original index schema/exclusions")
        expected = {}
        require(isinstance(index.get("files"), list), "Original index entries missing")
        for entry in index["files"]:
            name = entry.get("path")
            member_path(name)
            require(name != "files.json" and name not in expected, "Duplicate index member")
            require(type(entry.get("bytes")) is int and entry["bytes"] >= 0
                    and re.fullmatch(r"[a-f0-9]{64}", entry.get("sha256", "")),
                    "Malformed original index entry")
            expected[name] = {"bytes": entry["bytes"], "sha256": entry["sha256"]}
        relative_files = {name[len(prefix):]: item for name, item in files.items()}
        require(set(relative_files) == set(expected) | {"files.json"},
                "Original ZIP/index member mismatch")
        destination.mkdir()
        for name, item in relative_files.items():
            budget()
            target = destination.joinpath(*member_path(name))
            target.parent.mkdir(parents=True, exist_ok=True)
            expected_size = len(index_bytes) if name == "files.json" else expected[name]["bytes"]
            expected_sha = hashlib.sha256(index_bytes).hexdigest() if name == "files.json" else expected[name]["sha256"]
            require(item.file_size == expected_size, "ZIP/index size mismatch")
            checksum = hashlib.sha256()
            count = 0
            with source.open(item) as data, target.open("xb") as output:
                while True:
                    budget()
                    chunk = data.read(CHUNK)
                    if not chunk:
                        break
                    count += len(chunk)
                    require(count <= expected_size, "Expanded member exceeded index")
                    checksum.update(chunk)
                    output.write(chunk)
            require(count == expected_size and checksum.hexdigest() == expected_sha,
                    "Original member digest mismatch")
        return expected, {
            "allOriginalMembersVerifiedBeforeAnalyzer": True,
            "indexSha256": hashlib.sha256(index_bytes).hexdigest(),
            "indexedFiles": len(expected), "expandedBytes": expanded,
            "zipRootPrefix": prefix, "crcCheckedByZipReader": True,
        }


def selected(name):
    if name in ("inputs.json", "comparison.json"):
        return True
    parts = member_path(name)
    if parts[0] not in ("A1", "B1", "B2", "A2"):
        return False
    rest = "/".join(parts[1:])
    if rest == "sample-receipt.json" or rest == "coverage/source-metrics.json":
        return True
    if len(parts) > 2 and parts[1] in ("package", "proof", "native"):
        return True
    return any(rest == command + "." + suffix
               for command in ("install", "check", "native", "linked")
               for suffix in ("receipt.json", "stdout.log", "stderr.log", "combined.log"))


def inventory(root):
    result = []
    for directory, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            budget(finalizing=True)
            path = Path(directory) / name
            require(path.is_file() and not path.is_symlink(), "Unsafe export member")
            result.append({"path": path.relative_to(root).as_posix(),
                           "bytes": path.stat().st_size, "sha256": sha(path, finalizing=True)})
    return result


def main():
    require(len(sys.argv) == 2, "Expected new export directory")
    output = Path(sys.argv[1])
    require(output.is_absolute() and not output.exists()
            and not output.is_symlink(), "Refuse existing/nonabsolute export path")
    require(output.parent.resolve() == output.parent, "Export parent symlink")
    output.mkdir()
    scratch = output.parent / "sdk-ci153-recovery-scratch"
    require(not scratch.exists() and not scratch.is_symlink(), "Refuse existing scratch")
    receipt = {
        "schemaVersion": 1, "status": "running",
        "original": {"repository": REPOSITORY, "runId": RUN_ID, "artifactId": ARTIFACT_ID,
                     "head": ORIGINAL_HEAD, "bytes": ZIP_BYTES, "sha256": ZIP_SHA256},
        "recoveryHead": os.environ.get("SDK_RECOVERY_HEAD_SHA"),
        "recoveryEventSha": os.environ.get("GITHUB_SHA"),
        "recoveryRunId": os.environ.get("GITHUB_RUN_ID"),
        "recoveryRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "scriptSha256": sha(Path(__file__)), "benchmarkRerun": False,
        "backendOrBrowserAccess": False, "permissionScope": ["contents:read", "actions:read"],
    }
    workflow = Path(__file__).parents[1] / "workflows/check.yml"
    receipt["workflowSha256"] = sha(workflow)
    token = os.environ.pop("SDK_RECOVERY_GITHUB_TOKEN", "")
    exit_code = 1
    try:
        require(token and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY,
                "Same-repository job token/context required")
        require(shutil.disk_usage(output.parent).free >= 8 * GIB,
                "Need at least 8 GiB free runner disk")
        scratch.mkdir()
        metadata = api("/repos/" + REPOSITORY + "/actions/artifacts/" + str(ARTIFACT_ID), token)
        run = api("/repos/" + REPOSITORY + "/actions/runs/" + str(RUN_ID), token)
        require(metadata.get("id") == ARTIFACT_ID and metadata.get("name") ==
                "sdk-ci153-controlled-attempt-1" and metadata.get("size_in_bytes") == ZIP_BYTES
                and metadata.get("expired") is False, "Original artifact metadata changed/expired")
        require(metadata.get("digest") == "sha256:" + ZIP_SHA256, "Artifact reported digest changed")
        require(metadata.get("workflow_run", {}).get("id") == RUN_ID
                and metadata["workflow_run"].get("head_sha") == ORIGINAL_HEAD,
                "Artifact run/source binding changed")
        require(run.get("id") == RUN_ID and run.get("head_sha") == ORIGINAL_HEAD
                and run.get("run_attempt") == 1 and run.get("status") == "completed"
                and run.get("conclusion") == "success"
                and run.get("repository", {}).get("id") == REPOSITORY_ID,
                "Original run binding changed")
        receipt["artifactCreatedAt"] = metadata.get("created_at")
        receipt["artifactExpiresAt"] = metadata.get("expires_at")
        expires = datetime.datetime.fromisoformat(metadata["expires_at"].replace("Z", "+00:00"))
        require(expires > datetime.datetime.now(datetime.timezone.utc), "Original artifact expired")
        location = api("/repos/" + REPOSITORY + "/actions/artifacts/" + str(ARTIFACT_ID) + "/zip",
                       token, redirect=True)
        token = None
        archive = scratch / "original.zip"
        receipt["download"] = download(location, archive)
        location = None
        require(archive.stat().st_size == ZIP_BYTES and sha(archive) == ZIP_SHA256,
                "Persisted complete ZIP failed pre-parse digest verification")
        receipt["download"]["persistedZipRehashedBeforeParsing"] = True
        extracted = scratch / "original"
        expected, receipt["manifestVerification"] = extract_verified(archive, extracted)
        analyzer = Path(__file__).with_name("ci153-analyze.py")
        require(sha(analyzer) == ANALYZER_SHA256, "Frozen analyzer bytes changed")
        receipt["analyzerSha256"] = ANALYZER_SHA256
        analysis = scratch / "analysis"
        budget()
        timeout = min(180, int(DEADLINE - time.monotonic() - 30))
        require(timeout > 0, "Insufficient analyzer budget")
        with (output / "analyzer.stdout.log").open("xb") as stdout, \
                (output / "analyzer.stderr.log").open("xb") as stderr:
            completed = subprocess.run([sys.executable, "-I", str(analyzer), str(extracted), str(analysis)],
                                       stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                       timeout=timeout, check=False)
        require(completed.returncode in (0, 2), "Analyzer execution failed")
        receipt["analyzerExitCode"] = completed.returncode
        keep = sorted(name for name in expected if selected(name))
        omitted = [{"path": name, **entry} for name, entry in expected.items() if name not in keep]
        require(sum(expected[name]["bytes"] for name in keep) < MAX_EXPORT,
                "Required compact selection exceeds budget")
        for name in ["files.json"] + keep:
            budget()
            target = output / "original" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(extracted / name, target)
        shutil.copytree(analysis, output / "analysis")
        sources = output / "recovery-source"
        sources.mkdir()
        shutil.copyfile(Path(__file__), sources / "ci153-recover.py")
        shutil.copyfile(analyzer, sources / "ci153-analyze.py")
        shutil.copyfile(workflow, sources / "check.yml")
        write(output / "selected-original-files.json", {
            "originalIndexSha256": receipt["manifestVerification"]["indexSha256"],
            "files": [{"path": name, **expected[name]} for name in keep],
            "indexPreservedAt": "original/files.json",
        })
        write(output / "omitted-original-files.json", {
            "files": omitted, "bytes": sum(item["bytes"] for item in omitted),
            "verification": "All omitted bytes were verified against the original index on this runner before analysis. They are not present in the compact export.",
            "rawRssOmitted": True, "originalZipOmitted": True,
        })
        receipt["status"] = "recovered" if completed.returncode == 0 else "recovered-with-analysis-qualification"
        receipt["scope"] = {
            "originalFullZipDigestVerifiedOnRecoveryRunner": True,
            "originalFullManifestVerifiedOnRecoveryRunner": True,
            "localCompactVerificationIsSubsetOnly": True,
            "noSdkChecksOrNativeProofsRerun": True,
        }
        exit_code = completed.returncode
    except Exception as error:
        # Network helpers already strip signed URLs/auth. Never print traceback.
        receipt["status"] = "failed"
        receipt["error"] = str(error)
    finally:
        token = None
        receipt["cleanup"] = "not-started"
        if scratch.exists():
            try:
                shutil.rmtree(scratch)
                require(not scratch.exists(), "Scratch cleanup incomplete")
                receipt["cleanup"] = "completed"
            except Exception:
                receipt["cleanup"] = "failed"
                exit_code = 1
        receipt["completedAtUtc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        write(output / "recovery-receipt.json", receipt)
        members = inventory(output)
        require(sum(item["bytes"] for item in members) <= MAX_EXPORT,
                "Compact output exceeds 256 MiB; refuse upload")
        write(output / "export-manifest.json", {
            "schemaVersion": 1, "excludes": ["export-manifest.json (self-reference)"],
            "files": members, "originalIndexUnchanged": True,
        })
        # The upload step is gated on this marker, written only after the final
        # expanded export budget is checked; no oversized failure output uploads.
        require(sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
                < MAX_EXPORT, "Final compact export exceeds budget")
        write(output.with_name(output.name + "-upload-ready.json"), {
            "exportManifestSha256": sha(output / "export-manifest.json", finalizing=True),
            "maxExpandedBytes": MAX_EXPORT,
        })
    print("Recovery " + receipt["status"] + "; original artifact " + str(ARTIFACT_ID))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
