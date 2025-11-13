import os, argparse, random
from PIL import Image, ImageOps

SPECIAL = {
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

def load_glyph(ch, glyph_dir):
    name = SPECIAL.get(ch, ch)
    path = os.path.join(glyph_dir, f"{name}.png")
    if not os.path.exists(path):
        return Image.new("L", (30, 50), 255)
    return Image.open(path).convert("L")

def maybe_rotate(img, max_deg):
    if max_deg <= 0:
        return img
    angle = random.uniform(-max_deg, max_deg)
    return img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)

def render(text, glyph_dir, out_path,
           space_factor=0.45,
           line_spacing=22,
           scale=1.0,
           jitter_y=3,
           rotate_deg=2,
           extra_letter_spacing=4,
           margin=35):
    lines = text.split("\n")
    prepared = []
    total_h = margin
    max_w = 0

    for line in lines:
        glyphs = []
        width_sum = 0
        for ch in line:
            if ch == " ":
                w = int(40 * space_factor)
                space_img = Image.new("L", (w, 40), 255)
                glyphs.append(space_img)
                width_sum += w + extra_letter_spacing
                continue
            g = load_glyph(ch, glyph_dir)
            if scale != 1.0:
                g = g.resize((int(g.width*scale), int(g.height*scale)), Image.LANCZOS)
            g = maybe_rotate(g, rotate_deg)
            glyphs.append(g)
            width_sum += g.width + extra_letter_spacing
        line_h = max((g.height for g in glyphs), default=0)
        prepared.append((glyphs, line_h, width_sum))
        total_h += line_h + line_spacing
        max_w = max(max_w, width_sum)

    canvas = Image.new("L", (max_w + 2*margin, total_h + margin), 255)

    y_cursor = margin
    for glyphs, line_h, line_w in prepared:
        x_cursor = margin
        for g in glyphs:
            y_off = random.randint(-jitter_y, jitter_y) if jitter_y > 0 else 0
            canvas.paste(g, (x_cursor, y_cursor + y_off))
            x_cursor += g.width + extra_letter_spacing
        y_cursor += line_h + line_spacing

    noise = Image.effect_noise(canvas.size, 5).convert("L")
    noise = ImageOps.autocontrast(noise)
    blended = Image.blend(canvas, noise, 0.08)
    blended.save(out_path)
    print(f"[OK] Saved handwriting render => {out_path}")

