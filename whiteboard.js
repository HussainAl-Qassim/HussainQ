/* ===== منطق السبورة التفاعلية =====
   أدوات: قلم، تظليل، خط مستقيم، ممحاة
   مزايا: ألوان، سمك الخط، تراجع/إعادة، حفظ PNG، دعم اللمس
*/

(function () {
  "use strict";

  const canvas = document.getElementById("whiteboard");
  const ctx = canvas.getContext("2d");
  const wbHint = document.getElementById("wbHint");

  /* حالة الأداة */
  let tool = "pen";
  let color = "#111827";
  let strokeWidth = 4;
  let isDrawing = false;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;

  /* سجل التراجع */
  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 30;

  /* صورة أساس معاينة أداة الخط المستقيم (لمنع الوميض) */
  let lineBaseImg = null;
  let lineBaseSrc = null;

  /* ضبط حجم الكانفس مع الدقة (retina-aware) */
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();

    /* احفظ الحالة الحالية كصورة قبل تغيير الأبعاد (تغيير width يمسح الكانفس) */
    const keep = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    /* إعادة ضبط التحويل من الصفر ثم تطبيق الدقة (منع تراكم التكبير) */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    /* إعادة رسم الحالة الحالية */
    if (keep) {
      const img = new Image();
      img.onload = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = keep;
    } else {
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
  }

  /* حفظ لقطة للتراجع: تُؤخذ من الحالة الحالية قبل بدء ضربة جديدة */
  function snapshotNow() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.width / dpr));
    const h = Math.max(1, Math.floor(canvas.height / dpr));
    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");
    tctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
    return temp.toDataURL("image/png");
  }

  function pushState() {
    undoStack.push(snapshotNow());
    if (undoStack.length > MAX_UNDO + 1) undoStack.shift();
    redoStack = [];
    updateHint();
    updateUndoRedo();
  }

  function updateUndoRedo() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    /* زر التراجع متاح فقط إذا كان هناك أكثر من لقطة الأساس */
    if (undoBtn) undoBtn.disabled = undoStack.length <= 1;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  /* إعادة رسم من DataURL */
  function restoreSnapshot(snapshot) {
    const img = new Image();
    img.onload = () => {
      const wrap = canvas.parentElement;
      const rect = wrap.getBoundingClientRect();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      /* أعد تطبيق الدقة بعد المسح ثم ارسم */
      const dprNow = window.devicePixelRatio || 1;
      ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = snapshot;
  }

  /* إحداثيات الموقع (نسبة إلى الكانفس) */
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  /* إعداد نمط الريشة */
  function setupBrush() {
    if (tool === "marker") {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = strokeWidth * 2.5;
    } else if (tool === "eraser") {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = strokeWidth * 5;
    } else {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = strokeWidth;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
  }

  /* بدء الرسم */
  function startDraw(e) {
    e.preventDefault();
    /* لقطة الأساس للتراجع تؤخذ عند بدء كل ضربة (قبل الرسم) */
    if (tool === "line") {
      lineBaseImg = null;
      lineBaseSrc = null;
      if (undoStack.length > 0) {
        lineBaseSrc = undoStack[undoStack.length - 1];
        lineBaseImg = new Image();
        lineBaseImg.src = lineBaseSrc;
      }
    } else {
      pushState();
    }
    const pos = getPos(e);
    isDrawing = true;
    startX = pos.x;
    startY = pos.y;
    lastX = pos.x;
    lastY = pos.y;

    if (tool === "pen" || tool === "marker" || tool === "eraser") {
      setupBrush();
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }
    updateHint();
  }

  /* أثناء الرسم */
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);

    if (tool === "line") {
      /* إعادة رسم مؤقتة للخط: ارسم اللقطة فورًا (متزامن) ثم الخط فوقها
         لأن restoreSnapshot غير متزامن (Image.onload) ويسبب وميضًا */
      const snapshot = undoStack[undoStack.length - 1];
      if (snapshot && lineBaseImg && lineBaseSrc === snapshot) {
        const wrap = canvas.parentElement;
        const rect = wrap.getBoundingClientRect();
        const dprNow = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0);
        ctx.drawImage(lineBaseImg, 0, 0, rect.width, rect.height);
      } else if (snapshot) {
        restoreSnapshot(snapshot);
      } else {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      setupBrush();
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      return;
    }

    setupBrush();
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastX = pos.x;
    lastY = pos.y;
  }

  /* إنهاء الرسم */
  function endDraw(e) {
    if (!isDrawing) return;
    isDrawing = false;
    pushState();
  }
/* الأحداث */
  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", endDraw);

  /* دعم اللمس */
  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", endDraw);
  canvas.addEventListener("touchcancel", endDraw);

  /* اختيار الأداة */
  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      tool = btn.dataset.tool;
      canvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
    });
  });

  /* اختيار اللون */
  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".color-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      color = btn.dataset.color;
      /* التبديل إلى القلم عند اختيار لون */
      if (tool === "eraser") {
        tool = "pen";
        document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => b.classList.remove("active"));
        document.querySelector(".tool-btn[data-tool='pen']").classList.add("active");
      }
    });
  });

  /* سمك الخط */
  const strokeInput = document.getElementById("strokeWidth");
  const strokeVal = document.getElementById("strokeVal");
  strokeInput.addEventListener("input", () => {
    strokeWidth = parseInt(strokeInput.value, 10);
    strokeVal.textContent = strokeWidth;
  });

  /* تراجع */
  document.getElementById("undoBtn").addEventListener("click", () => {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    restoreSnapshot(undoStack[undoStack.length - 1]);
    updateHint();
    updateUndoRedo();
  });

  /* إعادة */
  document.getElementById("redoBtn").addEventListener("click", () => {
    if (redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    undoStack.push(snapshot);
    restoreSnapshot(snapshot);
    updateHint();
    updateUndoRedo();
  });

  /* مسح الكل */
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!hasContent()) return;
    if (!confirm("مسح كل ما على السبورة؟")) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dprNow = window.devicePixelRatio || 1;
    ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0);
    /* بعد المسح: أعد الضبط للقطة أساس فارغة واحدة */
    undoStack = [snapshotNow()];
    redoStack = [];
    lineBaseImg = null;
    lineBaseSrc = null;
    updateHint();
    updateUndoRedo();
  });

  /* حفظ كصورة */
  document.getElementById("saveBtn").addEventListener("click", () => {
    /* دمج مع خلفية بيضاء */
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = rect.width;
    tempCanvas.height = rect.height;
    const tctx = tempCanvas.getContext("2d");
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);

    const a = document.createElement("a");
    const date = new Date();
    const stamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}-${date.getHours().toString().padStart(2, "0")}${date.getMinutes().toString().padStart(2, "0")}`;
    a.download = `سبورة-${stamp}.png`;
    a.href = tempCanvas.toDataURL("image/png");
    a.click();
  });

  /* تحديث التلميح */
  function hasContent() {
    /* فارغ = لقطة أساس واحدة فقط ولا يوجد redo */
    return !(undoStack.length <= 1 && redoStack.length === 0);
  }

  function updateHint() {
    wbHint.classList.toggle("hidden", hasContent());
  }

  /* مفتاح الاختصار: Ctrl+Z */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        document.getElementById("redoBtn").click();
      } else {
        document.getElementById("undoBtn").click();
      }
    }
  });

  /* التهيئة */
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  /* لقطة أساس فارغة حتى يعمل التراجع/إعادة بشكل صحيح */
  undoStack = [snapshotNow()];
  redoStack = [];
  updateHint();
  updateUndoRedo();
})();