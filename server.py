"""HugInsure backend — proxies user messages to Claude with prompt caching.
Calls Anthropic models hosted on Azure AI Foundry via AsyncAnthropicFoundry.

Run:
    export ANTHROPIC_API_KEY=<your-foundry-key>
    ./run.sh

Or manually:
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python server.py

Then open http://127.0.0.1:8000

Configuration via env vars:
    ANTHROPIC_API_KEY   REQUIRED — your Azure Foundry key
    FOUNDRY_ENDPOINT    optional — defaults to the endpoint baked in below
    HUG_MODEL           optional — Foundry deployment name, default claude-haiku-4-5
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

import anthropic
from anthropic import AsyncAnthropicFoundry
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Azure AI Foundry endpoint and deployment.
ENDPOINT = os.environ.get(
    "FOUNDRY_ENDPOINT",
    os.environ.get(
        "AZURE_FOUNDRY_ENDPOINT",
        "https://ai-mghassem9468ai243514660583.services.ai.azure.com/anthropic/",
    ),
)
# Deployment name on Foundry — usually matches the Anthropic model ID.
# Set HUG_MODEL=claude-opus-4-7 (or whatever your Opus deployment is named) to swap.
MODEL = os.environ.get("HUG_MODEL", "claude-haiku-4-5")

HERE = Path(__file__).resolve().parent
SYSTEM_PROMPT = (HERE / "system_prompt.md").read_text()

# Always rate with Haiku 4.5 — cheap, fast, sufficient for a 0-10 score.
RATER_MODEL = os.environ.get("HUG_RATER_MODEL", "claude-haiku-4-5")
SUGGEST_MODEL = os.environ.get("HUG_SUGGEST_MODEL", "claude-haiku-4-5")
DETECT_MODEL = os.environ.get("HUG_DETECT_MODEL", "claude-haiku-4-5")
SEGMENT_MODEL = os.environ.get("HUG_SEGMENT_MODEL", "claude-haiku-4-5")
SUGGEST_SYSTEM = """You are a fact-checker reviewing an AI assistant's reply for potential errors. \
A user is considering filing a claim that this reply was wrong. Your job: produce a corrected \
version of the target reply, fixing factual, logical, or significant errors so the user can \
accept your suggestion or modify it.

Guidelines:
- If the target reply has clear factual or logical errors, fix them. Keep the same general \
  structure, length, and tone; just replace the wrong claims with correct ones.
- If the target reply is already correct, return it unchanged.
- Be calibrated: don't manufacture errors that aren't there. Don't reword for style.
- If you're uncertain, prefer the original over speculative changes.

Output ONLY the corrected message text. No quotation marks, no preamble like "Here's the \
correction:", no commentary, no markdown, no HTML. Just the text the user should see in \
their corrected version."""

DETECT_SYSTEM = """You identify which AI assistant likely produced a response in a claim transcript.
Choose the best label from this exact list:
GPT-5.1, GPT-4o, GPT-4.1, Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5, Gemini 2.5 Pro, Gemini 2.5 Flash, Meta AI, Grok, Perplexity, DeepSeek, Qwen, Mistral, Copilot, Other/Unknown.

Use explicit labels in the transcript first. If there is no clear evidence, return Other/Unknown.
Output ONLY JSON on one line:
{"llm":"<label>","confidence":0.0-1.0,"reason":"<short reason>"}"""

SEGMENT_SYSTEM = """You segment pasted chat transcripts into ordered turns.
Your output is used to render user vs assistant bubbles in a UI.

Rules:
- Return ONLY JSON on one line, no markdown or code fences.
- Extract conversation turns in original order.
- Each turn must have:
  - role: exactly "user" or "assistant"
  - text: non-empty message content
  - marker: short speaker label if visible (e.g., "User", "Claude Opus 4.7"), else ""
- Ignore metadata sections and headers (e.g., "Conversation", "Options", IDs, timestamps, endpoint, title).
- Keep the message text faithful; do not paraphrase.
- If uncertain, prefer "assistant" for non-user speakers.
- If no clear segmentation exists, return one turn as role "user" with the full text.

Output schema:
{"format":"History transcript|JSON export|Generic chat|LLM segmented","turns":[{"role":"user|assistant","text":"...","marker":"..."}]}"""

DISSATISFACTION_SYSTEM = """You extract why a user is dissatisfied with an AI answer.
You will receive:
- SOURCE_AI: model/provider label if known
- USER_NOTE: the user's own complaint (optional)
- TRANSCRIPT: the conversation text

Return ONLY one-line JSON:
{"summary":"<1 sentence>","reasons":["<short reason>", "..."],"severity":1-5,"needs_human_review":true|false,"confidence":0.0-1.0}

Rules:
- Focus ONLY on likely AI failures: factual error, missing context, hallucination, refusal mismatch, shallow answer, unsafe advice, stale info.
- Do NOT praise the AI, do NOT say the answer was appropriate/correct/helpful, and do NOT explain what it did right.
- Keep reasons concise and non-duplicative (1-4 items).
- If evidence is weak, still provide best-effort potential failure hypotheses and set needs_human_review=true with low confidence.
- severity=1 means minor annoyance; severity=5 means high-stakes error.
"""

PII_REDACT_SYSTEM = """You are a privacy redaction agent for user-shared claim text.
Input includes a transcript and optional user note.

Identify and redact user-identifiable or sensitive data, including:
- person names when they appear to identify a real individual
- emails, phone numbers, home/work addresses
- IDs, account numbers, passports, SSN-like tokens
- credit card / banking details
- dates of birth, exact ages for minors, medical record identifiers
- exact employer/school identifiers if personally identifying

Do NOT redact generic technical content, model names, or non-identifying facts.

Output ONLY one-line JSON:
{"redacted_text":"<full redacted transcript>","redactions":[{"original":"...","replacement":"[REDACTED:TYPE]","type":"NAME|EMAIL|PHONE|ADDRESS|ID|ACCOUNT|PAYMENT|DOB|MEDICAL|OTHER"}],"risk_level":"low|medium|high","confidence":0.0-1.0}

Rules:
- Keep redacted_text same structure as source; only replace sensitive spans.
- Use replacement token exactly like [REDACTED:TYPE].
- redactions should be unique and concise.
"""

AUTO_SIGNAL_SYSTEM = """You are an LLM claims triage agent.
Given a transcript between a user and an AI assistant, predict whether there is a likely
substantive assistant failure worth offering a HugInsure claim signal.

A substantive failure includes: factual error, unsafe advice, fabricated citation/source,
important omission, severe misunderstanding, or self-contradiction.
Ignore minor style issues and harmless preference mismatches.

Return ONLY one-line JSON:
{"detected":true|false,"summary":"<1 sentence>","reasons":["<short reason>", "..."],"difficulty":1-5,"confidence":0.0-1.0}

Guidance:
- difficulty=1 easy/low-stakes, 5 difficult/high-stakes verification burden.
- If uncertain, set detected=false and low confidence.
"""

IMAGE_FAILURE_SYSTEM = """You analyze user-provided screenshot/image evidence from an AI conversation and identify likely AI failures.
You will receive:
- SOURCE_AI
- USER_NOTE
- TRANSCRIPT
- one or more conversation images

Return ONLY one-line JSON:
{"summary":"<1 sentence>","reasons":["<short reason>", "..."],"severity":1-5,"confidence":0.0-1.0}

