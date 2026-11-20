"""Official-page capture. A screenshot is returned only as real PNG bytes."""

from __future__ import annotations

from .security import assert_official, sanitize


def capture_official(url: str, *, resolver=None, executable_path: str | None = None, prepare=None, capture=None) -> dict:
    safe = assert_official(url, resolver)
    try:
        from playwright.sync_api import sync_playwright
    except Exception as error:
        raise CaptureError("Chromium is not installed, so the page was not opened.") from error
    try:
        with sync_playwright() as playwright:
            launch_args = {"headless": True}
            if executable_path:
                launch_args["executable_path"] = executable_path
            browser = playwright.chromium.launch(**launch_args)
            try:
                page = browser.new_page()
                if prepare:
                    prepare(page)
                page.goto(safe, wait_until="domcontentloaded", timeout=20000)
                assert_official(page.url, resolver)
                _scroll(page)
                text = _visible_text(page, resolver)
                png = capture(page) if capture else page.screenshot(full_page=True, type="png")
            finally:
                browser.close()
    except CaptureError:
        raise
    except Exception as error:
        message = str(error)
        if "executable doesn't exist" in message.lower() or "failed to launch" in message.lower() or "enoent" in message.lower():
            raise CaptureError("Chromium is not installed, so the page was not opened.") from error
        if "allowlist" in message.lower() or "private" in message.lower() or "login" in message.lower() or "https" in message.lower():
            raise CaptureError(message) from error
        raise CaptureError("The official page could not be opened in the browser.") from error
    if not isinstance(png, (bytes, bytearray)) or not bytes(png).startswith(b"\x89PNG") or len(png) < 100:
        raise CaptureError("The screenshot was not captured.")
    if not text.strip():
        raise CaptureError("The official page opened, but no readable text was captured.")
    return {
        "sourceUrl": safe,
        "sourceType": "screenshot",
        "documentTitle": "Official page screenshot",
        "extractedText": sanitize(text)[:6000],
        "verificationStatus": "partial",
        "origin": "fetched",
        "screenshot": True,
    }


class CaptureError(RuntimeError):
    pass


def _scroll(page) -> None:
    page.evaluate(
        """async () => {
          const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
          const step = window.innerHeight || 800;
          for (let top = 0; top < height; top += step) {
            window.scrollTo(0, top);
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
          window.scrollTo(0, 0);
        }"""
    )


def _visible_text(page, resolver) -> str:
    parts = [page.locator("body").inner_text(timeout=8000)]
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        try:
            assert_official(frame.url, resolver)
        except ValueError:
            continue
        try:
            parts.append(frame.locator("body").inner_text(timeout=3000))
        except Exception:
            continue
    return "\n".join(part for part in parts if part)
