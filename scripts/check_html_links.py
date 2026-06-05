#!/usr/bin/env python3
"""Check local HTML links in HugInsure pages."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ROUTES_MAP = REPO_ROOT / "pages" / "routes.json"
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
ATTRS_BY_TAG = {
    "a": {"href"},
    "link": {"href"},
    "img": {"src"},
    "script": {"src"},
    "iframe": {"src"},
    "source": {"src"},
    "video": {"src", "poster"},
    "audio": {"src"},
    "form": {"action"},
}


@dataclass(frozen=True)
class LinkRef:
    source: Path
    line: int
    attr: str
    value: str


@dataclass(frozen=True)
class BrokenLink:
    ref: LinkRef
    resolved: Path


def route_wrapper_files() -> list[Path]:
    if not ROUTES_MAP.exists():
        return []
    data = json.loads(ROUTES_MAP.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return []
    out: list[Path] = []
    for key in data.keys():
        if not isinstance(key, str) or not key.endswith(".html"):
            continue
        path = REPO_ROOT / key
        if path.exists():
            out.append(path)
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
    for path in route_wrapper_files():
        files.add(path)
    return sorted(files)


class LinkExtractor(HTMLParser):
    def __init__(self, source: Path):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.refs: list[LinkRef] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        wanted = ATTRS_BY_TAG.get(tag)
        if not wanted:
            return
        line, _ = self.getpos()
        for attr, value in attrs:
            if attr in wanted and value is not None:
                self.refs.append(LinkRef(source=self.source, line=line, attr=attr, value=value.strip()))


def should_skip(raw: str) -> bool:
    if not raw:
        return True
    if raw.startswith(("#", "//")):
        return True
    if SCHEME_RE.match(raw):
        return True
    return False


def split_target(raw: str) -> str:
    target = raw.split("#", 1)[0].split("?", 1)[0].strip()
    return target


def resolve_target(ref: LinkRef) -> Path | None:
    if should_skip(ref.value):
        return None
    target = split_target(ref.value)
    if not target:
        return None
    if target.startswith("/"):
        return (REPO_ROOT / target.lstrip("/")).resolve()
    return (ref.source.parent / target).resolve()


def link_exists(path: Path) -> bool:
    if path.is_file():
        return True
    if path.is_dir():
        return (path / "index.html").is_file()
    return False


def check_links() -> tuple[int, int, list[BrokenLink]]:
    files = collect_html_files()
    total_refs = 0
    broken: list[BrokenLink] = []

    for file in files:
        parser = LinkExtractor(file)
        parser.feed(file.read_text(encoding="utf-8"))
        for ref in parser.refs:
            resolved = resolve_target(ref)
            if resolved is None:
                continue
            total_refs += 1
            if not link_exists(resolved):
                broken.append(BrokenLink(ref=ref, resolved=resolved))

    return len(files), total_refs, broken


def rel(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check local links across HugInsure HTML pages.")
    parser.parse_args()

    file_count, ref_count, broken = check_links()
    print(f"Scanned {file_count} HTML files, checked {ref_count} local link targets.")
    if not broken:
        print("No broken local links found.")
        return 0

    print(f"Found {len(broken)} broken local links:")
    for item in broken:
        source = rel(item.ref.source)
        target = rel(item.resolved)
        print(f"- {source}:{item.ref.line} [{item.ref.attr}] '{item.ref.value}' -> {target}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
