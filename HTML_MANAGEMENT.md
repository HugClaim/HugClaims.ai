# HTML Management

This repo keeps public routes stable while organizing source pages in subfolders.

Current layout:

- Route wrappers (public URLs): repo root, e.g. `chat.html`, `claim.html`
- Source pages: `pages/core/`, `pages/careers/`, `pages/account/`
- Route map: `pages/routes.json`
- Existing subareas: `persona/`, `chrome-extension/`

Use these scripts to keep changes manageable and safe:

## 1) Inventory pages

```bash
python scripts/html_inventory.py
```

What it does:

- Lists all tracked HTML pages from:
  - repo root (`*.html`)
  - `pages/core/*.html`
  - `pages/careers/*.html`
  - `pages/account/*.html`
  - `persona/*.html`
  - `chrome-extension/*.html`
- Buckets pages into source groups and route wrappers.

For machine-readable output:

```bash
python scripts/html_inventory.py --json
```

## 2) Check local links

```bash
python scripts/check_html_links.py
```

What it does:

- Parses local HTML links (`href`, `src`, `action`, `poster`) and validates local targets.
- Ignores external URLs (`http:`, `https:`, `mailto:`, etc.) and hash links.
- Fails with line-numbered errors when local links are broken.

## 3) Generate route wrappers

```bash
python scripts/generate_route_wrappers.py
```

What it does:

- Reads `pages/routes.json`
- Generates root wrapper pages (for stable public URLs)
- Preserves query string and hash while redirecting to the source page

Check mode (CI-friendly):

```bash
python scripts/generate_route_wrappers.py --check
```

## Recommended workflow

1. Edit HTML files.
2. Run `python scripts/check_html_links.py`.
3. If passing, review page inventory with `python scripts/html_inventory.py` when adding/removing pages.
4. When adding a new public route, add it to `pages/routes.json`.
5. Run `python scripts/generate_route_wrappers.py`.
