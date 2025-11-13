/* Client-side handwriting glyph extractor & renderer
 * Uses OpenCV.js for contour extraction and jsPDF for PDF export.
 * All processing stays in the browser.
 */
(() => {
  const SPECIAL = {
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
  };
  const PAGE_SIZES = { A4: [595, 842], LETTER: [612, 792] };

  // DOM references
  const sheetInput = qs('#sheetInput');
  const charsInput = qs('#charsInput');
  const minAreaInput = qs('#minAreaInput');
  const rowGapInput = qs('#rowGapInput');
  const padInput = qs('#padInput');
  const extractBtn = qs('#extractBtn');
  const extractStatus = qs('#extractStatus');
  const debugCanvas = qs('#debugCanvas');

  const textInput = qs('#textInput');
  const scaleInput = qs('#scaleInput');
  const letterSpacingInput = qs('#letterSpacingInput');
  const spaceFactorInput = qs('#spaceFactorInput');
  const lineSpacingInput = qs('#lineSpacingInput');
  const jitterYInput = qs('#jitterYInput');

  const renderBtn = qs('#renderBtn');
  const renderCanvas = qs('#renderCanvas');

  const pdfSizeSelect = qs('#pdfSizeSelect');
  const pdfMarginInput = qs('#pdfMarginInput');
  const downloadPdfBtn = qs('#downloadPdfBtn');

  // Glyph store: Map<char, {canvas,width,height}>
  let glyphMap = new Map();

  function qs(sel) { return document.querySelector(sel); }

  // Wait until OpenCV is ready
  function waitForOpenCV() {
    return new Promise(resolve => {
      if (typeof cv !== 'undefined' && cv.Mat) return resolve();
      const iid = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          clearInterval(iid);
          resolve();
        }
      }, 50);
    });
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function clusterRowIndices(boxes, rowGap) {
    const centers = boxes.map(b => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, idx: b.idx }));
    const rows = [];
    centers.forEach(c => {
      let placed = false;
      for (const r of rows) {
        const baseCy = r[0].cy;
        if (Math.abs(c.cy - baseCy) <= rowGap) { r.push(c); placed = true; break; }
      }
      if (!placed) rows.push([c]);
    });
    rows.sort((a, b) => avg(a.map(o => o.cy)) - avg(b.map(o => o.cy)));
    const ordered = [];
    rows.forEach(r => {
      r.sort((p, q) => p.cx - q.cx);
      r.forEach(o => ordered.push(o.idx));
    });
    return ordered;
  }

  function avg(arr) { return arr.reduce((s,v)=>s+v,0)/arr.length; }

  function drawDebug(imgEl, boxes, orderIndices, canvas) {
    canvas.width = imgEl.width;
    canvas.height = imgEl.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    ctx.strokeStyle = 'rgba(255,0,0,0.85)';
    ctx.lineWidth = 2;
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255,0,0,0.9)';
    orderIndices.forEach((bi, rank) => {
      const b = boxes.find(bb => bb.idx === bi);
      if (!b) return;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillText(rank, b.x + 2, b.y - 4 < 10 ? b.y + 12 : b.y - 4);
    });
  }

  function matToCanvas(mat) {
    const c = document.createElement('canvas');
    c.width = mat.cols;
    c.height = mat.rows;
    cv.imshow(c, mat);
    return c;
  }

  async function extractGlyphs() {
    const file = sheetInput.files?.[0];
    const chars = charsInput.value;
    const minArea = parseInt(minAreaInput.value, 10) || 140;
    const rowGap = parseInt(rowGapInput.value, 10) || 30;
    const pad = parseInt(padInput.value, 10) || 10;

    if (!file) return status('Please upload a sheet image.');
    if (!chars) return status('Provide character order string.');

    status('Loading OpenCV...');
    await waitForOpenCV();

    status('Reading image...');
    const imgEl = await fileToImage(file);

    const src = cv.imread(imgEl);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    const th = new cv.Mat();
    cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.morphologyEx(th, th, cv.MORPH_OPEN, kernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(th, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const boxes = [];
    for (let i = 0; i < contours.size(); i++) {
      const rect = cv.boundingRect(contours.get(i));
      const area = rect.width * rect.height;
      if (area >= minArea) boxes.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, idx: i });
    }

    if (!boxes.length) {
      cleanup(); return status('No glyph contours found. Try lower min area or clearer scan.');
    }

    const orderIndices = clusterRowIndices(boxes, rowGap);
    drawDebug(imgEl, boxes, orderIndices, debugCanvas);

    glyphMap.clear();
    const usable = Math.min(orderIndices.length, chars.length);
    for (let n = 0; n < usable; n++) {
      const bi = orderIndices[n];
      const b = boxes.find(bb => bb.idx === bi);
      if (!b) continue;
      const roi = gray.roi(new cv.Rect(b.x, b.y, b.w, b.h));
      const inv = new cv.Mat();
      cv.bitwise_not(roi, inv);

      const w = b.w + 2 * pad;
      const h = b.h + 2 * pad;
      const white = new cv.Mat(h, w, cv.CV_8U, new cv.Scalar(255));
      inv.copyTo(white.roi(new cv.Rect(pad, pad, b.w, b.h)));

      const canvas = matToCanvas(white);
      const ch = chars[n];
      glyphMap.set(ch, { canvas, width: canvas.width, height: canvas.height });

      roi.delete(); inv.delete(); white.delete();
    }

    status(`Extracted ${glyphMap.size} glyphs (requested ${chars.length}).`);

    function cleanup() {
      src.delete(); gray.delete(); th.delete();
      kernel.delete(); contours.delete(); hierarchy.delete();
    }
    cleanup();
  }

  function status(msg) {
    extractStatus.textContent = msg;
    console.log('[status]', msg);
  }

  function renderTextToCanvas(text, opts) {
    const {
      scale = 1.0,
      letterSpacing = 4,
      spaceFactor = 0.45,
      lineSpacing = 22,
      jitterY = 3,
      margin = 20
    } = opts;

    const lines = text.split('\n');
    let maxW = 0;
    let totalH = margin;
    const prepared = [];

    for (const line of lines) {
      const glyphs = [];
      let wSum = 0;
      for (const ch of line) {
        if (ch === ' ') {
          const w = Math.max(4, Math.floor(40 * spaceFactor * scale));
          const h = Math.floor(40 * scale);
          glyphs.push({ kind: 'space', width: w, height: h });
          wSum += w + letterSpacing;
          continue;
        }
        const g = glyphMap.get(ch);
        if (!g) {
          const w = Math.floor(22 * scale);
          const h = Math.floor(38 * scale);
          glyphs.push({ kind: 'placeholder', width: w, height: h });
          wSum += w + letterSpacing;
          continue;
        }
        const w = Math.floor(g.width * scale);
        const h = Math.floor(g.height * scale);
        glyphs.push({ kind: 'glyph', g, width: w, height: h });
        wSum += w + letterSpacing;
      }
      const lineH = glyphs.length ? Math.max(...glyphs.map(g => g.height)) : 0;
      prepared.push({ glyphs, lineH });
      totalH += lineH + lineSpacing;
      maxW = Math.max(maxW, wSum);
    }

    renderCanvas.width = maxW + 2 * margin;
    renderCanvas.height = totalH + margin;
    const ctx = renderCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

    let y = margin;
    for (const row of prepared) {
      let x = margin;
      for (const item of row.glyphs) {
        const yOff = jitterY ? randInt(-jitterY, jitterY) : 0;
        if (item.kind === 'glyph') {
          ctx.drawImage(item.g.canvas, 0, 0, item.g.width, item.g.height,
                        x, y + yOff, item.width, item.height);
          x += item.width + letterSpacing;
        } else {
          x += item.width + letterSpacing;
        }
      }
      y += row.lineH + lineSpacing;
    }
  }

  function renderTextToPdfPages(text, pageW, pageH, margin, opts) {
    const {
      scale = 1.0,
      letterSpacing = 4,
      spaceFactor = 0.45,
      lineSpacing = 26,
      jitterY = 2
    } = opts;

    const lines = text.split('\n');
    const pages = [];
    let pageCanvas = document.createElement('canvas');
    pageCanvas.width = pageW;
    pageCanvas.height = pageH;
    let ctx = pageCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pageW, pageH);

    const usableW = pageW - 2 * margin;
    const usableH = pageH - 2 * margin;
    let cursorY = margin;

    function newPage() {
      pages.push(pageCanvas);
      pageCanvas = document.createElement('canvas');
      pageCanvas.width = pageW; pageCanvas.height = pageH;
      ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, pageW, pageH);
      cursorY = margin;
    }

    for (const line of lines) {
      const words = line.split(' ');
      let x = margin;
      let lineH = 0;

      function commitLine() {
        cursorY += lineH + lineSpacing;
        x = margin;
        lineH = 0;
      }

      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi];
        let wWidth = 0;
        let wHeight = 0;
        const segments = [];
        for (const ch of word) {
          const g = glyphMap.get(ch);
          if (!g) {
            const w = Math.floor(22 * scale);
            const h = Math.floor(38 * scale);
            segments.push({ type: 'placeholder', width: w, height: h });
            wWidth += w + letterSpacing;
            wHeight = Math.max(wHeight, h);
          } else {
            const w = Math.floor(g.width * scale);
            const h = Math.floor(g.height * scale);
            segments.push({ type: 'glyph', g, width: w, height: h });
            wWidth += w + letterSpacing;
            wHeight = Math.max(wHeight, h);
          }
        }
        const spaceW = Math.floor(40 * spaceFactor * scale);
        const spaceH = Math.floor(40 * scale);

        if (x + wWidth > margin + usableW) {
          commitLine();
          if (cursorY + wHeight > margin + usableH) newPage();
        }

        for (const seg of segments) {
          const yOff = jitterY ? randInt(-jitterY, jitterY) : 0;
          if (seg.type === 'glyph') {
            ctx.drawImage(seg.g.canvas, 0, 0, seg.g.width, seg.g.height,
                          x, cursorY + yOff, seg.width, seg.height);
          }
          x += seg.width + letterSpacing;
          lineH = Math.max(lineH, seg.height);
        }

        if (wi < words.length - 1) {
          if (x + spaceW > margin + usableW) {
            commitLine();
            if (cursorY + spaceH > margin + usableH) newPage();
          } else {
            x += spaceW + letterSpacing;
            lineH = Math.max(lineH, spaceH);
          }
        }
      }
      commitLine();
      if (cursorY + 40 > margin + usableH) newPage();
    }
    pages.push(pageCanvas);
    return pages;
  }

  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  extractBtn.addEventListener('click', async () => {
    try {
      status('Starting extraction...');
      await extractGlyphs();
    } catch (e) {
      console.error(e);
      status('Extraction error: ' + e.message);
    }
  });

  renderBtn.addEventListener('click', () => {
    if (!glyphMap.size) return alert('Please extract glyphs first.');
    const text = textInput.value;
    renderTextToCanvas(text, {
      scale: parseFloat(scaleInput.value) || 1.0,
      letterSpacing: parseInt(letterSpacingInput.value, 10) || 4,
      spaceFactor: parseFloat(spaceFactorInput.value) || 0.45,
      lineSpacing: parseInt(lineSpacingInput.value, 10) || 22,
      jitterY: parseInt(jitterYInput.value, 10) || 0
    });
  });

  downloadPdfBtn.addEventListener('click', () => {
    if (!glyphMap.size) return alert('Extract glyphs first.');
    const text = textInput.value;
    const sizeKey = pdfSizeSelect.value;
    const [pw, ph] = PAGE_SIZES[sizeKey];
    const margin = parseInt(pdfMarginInput.value, 10) || 50;

    const pages = renderTextToPdfPages(text, pw, ph, margin, {
      scale: parseFloat(scaleInput.value) || 1.0,
      letterSpacing: parseInt(letterSpacingInput.value, 10) || 4,
      spaceFactor: parseFloat(spaceFactorInput.value) || 0.45,
      lineSpacing: parseInt(lineSpacingInput.value, 10) || 26,
      jitterY: parseInt(jitterYInput.value, 10) || 0
    });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: sizeKey === 'LETTER' ? 'letter' : 'a4' });

    pages.forEach((pc, idx) => {
      const img = pc.toDataURL('image/png');
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();
      doc.addImage(img, 'PNG', 0, 0, w, h);
      if (idx < pages.length - 1) doc.addPage();
    });

    doc.save('handwriting.pdf');
  });

  setTimeout(() => {
    if (typeof cv === 'undefined') status('Loading OpenCV.js… (If slow, check network)');
  }, 1200);
})();
