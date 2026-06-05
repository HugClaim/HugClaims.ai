# Hug.Claims

Cash back when your AI gets it wrong. A prototype of an LLM-error claims platform: ask any AI a question, find a mistake, file a claim, get cash back.

## What's in here

```
.
├── index.html, chat.html, claim.html, ...   ← stable public route files
│                                               (lightweight redirect wrappers)
├── pages/
│   ├── core/       ← source HTML for landing/chat/claim/forum/enterprise pages
│   ├── careers/    ← source HTML for careers hub + role pages
│   └── account/    ← source HTML for login/payment/disclaimer
│
├── server.py             ← FastAPI backend. Streams Claude responses, scores
│                            stakes, grades claims, suggests corrections.
│                            Mounts the project dir as static assets.
│
├── system_prompt.md      ← Hug-persona system prompt for the chat AI.
├── requirements.txt      ← anthropic, fastapi, uvicorn[standard].
├── run.sh                ← one-command launcher: creates .venv, installs
│                            deps, starts uvicorn on 127.0.0.1:8000.
└── data/
    └── math-induction-proof.jpg  ← sample induction-proof image used in the "math"
                             scenario chip.
```

## Run it locally

You need one configured LLM provider:

- Azure AI Foundry + Anthropic deployment (existing path), or
- Azure OpenAI (`AZURE_OPENAI_*`) credentials.

```bash
# Option A: Azure Foundry (Anthropic)
export ANTHROPIC_API_KEY=<your-foundry-key>

# Option B: Azure OpenAI
export AZURE_OPENAI_API_KEY=<your-azure-openai-key>
export AZURE_OPENAI_ENDPOINT=https://<resource-name>.openai.azure.com
export AZURE_OPENAI_DEPLOYMENT=<your-chat-deployment-name>
# optional:
# export AZURE_OPENAI_API_VERSION=2024-10-21

./run.sh
```

Then open `http://127.0.0.1:8000/`. From a remote cluster, forward port 8000:

```bash
ssh -N -L 8000:127.0.0.1:8000 you@<host>
```

### Optional env vars

| var                        | default             | what it does                                                               |
| -------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`        | optional            | Foundry key, passed to `AsyncAnthropicFoundry`                             |
| `FOUNDRY_ENDPOINT`         | hardcoded Azure URL | Foundry base URL                                                           |
| `AZURE_OPENAI_API_KEY`     | optional            | Azure OpenAI API key                                                       |
| `AZURE_OPENAI_ENDPOINT`    | optional            | Azure OpenAI resource endpoint, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT`  | optional            | Azure OpenAI chat deployment name                                          |
| `AZURE_OPENAI_API_VERSION` | `2024-10-21`        | Azure OpenAI API version                                                   |
| `HUG_MODEL`                | `claude-haiku-4-5`  | model used for chat replies                                                |
| `HUG_RATER_MODEL`          | `claude-haiku-4-5`  | model used to score question stakes (0–10)                                 |
| `HUG_VERIFIER_MODEL`       | `claude-haiku-4-5`  | model used to grade submitted claims                                       |
| `HUG_SUGGEST_MODEL`        | `claude-haiku-4-5`  | model used by `/suggest_edit` (frontend currently unused)                  |

## Backend endpoints

All implemented in `server.py`:

