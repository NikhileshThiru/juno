"""Turn the rendered document pages into realistic phone photos for the demo
camera roll: a flat sheet of paper on a wooden table, seen through a phone
camera held at a slight tilt (a true perspective projection of a rectangle),
with paper grain, fold creases, soft shadows, and indoor lighting.

usage: .venv/bin/python -I scripts/make_photos.py
"""
from pathlib import Path

import cv2
import numpy as np

DOCS = Path("docs")
OUT = DOCS / "photos"
W, H = 1512, 2016  # 3:4 portrait, like an iPhone photo
rng = np.random.default_rng(11)


def noise(cell_y, cell_x):
    """Smooth value noise with elongated cells (long cells → wood grain streaks)."""
    small = rng.random((H // cell_y + 3, W // cell_x + 3)).astype(np.float32)
    big = cv2.resize(small, ((W // cell_x + 3) * cell_x, (H // cell_y + 3) * cell_y), interpolation=cv2.INTER_CUBIC)
    return big[:H, :W]


def table():
    t = 0.45 * noise(5, 260) + 0.3 * noise(14, 700) + 0.25 * noise(160, 160)
    t = (t - t.min()) / (t.max() - t.min())
    dark, light = np.array([30, 52, 86], np.float32), np.array([62, 104, 150], np.float32)  # BGR walnut
    img = dark + (light - dark) * t[..., None]
    for y in range(int(rng.integers(150, 400)), H, 470):  # plank seams
        cv2.line(img, (0, y), (W, y + int(rng.integers(-6, 6))), (20, 32, 52), 3)
    img = cv2.GaussianBlur(img, (0, 0), 1.0)
    return img + rng.normal(0, 2.5, img.shape)


def paper(page, creases):
    """Printed-on-paper look: off-white stock, grain, slightly soft ink, fold creases."""
    p = cv2.GaussianBlur(page, (0, 0), 0.7).astype(np.float32)
    gray = p.mean(axis=2, keepdims=True)
    p = gray + (p - gray) * 0.85  # printer ink is a little less saturated than a screen
    p *= np.array([0.925, 0.955, 0.975], np.float32)  # warm off-white stock
    h, w = p.shape[:2]
    grain = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.8) * 3.0
    p += grain[..., None]
    for frac in creases:
        y = int(h * frac)
        ramp = np.linspace(-1, 1, 60, dtype=np.float32)
        band = 1 + 0.035 * np.sign(ramp) * np.exp(-np.abs(ramp) * 4)  # light on one side, shade on the other
        p[y - 30 : y + 30] *= band[:, None, None]
        p[y - 1 : y + 1] *= 0.93
    return np.clip(p, 0, 255)


def project(aspect, yaw, pitch, fill, shift):
    """Corners (tl, tr, br, bl) of a flat w×h sheet seen by a pinhole camera."""
    w, h = 1.0, aspect
    pts = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], np.float64)
    a, b = np.radians(yaw), np.radians(pitch)
    rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    cam = (rx @ rz @ pts.T).T
    cam[:, 2] += 2.4  # camera distance, in page widths
    uv = cam[:, :2] / cam[:, 2:3]
    uv -= uv.mean(axis=0)
    scale = fill * min(W / np.ptp(uv[:, 0]), H / np.ptp(uv[:, 1]))
    return (uv * scale + [W / 2 + shift[0], H / 2 + shift[1]]).astype(np.float32)


def photo(page, name, yaw, pitch, fill=0.8, shift=(0, 0), creases=()):
    h, w = page.shape[:2]
    quad = project(h / w, yaw, pitch, fill, shift)
    m = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), quad)
    sheet = cv2.warpPerspective(paper(page, creases), m, (W, H), flags=cv2.INTER_AREA)
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), m, (W, H)).astype(np.float32) / 255

    bg = table()
    contact = cv2.GaussianBlur(np.roll(mask, (10, 6), axis=(0, 1)), (0, 0), 14)  # soft shadow where paper meets table
    bg *= 1 - 0.5 * contact[..., None]
    a = cv2.GaussianBlur(mask, (0, 0), 0.8)[..., None]
    img = sheet * a + bg * (1 - a)

    # Indoor light from the upper left, a faint phone shadow at the bottom, vignette.
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    light = 1.06 - 0.22 * np.hypot((x - W * 0.3) / W, (y - H * 0.2) / H)
    phone = cv2.GaussianBlur(((((x - W * 0.62) / (W * 0.33)) ** 2 + ((y - H * 1.05) / (H * 0.2)) ** 2) < 1).astype(np.float32), (0, 0), 90)
    img *= (light * (1 - 0.16 * phone))[..., None]
    img *= np.array([0.95, 0.99, 1.04], np.float32)  # warm white balance
    img = cv2.GaussianBlur(np.clip(img + rng.normal(0, 2.2, img.shape), 0, 255).astype(np.uint8), (0, 0), 0.55)
    OUT.mkdir(exist_ok=True)
    cv2.imwrite(str(OUT / name), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print("wrote", OUT / name)


def crop_card(page):
    """Cut the appointment card out of its letter-size render (border + small margin)."""
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    ys, xs = np.where(gray[: int(page.shape[0] * 0.8)] < 200)
    pad = 40
    return page[max(0, ys.min() - pad) : ys.max() + pad, max(0, xs.min() - pad) : xs.max() + pad]


photo(cv2.imread(str(DOCS / "discharge-p1.png")), "1-discharge-page1.jpg", yaw=-4, pitch=14, creases=(1 / 3, 2 / 3))
photo(cv2.imread(str(DOCS / "discharge-p2.png")), "2-discharge-page2.jpg", yaw=3, pitch=12, shift=(15, -10), creases=(1 / 3, 2 / 3))
photo(crop_card(cv2.imread(str(DOCS / "appointment.png"))), "3-appointment-card.jpg", yaw=-6, pitch=16, fill=0.78)
photo(cv2.imread(str(DOCS / "labs.png")), "4-lab-results.jpg", yaw=2.5, pitch=15, shift=(-10, 0))
