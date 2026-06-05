#!/usr/bin/env python3
"""Generate root-level HTML route wrappers from pages/routes.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAP = REPO_ROOT / "pages" / "routes.json"

WRAPPER_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redirecting...</title>
  <meta http-equiv="refresh" content="0; url={target}" />
  <script>
    (function () {{
      var target = '{target}' + window.location.search + window.location.hash;
      if (window.location.pathname + window.location.search + window.location.hash !== target) {{
        window.location.replace(target);
      }}
    }}());
  </script>
</head>
<body>
  <p>Redirecting to <a href="{target}">{target}</a>...</p>
</body>
</html>
"""


def load_routes(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data:
        raise ValueError(f"Route map must be a non-empty object: {path}")
    routes: dict[str, str] = {}
    for route, target in data.items():
        if (
            not isinstance(route, str)
            or not route.endswith(".html")
            or route.startswith("/")
            or ".." in route
        ):
            raise ValueError(f"Invalid route key: {route!r}")
        if not isinstance(target, str) or not target.startswith("/pages/") or not target.endswith(".html"):
            raise ValueError(f"Invalid route target for {route!r}: {target!r}")
        routes[route] = target
    return routes


def wrapper_content(target: str) -> str:
    return WRAPPER_TEMPLATE.format(target=target)


def write_wrappers(routes: dict[str, str], *, check: bool) -> tuple[int, int]:
    changed = 0
    unchanged = 0
    for route, target in routes.items():
        out = REPO_ROOT / route
        expected = wrapper_content(target)
        current = out.read_text(encoding="utf-8") if out.exists() else ""
        if current == expected:
            unchanged += 1
            continue
        if check:
            changed += 1
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(expected, encoding="utf-8")
        changed += 1
    return changed, unchanged


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate root wrapper HTML routes.")
    parser.add_argument("--map", dest="map_path", type=Path, default=DEFAULT_MAP, help="Path to route map JSON.")
    parser.add_argument("--check", action="store_true", help="Check mode: fail if wrappers are out of date.")
    args = parser.parse_args()

    route_map = args.map_path.resolve()
    routes = load_routes(route_map)
    changed, unchanged = write_wrappers(routes, check=args.check)

    if args.check:
        if changed:
            print(f"{changed} wrapper file(s) are out of date. Run: python scripts/generate_route_wrappers.py")
            return 1
        print(f"All {unchanged} wrapper file(s) are up to date.")
        return 0

    print(f"Wrote {changed} wrapper file(s), {unchanged} already up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
