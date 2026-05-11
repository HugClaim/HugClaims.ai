#!/usr/bin/env python3
"""Record a separate HugClaims forum interaction demo with Playwright."""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    from playwright.sync_api import Page, sync_playwright
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
COMMENT_TEXT = "Nice catch: the corrected antiderivative is exactly where the proof changes."


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Record a HugClaims forum demo video.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Local or hosted HugClaims base URL.")
    parser.add_argument("--out-dir", default=str(ROOT / "recordings"), help="Directory for output videos.")
    parser.add_argument("--name", default=f"hugclaims-forum-{time.strftime('%Y%m%d-%H%M%S')}")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--mp4", action="store_true", help="Also write an MP4 after recording the WebM.")
    parser.add_argument("--gif", action="store_true", help="Also write a GIF after recording the WebM.")
    parser.add_argument("--zoom", action="store_true", help="Use camera zooms around typing and edits.")
    parser.add_argument("--mp4-width", type=int, default=1600, help="Rendered MP4 width after ffmpeg conversion.")
    parser.add_argument("--gif-width", type=int, default=1280, help="Rendered GIF width after ffmpeg conversion.")
    parser.add_argument("--slow-mo", type=int, default=45, help="Playwright slow motion in ms.")
    parser.add_argument("--no-gif", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def wait(page: Page, ms: int) -> None:
    page.wait_for_timeout(ms)


def click_when_ready(page: Page, selector: str, timeout: int = 15000) -> None:
    loc = page.locator(selector)
    loc.wait_for(state="visible", timeout=timeout)
    loc.click()


def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


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


def reset_camera(page: Page) -> None:
    if not RECORDING_ZOOM_ENABLED:
        return
    page.evaluate("document.documentElement.style.setProperty('--hug-camera-scale', '1')")
    wait(page, 520)


def run_forum_demo(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/forum.html", wait_until="domcontentloaded")
    install_recording_camera(page)
    wait(page, 650)

    # Filter to math so the first post is a clean proof-correction case.
    click_when_ready(page, '.filter-btn[data-filter="math"]')
    wait(page, 550)

    first_post = page.locator(".post:visible").first
    first_post.scroll_into_view_if_needed()
    focus_camera(page, ".post:visible", scale=1.28)
    wait(page, 400)

    # Show voting and expanded comments.
    first_post.locator(".vote-pill").click()
    wait(page, 450)
    first_post.locator(".toggle-comments").click()
    wait(page, 650)
    first_post.locator(".comment").first.scroll_into_view_if_needed()
    focus_camera(page, ".post:visible .comments", scale=1.35)
    wait(page, 450)
    first_post.locator(".vote-mini").first.click()
    wait(page, 450)

    # Reply flow: focus input, add a comment, and reveal it in the thread.
    first_post.locator(".reply-btn").click()
    comment_input = first_post.locator(".add-comment input")
    focus_camera(page, ".post:visible .add-comment", scale=1.55)
    comment_input.type(COMMENT_TEXT, delay=12)
    wait(page, 350)
    first_post.locator(".add-comment button").click()
    wait(page, 800)
    reset_camera(page)

    # Showcase sorting and another domain without relying on backend calls.
    page.locator(".toolbar").scroll_into_view_if_needed()
    wait(page, 350)
    page.select_option("#sort", "cashback")
    wait(page, 700)
    page.select_option("#sort", "discussed")
    wait(page, 700)
    click_when_ready(page, '.filter-btn[data-filter="finance"]')
    wait(page, 650)
    page.locator(".post:visible").first.scroll_into_view_if_needed()
    wait(page, 900)


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
        run_forum_demo(page, args.base_url.rstrip("/"))

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
