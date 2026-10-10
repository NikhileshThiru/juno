"""Find the page in a photo, flatten it, and boost contrast.

usage: flatten.py in.jpg out_dir
Writes clean.jpg, debug_edges.jpg, debug_contour.jpg into out_dir and prints a JSON result.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

MAX_SIDE = 2000


def order(pts):
    pts = pts.reshape(4, 2).astype("float32")
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")


def enhance(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    out = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(out, (0, 0), 1.2)
    return cv2.addWeighted(out, 1.4, blur, -0.4, 0)


def main(src, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(src)
    if img is None:
        print(json.dumps({"ok": False, "error": "unreadable image"}))
        return
    scale = MAX_SIDE / max(img.shape[:2])
    if scale < 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)
    cv2.imwrite(str(out / "debug_edges.jpg"), edges)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = img.shape[0] * img.shape[1]
    page = None
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.contourArea(approx) >= 0.2 * area:
            page = approx
            break

    contour_img = img.copy()
    if page is None:
        clean = enhance(img)
        result = {"ok": True, "found_page": False}
    else:
        cv2.drawContours(contour_img, [page], -1, (0, 200, 255), 8)
        rect = order(page)
        (tl, tr, br, bl) = rect
        w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        # Snap to US Letter proportions (8.5 x 11) in whichever orientation the page is.
        if h >= w:
            h = int(w * 11 / 8.5)
        else:
            w = int(h * 11 / 8.5)
        m = cv2.getPerspectiveTransform(rect, np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32"))
        clean = enhance(cv2.warpPerspective(img, m, (w, h)))
        result = {"ok": True, "found_page": True, "page_fraction": round(cv2.contourArea(page) / area, 3)}

    cv2.imwrite(str(out / "debug_contour.jpg"), contour_img)
    cv2.imwrite(str(out / "clean.jpg"), clean, [cv2.IMWRITE_JPEG_QUALITY, 90])
    result["clean"] = str(out / "clean.jpg")
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
