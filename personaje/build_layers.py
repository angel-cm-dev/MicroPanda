"""Edita source.webp y genera las capas animables del panda.

Es la receta con la que se hicieron las imágenes actuales. source.webp (la ilustración original)
NO está en el repositorio (ver NOTICE.md), y las coordenadas de abajo son de esa imagen.
Para usar otro dibujo no hace falta este script: basta con head.png, body.png y panda.png de
1000x1000 con fondo transparente, y ajustar en rig.json dónde van los ojos, el borde de la
capucha y el pivote de la cabeza (ver docs/ARQUITECTURA.md).

Salidas (1000x1000, fondo transparente):
  panda.png  imagen fija editada (sin globo rojo, logo de bambú nuevo)
  body.png   cuerpo + laptop (sin cabeza)
  head.png   capucha y cara, sin ojos (los ojos se dibujan en SVG)
  rig.json   posición de ojos, borde de la capucha y pivote de la cabeza

Uso: pip install pillow numpy && python build_layers.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
OUT_SIZE = 1000

if not (HERE / "source.webp").exists():
    sys.exit("Falta source.webp (la ilustración original no está en el repositorio; ver NOTICE.md).")
src = Image.open(HERE / "source.webp").convert("RGBA")
a = np.asarray(src).astype(np.int32).copy()
H, W = a.shape[:2]
r, g, b, al = (a[..., i] for i in range(4))
navy = (b > 90) & (r < 60) & (g < 60) & (al > 0)
NAVY = tuple(int(v) for v in np.median(a[navy][:, :3], axis=0))
PATCH = tuple(int(v) for v in np.median(a[840:860, 690:710, :3].reshape(-1, 3), axis=0))

# 1) quitar el globo rojo
a[460:740, 1470:1770, 3] = 0

# 2) borrar el sticker: interpolar el color de la tapa fila por fila
x0, x1, y0, y1 = 850, 1055, 1380, 1545
for y in range(y0, y1):
    left, right = a[y, x0 - 4, :3], a[y, x1 + 4, :3]
    t = np.linspace(0, 1, x1 - x0)[:, None]
    a[y, x0:x1, :3] = (left * (1 - t) + right * t).astype(np.int32)


def leaf(p, ang, length, width, n=24):
    ux, uy = math.cos(ang), math.sin(ang)
    px, py = -uy, ux
    side1, side2 = [], []
    for i in range(n + 1):
        t = i / n
        cx, cy = p[0] + ux * length * t, p[1] + uy * length * t
        o = math.sin(math.pi * t) * width / 2 * (1 - 0.35 * t)
        side1.append((cx + px * o, cy + py * o))
        side2.append((cx - px * o, cy - py * o))
    return side1 + side2[::-1]


def bamboo_logo(size=210, k=4):
    """Logo de bambú en el mismo estilo de línea navy y colores planos."""
    S = size * k
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = lambda v: v * k
    ow = s(5)
    green, light, dark = (76, 196, 92), (150, 232, 160), (46, 150, 70)
    leaf_c, leaf_l = (64, 180, 84), (120, 214, 128)
    # hojas detrás del tallo
    for p, ang, ln, wd in [((112, 78), -0.65, 70, 26), ((90, 128), math.pi + 0.55, 58, 22)]:
        pts = [(s(x), s(y)) for x, y in leaf(p, ang, ln, wd)]
        d.polygon(pts, fill=leaf_c, outline=NAVY, width=ow)
        mid = [(s(p[0] + math.cos(ang) * ln * t), s(p[1] + math.sin(ang) * ln * t)) for t in (0.15, 0.75)]
        d.line(mid, fill=leaf_l, width=s(3))
    # tallo en tres segmentos
    cx, w = 100, 34
    for ya, yb in [(28, 78), (82, 130), (134, 182)]:
        d.rounded_rectangle([s(cx - w / 2), s(ya), s(cx + w / 2), s(yb)], radius=s(9), fill=green, outline=NAVY, width=ow)
        d.rounded_rectangle([s(cx - w / 2 + 7), s(ya + 9), s(cx - w / 2 + 12), s(yb - 9)], radius=s(2.5), fill=light)
    for yn in (80, 132):
        d.rounded_rectangle([s(cx - w / 2 - 5), s(yn - 5), s(cx + w / 2 + 5), s(yn + 5)], radius=s(5), fill=dark, outline=NAVY, width=ow)
    im = im.rotate(-18, resample=Image.BICUBIC, center=(S / 2, S / 2))
    return im.resize((size, size), Image.LANCZOS)


edited = Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")
logo = bamboo_logo(300)
edited.alpha_composite(logo, (965 - logo.width // 2, 1495 - logo.height // 2))
edited_a = np.asarray(edited).astype(np.int32).copy()


# 3) ojos: medir y borrar (se redibujan en SVG para animarlos)
def rim(x):
    """Borde inferior de la capucha sobre la cara (parábola ajustada a la imagen)."""
    return 728 + 0.00076 * (x - 960) ** 2


# Medidas tomadas de la imagen original (px de 2000x2000): óvalo del ojo y su brillo.
eyes = [
    {"cx": 790, "cy": 767, "rx": 45, "ry": 52, "hx": 807, "hy": 770, "hrx": 10, "hry": 19},
    {"cx": 1128, "cy": 767, "rx": 46, "ry": 52, "hx": 1112, "hy": 770, "hrx": 10, "hry": 19},
]
noeyes = edited_a.copy()
yy, xx = np.mgrid[0:H, 0:W]
for e in eyes:
    m = (((xx - e["cx"]) / (e["rx"] + 6)) ** 2 + ((yy - e["cy"]) / (e["ry"] + 6)) ** 2 <= 1) & (yy > rim(xx) + 2)
    m &= edited_a[..., 3] > 0
    noeyes[m, :3] = PATCH

# 4) separar cabeza y cuerpo por la línea inferior de la capucha
PIVOT = (960, 1190)


def cutoff(x):
    pts = [(0, 1125), (560, 1125), (960, 1205), (1360, 1125), (W, 1125)]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / (xb - xa)
    return 1125


cut = np.array([cutoff(x) for x in range(W)])[None, :]
yy = np.arange(H)[:, None]
head = noeyes.copy()
head[yy >= cut, 3] = 0
body = noeyes.copy()
body[yy < cut - 60, 3] = 0          # se conserva una franja bajo la cabeza para que no haya huecos al moverla


def save(arr, name):
    Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA").resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS).save(HERE / name, optimize=True)


save(edited_a, "panda.png")
save(head, "head.png")
save(body, "body.png")

f = OUT_SIZE / W
rig = {
    "size": OUT_SIZE,
    "navy": "#%02x%02x%02x" % NAVY,
    "eyes": [{k: round(v * f, 2) for k, v in e.items()} for e in eyes],
    "rim": {"cx": 960 * f, "y0": 728 * f, "k": 0.00076 / f},
    "pivot": [PIVOT[0] * f, PIVOT[1] * f],
}
(HERE / "rig.json").write_text(json.dumps(rig, indent=2))
# rig.js permite abrir la página sin servidor (file://), por ejemplo dentro de la app de escritorio
(HERE / "rig.js").write_text("window.RIG = " + json.dumps(rig, indent=2) + ";\n")
print(json.dumps(rig))
