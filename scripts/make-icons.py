"""Rebuild every icon the app uses from the two source images in assets/icons.

    python scripts/make-icons.py        (needs Pillow and numpy; run from the repository root)

The sources carry stray semi-transparent pixels around the artwork. They are removed here, so
the sources themselves stay exactly as delivered.

Outputs
  src-tauri/icons/*            app icon set (via `tauri icon`): tight framing for Windows / Linux,
                               the original padded framing for the macOS .icns
  src-tauri/icons/tray.png     status bar / tray icon (white glyph, alpha only matters on macOS)
  public/icon.png              icon used inside the UI and as the favicon
"""

import shutil
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icons"
ICONS = ROOT / "src-tauri" / "icons"


def keep_artwork(img: Image.Image, floor: int = 32) -> Image.Image:
    """Drop faint pixels, then everything not connected to the largest opaque shape."""
    a = np.array(img.convert("RGBA"))
    alpha = a[..., 3]
    solid = alpha >= floor
    labels = np.zeros(solid.shape, dtype=np.int32)
    sizes = [0]
    h, w = solid.shape
    for y, x in zip(*np.nonzero(solid)):
        if labels[y, x]:
            continue
        n = len(sizes)
        labels[y, x] = n
        queue = deque([(y, x)])
        count = 0
        while queue:
            cy, cx = queue.popleft()
            count += 1
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = n
                    queue.append((ny, nx))
        sizes.append(count)
    biggest = max(sizes)
    # Keep every sizeable piece (the tray glyph may be more than one shape), drop the specks.
    keep = np.isin(labels, [i for i, s in enumerate(sizes) if i and s >= biggest * 0.01])
    a[~keep] = 0
    return Image.fromarray(a)


def square_crop(img: Image.Image, margin: float) -> Image.Image:
    """Crop to the artwork, centred on a transparent square with `margin` (0..1) on each side."""
    box = img.getbbox()
    art = img.crop(box)
    side = round(max(art.size) / (1 - 2 * margin))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    return out


def tauri_icon(source: Path, out: Path) -> None:
    cmd = ["pnpm", "tauri", "icon", str(source), "-o", str(out)]
    subprocess.run(cmd, cwd=ROOT, check=True, shell=sys.platform == "win32")


def main() -> None:
    app = keep_artwork(Image.open(SRC / "mail-studio-main.png"))
    tight = square_crop(app, 0.02).resize((1024, 1024), Image.LANCZOS)
    padded = square_crop(app, 0.10).resize((1024, 1024), Image.LANCZOS)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        tight.save(tmp / "tight.png")
        padded.save(tmp / "padded.png")
        tauri_icon(tmp / "tight.png", ICONS)
        tauri_icon(tmp / "padded.png", tmp / "mac")
        shutil.copy(tmp / "mac" / "icon.icns", ICONS / "icon.icns")
    # `tauri icon` also writes mobile sets this desktop app does not ship.
    for extra in ("android", "ios"):
        shutil.rmtree(ICONS / extra, ignore_errors=True)

    tight.resize((256, 256), Image.LANCZOS).save(ROOT / "public" / "icon.png", optimize=True)

    glyph = np.array(keep_artwork(Image.open(SRC / "mail-studio-statusbar-white.png")))
    glyph[..., :3] = 255  # pure white; the shape lives in the alpha channel
    tray = square_crop(Image.fromarray(glyph), 0.04).resize((64, 64), Image.LANCZOS)
    tray.save(ICONS / "tray.png", optimize=True)


if __name__ == "__main__":
    main()
