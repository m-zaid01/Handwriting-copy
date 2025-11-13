import cv2
import numpy as np
import argparse, os

SPECIAL_REPLACEMENTS = {
    '"': 'dq',
    "'": 'sq',
    ':': 'colon',
    ';': 'semicolon',
    '?': 'qmark',
    '!': 'emark',
    '-': 'dash',
    '_': 'underscore',
    '(': 'lparen',
    ')': 'rparen',
    '[': 'lbracket',
    ']': 'rbracket',
    '{': 'lbrace',
    '}': 'rbrace',
    '.': 'dot',
    ',': 'comma'
}

def preprocess(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    th = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        25, 9
    )
    kernel = np.ones((3,3), np.uint8)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel, iterations=1)
    return gray, th

def find_glyph_boxes(th, min_area):
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h >= min_area:
            boxes.append((x, y, w, h))
    return boxes

def cluster_rows(boxes, row_gap=25):
    centers = [(x + w/2, y + h/2) for x, y, w, h in boxes]
    rows = []
    for i, (cx, cy) in enumerate(centers):
        placed = False
        for r in rows:
            _, ry = r[0]
            if abs(cy - ry) <= row_gap:
                r.append((cx, cy, i))
                placed = True
                break
        if not placed:
            rows.append([(cx, cy, i)])
    rows.sort(key=lambda r: sum(cy for _, cy, _ in r) / len(r))
    ordered_indices = []
    for r in rows:
        r.sort(key=lambda t: t[0])
        ordered_indices.extend(idx for _, _, idx in r)
    return ordered_indices

def save_glyphs(gray, boxes, order_indices, chars, out_dir, pad=10):
    os.makedirs(out_dir, exist_ok=True)
    if len(order_indices) < len(chars):
        print(f"[WARN] Found {len(order_indices)} glyphs for {len(chars)} characters.")
    count = min(len(order_indices), len(chars))
    for n in range(count):
        bi = order_indices[n]
        x, y, w, h = boxes[bi]
        glyph = gray[y:y+h, x:x+w]
        glyph = 255 - glyph  # invert to black strokes on white
        canvas = np.full((h + 2*pad, w + 2*pad), 255, dtype=np.uint8)
        canvas[pad:pad+h, pad:pad+w] = glyph
        ch = chars[n]
        fname = SPECIAL_REPLACEMENTS.get(ch, ch)
        cv2.imwrite(os.path.join(out_dir, f"{fname}.png"), canvas)
    print(f"[INFO] Saved {count} glyphs to {out_dir}")

def debug_visual(image, boxes, order_indices, out_path):
    dbg = image.copy()
    for rank, bi in enumerate(order_indices):
        x, y, w, h = boxes[bi]
        cv2.rectangle(dbg, (x, y), (x+w, y+h), (0, 0, 255), 2)
        cv2.putText(dbg, str(rank), (x, y-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,0,255), 1)
    cv2.imwrite(out_path, dbg)
    print(f"[DEBUG] Saved ordering visualization: {out_path}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--chars", required=True)
    ap.add_argument("--out", default="glyphs")
    ap.add_argument("--min_area", type=int, default=140)
    ap.add_argument("--row_gap", type=int, default=30)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    img = cv2.imread(args.image)
    if img is None:
        raise SystemExit(f"Cannot read {args.image}")
    gray, th = preprocess(img)
    boxes = find_glyph_boxes(th, args.min_area)
    if not boxes:
        raise SystemExit("No glyph boxes detected. Adjust lighting or min_area.")
    order_indices = cluster_rows(boxes, row_gap=args.row_gap)
    save_glyphs(gray, boxes, order_indices, args.chars, args.out)
    if args.debug:
        debug_visual(img, boxes, order_indices, "glyph_order_debug.png")

if __name__ == "__main__":
    main()
