/* ============================================================
   محرك الكتابة والتحديد على صفحات الكتب  (Ink Engine)
   ------------------------------------------------------------
   * أدوات: قلم / تظليل (ماركر) / ممحاة / تحديد
   * الإحداثيات تُحفظ بنسبة 0..1 => الرسم يبقى دقيقًا مع أي تكبير
   * حفظ تلقائي في localStorage لكل (كتاب + فصل + صفحة)
   * دعم كامل للفأرة واللمس والقلم الإلكتروني (Pointer Events)
   ============================================================ */

const Ink = (function () {
  "use strict";

  const STORE_PREFIX = "msp_ink_";

  const DEFAULT_COLOR = "#e11d48";
  const DEFAULT_SIZE = 3;
  const MARKER_ALPHA = 0.32;
  const MAX_UNDO = 40;
  const MIN_POINT_GAP = 0.0015;   // تجاهل النقاط المتقاربة جدًا
  const PRECISION = 4;            // عدد الخانات العشرية في الحفظ

  const state = {
    grade: "1",
    book: "",
    sem: "1",
    page: 1,
    tool: "none",         // none | pen | marker | eraser | select
    color: DEFAULT_COLOR,
    size: DEFAULT_SIZE,

    strokes: [],          // أقلام الصفحة الحالية
    undoStack: [],        // لقطات للتراجع
    redoStack: [],

    box: null,
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0,
    dpr: 1,

    drawing: false,
    curStroke: null,
    curMoved: false,

    marquee: null,        // مستطيل التحديد {x0,y0,x1,y1}
    selectedIdx: [],
    moveAnchor: null,
    beforeMove: null,

    ready: false,
    saveTimer: null,
  };

  /* ---------------------------------------------------------- أدوات */

  function storageKey() {
    return STORE_PREFIX + state.grade + "_" + state.book + "_" + state.sem;
  }

  function rnd(v) {
    const f = Math.pow(10, PRECISION);
    return Math.round(v * f) / f;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function norm(evt) {
    const r = state.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: clamp01((evt.clientX - r.left) / r.width),
      y: clamp01((evt.clientY - r.top) / r.height),
    };
  }

  function px(v, total) {
    return v * total;
  }

  /* ---------------------------------------------------------- التخزين */

  function loadAll() {
    try {
      const raw = localStorage.getItem(storageKey());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function loadPage(page) {
    const all = loadAll();
    const list = all[String(page)];
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) {
      return s && Array.isArray(s.p) && s.p.length >= 4;
    });
  }

  function persist() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      state.saveTimer = null;
      writeNow();
    }, 350);
  }

  function writeNow() {
    if (!state.book) return;
    try {
      const all = loadAll();
      if (state.strokes.length) {
        all[String(state.page)] = state.strokes;
      } else {
        delete all[String(state.page)];
      }
      localStorage.setItem(storageKey(), JSON.stringify(all));
      notifySaved(true);
    } catch (e) {
      notifySaved(false);
    }
  }

  let savedBadge = null;
  let savedTimer = null;
  function notifySaved(ok) {
    if (!savedBadge) savedBadge = document.getElementById("inkSaved");
    if (!savedBadge) return;
    savedBadge.textContent = ok ? "✓ تم الحفظ" : "⚠️ الذاكرة ممتلئة";
    savedBadge.classList.toggle("ink-saved-error", !ok);
    savedBadge.hidden = false;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(function () {
      savedBadge.hidden = true;
    }, 1400);
  }

  /* ---------------------------------------------------------- التراجع */

  function snapshot() {
    state.undoStack.push(JSON.stringify(state.strokes));
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack.length = 0;
    updateButtons();
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(JSON.stringify(state.strokes));
    state.strokes = JSON.parse(state.undoStack.pop());
    state.selectedIdx = [];
    state.marquee = null;
    state.curStroke = null;
    fullRedraw();
    persist();
    updateButtons();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(JSON.stringify(state.strokes));
    state.strokes = JSON.parse(state.redoStack.pop());
    state.selectedIdx = [];
    state.marquee = null;
    fullRedraw();
    persist();
    updateButtons();
  }

  function updateButtons() {
    const u = document.getElementById("inkUndo");
    const r = document.getElementById("inkRedo");
    if (u) u.disabled = state.undoStack.length === 0;
    if (r) r.disabled = state.redoStack.length === 0;
  }

  /* ---------------------------------------------------------- الرسم */

  function lineWidthFor(s) {
    /* سُمك القلم محفوظ كنسبة من عرض الصفحة حتى يبقى ثابتًا بصريًا */
    return Math.max(1, s.w * state.cssW);
  }

  function strokeStyleFor(s) {
    if (s.t === "marker") {
      return { color: s.c, alpha: MARKER_ALPHA, cap: "butt" };
    }
    return { color: s.c, alpha: 1, cap: "round" };
  }

  function drawStrokeOn(ctx, s) {
    const p = s.p;
    if (!p || p.length < 4) return;
    const st = strokeStyleFor(s);
    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.strokeStyle = st.color;
    ctx.fillStyle = st.color;
    ctx.lineWidth = lineWidthFor(s);
    ctx.lineCap = st.cap;
    ctx.lineJoin = "round";

    if (s.t === "marker") {
      ctx.globalCompositeOperation = "multiply";
    }

    if (p.length === 4) {
      /* نقطة واحدة => دائرة صغيرة */
      const r = lineWidthFor(s) / 2;
      ctx.beginPath();
      ctx.arc(px(p[0], state.cssW), px(p[1], state.cssH), Math.max(r, 1), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(px(p[0], state.cssW), px(p[1], state.cssH));
      for (let i = 2; i < p.length; i += 2) {
        ctx.lineTo(px(p[i], state.cssW), px(p[i + 1], state.cssH));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function clearCanvas() {
    if (!state.ctx) return;
    state.ctx.setTransform(1, 0, 0, 1, 0, 0);
    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function fullRedraw() {
    if (!state.ctx) return;
    clearCanvas();
    for (let i = 0; i < state.strokes.length; i++) {
      if (state.selectedIdx.indexOf(i) !== -1) continue;
      drawStrokeOn(state.ctx, state.strokes[i]);
    }
    drawSelectionOverlay();
    drawMarquee();
  }

  /* ---------------------------------------------------------- التحديد */

  function strokeBounds(s) {
    const p = s.p;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function rectOfSelection() {
    if (!state.marquee) return null;
    const m = state.marquee;
    return {
      x0: Math.min(m.x0, m.x1),
      y0: Math.min(m.y0, m.y1),
      x1: Math.max(m.x0, m.x1),
      y1: Math.max(m.y0, m.y1),
    };
  }

  function insideRect(b, r) {
    return b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;
  }

  function drawSelectionOverlay() {
    if (!state.selectedIdx.length) return;
    const ctx = state.ctx;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    state.selectedIdx.forEach(function (i) {
      const b = strokeBounds(state.strokes[i]);
      if (b.x0 < x0) x0 = b.x0;
      if (b.y0 < y0) y0 = b.y0;
      if (b.x1 > x1) x1 = b.x1;
      if (b.y1 > y1) y1 = b.y1;
    });
    const pad = 4;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#2563eb";
    ctx.fillStyle = "rgba(37, 99, 235, 0.10)";
    const rx = px(x0, state.cssW) - pad;
    const ry = px(y0, state.cssH) - pad;
    const rw = px(x1 - x0, state.cssW) + pad * 2;
    const rh = px(y1 - y0, state.cssH) + pad * 2;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }

  function drawMarquee() {
    if (!state.marquee) return;
    const ctx = state.ctx;
    const r = rectOfSelection();
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0ea5e9";
    ctx.fillStyle = "rgba(14, 165, 233, 0.12)";
    const rx = px(r.x0, state.cssW);
    const ry = px(r.y0, state.cssH);
    const rw = px(r.x1 - r.x0, state.cssW);
    const rh = px(r.y1 - r.y0, state.cssH);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }

  function applySelection() {
    const r = rectOfSelection();
    if (!r || (r.x1 - r.x0) < 0.01 || (r.y1 - r.y0) < 0.01) {
      state.selectedIdx = [];
    } else {
      const idx = [];
      for (let i = 0; i < state.strokes.length; i++) {
        if (insideRect(strokeBounds(state.strokes[i]), r)) idx.push(i);
      }
      state.selectedIdx = idx;
    }
    state.marquee = null;
    fullRedraw();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    const bar = document.getElementById("inkSelectBar");
    const txt = document.getElementById("inkSelectCount");
    if (!bar) return;
    if (state.selectedIdx.length) {
      bar.hidden = false;
      if (txt) txt.textContent = "تم تحديد " + state.selectedIdx.length + " عنصر";
    } else {
      bar.hidden = true;
    }
  }

  function deleteSelection() {
    if (!state.selectedIdx.length) return;
    snapshot();
    const keep = state.strokes.filter(function (s, i) {
      return state.selectedIdx.indexOf(i) === -1;
    });
    state.strokes = keep;
    state.selectedIdx = [];
    state.marquee = null;
    fullRedraw();
    persist();
    updateSelectionBar();
  }

  function clearSelection() {
    state.selectedIdx = [];
    state.marquee = null;
    fullRedraw();
    updateSelectionBar();
  }

  /* ---------------------------------------------------------- التفاعل */

  function beginStroke(pt) {
    state.curStroke = {
      t: state.tool === "marker" ? "marker" : "pen",
      c: state.color,
      w: rnd(state.size / Math.max(1, state.cssW)),
      p: [rnd(pt.x), rnd(pt.y), rnd(pt.x), rnd(pt.y)],
    };
    state.curMoved = false;
    drawStrokeOn(state.ctx, state.curStroke);
  }

  function extendStroke(pt) {
    const s = state.curStroke;
    if (!s) return;
    const n = s.p.length;
    const lx = s.p[n - 2];
    const ly = s.p[n - 1];
    if (Math.abs(pt.x - lx) < MIN_POINT_GAP && Math.abs(pt.y - ly) < MIN_POINT_GAP) return;

    /* ارسم الجزء الجديد فقط (أسرع بكثير) */
    const ctx = state.ctx;
    const st = strokeStyleFor(s);
    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = lineWidthFor(s);
    ctx.lineCap = st.cap;
    ctx.lineJoin = "round";
    if (s.t === "marker") ctx.globalCompositeOperation = "multiply";
    ctx.beginPath();
    ctx.moveTo(px(lx, state.cssW), px(ly, state.cssH));
    ctx.lineTo(px(pt.x, state.cssW), px(pt.y, state.cssH));
    ctx.stroke();
    ctx.restore();

    s.p.push(rnd(pt.x), rnd(pt.y));
    state.curMoved = true;
  }

  function eraserHit(pt) {
    const r = state.canvas.getBoundingClientRect();
    const rad = (state.size * 2.6) / Math.max(1, r.width);   // نصف قطر الممحاة (نسبة)
    let removed = false;
    for (let i = state.strokes.length - 1; i >= 0; i--) {
      const p = state.strokes[i].p;
      for (let j = 0; j < p.length; j += 2) {
        const dx = p[j] - pt.x;
        const dy = p[j + 1] - pt.y;
        const d = Math.sqrt(dx * dx + dy * dy) * (r.width / r.height > 1.1 ? 1 : 1.1);
        if (d <= rad) {
          state.strokes.splice(i, 1);
          removed = true;
          break;
        }
      }
    }
    if (removed) {
      fullRedraw();
      persist();
    }
  }

  function onPointerDown(e) {
    if (state.tool === "none") return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    state.canvas.setPointerCapture(e.pointerId);
    const pt = norm(e);

    if (state.tool === "pen" || state.tool === "marker") {
      snapshot();
      beginStroke(pt);
      state.drawing = true;
      return;
    }

    if (state.tool === "eraser") {
      snapshot();
      state.drawing = true;
      eraserHit(pt);
      return;
    }

    if (state.tool === "select") {
      /* إذا بدأ السحب داخل التحديد الحالي => نقل */
      if (state.selectedIdx.length && state.marquee === null) {
        const r = rectOfSelectionFromSelection();
        if (r && pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1) {
          snapshot();
          state.moving = true;
          state.moveAnchor = pt;
          state.drawing = true;
          return;
        }
      }
      clearSelection();
      state.marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      state.drawing = true;
    }
  }

  function rectOfSelectionFromSelection() {
    if (!state.selectedIdx.length) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    state.selectedIdx.forEach(function (i) {
      const b = strokeBounds(state.strokes[i]);
      if (b.x0 < x0) x0 = b.x0;
      if (b.y0 < y0) y0 = b.y0;
      if (b.x1 > x1) x1 = b.x1;
      if (b.y1 > y1) y1 = b.y1;
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function onPointerMove(e) {
    if (!state.drawing) return;
    const pt = norm(e);

    if (state.moving) {
      const dx = pt.x - state.moveAnchor.x;
      const dy = pt.y - state.moveAnchor.y;
      state.moveAnchor = pt;
      state.selectedIdx.forEach(function (i) {
        const p = state.strokes[i].p;
        for (let j = 0; j < p.length; j += 2) {
          p[j] = rnd(clamp01(p[j] + dx));
          p[j + 1] = rnd(clamp01(p[j + 1] + dy));
        }
      });
      fullRedraw();
      return;
    }

    if (state.tool === "eraser") {
      eraserHit(pt);
      return;
    }

    if (state.tool === "select") {
      if (state.marquee) {
        state.marquee.x1 = pt.x;
        state.marquee.y1 = pt.y;
        fullRedraw();
      }
      return;
    }

    extendStroke(pt);
  }

  function onPointerUp(e) {
    if (!state.drawing) return;
    state.drawing = false;
    try {
      state.canvas.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (state.moving) {
      state.moving = false;
      state.moveAnchor = null;
      persist();
      updateSelectionBar();
      return;
    }

    if (state.tool === "select") {
      applySelection();
      return;
    }

    if ((state.tool === "pen" || state.tool === "marker") && state.curStroke) {
      if (!state.curMoved) {
        /* نقرة واحدة => نقطة واضحة */
        const s = state.curStroke;
        const minW = 6 / Math.max(1, state.cssW);
        if (s.w < minW) s.w = rnd(minW);
        fullRedraw();
      }
      state.strokes.push(state.curStroke);
      state.curStroke = null;
      persist();
    }
  }

  function onPointerCancel() {
    if (!state.drawing) return;
    state.drawing = false;
    state.moving = false;
    state.curStroke = null;
    state.marquee = null;
    fullRedraw();
  }

  /* ---------------------------------------------------------- الواجهة العامة */

  function setTool(tool) {
    state.tool = tool || "none";
    state.selectedIdx = [];
    state.marquee = null;
    state.curStroke = null;
    state.drawing = false;

    document.querySelectorAll(".ink-tool").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tool") === state.tool);
    });

    const sizeWrap = document.getElementById("inkSizeWrap");
    if (sizeWrap) sizeWrap.hidden = state.tool === "none" || state.tool === "select";

    const colWrap = document.getElementById("inkColors");
    if (colWrap) {
      colWrap.hidden = state.tool === "none" || state.tool === "eraser" || state.tool === "select";
    }

    if (state.canvas) {
      state.canvas.classList.toggle("ink-active", state.tool !== "none");
      state.canvas.classList.toggle("ink-marker", state.tool === "marker");
      state.canvas.classList.toggle("ink-eraser", state.tool === "eraser");
      state.canvas.classList.toggle("ink-select", state.tool === "select");
    }
    fullRedraw();
    updateSelectionBar();
  }

  function setColor(color) {
    state.color = color;
    document.querySelectorAll(".ink-color").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-color") === color);
    });
    if (state.tool !== "pen" && state.tool !== "marker") setTool("pen");
  }

  function setSize(size) {
    state.size = Math.max(1, Math.min(40, parseInt(size, 10) || DEFAULT_SIZE));
    const lbl = document.getElementById("inkSizeLabel");
    if (lbl) lbl.textContent = state.size;
  }

  function clearPage() {
    if (!state.strokes.length) return;
    if (!window.confirm("مسح كل الكتابة في هذه الصفحة؟")) return;
    snapshot();
    state.strokes = [];
    state.selectedIdx = [];
    state.marquee = null;
    fullRedraw();
    persist();
  }

  function clearAll() {
    if (!window.confirm("مسح كل الكتابة في الكتاب كاملًا (جميع الصفحات)؟")) return;
    try {
      localStorage.removeItem(storageKey());
    } catch (e) {}
    state.strokes = [];
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.selectedIdx = [];
    state.marquee = null;
    fullRedraw();
    updateButtons();
    updateSelectionBar();
    notifySaved(true);
  }

  function hasInkOnPage(page) {
    const all = loadAll();
    return !!all[String(page)];
  }

  function makeCanvas(parent) {
    const c = document.createElement("canvas");
    c.className = "ink-canvas";
    parent.appendChild(c);
    return c;
  }

  /* استدعاء بعد رسم كل صفحة (أو بعد تغيير التكبير) */
  function load(box, page, info) {
    state.grade = String((info && info.grade) || "1");
    state.sem = String((info && info.sem) || "1");
    state.book = String((info && info.book) || "");
    state.page = page;
    state.undoStack.length = 0;
    state.redoStack.length = 0;
    state.selectedIdx = [];
    state.marquee = null;
    state.drawing = false;
    state.curStroke = null;

    let canvas = box.querySelector(".ink-canvas");
    if (!canvas) canvas = makeCanvas(box);

    const cssW = box.clientWidth || 1;
    const cssH = box.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");
    state.cssW = cssW;
    state.cssH = cssH;
    state.dpr = dpr;
    state.strokes = loadPage(page);
    state.ready = true;

    if (!canvas.dataset.inkBound) {
      canvas.dataset.inkBound = "1";
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      canvas.addEventListener("contextmenu", function (e) {
        if (state.tool !== "none") e.preventDefault();
      });
      /* منع تمرير الصفحة أثناء الكتابة باللمس */
      canvas.addEventListener(
        "touchstart",
        function (e) {
          if (state.tool !== "none") e.preventDefault();
        },
        { passive: false }
      );
    }

    setTool(state.tool);
    fullRedraw();
    updateButtons();
    updateSelectionBar();

    const badge = document.getElementById("inkPageBadge");
    if (badge) badge.hidden = !hasInkOnPage(page);
  }

  function bindUi() {
    document.querySelectorAll(".ink-tool").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTool(btn.getAttribute("data-tool"));
      });
    });

    document.querySelectorAll(".ink-color").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setColor(btn.getAttribute("data-color"));
      });
    });

    const size = document.getElementById("inkSize");
    if (size) {
      size.addEventListener("input", function () {
        setSize(size.value);
      });
    }

    const undoBtn = document.getElementById("inkUndo");
    const redoBtn = document.getElementById("inkRedo");
    if (undoBtn) undoBtn.addEventListener("click", undo);
    if (redoBtn) redoBtn.addEventListener("click", redo);

    const cp = document.getElementById("inkClearPage");
    const ca = document.getElementById("inkClearAll");
    if (cp) cp.addEventListener("click", clearPage);
    if (ca) ca.addEventListener("click", clearAll);

    const del = document.getElementById("inkDeleteSel");
    const unsel = document.getElementById("inkUnselect");
    if (del) del.addEventListener("click", deleteSelection);
    if (unsel) unsel.addEventListener("click", clearSelection);

    document.addEventListener("keydown", onKeyDown);

    /* حفظ فوري قبل إغلاق الصفحة */
    window.addEventListener("beforeunload", function () {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      writeNow();
    });
  }

  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (ctrl && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k === "b") setTool("none");
    else if (k === "p") setTool("pen");
    else if (k === "h") setTool("marker");
    else if (k === "e") setTool("eraser");
    else if (k === "s") setTool("select");
    else if (e.key === "Escape") clearSelection();
  }

  return {
    load: load,
    bindUi: bindUi,
    setTool: setTool,
    setColor: setColor,
    setSize: setSize,
    undo: undo,
    redo: redo,
    clearPage: clearPage,
    clearAll: clearAll,
    writeNow: writeNow,
    getTool: function () {
      return state.tool;
    },
    hasInkOnPage: hasInkOnPage,
  };
})();