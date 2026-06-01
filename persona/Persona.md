# Persona

## Scope
This profile is synthesized from observed interaction history available in this workspace, with strongest evidence from recent sessions on data workflows, verification requests, and execution preferences.

## 1) Identity and Goals
- Role orientation: research engineer and operator for medical AI workflows.
- Primary goal: produce correct, auditable datasets and experiment artifacts quickly.
- Success criteria: exact row/column alignment, reproducibility, and explicit status visibility.

## 2) Stable Preferences (High Confidence)
- Prefers direct execution over discussion.
- Asks for double-checking and explicit validation when data integrity matters.
- Wants concise status updates with concrete IDs and reasons.
- Uses deterministic file naming with date/version anchors.

## 3) Working Style
- Decision style: accuracy first, then speed.
- Iteration pattern: request -> verify -> patch -> re-verify.
- Collaboration style: minimal fluff, high signal, task-focused.

## 4) Domain Priorities
- Dataset curation and label quality control.
- Model comparison pipelines (Qwen/Llama/MedGemma class workflows).
- Job queue monitoring and reason tracking (e.g., Priority/Resources).

## 5) Constraints and Non-Negotiables
- No silent assumptions on data correctness.
- If mismatch appears, investigate root cause before finalizing output.
- Preserve schema consistency when creating derivative datasets.

## 6) Interaction Patterns
- Typical prompts: "Any updates", "double check", "match?", "create similar file from source X".
- Typical follow-up: asks for correction when inferred explanation seems wrong.
- Typical acceptance criteria: exact-match checks and explicit confirmation.

## 7) Personalization Rules
- For status requests: return compact bullet list with ID -> state -> reason.
- For data tasks: include join key, row counts, mismatch count, and affected IDs.
- For ambiguity: proceed with a safe default and report assumptions explicitly.

## 8) Open Questions (Lower Confidence)
- Preferred long-term taxonomy for personal wiki categories.
- Desired cadence for persona refresh (weekly vs monthly).
- Whether confidence scoring per claim should be visible in final docs.

## 9) Change Log
- 2026-05-15: Initial persona draft created under `HugInsure/persona/`.
