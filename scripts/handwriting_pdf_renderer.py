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

PAGE_SIZES = {
    "A4": (595, 842),
    "LETTER": (612, 792)
}

def load_glyph(ch, glyph_dir):
    name = SPECIAL.get(ch, ch)
    path = os.path.join(glyph_dir, f"{name}.png")
    if not os.path.exists(path):
        return Image.new("L", (30, 50), 255)
    return Image.open(path).convert("L")

def maybe_rotate(img, max_deg, variation=True):
    if not variation or max_deg <= 0:
        return img
    angle = random.uniform(-max_deg, max_deg)
    return img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)

def compose_pages(text, glyph_dir, page_w, page_h, margin,
                  line_spacing, space_factor, letter_spacing,
                  scale, rotate_deg, jitter_y, variation=True, max_pages=None):
    words = []
    for raw_line in text.split("\n"):
        split_words = raw_line.split(" ")
        for i, w in enumerate(split_words):
            if w != "":
                words.append(w)
            if i < len(split_words) - 1:
                words.append(" ")
        words.append("\n")
    pages = []
    current_page = Image.new("L", (page_w, page_h), 255)
    y_cursor = margin
    x_cursor = margin
    line_max_height = 0

    def new_page():
        nonlocal current_page, y_cursor, x_cursor, line_max_height
        pages.append(current_page)
        current_page = Image.new("L", (page_w, page_h), 255)
        y_cursor = margin
        x_cursor = margin
        line_max_height = 0

    for token in words:
        if token == "\n":
            y_cursor += line_max_height + line_spacing
            x_cursor = margin
            line_max_height = 0
            if y_cursor + 50 > page_h - margin:
                new_page()
                if max_pages and len(pages) >= max_pages:
                    break
            continue

        if token == " ":
            space_w = int(40 * space_factor * scale)
            space_img = Image.new("L", (space_w, int(40*scale)), 255)
            if x_cursor + space_img.width > page_w - margin:
                y_cursor += line_max_height + line_spacing
                x_cursor = margin
                line_max_height = 0
                if y_cursor + 50 > page_h - margin:
                    new_page()
                    if max_pages and len(pages) >= max_pages:
                        break
            x_cursor += space_img.width + letter_spacing
            line_max_height = max(line_max_height, space_img.height)
            continue

        word_glyphs = []
        total_word_w = 0
        max_h_word = 0
        for ch in token:
            g = load_glyph(ch, glyph_dir)
            if scale != 1.0:
                g = g.resize((int(g.width*scale), int(g.height*scale)), Image.LANCZOS)
            g = maybe_rotate(g, rotate_deg, variation)
            word_glyphs.append(g)
            total_word_w += g.width + letter_spacing
            max_h_word = max(max_h_word, g.height)

        if x_cursor + total_word_w > page_w - margin:
            y_cursor += line_max_height + line_spacing
            x_cursor = margin
            line_max_height = 0
            if y_cursor + max_h_word > page_h - margin:
                new_page()
                if max_pages and len(pages) >= max_pages:
                    break

        for g in word_glyphs:
            y_off = random.randint(-jitter_y, jitter_y) if (variation and jitter_y > 0) else 0
            current_page.paste(g, (x_cursor, y_cursor + y_off))
            x_cursor += g.width + letter_spacing
            line_max_height = max(line_max_height, g.height)

    pages.append(current_page)
    return pages

def add_texture(pages, strength=0.07):
    textured = []
    for p in pages:
        noise = Image.effect_noise(p.size, 6).convert("L")
        noise = ImageOps.autocontrast(noise)
        blended = Image.blend(p, noise, strength)
        textured.append(blended)
    return textured

def save_pdf(pages, out_path):
    if not pages:
        raise ValueError("No pages to save.")
    rgb_pages = [p.convert("RGB") for p in pages]
    first, rest = rgb_pages[0], rgb_pages[1:]
    first.save(out_path, save_all=True, append_images=rest)
    print(f"[OK] Saved PDF: {out_path} (pages={len(rgb_pages)})")

def main():
    ap = argparse.ArgumentParser(description="Render handwriting glyphs into multi-page PDF.")
    ap.add_argument("--text", help="Direct text input (optional if --text_file provided).")
    ap.add_argument("--text_file", help="Path to UTF-8 text file.")
    ap.add_argument("--glyphs", default="glyphs")
    ap.add_argument("--out", default="out/handwriting.pdf")
    ap.add_argument("--page_size", choices=["A4", "LETTER"], default="A4")
    ap.add_argument("--page_w", type=int)
    ap.add_argument("--page_h", type=int)
    ap.add_argument("--margin", type=int, default=50)
    ap.add_argument("--line_spacing", type=int, default=26)
    ap.add_argument("--space_factor", type=float, default=0.42)
    ap.add_argument("--letter_spacing", type=int, default=4)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--rotate_deg", type=float, default=2.0)
    ap.add_argument("--jitter_y", type=int, default=3)
    ap.add_argument("--no_variation", action="store_true")
    ap.add_argument("--texture", action="store_true")
    ap.add_argument("--max_pages", type=int)
    args = ap.parse_args()

    if args.text_file:
        if not os.path.exists(args.text_file):
            raise SystemExit(f"Text file not found: {args.text_file}")
        with open(args.text_file, "r", encoding="utf-8") as f:
            text = f.read()
    elif args.text:
        text = args.text
    else:
        raise SystemExit("Provide --text or --text_file.")

    if args.page_w and args.page_h:
        page_w, page_h = args.page_w, args.page_h
    else:
        page_w, page_h = PAGE_SIZES[args.page_size]

    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    pages = compose_pages(
        text=text,
        glyph_dir=args.glyphs,
        page_w=page_w,
        page_h=page_h,
        margin=args.margin,
        line_spacing=args.line_spacing,
        space_factor=args.space_factor,
        letter_spacing=args.letter_spacing,
        scale=args.scale,
        rotate_deg=args.rotate_deg,
        jitter_y=args.jitter_y,
        variation=(not args.no_variation),
        max_pages=args.max_pages
    )

    if args.texture:
        pages = add_texture(pages)

    save_pdf(pages, args.out)

if __name__ == "__main__":
    main()