| route                         | method | purpose                                                                                                                                                   |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/chat`                       | POST   | streams a Claude reply (SSE); after the stream finishes, fires a Haiku 4.5 stakes-rating call and emits a final `score` event before `done`               |
| `/verify_claim`               | POST   | LLM-as-grader. Takes the conversation snapshot + claimed error + user's correction, returns `{verdict: valid\|invalid\|uncertain, confidence, reasoning}` |
| `/suggest_edit`               | POST   | Haiku 4.5 suggests a corrected version of one assistant message. The frontend currently does not call this — kept for future re-enable                    |
| `/extract_dissatisfaction`    | POST   | extension helper: summarizes why user is unhappy with an external LLM answer, returns `{summary, reasons[], severity, confidence}`                        |
| `/analyze_image_evidence`     | POST   | optional vision helper: analyzes uploaded screenshot/image evidence for likely AI failures                                                                |
| `/submit_extension_claim`     | POST   | extension helper: records confirmed extension claim and returns mock payout in `LLM_CREDITS`                                                              |
| `/redact_for_share`           | POST   | extension helper: detects PII/sensitive content and returns redacted share text + replacement list (`original -> [REDACTED:TYPE]`)                        |
| `/detect_failure_signal`      | POST   | extension auto-agent: predicts likely substantive failure, estimates verification difficulty, and returns cashback offer `$X`                             |
| `/event`                      | POST   | logs client interaction events to `data/events.jsonl`                                                                                                     |
| `/enterprise_grant`           | POST   | stores Enterprise Grant trial applications in `data/enterprise_grants.jsonl` and returns a `grant_id` reference                                           |
| `/export`                     | GET    | downloads `data/events.jsonl` (optional `HUG_EXPORT_TOKEN` gate)                                                                                          |
| `/events_count`               | GET    | returns quick count/size/path for `data/events.jsonl`                                                                                                     |
| `/export_extension`           | GET    | downloads extension-only records from `data/extension_records.jsonl`                                                                                      |
| `/extension_records_count`    | GET    | returns quick count/size/path for `data/extension_records.jsonl`                                                                                          |
| `/` and any other static path | GET    | served from the project directory by FastAPI's `StaticFiles` mount with `html=True`, so `/` resolves to `index.html`                                      |

## How the cash-back loop works

1. User chats with an AI through `chat.html`. After each response, Haiku 4.5 silently rates the question's _stakes_ on a 0–10 scale.
2. The stakes score drives a dynamic bounty: `max(2, round(score × 2.7))` — capped under $30. Bigger stakes = more cash back if the AI was wrong.
3. User clicks **Submit a correct claim →**, which snapshots the conversation into `localStorage["hug:claim"]` and navigates to `claim.html`.
4. On the claim page, the user hovers any assistant reply to inline-edit it. A live word-level diff preview shows their corrections in coral and the original in red strikethrough.
5. **LLM Verifier** sends the edits to Haiku 4.5 as a grader; **Submit** mocks a payout, showing the expected cash-back amount.

## Tech

- **FastAPI** + uvicorn for the backend
- **Anthropic Foundry SDK** (`anthropic >= 0.40`)
- **Vanilla JS** + Server-Sent Events for the chat streaming
- **Fraunces** + **Hanken Grotesk** from Google Fonts; warm parchment background with subtle noise + radial gradients

Prompt caching is wired in (`cache_control: {type: "ephemeral"}` on the system block). Whether it actually engages depends on the chosen model's minimum cacheable prefix size — Haiku 4.5 needs ≥ 4096 tokens, the Hug system prompt is closer to 2200, so a switch to Sonnet 4.6 (2048-token threshold) will start caching immediately.

## Deploying the frontend separately

The HTML files plus the sample assets under `data/` are everything the UI needs. GitHub Pages serves them as-is; the chat composer's `fetch('/chat', …)` will fail without a backend somewhere to forward to. For a fully working hosted demo, deploy `server.py` (Render, Railway, Modal, Fly), set CORS for the Pages origin, and point the frontend's `fetch` at the backend's URL.

## Chrome extension MVP (`chrome-extension/`)

This repo now includes a Manifest V3 extension for the flow:

1. User is on ChatGPT / Claude / Gemini / Copilot.
2. Click extension popup → **Capture From Tab**.
3. Click **Extract Why** (calls `/extract_dissatisfaction`).
4. Confirm extracted complaint summary.
5. Click **Confirm + Submit** (calls `/submit_extension_claim`) and receives LLM credits.
6. Click **Share (PII Safe)** to run LLM redaction and preview exactly what is replaced before copying.

### Auto failure signal (in-page)

When enabled in the popup, the content script periodically checks the current chat transcript and calls `/detect_failure_signal`.
If a likely substantial model error is detected, HugInsure shows a small in-page prompt with:

- `Log interaction for $X` (submits claim + synced credit/cash-back offer)
- `Donate` (logs interaction for quality analysis)
- `Dismiss`

Cashback offer `$X` is computed from model-predicted verification difficulty.

### Load in Chrome (unpacked)

1. Start HugInsure backend (`./run.sh`) on `http://127.0.0.1:8000`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `HugInsure/chrome-extension`.
5. Pin the extension and open it on a supported AI chat tab.

The popup lets you override backend URL if needed.

### Where extension data is saved

Extension activity is persisted on the backend under `data/`:

- `events.jsonl` (all pages + extension events)
- `extension_records.jsonl` (extension-only records: extract, claim submit, redaction, auto-signal)
- `extension_images/` (captured image evidence from extension requests, when provided)

For download/export:

- `/export` for all events
- `/export_extension` for extension-only records

Extension records are deduplicated by input fingerprint:

- exact same input is skipped
- same conversation with different failure datapoints (summary/reasons/severity/user note) is kept

To dedupe existing historical duplicates in-place:

- `POST /dedupe_extension_records` (creates backup `data/extension_records.jsonl.bak`)

## Managing HTML files

Public route files are lightweight redirect wrappers, with:

- root-level routes for core/account pages (`/chat.html`, `/claim.html`, etc.)
- `careers/` routes for career pages (`/careers/career.html`, etc.)
  Source HTML now lives under:

- `pages/core/`
- `pages/careers/`
- `pages/account/`

To manage these pages, use the built-in scripts:

- `python scripts/generate_route_wrappers.py`
  - regenerates wrapper pages from `pages/routes.json` (including nested route keys)
- `python scripts/html_inventory.py`
  - lists HTML files and buckets them by area (`core`, `careers`, `persona`, `chrome-extension`, etc.)
- `python scripts/check_html_links.py`
  - checks local `href/src/action/poster` targets and reports broken links with file + line

Detailed usage and workflow notes live in `HTML_MANAGEMENT.md`.
