# Handwriting Glyph Pipeline

Convert your own English handwriting into:
1. Individual glyph images.
2. Rendered handwritten text images (with natural variation).
3. Multi‑page PDF documents (image glyph based).

## 1. Prepare Handwriting Sheet
Write characters with dark pen on clean white paper, spaced apart:

```
ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
0123456789
.,!?;:'"-_()[]{ }
```

Tips:
- Camera straight above (no tilt).
- Good, even lighting (no harsh shadows).
- Leave small horizontal gaps so contours don’t merge.
- Use a darker pen if strokes look faint.

Save / scan as `samples/input_sheet.jpg` (or `.png`).

## 2. Install Dependencies
```bash
pip install -r requirements.txt
```

## 3. Extract Glyphs
```bash
python scripts/handwriting_extractor_v2.py \
  --image samples/input_sheet.jpg \
  --chars "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?;:'\"-_()[]{}" \
  --out glyphs \
  --debug
```

Outputs:
- `glyphs/*.png`
- `glyph_order_debug.png` (visual ordering check if `--debug` used)

Adjust if problems:
- Fewer glyphs than expected → increase spacing physically or tune `--row_gap`.
- Very small punctuation lost → lower `--min_area`.
- Merged letters → write with a little more gap.

## 4. Render Single Image
```bash
python scripts/handwriting_render_v2.py \
  --text "Hello World!\nThis is my handwriting test 123." \
  --glyphs glyphs \
  --out out/example.png \
  --scale 1.0 \
  --jitter_y 3 \
  --rotate_deg 2 \
  --extra_letter_spacing 4
```

Disable variation (clean look):
```
--rotate_deg 0 --jitter_y 0
```

## 5. Render Multi‑Page PDF
```bash
python scripts/handwriting_pdf_renderer.py \
  --text_file samples/text.txt \
  --glyphs glyphs \
  --out out/handwriting.pdf \
  --page_size A4 \
  --margin 50 \
  --line_spacing 28 \
  --space_factor 0.42 \
  --letter_spacing 4 \
  --rotate_deg 2 \
  --jitter_y 3 \
  --texture
```

Custom size example:
```bash
python scripts/handwriting_pdf_renderer.py \
  --text_file samples/text.txt \
  --glyphs glyphs \
  --out out/custom.pdf \
  --page_w 650 --page_h 900
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Missing punctuation glyph | Not extracted | Ensure appears on sheet & in --chars order |
| Characters merged | Contours touching | Increase writing gap or raise `--min_area` |
| Thin strokes vanish | Threshold removes light ink | Use darker pen or adjust adaptive threshold parameters |
| Baseline jumps | Writing on unruled paper | Use lined paper or later implement baseline normalization |

## Future Ideas
- Kerning pairs JSON
- Ligatures / cursive joins
- TTF font generation (Calligraphr) for scalable font-based PDF
- Real paper texture overlay (scan your notebook)
- Optional color ink support

## License
MIT License (see LICENSE file).

## Quick Image → PDF
```python
from PIL import Image
img = Image.open("out/example.png").convert("RGB")
img.save("out/example.pdf")
```

## Safety
Your handwriting images may be personal. Avoid uploading sensitive text samples.

---
Made for: Personal handwriting rendering.