Rules:
- Focus ONLY on likely failures or risk points visible in text/images.
- Do NOT praise the AI and do NOT explain what it did right.
- If text inside images is partially unreadable, report uncertainty but still provide best-effort hypotheses.
- Keep reasons concise and non-duplicative (1-4 items).
"""


VERIFIER_MODEL = os.environ.get("HUG_VERIFIER_MODEL", "claude-haiku-4-5")
VERIFIER_SYSTEM = """You are an impartial verifier of error claims against AI assistants. \
A user has filed a claim that an AI got something wrong. You will see four things:

  CONVERSATION: the full back-and-forth between the user and the AI.
  CLAIMED ERROR: what the user says was wrong about the AI's answer.
  PROPOSED CORRECTION: what the user says the actual correct answer is.

Determine whether the claim has merit:
  - "valid"     means the AI made a real, substantial error AND the user's correction is essentially right.
  - "invalid"   means the AI was actually correct (claim doesn't hold), OR the user's proposed correction is itself wrong.
  - "uncertain" means you genuinely cannot tell from what was provided (insufficient context, subjective domain, etc.).

Be calibrated and skeptical. Don't reward nitpicks (typos, formatting, stylistic preferences) — \
the AI must have made a real factual or logical error to merit a payout. Don't reward claims \
where the user just disagrees with a correctly-hedged answer.

Output ONLY a single line of JSON, no prose, no code fences, no markdown:
{"verdict": "valid"|"invalid"|"uncertain", "confidence": 0.0-1.0, "reasoning": "<1-3 sentences>"}"""


RATER_SYSTEM = """You evaluate how high-stakes a user's QUESTION is — i.e., how much careful \
attention it deserves in a response. You are NOT rating the answer's correctness; you are rating \
how consequential it is to get this question right.

Score 0-10 (integer):
  0-2  Trivial or playful — small consequence if mishandled.
  3-4  Common-knowledge factual — low real-world consequence.
  5-6  Specific or domain-bound — meaningful consequence if mishandled.
  7-8  Specialized, time-sensitive, or affects real decisions.
  9-10 High-stakes: medical, legal, financial, safety-critical decisions.

If the question is about taking medication, treatment, regulated activity, money decisions, \
or anything irreversible: lean 7+. If a child's homework or a trivia bet: lean 0-3.

Respond with ONLY a valid JSON object on a single line, no prose, no code fences:
{"score": <integer 0-10>, "reason": "<one short clause, <=14 words, why these stakes>"}"""

app = FastAPI()

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "https://yuexinghao.github.io,http://127.0.0.1:8000,http://localhost:8000",
    ).split(",")
    if origin.strip()
]
ALLOWED_ORIGIN_REGEX = os.environ.get("ALLOWED_ORIGIN_REGEX", r"chrome-extension://.*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

client: Optional[AsyncAnthropicFoundry] = None
AZURE_MODEL_CATALOG_URL = "https://ai.azure.com/catalog/models"
AZURE_MODELS_CACHE_TTL_SECONDS = 60 * 60 * 6  # 6 hours
_azure_models_cache: dict[str, Any] = {"expires_at": 0.0, "payload": None}
_azure_models_cache_lock = asyncio.Lock()

_MODEL_TOKEN_RE = re.compile(
    r"\b(?:gpt|o1|o3|o4|claude|gemini|llama|mistral|codestral|ministral|pixtral|deepseek|grok|phi|mai|command|nemotron|qwen|yi|jamba|reka)[a-z0-9._-]*\b",
    flags=re.IGNORECASE,
)
_MODEL_BAD_FRAGMENTS = (
    ".com",
    ".pdf",
    "system-card",
    "plan-pricing",
    "prompting-best-practices",
    "cookbooks",
    "modelpricing",
    "eastus",
    "westus",
    "latest",
    "preview",
    "access",
    "prod",
)

_PROVIDER_META: dict[str, tuple[str, str, str]] = {
    "openai": ("OpenAI", "openai", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openai.svg"),
    "anthropic": ("Anthropic", "anthropic", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/anthropic.svg"),
    "google": ("Google", "gemini", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini.svg"),
    "meta": ("Meta", "meta", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/meta.svg"),
    "mistral": ("Mistral AI", "mistral", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/mistral.svg"),
    "cohere": ("Cohere", "cohere", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/cohere.svg"),
    "deepseek": ("DeepSeek", "deepseek", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/deepseek.svg"),
    "xai": ("xAI", "grok", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/grok.svg"),
    "microsoft": ("Microsoft", "microsoft", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/microsoft.svg"),
    "nvidia": ("NVIDIA", "nvidia", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia.svg"),
    "qwen": ("Qwen", "qwen", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/qwen.svg"),
    "yi": ("Yi", "yi", "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/yi.svg"),
}


def _provider_for_model_token(token: str) -> str:
    t = token.lower()
    if t.startswith(("gpt", "o1", "o3", "o4")):
        return "openai"
    if t.startswith("claude"):
        return "anthropic"
    if t.startswith("gemini"):
        return "google"
    if t.startswith("llama"):
        return "meta"
    if t.startswith(("mistral", "codestral", "ministral", "pixtral")):
        return "mistral"
    if t.startswith("command"):
        return "cohere"
    if t.startswith("deepseek"):
        return "deepseek"
    if t.startswith("grok"):
        return "xai"
    if t.startswith(("phi", "mai")):
        return "microsoft"
    if t.startswith("nemotron"):
        return "nvidia"
    if t.startswith("qwen"):
        return "qwen"
    if t.startswith("yi"):
        return "yi"
    return "microsoft"


def _is_likely_model_token(token: str) -> bool:
    t = token.lower().strip(" .,:;!?\"'`()[]{}")
    if len(t) < 4:
        return False
    if any(bad in t for bad in _MODEL_BAD_FRAGMENTS):
        return False
    if t.endswith((".png", ".jpg", ".jpeg", ".webp", ".svg")):
        return False
    # Model-like tokens generally carry versioning or family suffixes.
    if not any(ch.isdigit() for ch in t):
        if t not in {"command-r", "command-r-plus", "gpt-oss", "deepseek-r1", "deepseek-v3", "deepseek-v4"}:
            return False
    return True


def _canonical_model_name(token: str) -> str:
    t = token.lower().strip(" .,:;!?\"'`()[]{}")
    t = t.replace("_", "-")
    # Normalize common separators and readability for chips.
    t = re.sub(r"-{2,}", "-", t)
    return t


def _fetch_azure_models(limit: int = 36) -> dict[str, Any]:
    req = urlrequest.Request(
        AZURE_MODEL_CATALOG_URL,
        headers={"User-Agent": "HugInsure/1.0 (+https://hug.claims)"},
        method="GET",
    )
    with urlrequest.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    candidates = []
    seen = set()
    for m in _MODEL_TOKEN_RE.finditer(html):
        raw = m.group(0)
        if not _is_likely_model_token(raw):
            continue
        name = _canonical_model_name(raw)
        if name in seen:
            continue
        seen.add(name)
        provider_key = _provider_for_model_token(name)
        provider_name, logo_key, logo_url = _PROVIDER_META[provider_key]
        candidates.append(
            {
                "name": name,
                "provider": provider_name,
                "provider_key": provider_key,
                "logo_key": logo_key,
                "logo": logo_url,
            }
        )

    # Stable order by provider first, then model name.
    provider_order = {
        "openai": 1,
        "anthropic": 2,
        "google": 3,
        "meta": 4,
        "mistral": 5,
        "cohere": 6,
        "deepseek": 7,
        "xai": 8,
        "microsoft": 9,
        "nvidia": 10,
        "qwen": 11,
        "yi": 12,
    }
    candidates.sort(key=lambda x: (provider_order.get(x["provider_key"], 99), x["name"]))
    models = candidates[: max(1, min(80, int(limit or 36)))]
    return {
        "source_url": AZURE_MODEL_CATALOG_URL,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": len(models),
        "models": models,
    }


def foundry_api_key() -> Optional[str]:
    return (
        os.environ.get("ANTHROPIC_API_KEY")
        or os.environ.get("ANTHROPIC_FOUNDRY_API_KEY")
        or os.environ.get("AZURE_FOUNDRY_API_KEY")
    )


def azure_openai_api_key() -> Optional[str]:
    return (
        os.environ.get("AZURE_OPENAI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )


def azure_openai_endpoint() -> str:
    return os.environ.get("AZURE_OPENAI_ENDPOINT", "").strip()


def azure_openai_deployment() -> str:
    return os.environ.get("AZURE_OPENAI_DEPLOYMENT", "").strip()


def azure_openai_api_version() -> str:
    return os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21")


def has_llm_credentials() -> bool:
    return bool(foundry_api_key() or (azure_openai_api_key() and azure_openai_endpoint() and azure_openai_deployment()))


def active_llm_provider() -> str:
    if foundry_api_key():
        return "anthropic_foundry"
    if azure_openai_api_key() and azure_openai_endpoint() and azure_openai_deployment():
        return "azure_openai"
    return "none"


def _flatten_content_for_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                txt = str(block.get("text") or "").strip()
                if txt:
                    parts.append(txt)
            elif block.get("type") == "image":
                parts.append("[image omitted]")
        return "\n".join(parts).strip()
    return str(content or "")


def _azure_openai_chat_sync(*, system: Optional[str], messages: list[dict[str, Any]], max_tokens: int) -> str:
    endpoint = azure_openai_endpoint().rstrip("/")
    deployment = azure_openai_deployment()
    api_key = azure_openai_api_key()
    if not endpoint or not deployment or not api_key:
        raise RuntimeError("Azure OpenAI is not fully configured")

    url = (
        f"{endpoint}/openai/deployments/{urlparse.quote(deployment)}/chat/completions"
        f"?api-version={urlparse.quote(azure_openai_api_version())}"
    )
    azure_messages: list[dict[str, str]] = []
    if system:
        azure_messages.append({"role": "system", "content": str(system)})
    for msg in messages:
        role = str(msg.get("role") or "user")
        role = role if role in ("system", "user", "assistant") else "user"
        azure_messages.append({"role": role, "content": _flatten_content_for_text(msg.get("content"))})

    payload = {
        "messages": azure_messages,
        "temperature": 0,
        "max_tokens": int(max_tokens),
    }
    req = urlrequest.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "api-key": api_key,
        },
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urlerror.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise RuntimeError(f"azure api error {e.code}: {body[:300]}") from e
    except Exception as e:
        raise RuntimeError(f"azure request failed: {type(e).__name__}: {e}") from e

    data = json.loads(raw or "{}")
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("azure response missing choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else {}
    text = str((message or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("azure response returned empty text")
    return text


async def llm_create_text(*, model: str, max_tokens: int, system: str, messages: list[dict[str, Any]]) -> str:
    provider = active_llm_provider()
    if provider == "anthropic_foundry":
        resp = await get_client().messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        return next((b.text for b in resp.content if b.type == "text"), "").strip()
    if provider == "azure_openai":
        return await asyncio.to_thread(
            _azure_openai_chat_sync,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
        )
    raise RuntimeError("No LLM credentials configured. Set ANTHROPIC_API_KEY or Azure OpenAI vars.")


def severity_to_cashback(level: int) -> int:
    """Map 1..5 severity/difficulty to a concise $2..$27 payout scale."""
    clamped = max(1, min(5, int(level)))
    # 1->2, 2->8, 3->15, 4->21, 5->27
    return int(round(2 + (clamped - 1) * (25 / 4)))


def get_client() -> AsyncAnthropicFoundry:
    global client
    if client is None:
        key = foundry_api_key()
        if not key:
            raise RuntimeError("Foundry API key not configured")
        client = AsyncAnthropicFoundry(
            api_key=key,
            base_url=ENDPOINT,
        )
    return client

# ---------- Dataset capture ----------------------------------------------------
# Every interaction (server-driven and client-driven) lands as one JSON object
# per line in data/events.jsonl. JSONL is append-only, streamable, and consumed
# downstream with `pandas.read_json("data/events.jsonl", lines=True)`.

DATA_DIR = HERE / "data"
DATA_DIR.mkdir(exist_ok=True)
EVENTS_FILE = DATA_DIR / "events.jsonl"
EXTENSION_RECORDS_FILE = DATA_DIR / "extension_records.jsonl"
_events_lock = asyncio.Lock()
_extension_records_lock = asyncio.Lock()
_extension_seen_fingerprints: set[str] = set()
_extension_seen_loaded = False


async def log_event(
    event_type: str,
    *,
    page: Optional[str] = None,
    session_id: Optional[str] = None,
    payload: Optional[dict] = None,
    request: Optional[Request] = None,
    client_timestamp: Optional[str] = None,
) -> dict:
    """Append one JSONL record to data/events.jsonl. Best-effort; never raises."""
    record: dict[str, Any] = {
        "event_id":   str(_uuid.uuid4()),
        "session_id": session_id,
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "page":       page,
        "payload":    payload or {},
    }
    if client_timestamp:
        record["client_timestamp"] = client_timestamp
    if request is not None:
        record["ip"] = request.client.host if request.client else None
        record["user_agent"] = request.headers.get("user-agent")
    try:
        async with _events_lock:
            with EVENTS_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    except Exception as e:
        print(f"[hug] log_event write error: {type(e).__name__}: {e}", flush=True)
    return record


async def log_extension_record(
    record_type: str,
    *,
    session_id: Optional[str] = None,
    source_ai: Optional[str] = None,
    transcript: Optional[str] = None,
    payload: Optional[dict] = None,
) -> dict:
    """Append one extension-focused JSONL record for easy downstream analysis.

    Dedupes by input fingerprint:
    - exact same input => skipped
    - same transcript with different failure datapoints => kept
    """
    payload_obj = payload or {}
    fingerprint = extension_input_fingerprint(
        record_type=record_type,
        source_ai=source_ai,
        transcript=transcript,
        payload=payload_obj,
    )
    record: dict[str, Any] = {
        "record_id": str(_uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "record_type": record_type,
        "session_id": session_id,
        "source_ai": source_ai or "Unknown",
        "transcript": (transcript or "")[:50000],
        "payload": payload_obj,
        "input_fingerprint": fingerprint,
    }
    try:
        async with _extension_records_lock:
            await _load_extension_seen_fingerprints_locked()
            if fingerprint in _extension_seen_fingerprints:
                return {
                    "record_id": None,
                    "deduped": True,
                    "input_fingerprint": fingerprint,
                }
            with EXTENSION_RECORDS_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
            _extension_seen_fingerprints.add(fingerprint)
    except Exception as e:
        print(f"[hug] extension record write error: {type(e).__name__}: {e}", flush=True)
    return record


def _norm_text(value: Any, limit: int = 50000) -> str:
    text = str(value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text.strip()[:limit]


def _norm_list(values: Any, each_limit: int = 200) -> list[str]:
    out: list[str] = []
    if not isinstance(values, list):
        return out
    for item in values:
        t = _norm_text(item, each_limit)
        if t:
            out.append(t)
    return out


def extension_dedupe_key_payload(record_type: str, source_ai: Optional[str], transcript: Optional[str], payload: dict) -> dict:
    source = _norm_text(source_ai, 80) or "Unknown"
    transcript_norm = _norm_text(transcript, 50000)
    key: dict[str, Any] = {
        "record_type": record_type,
        "source_ai": source,
        "transcript": transcript_norm,
    }

    if record_type == "extract_dissatisfaction":
        key["user_note"] = _norm_text(payload.get("user_note"), 500)
        key["image_hashes"] = _norm_list(payload.get("image_hashes"), 128)
    elif record_type == "submit_extension_claim":
        key["summary"] = _norm_text(payload.get("summary"), 260)
        key["reasons"] = _norm_list(payload.get("reasons"), 150)
        key["severity"] = int(payload.get("severity") or 0)
        key["auto_detected"] = bool(payload.get("auto_detected"))
        key["user_note"] = _norm_text(payload.get("user_note"), 500)
    elif record_type == "redact_for_share":
        key["user_note"] = _norm_text(payload.get("user_note"), 500)
    elif record_type == "detect_failure_signal":
        # Same transcript + source is same input. Do not include model outputs.
        pass
    else:
        # Fallback for future record types.
        key["payload"] = payload
    return key


def extension_input_fingerprint(*, record_type: str, source_ai: Optional[str], transcript: Optional[str], payload: dict) -> str:
    key = extension_dedupe_key_payload(record_type, source_ai, transcript, payload)
    canonical = json.dumps(key, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _parse_data_url(data_url: str) -> tuple[Optional[str], Optional[bytes]]:
    s = str(data_url or "").strip()
    m = re.match(r"^data:([a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+);base64,(.+)$", s, flags=re.DOTALL)
    if not m:
        return None, None
    mime = m.group(1).lower()
    b64 = m.group(2)
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        return None, None
    return mime, raw


def persist_extension_images(
    images: list[dict[str, Any]],
    *,
    session_id: Optional[str],
    record_type: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not images:
        return out
    img_dir = DATA_DIR / "extension_images"
    img_dir.mkdir(exist_ok=True)
    sid = (session_id or "nosession").replace("/", "_")[:40]
    for idx, image in enumerate(images[:6], start=1):
        if not isinstance(image, dict):
            continue
        mime, raw = _parse_data_url(str(image.get("data_url") or ""))
        if not mime or raw is None:
            continue
        if len(raw) > 5 * 1024 * 1024:
            continue
        sha = hashlib.sha256(raw).hexdigest()
        ext = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
        }.get(mime, "bin")
        name = f"{record_type}_{sid}_{idx}_{sha[:12]}.{ext}"
        path = img_dir / name
        if not path.exists():
            with path.open("wb") as f:
                f.write(raw)
        out.append({
            "sha256": sha,
            "mime_type": mime,
            "bytes": len(raw),
            "path": str(path),
            "alt": _norm_text(image.get("alt"), 200),
            "source_url": _norm_text(image.get("source_url"), 300),
        })
    return out


async def analyze_images_for_failures(
    *,
    transcript: str,
    source_ai: Optional[str],
    user_note: Optional[str],
    images: list[dict[str, Any]],
) -> dict[str, Any]:
    if not images:
        return {"summary": "", "reasons": [], "severity": 1, "confidence": 0.0}
    if active_llm_provider() != "anthropic_foundry":
        return {
            "summary": "Image evidence provided but vision analysis is unavailable for current backend provider.",
            "reasons": ["Switch to Anthropic Foundry deployment to enable vision/OCR analysis in this endpoint."],
            "severity": 2,
            "confidence": 0.2,
        }

    blocks: list[dict[str, Any]] = [{
        "type": "text",
        "text": (
            f"SOURCE_AI: {source_ai or 'Unknown'}\n\n"
            f"USER_NOTE:\n{(user_note or '(none)')[:3000]}\n\n"
            f"TRANSCRIPT:\n{transcript[:30000]}\n\n"
            "Analyze the attached images and return the JSON now."
        ),
    }]
    for image in images[:4]:
        if not isinstance(image, dict):
            continue
        mime, raw = _parse_data_url(str(image.get("data_url") or ""))
        if not mime or raw is None:
            continue
        if len(raw) > 5 * 1024 * 1024:
            continue
        blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime,
                "data": base64.b64encode(raw).decode("utf-8"),
            },
        })

    if len(blocks) <= 1:
        return {"summary": "", "reasons": [], "severity": 1, "confidence": 0.0}

    resp = await get_client().messages.create(
        model=DETECT_MODEL,
        max_tokens=900,
        system=IMAGE_FAILURE_SYSTEM,
        messages=[{"role": "user", "content": blocks}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "").strip()
    if text.startswith("```"):
        text = text.strip("`").replace("json", "", 1).strip()
    start = text.find("{")
    end = text.rfind("}")
    payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)
    reasons = _norm_list(payload.get("reasons"), 160)[:4]
    return {
        "summary": _norm_text(payload.get("summary"), 260),
        "reasons": reasons,
        "severity": max(1, min(5, int(payload.get("severity") or 2))),
        "confidence": max(0.0, min(1.0, float(payload.get("confidence") or 0.0))),
    }


async def _load_extension_seen_fingerprints_locked() -> None:
    global _extension_seen_loaded
    if _extension_seen_loaded:
        return
    _extension_seen_fingerprints.clear()
    if EXTENSION_RECORDS_FILE.exists():
        with EXTENSION_RECORDS_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s:
                    continue
                try:
                    rec = json.loads(s)
                except Exception:
                    continue
                fp = str(rec.get("input_fingerprint") or "").strip()
                if fp:
                    _extension_seen_fingerprints.add(fp)
                    continue
                rtype = str(rec.get("record_type") or "").strip()
                if not rtype:
                    continue
                fp = extension_input_fingerprint(
                    record_type=rtype,
                    source_ai=rec.get("source_ai"),
                    transcript=rec.get("transcript"),
                    payload=rec.get("payload") if isinstance(rec.get("payload"), dict) else {},
                )
                _extension_seen_fingerprints.add(fp)
    _extension_seen_loaded = True


class Turn(BaseModel):
    role: str
    # str (plain text) OR list of Anthropic content blocks (text + image for multimodal)
    content: Union[str, list[dict[str, Any]]]


class ChatRequest(BaseModel):
    messages: list[Turn]
    session_id: Optional[str] = None


class VerifyRequest(BaseModel):
    conversation: str
    claimed_error: str
    correct_answer: str
    session_id: Optional[str] = None


class SuggestRequest(BaseModel):
    conversation: str
    target_message: str
    session_id: Optional[str] = None


class DetectLLMRequest(BaseModel):
    conversation: str
    session_id: Optional[str] = None


class SegmentTranscriptRequest(BaseModel):
    transcript: str
    source_ai: Optional[str] = None
    session_id: Optional[str] = None


class DissatisfactionExtractRequest(BaseModel):
    transcript: str
    source_ai: Optional[str] = None
    user_note: Optional[str] = None
    images: list[dict[str, Any]] = Field(default_factory=list)
    session_id: Optional[str] = None


class SubmitExtensionClaimRequest(BaseModel):
    source_ai: Optional[str] = None
    transcript: str
    summary: str
    reasons: list[str] = Field(default_factory=list)
    severity: int = 2
    offered_cashback: Optional[int] = None
    auto_detected: bool = False
    user_note: Optional[str] = None
    session_id: Optional[str] = None


class RedactForShareRequest(BaseModel):
    transcript: str
    user_note: Optional[str] = None
    source_ai: Optional[str] = None
    session_id: Optional[str] = None


class AutoFailureSignalRequest(BaseModel):
    transcript: str
    source_ai: Optional[str] = None
    session_id: Optional[str] = None


class ImageEvidenceRequest(BaseModel):
    transcript: Optional[str] = None
    source_ai: Optional[str] = None
    user_note: Optional[str] = None
    images: list[dict[str, Any]] = Field(default_factory=list)
    session_id: Optional[str] = None


class EventIn(BaseModel):
    """Client-emitted interaction event. Fully open payload to keep the schema flexible."""
    event_type: str
    page: Optional[str] = None
    session_id: Optional[str] = None
    timestamp: Optional[str] = None  # client-side wall clock; server still stamps its own
    payload: dict[str, Any] = Field(default_factory=dict)


async def rate_answer(question: str, answer: str) -> dict:
    """Score an answer 0-10 for factual risk via Haiku 4.5. Best-effort; falls back to mid."""
    try:
        text = await llm_create_text(
            model=RATER_MODEL,
            max_tokens=200,
            system=RATER_SYSTEM,
            messages=[{
                "role": "user",
                "content": f"QUESTION:\n{question}\n\nANSWER:\n{answer}\n\nReturn the JSON now.",
            }],
        )
        # Tolerate stray prose around the JSON: find the first {...} block.
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(text[start : end + 1])
            score = float(data.get("score", 5))
            reason = str(data.get("reason", "")).strip()[:140]
            return {"score": max(0.0, min(10.0, score)), "reason": reason}
    except Exception as e:
        print(f"[hug] rate error: {type(e).__name__}: {e}", flush=True)
    return {"score": 5.0, "reason": "rating unavailable."}


def _last_user(messages: list[dict]) -> str:
    """Pull the latest user turn as plain text — handles both string and content-block forms."""
    for m in reversed(messages):
        if m["role"] != "user":
            continue
        c = m["content"]
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            parts = [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
            has_image = any(isinstance(b, dict) and b.get("type") == "image" for b in c)
            text = " ".join(p for p in parts if p).strip()
            if has_image and not text:
                return "(image attached, no text)"
            if has_image:
                return f"{text} (with attached image)"
            return text
    return ""


@app.post("/chat")
async def chat(req: ChatRequest, request: Request):
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    api_messages = [{"role": t.role, "content": t.content} for t in req.messages]
    question = _last_user(api_messages)

    # Log the incoming request immediately so we capture the user's prompt even
    # if the stream errors mid-flight.
    await log_event(
        "chat_request",
        page="chat.html",
        session_id=req.session_id,
        payload={
            "messages": api_messages,
            "last_user_text": question,
            "model": MODEL,
        },
        request=request,
    )

    async def event_stream():
        answer_text = ""
        usage: dict[str, Any] = {}
        rating: Optional[dict] = None
        error: Optional[str] = None
        try:
            if active_llm_provider() == "anthropic_foundry":
                async with get_client().messages.stream(
                    model=MODEL,
                    max_tokens=1024,
                    system=[
                        {
                            "type": "text",
                            "text": SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        }
                    ],
                    messages=api_messages,
                ) as stream:
                    async for chunk in stream.text_stream:
                        answer_text += chunk
                        yield f"data: {json.dumps({'text': chunk})}\n\n"

                    final = await stream.get_final_message()
                    usage = {
                        "input": final.usage.input_tokens,
                        "output": final.usage.output_tokens,
                        "cache_read": final.usage.cache_read_input_tokens,
                        "cache_write": final.usage.cache_creation_input_tokens,
                    }
                    print(f"[hug] model={MODEL} usage={usage}", flush=True)
            else:
                answer_text = await llm_create_text(
                    model=MODEL,
                    max_tokens=1024,
                    system=SYSTEM_PROMPT,
                    messages=api_messages,
                )
                yield f"data: {json.dumps({'text': answer_text})}\n\n"
                usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}

            # Second-pass rating with Haiku 4.5
            rating = await rate_answer(question, answer_text)
            print(f"[hug] rating={rating}", flush=True)
            yield f"data: {json.dumps({'score': rating['score'], 'reason': rating['reason']})}\n\n"

            yield f"data: {json.dumps({'done': True, 'usage': usage})}\n\n"

        except anthropic.AuthenticationError:
            error = "invalid Foundry API key"
            yield f"data: {json.dumps({'error': error})}\n\n"
        except anthropic.RateLimitError as e:
            error = f"rate limited: {e}"
            yield f"data: {json.dumps({'error': error})}\n\n"
        except anthropic.APIStatusError as e:
            error = f"API {e.status_code}: {getattr(e, 'message', str(e))}"
            yield f"data: {json.dumps({'error': error})}\n\n"
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
            yield f"data: {json.dumps({'error': error})}\n\n"
        finally:
            # Always log the response (success or failure) so the dataset stays paired
            # with chat_request records.
            await log_event(
                "chat_response",
                page="chat.html",
                session_id=req.session_id,
                payload={
                    "answer": answer_text,
                    "rating": rating,
                    "usage": usage,
                    "model": MODEL,
                    "error": error,
                },
                request=request,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/verify_claim")
async def verify_claim(req: VerifyRequest, request: Request):
    """LLM-as-grader: judges whether the user's claim has merit."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    user_content = (
        f"CONVERSATION:\n{req.conversation}\n\n"
        f"CLAIMED ERROR:\n{req.claimed_error}\n\n"
        f"PROPOSED CORRECTION:\n{req.correct_answer}\n\n"
        "Return your JSON verdict now."
    )

    fallback = {"verdict": "uncertain", "confidence": 0.0, "reasoning": "verifier produced no parseable verdict."}
    result: dict = fallback
    error: Optional[str] = None
    try:
        text = await llm_create_text(
            model=VERIFIER_MODEL,
            max_tokens=400,
            system=VERIFIER_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(text[start : end + 1])
            verdict = data.get("verdict", "uncertain")
            if verdict not in ("valid", "invalid", "uncertain"):
                verdict = "uncertain"
            confidence = float(data.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))
            reasoning = str(data.get("reasoning", "")).strip()[:600] or "no reasoning provided."
            result = {"verdict": verdict, "confidence": confidence, "reasoning": reasoning}
            print(f"[hug] verify {result}", flush=True)
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"verifier API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] verify error: {error}", flush=True)

    await log_event(
        "verdict_returned",
        page="claim.html",
        session_id=req.session_id,
        payload={
            "conversation": req.conversation,
            "claimed_error": req.claimed_error,
            "correct_answer": req.correct_answer,
            "verdict":    result["verdict"],
            "confidence": result["confidence"],
            "reasoning":  result["reasoning"],
            "model":      VERIFIER_MODEL,
            "error":      error,
        },
        request=request,
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("verifier API error"):
        raise HTTPException(502, error)
    return result


@app.post("/suggest_edit")
async def suggest_edit(req: SuggestRequest, request: Request):
    """Haiku 4.5 suggests a corrected version of one assistant message."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    user_content = (
        f"CONVERSATION:\n{req.conversation}\n\n"
        f"TARGET REPLY TO REVIEW AND CORRECT:\n{req.target_message}\n\n"
        "Output only the corrected reply text now."
    )

    suggested = req.target_message
    error: Optional[str] = None
    try:
        text = await llm_create_text(
            model=SUGGEST_MODEL,
            max_tokens=600,
            system=SUGGEST_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )
        # Strip surrounding quotes the model might add despite instructions
        if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
            text = text[1:-1].strip()
        print(f"[hug] suggest produced {len(text)} chars", flush=True)
        suggested = text or req.target_message
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"suggest API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] suggest error: {error}", flush=True)

    await log_event(
        "suggest_returned",
        page="claim.html",
        session_id=req.session_id,
        payload={
            "conversation":   req.conversation,
            "target_message": req.target_message,
            "suggested":      suggested,
            "model":          SUGGEST_MODEL,
            "error":          error,
        },
        request=request,
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("suggest API error"):
        raise HTTPException(502, error)
    return {"suggested": suggested}


@app.post("/detect_llm")
async def detect_llm(req: DetectLLMRequest, request: Request):
    """Best-effort guess of which AI produced the response being claimed."""
    if not has_llm_credentials():
      raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    clipped = req.conversation[:12000]
    result = {"llm": "Other/Unknown", "confidence": 0.0, "reason": "no clear model label found"}
    error: Optional[str] = None
    try:
        text = await llm_create_text(
            model=DETECT_MODEL,
            max_tokens=160,
            system=DETECT_SYSTEM,
            messages=[{
                "role": "user",
                "content": f"CLAIM TRANSCRIPT:\n{clipped}\n\nIdentify the AI assistant label.",
            }],
        )
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()
        parsed = json.loads(text)
        label = str(parsed.get("llm") or "Other/Unknown").strip()
        confidence = float(parsed.get("confidence") or 0)
        reason = str(parsed.get("reason") or "").strip()[:180]
        result = {
            "llm": label or "Other/Unknown",
            "confidence": max(0.0, min(1.0, confidence)),
            "reason": reason or "detected from transcript",
        }
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"detect API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] detect llm error: {error}", flush=True)

    await log_event(
        "llm_detected",
        page="claim.html",
        session_id=req.session_id,
        payload={
            "conversation_length": len(req.conversation or ""),
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
        request=request,
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("detect API error"):
        raise HTTPException(502, error)
    return result


@app.post("/segment_transcript")
async def segment_transcript(req: SegmentTranscriptRequest, request: Request):
    """Best-effort LLM segmentation for messy pasted transcripts."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    raw = (req.transcript or "").strip()
    if not raw:
        return {"format": "Generic chat", "turns": []}

    clipped = raw[:50000]
    result: dict[str, Any] = {
        "format": "LLM segmented",
        "turns": [{"role": "user", "text": clipped, "marker": ""}],
    }
    error: Optional[str] = None

    user_prompt = (
        f"SOURCE_AI_HINT: {req.source_ai or 'Unknown'}\n\n"
        f"TRANSCRIPT:\n{clipped}\n\n"
        "Return the JSON now."
    )
    try:
        text = await llm_create_text(
            model=SEGMENT_MODEL,
            max_tokens=2400,
            system=SEGMENT_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()
        start = text.find("{")
        end = text.rfind("}")
        payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)

        turns_in = payload.get("turns") if isinstance(payload, dict) else None
        turns_out: list[dict[str, str]] = []
        if isinstance(turns_in, list):
            for t in turns_in:
                if not isinstance(t, dict):
                    continue
                role = str(t.get("role") or "").strip().lower()
                role = "user" if role == "user" else "assistant"
                txt = str(t.get("text") or "").strip()
                if not txt:
                    continue
                marker = str(t.get("marker") or "").strip()[:120]
                turns_out.append({"role": role, "text": txt, "marker": marker})

        fmt = str((payload.get("format") if isinstance(payload, dict) else "") or "").strip()[:40]
        if turns_out:
            result = {
                "format": fmt or "LLM segmented",
                "turns": turns_out,
            }
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"segment API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] segment transcript error: {error}", flush=True)

    await log_event(
        "transcript_segmented",
        page="chat.html",
        session_id=req.session_id,
        payload={
            "transcript_length": len(raw),
            "turn_count": len(result.get("turns") or []),
            "format": result.get("format"),
            "model": SEGMENT_MODEL,
            "error": error,
        },
        request=request,
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("segment API error"):
        raise HTTPException(502, error)
    return result


@app.post("/extract_dissatisfaction")
async def extract_dissatisfaction(req: DissatisfactionExtractRequest, request: Request):
    """Extract and summarize why the user is unhappy with an AI answer."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    transcript = (req.transcript or "").strip()
    if not transcript:
        raise HTTPException(400, "transcript is required")

    clipped = transcript[:50000]
    user_note = (req.user_note or "").strip()
    image_refs = persist_extension_images(
        req.images if isinstance(req.images, list) else [],
        session_id=req.session_id,
        record_type="extract",
    )
    result: dict[str, Any] = {
        "summary": "User is dissatisfied, but the issue needs manual clarification.",
        "reasons": ["Not enough detail to identify a concrete model error."],
        "severity": 2,
        "needs_human_review": True,
        "confidence": 0.2,
    }
    error: Optional[str] = None

    prompt = (
        f"SOURCE_AI: {req.source_ai or 'Unknown'}\n\n"
        f"USER_NOTE:\n{user_note or '(none)'}\n\n"
        f"TRANSCRIPT:\n{clipped}\n\n"
        "Return the JSON now."
    )
    try:
        text = await llm_create_text(
            model=DETECT_MODEL,
            max_tokens=500,
            system=DISSATISFACTION_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()
        start = text.find("{")
        end = text.rfind("}")
        payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)

        summary = str(payload.get("summary") or "").strip()[:260]
        reasons_in = payload.get("reasons")
        reasons: list[str] = []
        if isinstance(reasons_in, list):
            for item in reasons_in[:4]:
                reason = str(item).strip()[:150]
                if reason:
                    reasons.append(reason)
        severity = int(payload.get("severity") or 2)
        needs_review = bool(payload.get("needs_human_review"))
        confidence = float(payload.get("confidence") or 0.0)

        result = {
            "summary": summary or result["summary"],
            "reasons": reasons or result["reasons"],
            "severity": max(1, min(5, severity)),
            "needs_human_review": needs_review,
            "confidence": max(0.0, min(1.0, confidence)),
        }

        # Optional image-grounded failure analysis (vision path).
        if req.images:
            vision = await analyze_images_for_failures(
                transcript=clipped,
                source_ai=req.source_ai,
                user_note=user_note,
                images=req.images,
            )
            img_summary = str(vision.get("summary") or "").strip()
            img_reasons = vision.get("reasons") if isinstance(vision.get("reasons"), list) else []
            merged = []
            seen = set()
            for r in [*result.get("reasons", []), *img_reasons]:
                rs = _norm_text(r, 150)
                if rs and rs not in seen:
                    seen.add(rs)
                    merged.append(rs)
            if merged:
                result["reasons"] = merged[:4]
            if img_summary and not result.get("summary"):
                result["summary"] = img_summary
            if float(vision.get("confidence") or 0) > float(result.get("confidence") or 0):
                result["confidence"] = max(0.0, min(1.0, float(vision.get("confidence") or 0.0)))
            result["severity"] = max(
                int(result.get("severity") or 1),
                max(1, min(5, int(vision.get("severity") or 1))),
            )
            result["image_analysis"] = {
                "summary": img_summary,
                "reasons": img_reasons[:4],
                "confidence": max(0.0, min(1.0, float(vision.get("confidence") or 0.0))),
            }
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"extract API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] dissatisfaction extract error: {error}", flush=True)

    await log_event(
        "dissatisfaction_extracted",
        page="extension",
        session_id=req.session_id,
        payload={
            "source_ai": req.source_ai or "Unknown",
            "transcript_length": len(transcript),
            "has_user_note": bool(user_note),
            "image_count": len(req.images or []),
            "saved_images": [x.get("path") for x in image_refs],
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
        request=request,
    )
    await log_extension_record(
        "extract_dissatisfaction",
        session_id=req.session_id,
        source_ai=req.source_ai,
        transcript=transcript,
        payload={
            "user_note": user_note[:500],
            "image_hashes": [x.get("sha256") for x in image_refs],
            "saved_images": [x.get("path") for x in image_refs],
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("extract API error"):
        raise HTTPException(502, error)
    return result


@app.post("/submit_extension_claim")
async def submit_extension_claim(req: SubmitExtensionClaimRequest, request: Request):
    """Record a confirmed extension claim and return mock LLM-credit payout."""
    transcript = (req.transcript or "").strip()
    summary = (req.summary or "").strip()
    if not transcript:
        raise HTTPException(400, "transcript is required")
    if not summary:
        raise HTTPException(400, "summary is required")

    severity = max(1, min(5, int(req.severity)))
    reasons = [str(r).strip()[:150] for r in (req.reasons or []) if str(r).strip()][:4]
    source_ai = (req.source_ai or "Other/Unknown").strip()[:80]
    claim_id = f"HUGX-{_uuid.uuid4().hex[:8].upper()}"

    # Payout policy: severity-based predicted cashback on a fixed $2..$27 scale.
    base_amount = severity_to_cashback(severity)
    auto_offer_amount = severity_to_cashback(severity)
    if req.auto_detected:
        credit_amount = auto_offer_amount
    else:
        credit_amount = base_amount

    # If the client passes the displayed offer, keep payout synced to that
    # offer while enforcing server-side bounds.
    if req.offered_cashback is not None:
        offered = min(27, max(2, int(req.offered_cashback)))
        credit_amount = offered

    await log_event(
        "extension_claim_submitted",
        page="extension",
        session_id=req.session_id,
        payload={
            "claim_id": claim_id,
            "source_ai": source_ai,
            "summary": summary[:260],
            "reasons": reasons,
            "severity": severity,
            "auto_detected": bool(req.auto_detected),
            "offered_cashback": req.offered_cashback,
            "credit_amount": credit_amount,
            "transcript_length": len(transcript),
            "user_note": (req.user_note or "")[:500],
        },
        request=request,
    )
    await log_extension_record(
        "submit_extension_claim",
        session_id=req.session_id,
        source_ai=source_ai,
        transcript=transcript,
        payload={
            "claim_id": claim_id,
            "summary": summary[:260],
            "reasons": reasons,
            "severity": severity,
            "auto_detected": bool(req.auto_detected),
            "offered_cashback": req.offered_cashback,
            "credit_amount": credit_amount,
            "user_note": (req.user_note or "")[:500],
        },
    )

    return {
        "claim_id": claim_id,
        "status": "approved_mock",
        "credit_amount": credit_amount,
        "currency": "LLM_CREDITS",
        "message": "Claim confirmed and credits added (prototype payout).",
    }


@app.post("/redact_for_share")
async def redact_for_share(req: RedactForShareRequest, request: Request):
    """Redact user-identifiable info from transcript before sharing."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    transcript = (req.transcript or "").strip()
    if not transcript:
        raise HTTPException(400, "transcript is required")

    clipped = transcript[:50000]
    user_note = (req.user_note or "").strip()[:3000]
    result: dict[str, Any] = {
        "redacted_text": clipped,
        "redactions": [],
        "risk_level": "low",
        "confidence": 0.2,
    }
    error: Optional[str] = None

    prompt = (
        f"SOURCE_AI: {req.source_ai or 'Unknown'}\n\n"
        f"USER_NOTE:\n{user_note or '(none)'}\n\n"
        f"TRANSCRIPT:\n{clipped}\n\n"
        "Return the JSON now."
    )
    try:
        text = await llm_create_text(
            model=DETECT_MODEL,
            max_tokens=2200,
            system=PII_REDACT_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()
        start = text.find("{")
        end = text.rfind("}")
        payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)

        redacted_text = str(payload.get("redacted_text") or "").strip()
        if not redacted_text:
            redacted_text = clipped

        level = str(payload.get("risk_level") or "low").strip().lower()
        if level not in ("low", "medium", "high"):
            level = "medium"

        conf = float(payload.get("confidence") or 0.0)
        conf = max(0.0, min(1.0, conf))

        redactions_in = payload.get("redactions")
        redactions: list[dict[str, str]] = []
        if isinstance(redactions_in, list):
            seen: set[tuple[str, str]] = set()
            for item in redactions_in[:80]:
                if not isinstance(item, dict):
                    continue
                original = str(item.get("original") or "").strip()[:140]
                replacement = str(item.get("replacement") or "").strip()[:40]
                kind = str(item.get("type") or "OTHER").strip().upper()[:20]
                if not original:
                    continue
                if not replacement.startswith("[REDACTED:"):
                    replacement = f"[REDACTED:{kind or 'OTHER'}]"
                key = (original, replacement)
                if key in seen:
                    continue
                seen.add(key)
                redactions.append({"original": original, "replacement": replacement, "type": kind or "OTHER"})

        result = {
            "redacted_text": redacted_text,
            "redactions": redactions,
            "risk_level": level,
            "confidence": conf,
        }
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"redact API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] redact_for_share error: {error}", flush=True)

    await log_event(
        "share_redaction_generated",
        page="extension",
        session_id=req.session_id,
        payload={
            "source_ai": req.source_ai or "Unknown",
            "transcript_length": len(transcript),
            "redaction_count": len(result.get("redactions") or []),
            "risk_level": result.get("risk_level"),
            "confidence": result.get("confidence"),
            "model": DETECT_MODEL,
            "error": error,
        },
        request=request,
    )
    await log_extension_record(
        "redact_for_share",
        session_id=req.session_id,
        source_ai=req.source_ai,
        transcript=transcript,
        payload={
            "user_note": user_note[:500],
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("redact API error"):
        raise HTTPException(502, error)
    return result


@app.post("/detect_failure_signal")
async def detect_failure_signal(req: AutoFailureSignalRequest, request: Request):
    """Predict whether to surface an auto claim signal and estimate payout difficulty."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")

    transcript = (req.transcript or "").strip()
    if not transcript:
        raise HTTPException(400, "transcript is required")

    clipped = transcript[:50000]
    result: dict[str, Any] = {
        "detected": False,
        "summary": "No clear high-confidence model failure detected.",
        "reasons": [],
        "difficulty": 1,
        "confidence": 0.2,
        "cashback_offer": 2,
        "currency": "LLM_CREDITS",
    }
    error: Optional[str] = None

    prompt = (
        f"SOURCE_AI: {req.source_ai or 'Unknown'}\n\n"
        f"TRANSCRIPT:\n{clipped}\n\n"
        "Return the JSON now."
    )
    try:
        text = await llm_create_text(
            model=DETECT_MODEL,
            max_tokens=600,
            system=AUTO_SIGNAL_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        if text.startswith("```"):
            text = text.strip("`").replace("json", "", 1).strip()
        start = text.find("{")
        end = text.rfind("}")
        payload = json.loads(text[start : end + 1] if start >= 0 and end > start else text)

        detected = bool(payload.get("detected"))
        summary = str(payload.get("summary") or "").strip()[:260]
        difficulty = max(1, min(5, int(payload.get("difficulty") or 1)))
        confidence = max(0.0, min(1.0, float(payload.get("confidence") or 0.0)))
        reasons_raw = payload.get("reasons")
        reasons: list[str] = []
        if isinstance(reasons_raw, list):
            for r in reasons_raw[:4]:
                rs = str(r).strip()[:160]
                if rs:
                    reasons.append(rs)

        cashback = severity_to_cashback(difficulty) if detected else 2
        result = {
            "detected": detected,
            "summary": summary or result["summary"],
            "reasons": reasons,
            "difficulty": difficulty,
            "confidence": confidence,
            "cashback_offer": cashback,
            "currency": "LLM_CREDITS",
        }
    except anthropic.AuthenticationError:
        error = "invalid Foundry API key"
    except anthropic.APIStatusError as e:
        error = f"auto-signal API error {e.status_code}"
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        print(f"[hug] detect_failure_signal error: {error}", flush=True)

    await log_event(
        "auto_failure_signal_predicted",
        page="extension",
        session_id=req.session_id,
        payload={
            "source_ai": req.source_ai or "Unknown",
            "transcript_length": len(transcript),
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
        request=request,
    )
    await log_extension_record(
        "detect_failure_signal",
        session_id=req.session_id,
        source_ai=req.source_ai,
        transcript=transcript,
        payload={
            "result": result,
            "model": DETECT_MODEL,
            "error": error,
        },
    )

    if error == "invalid Foundry API key":
        raise HTTPException(401, error)
    if error and error.startswith("auto-signal API error"):
        raise HTTPException(502, error)
    return result


@app.post("/analyze_image_evidence")
async def analyze_image_evidence(req: ImageEvidenceRequest, request: Request):
    """Optional vision endpoint: analyze uploaded screenshot evidence for likely AI failures."""
    if not has_llm_credentials():
        raise HTTPException(500, "No LLM credentials set. Configure ANTHROPIC_API_KEY or Azure OpenAI env vars.")
    images = req.images if isinstance(req.images, list) else []
    if not images:
        raise HTTPException(400, "images are required")

    transcript = (req.transcript or "").strip()[:50000]
    user_note = (req.user_note or "").strip()[:3000]
    image_refs = persist_extension_images(
        images,
        session_id=req.session_id,
        record_type="image_evidence",
    )
    result = await analyze_images_for_failures(
        transcript=transcript,
        source_ai=req.source_ai,
        user_note=user_note,
        images=images,
    )
    await log_event(
        "image_evidence_analyzed",
        page="extension",
        session_id=req.session_id,
        payload={
            "source_ai": req.source_ai or "Unknown",
            "image_count": len(images),
            "saved_images": [x.get("path") for x in image_refs],
            "result": result,
            "model": DETECT_MODEL,
            "provider": active_llm_provider(),
        },
        request=request,
    )
    return {
        "image_count": len(images),
        "saved_images": image_refs,
        "provider": active_llm_provider(),
        **result,
    }


# ---------- Client-emitted events + dataset export ---------------------------

@app.post("/event")
async def event(evt: EventIn, request: Request):
    """Client-side interactions land here (page_view, edit_committed, vote_cast, etc.)."""
    rec = await log_event(
        evt.event_type,
        page=evt.page,
        session_id=evt.session_id,
        payload=evt.payload,
        request=request,
        client_timestamp=evt.timestamp,
    )
    return {"ok": True, "event_id": rec["event_id"]}


@app.get("/api/azure_models")
async def api_azure_models(limit: int = 36, refresh: bool = False):
    """Return model/provider/logo rows inferred from Azure AI catalog page."""
    now = datetime.now(timezone.utc).timestamp()
    async with _azure_models_cache_lock:
        if (
            not refresh
            and _azure_models_cache.get("payload") is not None
            and float(_azure_models_cache.get("expires_at") or 0) > now
        ):
            cached = dict(_azure_models_cache["payload"])
            cached["cached"] = True
            return cached

        try:
            payload = await asyncio.to_thread(_fetch_azure_models, limit)
            _azure_models_cache["payload"] = payload
            _azure_models_cache["expires_at"] = now + AZURE_MODELS_CACHE_TTL_SECONDS
            out = dict(payload)
            out["cached"] = False
            return out
        except Exception as e:
            print(f"[hug] azure models fetch error: {type(e).__name__}: {e}", flush=True)
            cached_payload = _azure_models_cache.get("payload")
            if cached_payload is not None:
                out = dict(cached_payload)
                out["cached"] = True
                out["stale"] = True
                return out
            # No cache yet: return empty list and let frontend fallback list render.
            return {
                "source_url": AZURE_MODEL_CATALOG_URL,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "count": 0,
                "models": [],
                "cached": False,
                "stale": True,
                "error": "azure catalog unavailable",
            }


@app.get("/export")
async def export(token: Optional[str] = None):
    """Download the entire JSONL dataset.

    Set HUG_EXPORT_TOKEN in the environment to gate access. If unset, /export
    is open (intended for local-only dev).
    """
    expected = os.environ.get("HUG_EXPORT_TOKEN")
    if expected and token != expected:
        raise HTTPException(403, "missing or invalid token")
    if not EVENTS_FILE.exists():
        return Response(content="", media_type="application/x-ndjson")
    return FileResponse(
        EVENTS_FILE,
        media_type="application/x-ndjson",
        filename="events.jsonl",
    )


@app.get("/events_count")
async def events_count():
    """Quick health check — how many events have we captured?"""
    if not EVENTS_FILE.exists():
        return {"count": 0, "bytes": 0, "path": str(EVENTS_FILE)}
    n = 0
    with EVENTS_FILE.open("rb") as f:
        for _ in f:
            n += 1
    return {"count": n, "bytes": EVENTS_FILE.stat().st_size, "path": str(EVENTS_FILE)}


@app.get("/export_extension")
async def export_extension(token: Optional[str] = None):
    """Download extension-only JSONL records.

    Uses the same optional HUG_EXPORT_TOKEN gate as /export.
    """
    expected = os.environ.get("HUG_EXPORT_TOKEN")
    if expected and token != expected:
        raise HTTPException(403, "missing or invalid token")
    if not EXTENSION_RECORDS_FILE.exists():
        return Response(content="", media_type="application/x-ndjson")
    return FileResponse(
        EXTENSION_RECORDS_FILE,
        media_type="application/x-ndjson",
        filename="extension_records.jsonl",
    )


@app.get("/extension_records_count")
async def extension_records_count():
    """Quick check for extension-only dataset size."""
    if not EXTENSION_RECORDS_FILE.exists():
        return {"count": 0, "bytes": 0, "path": str(EXTENSION_RECORDS_FILE)}
    n = 0
    with EXTENSION_RECORDS_FILE.open("rb") as f:
        for _ in f:
            n += 1
    return {"count": n, "bytes": EXTENSION_RECORDS_FILE.stat().st_size, "path": str(EXTENSION_RECORDS_FILE)}


@app.post("/dedupe_extension_records")
async def dedupe_extension_records(token: Optional[str] = None):
    """Rewrite extension_records.jsonl keeping one row per input fingerprint.

    Keeps first occurrence, removes exact input duplicates.
    Same transcript with different failure datapoints is preserved by fingerprint design.
    """
    expected = os.environ.get("HUG_EXPORT_TOKEN")
    if expected and token != expected:
        raise HTTPException(403, "missing or invalid token")

    async with _extension_records_lock:
        if not EXTENSION_RECORDS_FILE.exists():
            return {"ok": True, "before": 0, "after": 0, "removed": 0, "path": str(EXTENSION_RECORDS_FILE)}

        before = 0
        after = 0
        seen: set[str] = set()
        kept_lines: list[str] = []
        with EXTENSION_RECORDS_FILE.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                before += 1
                try:
                    rec = json.loads(line)
                except Exception:
                    # Keep malformed lines to avoid silent data loss.
                    kept_lines.append(raw if raw.endswith("\n") else raw + "\n")
                    after += 1
                    continue

                rtype = str(rec.get("record_type") or "").strip()
                payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
                fp = str(rec.get("input_fingerprint") or "").strip()
                if not fp and rtype:
                    fp = extension_input_fingerprint(
                        record_type=rtype,
                        source_ai=rec.get("source_ai"),
                        transcript=rec.get("transcript"),
                        payload=payload,
                    )
                    rec["input_fingerprint"] = fp

                if fp and fp in seen:
                    continue
                if fp:
                    seen.add(fp)
                kept_lines.append(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
                after += 1

        backup_path = EXTENSION_RECORDS_FILE.with_suffix(".jsonl.bak")
        EXTENSION_RECORDS_FILE.replace(backup_path)
        with EXTENSION_RECORDS_FILE.open("w", encoding="utf-8") as f:
            f.writelines(kept_lines)

        global _extension_seen_loaded
        _extension_seen_loaded = False
        await _load_extension_seen_fingerprints_locked()

    return {
        "ok": True,
        "before": before,
        "after": after,
        "removed": before - after,
        "path": str(EXTENSION_RECORDS_FILE),
        "backup_path": str(backup_path),
    }


# Serve every static file in the project dir (HTML pages, data assets, etc.).
# Mounted last so the POST /chat route above takes priority over GET /chat.
app.mount("/", StaticFiles(directory=str(HERE), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    print(f"\nhug.  model={MODEL}  endpoint={ENDPOINT}")
    print("→ http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
