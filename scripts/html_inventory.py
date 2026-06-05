#!/usr/bin/env python3
"""Inventory HTML files in HugInsure with lightweight grouping."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ROUTES_MAP = REPO_ROOT / "pages" / "routes.json"


@dataclass(frozen=True)
class HtmlEntry:
    path: str
    bucket: str
    page_type: str


def route_wrapper_paths() -> set[str]:
    if not ROUTES_MAP.exists():
        return set()
    data = json.loads(ROUTES_MAP.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return set()
    out: set[str] = set()
    for key in data.keys():
        if isinstance(key, str) and key.endswith(".html"):
            out.add(key)
    return out


def collect_html_files() -> list[Path]:
    files: set[Path] = set()
    for path in REPO_ROOT.glob("*.html"):
        files.add(path)
    for path in (REPO_ROOT / "pages" / "core").glob("*.html"):
        files.add(path)
    for path in (REPO_ROOT / "pages" / "careers").glob("*.html"):
        files.add(path)
    for path in (REPO_ROOT / "pages" / "account").glob("*.html"):
        files.add(path)
    for path in (REPO_ROOT / "persona").glob("*.html"):
        files.add(path)
    for path in (REPO_ROOT / "chrome-extension").glob("*.html"):
        files.add(path)
    for rel in route_wrapper_paths():
        candidate = REPO_ROOT / rel
        if candidate.exists():
            files.add(candidate)
    return sorted(files)


def classify(path: Path, wrappers: set[str]) -> HtmlEntry:
    rel = path.relative_to(REPO_ROOT).as_posix()
    name = path.name
    if rel in wrappers:
        return HtmlEntry(path=rel, bucket="route-wrapper", page_type="redirect")
    if rel.startswith("pages/core/"):
        return HtmlEntry(path=rel, bucket="pages-core", page_type="source")
    if rel.startswith("pages/careers/"):
        return HtmlEntry(path=rel, bucket="pages-careers", page_type="source")
    if rel.startswith("pages/account/"):
        return HtmlEntry(path=rel, bucket="pages-account", page_type="source")
    if rel.startswith("persona/"):
        return HtmlEntry(path=rel, bucket="persona", page_type="persona")
    if rel.startswith("chrome-extension/"):
        return HtmlEntry(path=rel, bucket="chrome-extension", page_type="extension")
    if name.startswith("career-") and name != "career.html":
        return HtmlEntry(path=rel, bucket="careers", page_type="job-posting")
    if name in {"disclaimer.html", "payment.html", "login.html"}:
        return HtmlEntry(path=rel, bucket="account-legal", page_type="support")
    if name in {"index.html", "chat.html", "claim.html", "forum.html", "enterprise.html", "enterprise-grant.html", "career.html"}:
        return HtmlEntry(path=rel, bucket="core", page_type="main")
    return HtmlEntry(path=rel, bucket="other", page_type="other")


def render_table(entries: list[HtmlEntry]) -> str:
    col_path = max(len("Path"), *(len(e.path) for e in entries))
    col_bucket = max(len("Bucket"), *(len(e.bucket) for e in entries))
    lines = [
        f"{'Path'.ljust(col_path)}  {'Bucket'.ljust(col_bucket)}  Type",
        f"{'-' * col_path}  {'-' * col_bucket}  {'-' * 12}",
    ]
    for e in entries:
        lines.append(f"{e.path.ljust(col_path)}  {e.bucket.ljust(col_bucket)}  {e.page_type}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory HugInsure HTML files.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table.")
    args = parser.parse_args()

    wrappers = route_wrapper_paths()
    entries = [classify(path, wrappers) for path in collect_html_files()]
    if args.json:
        print(json.dumps([asdict(e) for e in entries], indent=2))
    else:
        print(render_table(entries))
        print(f"\nTotal HTML files: {len(entries)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
