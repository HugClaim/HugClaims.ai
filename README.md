# Hug.Claims

Cash back when your AI gets it wrong. A prototype of an LLM-error claims platform: ask any AI a question, find a mistake, file a claim, get cash back.

## What's in here

```
.
├── index.html            ← landing page (the homepage at /)
│                            background grid of red ✗ that flip to green ✓ on hover,
│                            hero with the "v = 1 → −e⁻ˣ" math example, examples
│                            grid (math / finance / medicine), how-it-works, CTA.
│
├── chat.html             ← the chat interface. Two modes: "your chat" (real Claude
│                            via the backend) and "examples" (canned scenarios).
│                            Right sidebar shows live stakes (10-segment bar) + a
│                            dynamic cash-back amount (animated $X). Composer
│                            supports text + image (paperclip → multimodal block).
│
├── claim.html            ← claim-filing page. Snapshot of the chat (loaded from
│                            localStorage), inline track-changes editing on each
│                            assistant message (hover to open, side-by-side textarea
│                            + live diff preview), figure uploads, "Submit claim",
│                            "LLM Verifier" button (Haiku 4.5 grader), and a
│                            cash-back receipt on submit.
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
    └── Math.JPG          ← sample induction-proof image used in the "math"
                             scenario chip.
```

## Run it locally

You need an Azure AI Foundry key for an Anthropic deployment (Haiku 4.5 by default).

```bash
export ANTHROPIC_API_KEY=<your-foundry-key>
./run.sh
```

Then open `http://127.0.0.1:8000/`. From a remote cluster, forward port 8000:

```bash
ssh -N -L 8000:127.0.0.1:8000 you@<host>
```

### Optional env vars

| var | default | what it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Foundry key, passed to `AsyncAnthropicFoundry` |
| `FOUNDRY_ENDPOINT` | hardcoded Azure URL | Foundry base URL |
| `HUG_MODEL` | `claude-haiku-4-5` | model used for chat replies |
| `HUG_RATER_MODEL` | `claude-haiku-4-5` | model used to score question stakes (0–10) |
| `HUG_VERIFIER_MODEL` | `claude-haiku-4-5` | model used to grade submitted claims |
| `HUG_SUGGEST_MODEL` | `claude-haiku-4-5` | model used by `/suggest_edit` (frontend currently unused) |

## Backend endpoints

All implemented in `server.py`:

| route | method | purpose |
|---|---|---|
| `/chat` | POST | streams a Claude reply (SSE); after the stream finishes, fires a Haiku 4.5 stakes-rating call and emits a final `score` event before `done` |
| `/verify_claim` | POST | LLM-as-grader. Takes the conversation snapshot + claimed error + user's correction, returns `{verdict: valid\|invalid\|uncertain, confidence, reasoning}` |
| `/suggest_edit` | POST | Haiku 4.5 suggests a corrected version of one assistant message. The frontend currently does not call this — kept for future re-enable |
| `/extract_dissatisfaction` | POST | extension helper: summarizes why user is unhappy with an external LLM answer, returns `{summary, reasons[], severity, confidence}` |
| `/submit_extension_claim` | POST | extension helper: records confirmed extension claim and returns mock payout in `LLM_CREDITS` |
| `/redact_for_share` | POST | extension helper: detects PII/sensitive content and returns redacted share text + replacement list (`original -> [REDACTED:TYPE]`) |
| `/detect_failure_signal` | POST | extension auto-agent: predicts likely substantive failure, estimates verification difficulty, and returns cashback offer `$X` |
| `/event` | POST | logs client interaction events to `data/events.jsonl` |
| `/export` | GET | downloads `data/events.jsonl` (optional `HUG_EXPORT_TOKEN` gate) |
| `/events_count` | GET | returns quick count/size/path for `data/events.jsonl` |
| `/export_extension` | GET | downloads extension-only records from `data/extension_records.jsonl` |
| `/extension_records_count` | GET | returns quick count/size/path for `data/extension_records.jsonl` |
| `/` and any other static path | GET | served from the project directory by FastAPI's `StaticFiles` mount with `html=True`, so `/` resolves to `index.html` |

## How the cash-back loop works

1. User chats with an AI through `chat.html`. After each response, Haiku 4.5 silently rates the question's *stakes* on a 0–10 scale.
2. The stakes score drives a dynamic bounty: `max(2, round(score × 2.7))` — capped under $30. Bigger stakes = more cash back if the AI was wrong.
3. User clicks **Submit a correct claim →**, which snapshots the conversation into `localStorage["hug:claim"]` and navigates to `claim.html`.
4. On the claim page, the user hovers any assistant reply to inline-edit it. A live word-level diff preview shows their corrections in coral and the original in red strikethrough.
5. **LLM Verifier** sends the edits to Haiku 4.5 as a grader; **Submit** mocks a payout, showing the expected cash-back amount.

## Tech

- **FastAPI** + uvicorn for the backend, async streaming via `AsyncAnthropicFoundry.messages.stream()`
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

For download/export:
- `/export` for all events
- `/export_extension` for extension-only records
