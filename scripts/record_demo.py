#!/usr/bin/env python3
"""Record a HugClaims product demo with Playwright.

The script records a deterministic browser walkthrough:
  1. homepage correction hover
  2. chat prompt + streamed answer + bounty panel
  3. claim page edit/diff
  4. verifier result and final claim screen

Playwright records WebM. If ffmpeg is available, the script also writes MP4 and
GIF versions next to the WebM.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError:
    print(
        "Missing dependency: playwright\n"
        "Install with: pip install playwright && python -m playwright install chromium",
        file=sys.stderr,
    )
    raise


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "http://127.0.0.1:8000"
RECORDING_ZOOM_ENABLED = False
DEFAULT_PROMPT = (
    "Audit this proof. Claim: every pointwise convergent sequence of continuous "
    "functions on [0,1] converges uniformly. Proof: for each x choose N_x for "
    "epsilon/3; by continuity this works in a neighborhood of x; compactness "
    "gives a finite subcover, so take the maximum N_x. Is the proof valid?"
)
FOLLOWUP_PROMPT = (
    "Now test it on f_n(x)=x^n on [0,1]. Keep the answer tight and name the "
    "exact hidden quantifier mistake."
)
CLAIM_EDIT_INSERT = (
    "Correction: this step quietly swaps pointwise control for uniform local control."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Record a HugClaims demo video.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Local or hosted HugClaims base URL.")
    parser.add_argument("--out-dir", default=str(ROOT / "recordings"), help="Directory for output videos.")
    parser.add_argument("--name", default=f"hugclaims-demo-{time.strftime('%Y%m%d-%H%M%S')}")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt to type into the chat.")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--mp4", action="store_true", help="Also write an MP4 after recording the WebM.")
    parser.add_argument("--gif", action="store_true", help="Also write a GIF after recording the WebM.")
    parser.add_argument("--zoom", action="store_true", help="Use camera zooms around typing and edits.")
    parser.add_argument("--mp4-width", type=int, default=1600, help="Rendered MP4 width after ffmpeg conversion.")
    parser.add_argument("--gif-width", type=int, default=1280, help="Rendered GIF width after ffmpeg conversion.")
    parser.add_argument("--slow-mo", type=int, default=35, help="Playwright slow motion in ms.")
    parser.add_argument("--keep-open", action="store_true", help="Leave the browser open at the end.")
    parser.add_argument("--no-gif", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def wait(page: Page, ms: int) -> None:
    page.wait_for_timeout(ms)


def click_when_ready(page: Page, selector: str, timeout: int = 15000) -> None:
    loc = page.locator(selector)
    loc.wait_for(state="visible", timeout=timeout)
    loc.click()


def convert_with_ffmpeg(webm: Path, mp4: Path | None, gif: Path | None, mp4_width: int, gif_width: int) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print(f"Full ffmpeg not found; kept WebM only: {webm}")
        return

    if mp4 is not None:
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(webm),
                    "-movflags",
                    "+faststart",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "24",
                    "-pix_fmt",
                    "yuv420p",
                    "-vf",
                    f"scale={mp4_width}:-2",
                    str(mp4),
                ],
                check=True,
            )
            print(f"Wrote MP4: {mp4}")
        except subprocess.CalledProcessError as exc:
            print(f"MP4 conversion failed; kept WebM output: {exc}", file=sys.stderr)

    if gif is None:
        return

    try:
        palette = gif.with_suffix(".palette.png")
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(webm),
                "-vf",
                f"fps=12,scale={gif_width}:-1:flags=lanczos,palettegen",
                str(palette),
            ],
            check=True,
        )
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(webm),
                "-i",
                str(palette),
                "-lavfi",
                f"fps=12,scale={gif_width}:-1:flags=lanczos[x];[x][1:v]paletteuse",
                str(gif),
            ],
            check=True,
        )
        palette.unlink(missing_ok=True)
        print(f"Wrote GIF: {gif}")
    except subprocess.CalledProcessError as exc:
        print(f"GIF conversion failed; kept WebM/MP4 outputs: {exc}", file=sys.stderr)


def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def install_recording_camera(page: Page) -> None:
    page.add_style_tag(
        content="""
        html.hug-recording-camera {
          overflow: hidden;
          background: var(--paper, #f1edf6);
        }
        html.hug-recording-camera body {
          transform-origin: var(--hug-camera-x, 50vw) var(--hug-camera-y, 50vh);
          transform: scale(var(--hug-camera-scale, 1));
          transition: transform 520ms cubic-bezier(.2, .8, .2, 1);
          will-change: transform;
        }
        """
    )
    page.evaluate(
        """
        () => {
          document.documentElement.classList.add('hug-recording-camera');
          document.documentElement.style.setProperty('--hug-camera-scale', '1');
        }
        """
    )


def focus_camera(page: Page, selector: str, scale: float = 1.35, timeout: int = 15000) -> None:
    loc = page.locator(selector).first
    loc.wait_for(state="visible", timeout=timeout)
    loc.scroll_into_view_if_needed()
    wait(page, 180)
    if not RECORDING_ZOOM_ENABLED:
        return
    loc.evaluate(
        """(el, scale) => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2 + window.scrollX;
          const y = rect.top + rect.height / 2 + window.scrollY;
          document.documentElement.style.setProperty('--hug-camera-x', `${x}px`);
          document.documentElement.style.setProperty('--hug-camera-y', `${y}px`);
          document.documentElement.style.setProperty('--hug-camera-scale', String(scale));
        }""",
        scale,
    )
    wait(page, 580)


def focus_element_camera(page: Page, selector: str, index: int, scale: float = 1.35, timeout: int = 15000) -> None:
    matches = page.locator(selector)
    count = matches.count()
    if count == 0:
        matches.first.wait_for(state="visible", timeout=timeout)
    loc = matches.nth(index if index >= 0 else count + index)
    loc.wait_for(state="visible", timeout=timeout)
    loc.scroll_into_view_if_needed()
    wait(page, 180)
    if not RECORDING_ZOOM_ENABLED:
        return
    loc.evaluate(
        """(el, scale) => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2 + window.scrollX;
          const y = rect.top + rect.height / 2 + window.scrollY;
          document.documentElement.style.setProperty('--hug-camera-x', `${x}px`);
          document.documentElement.style.setProperty('--hug-camera-y', `${y}px`);
          document.documentElement.style.setProperty('--hug-camera-scale', String(scale));
        }""",
        scale,
    )
    wait(page, 580)


def reset_camera(page: Page) -> None:
    if not RECORDING_ZOOM_ENABLED:
        return
    page.evaluate("document.documentElement.style.setProperty('--hug-camera-scale', '1')")
    wait(page, 520)


def wait_for_chat_turn(page: Page) -> None:
    try:
        page.wait_for_function(
            """
            () => {
              const assistants = document.querySelectorAll('#convo .msg.assistant');
              const last = assistants[assistants.length - 1];
              if (!last) return false;
              return !last.innerHTML.includes('cursor') && last.textContent.trim().length > 35;
            }
            """,
            timeout=90000,
        )
    except PlaywrightTimeoutError:
        print("Timed out waiting for chat completion; continuing with current page state.", file=sys.stderr)


def send_chat_turn(page: Page, prompt: str) -> None:
    focus_camera(page, ".composer-wrap", scale=1.45)
    ta = page.locator("#ta")
    ta.click()
    if RECORDING_ZOOM_ENABLED:
        ta.type(prompt, delay=10, timeout=120000)
    else:
        ta.fill(prompt)
    wait(page, 180)
    click_when_ready(page, "#send")
    focus_camera(page, "#convo", scale=1.22)
    wait_for_chat_turn(page)


def run_demo(page: Page, base_url: str, prompt: str) -> None:
    page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
    install_recording_camera(page)
    wait(page, 450)

    # Homepage: show the wrong -> right correction affordance.
    focus_camera(page, ".hero h1", scale=1.28)
    page.locator(".hero .swap").first.hover()
    wait(page, 650)
    reset_camera(page)
    page.mouse.move(80, 80)
    wait(page, 180)
    focus_camera(page, ".examples .ex-card:nth-child(2)", scale=1.35)
    page.locator(".examples .swap").nth(1).hover()
    wait(page, 550)
    reset_camera(page)

    click_when_ready(page, 'a.cta[href="chat.html"]')
    page.wait_for_url("**/chat.html")
    page.wait_for_load_state("domcontentloaded")
    install_recording_camera(page)
    wait(page, 350)

    # Chat: use a two-round hard math proof audit.
    send_chat_turn(page, prompt)
    wait(page, 700)
    send_chat_turn(page, FOLLOWUP_PROMPT)

    # Wait until the bounty panel has updated.
    try:
        page.wait_for_function(
            """
            () => {
              const verdict = document.querySelector('#riskVerdict')?.textContent?.trim() || '';
              return verdict && verdict !== '—';
            }
            """,
            timeout=15000,
        )
    except PlaywrightTimeoutError:
        print("Timed out waiting for score update; continuing with current page state.", file=sys.stderr)

    wait(page, 900)
    focus_camera(page, ".bet-panel", scale=1.45)
    wait(page, 450)
    reset_camera(page)

    # Claim: save the chat snapshot and move to the correction workflow.
    click_when_ready(page, "#claimBtn")
    page.wait_for_url("**/claim.html")
    page.wait_for_load_state("domcontentloaded")
    install_recording_camera(page)
    wait(page, 450)

    assistant = page.locator("#snapshot .msg.assistant").last
    assistant.scroll_into_view_if_needed()
    focus_element_camera(page, "#snapshot .msg.assistant", -1, scale=1.35)
    wait(page, 250)
    assistant.click()
    wait(page, 250)
    focus_camera(page, "#snapshot .msg.assistant.editing", scale=1.5)
    page.locator("#snapshot .msg.assistant.editing").click()
    page.evaluate(
        """() => {
          const msg = document.querySelector('#snapshot .msg.assistant.editing');
          if (!msg) return;
          msg.focus();
          const range = document.createRange();
          range.selectNodeContents(msg);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }"""
    )
    page.keyboard.type(f"\n\n{CLAIM_EDIT_INSERT}", delay=10)
    wait(page, 350)
    click_when_ready(page, ".edit-toolbar .done")
    wait(page, 650)

    focus_camera(page, "#verifyBtn", scale=1.35)
    click_when_ready(page, "#verifyBtn")
    try:
        page.wait_for_selector(".verdict.show", timeout=90000)
    except PlaywrightTimeoutError:
        print("Timed out waiting for verifier result; continuing.", file=sys.stderr)
    wait(page, 900)
    reset_camera(page)

    click_when_ready(page, "#submitBtn")
    if page.locator("#confirmModal.open #confirmYes").count():
        wait(page, 500)
        click_when_ready(page, "#confirmYes")
    wait(page, 1200)


def main() -> int:
    global RECORDING_ZOOM_ENABLED
    args = parse_args()
    RECORDING_ZOOM_ENABLED = args.zoom
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = out_dir / f"{args.name}-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, slow_mo=args.slow_mo)
        context = browser.new_context(
            viewport={"width": args.width, "height": args.height},
            device_scale_factor=1,
            record_video_dir=str(raw_dir),
            record_video_size={"width": args.width, "height": args.height},
        )
        page = context.new_page()
        run_demo(page, args.base_url.rstrip("/"), args.prompt)

        if args.keep_open:
            print("Keeping browser open. Press Ctrl+C to stop.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass

        video = page.video
        context.close()
        browser.close()

        if video is None:
            raise RuntimeError("Playwright did not produce a video.")

        webm = out_dir / f"{args.name}.webm"
        Path(video.path()).replace(webm)

    mp4 = out_dir / f"{args.name}.mp4" if args.mp4 else None
    gif = out_dir / f"{args.name}.gif" if args.gif and not args.no_gif else None
    if mp4 is not None or gif is not None:
        convert_with_ffmpeg(webm, mp4, gif, args.mp4_width, args.gif_width)
    print(f"Wrote WebM: {webm}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
