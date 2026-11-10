from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "assets"
OUT.mkdir(exist_ok=True)

SIZE = 512
ACCENT = (47, 111, 237)
ACCENT_DARK = (31, 74, 173)


def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(size * 0.08)
    d.rounded_rectangle((m, m, size - m, size - m), radius=int(size * 0.21), fill=ACCENT)
    d.rounded_rectangle((m, m, size - m, size - m), radius=int(size * 0.21), outline=ACCENT_DARK, width=max(2, size // 64))
    r = max(2, int(size * 0.055))
    cx, cy = int(size * 0.36), int(size * 0.52)
    nodes = [
        (int(size * 0.70), int(size * 0.26), (255, 214, 102, 255)),
        (int(size * 0.76), int(size * 0.56), (129, 230, 167, 255)),
        (int(size * 0.62), int(size * 0.80), (255, 154, 138, 255)),
    ]
    w = max(2, int(size * 0.045))
    for nx, ny, _ in nodes:
        d.line([(cx, cy), (nx, ny)], fill=(255, 255, 255, 230), width=w)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
    for nx, ny, col in nodes:
        d.ellipse((nx - r, ny - r, nx + r, ny + r), fill=col)
    return img


master = make(SIZE)
master.save(OUT / "icon.png")

sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [make(s) for s in sizes]
imgs[-1].save(OUT / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes])
print("icon written:", OUT / "icon.ico", OUT / "icon.png")
