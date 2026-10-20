/* ============================================================
   قارئ الكتب — عرض الصفحات كصور (مثل موقع كتبي / حلول)
   الصور تُولّد لحظيًا من الخادم المحلي عبر PyMuPDF
   => يعمل على جميع المتصفحات، ولا يتأثر بحجم ملف الـ PDF
   ============================================================ */

const params = new URLSearchParams(window.location.search);
const bookKey = (params.get("book") || "").trim();
const grade = (params.get("grade") || "1").trim();
const sem = (params.get("sem") || "1").trim();
const bookName = params.get("name") || "الكتاب";

/* نوع النسخة: الكتاب الأصلي، أو النسخة المحلولة (kind=solved) */
const KIND_RAW = (params.get("kind") || params.get("k") || "book").trim().toLowerCase();
const isSolved = ["s", "solved", "hulul", "1", "true"].indexOf(KIND_RAW) !== -1;

const SEM_NAMES = {
  1: "الفصل الدراسي الأول",
  2: "الفصل الدراسي الثاني",
  3: "الفصل الدراسي الثالث",
};

/* المسار الافتراضي — يُحدَّث من الخادم (info.pdf) ليطابق ملف النسخة المحلولة الفعلي */
const PDF_PATH = isSolved
  ? `كتب/grade${grade}/${bookKey}-${sem}-solved.pdf`
  : `كتب/grade${grade}/${bookKey}-${sem}.pdf`;
let pdfPath = PDF_PATH;

const el = {
  title: document.getElementById("readerTitle"),
  badge: document.getElementById("modeBadge"),
  downloadBtn: document.getElementById("downloadBtn"),
  openBtn: document.getElementById("openBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  pageNum: document.getElementById("pageNum"),
  pageCount: document.getElementById("pageCount"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomLevel: document.getElementById("zoomLevel"),
  fitBtn: document.getElementById("fitBtn"),
  loading: document.getElementById("loading"),
  loadingText: documbgent.getElementById("loadingText"),
  container: document.getElementById("pdfContainer"),
  error: document.getElementById("readerError"),
  errorMsg: document.getElementById("errorMsg"),
  errorPath: document.getElementById("errorPath"),
};

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

let totalPages = 0;
let currentPage = 1;
let zoom = 1;
let pageAspect = 1.29;      // نسبة العرض/الارتفاع الافتراضية للصفحة
let currentRenderWidth = 0;
let requestToken = 0;
let placeHolder = null;

/* التنقل بعجلة الفأرة: عتبة التراكم + مهلة تهدئة بعد كل قلب صفحة،
   حتى لا تتخطى اللفّة السريعة (أو زخم لوحة اللمس) عدة صفحات */
const WHEEL_THRESHOLD = 60;
const WHEEL_COOLDOWN_MS = 400;
let wheelAccum = 0;
let wheelLastTurn = 0;
let pointerIsDown = false;

const stateKey = `msp_${grade}_${bookKey}_${sem}${isSolved ? "_solved" : ""}`;

/* ------------------------------ أدوات مساعدة ------------------------------ */

function api(route, extra = "") {
  const kind = isSolved ? "&k=solved" : "";
  return `__${route}?g=${encodeURIComponent(grade)}&b=${encodeURIComponent(bookKey)}&s=${encodeURIComponent(sem)}${kind}${extra}`;
}

function fitWidth() {
  const w = el.container ? el.container.clientWidth - 36 : 900;
  return Math.max(320, Math.min(w, 1600));
}

/* الارتفاع المتاح للصفحة داخل الحاوية (مع خصم الحشو العلوي والسفلي) */
function fitHeight() {
  const h = el.container ? el.container.clientHeight - 36 : 800;
  return Math.max(280, h);
}

/* العرض الظاهر: نُظهر الصفحة كاملة عرضًا وارتفاعًا مثل قارئ الـ PDF،
   فتبقى مقروءة كلها بدون تمرير، ومع التكبير تكبر فيصبح لها تمرير داخلي */
function displayWidth() {
  const widthForFullHeight = fitHeight() / pageAspect;
  return Math.round(Math.min(fitWidth(), widthForFullHeight) * zoom);
}

/* هل الصفحة أطول من الشاشة بعد التكبير؟ عندها فقط نسمح بالتمرير داخلها */
function pageOverflows() {
  const c = el.container;
  return !!c && c.scrollHeight > c.clientHeight + 2;
}

/* العرض الذي نطلب به الصورة من الخادم (يعتمد على الزووم ودقة الشاشة) */
function renderWidth() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const raw = displayWidth() * dpr;
  const clamped = Math.max(700, Math.min(2400, Math.round(raw)));
  /* تقريب لأقرب 100 لتقليل عدد الصور المخزنة مؤقتًا */
  return Math.round(clamped / 100) * 100;
}

function pageUrl(number, width) {
  return api("page", `&p=${number}&w=${width}`);
}

function showLoading(show, text) {
  if (!el.loading) return;
  el.loading.style.display = show ? "flex" : "none";
  if (show && text && el.loadingText) el.loadingText.textContent = text;
}

function showError(message, extra) {
  showLoading(false);
  setBusy(false);
  if (el.container) el.container.innerHTML = "";
  if (el.error) el.error.hidden = false;
  if (el.errorMsg) el.errorMsg.textContent = message;
  if (el.errorPath) {
    if (extra) {
      el.errorPath.textContent = extra;
      el.errorPath.hidden = false;
    } else {
      el.errorPath.hidden = true;
    }
  }
}

function hideError() {
  if (el.error) el.error.hidden = true;
}

/* ربط زرّي «تحميل PDF» و«الأصل» بملف النسخة الحالية (أصلية أو محلولة) */
function applyPdfLinks() {
  const fileName = pdfPath.split("/").pop();
  if (el.downloadBtn) {
    el.downloadBtn.href = encodeURI(pdfPath);
    el.downloadBtn.setAttribute("download", fileName);
  }
  if (el.openBtn) el.openBtn.href = encodeURI(pdfPath);
}

function setTitle() {
  const semText = SEM_NAMES[sem] || "";
  if (isSolved) {
    if (el.title) el.title.textContent = `${bookName} — النسخة المحلولة`;
    if (el.badge) el.badge.textContent = `🧮 محلولة — ${semText}`;
  } else {
    if (el.title) el.title.textContent = `${bookName} — ${semText}`;
    if (el.badge) el.badge.textContent = `📖 ${semText}`;
  }
  document.title = isSolved
    ? `النسخة المحلولة | ${bookName}`
    : `قارئ الكتب | المرحلة المتوسطة`;
}

function updateZoomLabel() {
  if (el.zoomLevel) el.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}

function updatePageIndicator() {
  if (el.pageNum) el.pageNum.value = currentPage;
  if (el.pageCount) el.pageCount.textContent = totalPages;
  if (el.prevBtn) el.prevBtn.disabled = currentPage <= 1;
  if (el.nextBtn) el.nextBtn.disabled = currentPage >= totalPages;
}

function saveProgress() {
  try {
    localStorage.setItem(stateKey, String(currentPage));
  } catch (e) {}
}

function loadProgress() {
  try {
    const v = parseInt(localStorage.getItem(stateKey) || "1", 10);
    return isNaN(v) || v < 1 ? 1 : v;
  } catch (e) {
    return 1;
  }
}

let busyBadge = null;
function setBusy(busy) {
  if (!busyBadge) busyBadge = document.getElementById("busyBadge");
  if (busyBadge) busyBadge.hidden = !busy;
}

/* ------------------------------ عرض الصفحات ------------------------------ */

function preload(number) {
  if (number < 1 || number > totalPages) return;
  const img = new Image();
  img.src = pageUrl(number, renderWidth());
}

function showPage(number, toBottom) {
  if (!totalPages) return;
  const jumpToBottom = !!toBottom;

  number = Math.max(1, Math.min(totalPages, number));
  currentPage = number;
  updatePageIndicator();
  saveProgress();
  hideError();
  setBusy(true);

  const width = renderWidth();
  const token = ++requestToken;

  const img = new Image();
  img.decoding = "async";
  img.alt = "صفحة " + number;
  img.className = "page-img";

  img.onload = function () {
    if (token !== requestToken) return;
    currentRenderWidth = width;

    const box = document.createElement("div");
    box.className = "page-box";
    box.style.width = displayWidth() + "px";
    box.appendChild(img);

    el.container.innerHTML = "";
    el.container.appendChild(box);
    /* صفحة جديدة => ابدأ قياس العجلة من الصفر */
    wheelAccum = 0;
    /* عند الرجوع للخلف نهبط إلى أسفل الصفحة السابقة، فيواصل القارئ
       التمرير لأعلى طبيعيًا، بدل أن يقفز إلى صفحة أقدم فورًا */
    if (jumpToBottom) {
      el.container.scrollTop = el.container.scrollHeight;
      /* إعادة الحساب في الإطار التالي تغطي أي تأخر في حساب الارتفاع */
      window.requestAnimationFrame(function () {
        el.container.scrollTop = el.container.scrollHeight;
      });
    } else {
      el.container.scrollTop = 0;
    }

    /* تحميل طبقة الكتابة والتحديد الخاصة بهذه الصفحة */
    if (typeof Ink !== "undefined") {
      Ink.load(box, number, {
        grade: grade,
        /* فصل كتابة النسخة المحلولة عن الأصلية في التخزين */
        book: isSolved ? bookKey + "-solved" : bookKey,
        sem: sem,
      });
    }

    showLoading(false);
    setBusy(false);

    window.requestAnimationFrame(function () {
      preload(number + 1);
      preload(number - 1);
    });
  };

  img.onerror = function () {
    if (token !== requestToken) return;
    setBusy(false);
    showLoading(false);
    showError(
      "تعذر عرض الصفحة رقم " + number + ".",
      "تأكد أن الخادم يعمل وأن ملف الكتاب سليم."
    );
  };

  img.src = pageUrl(number, width);
}

function goTo(number) {
  if (!totalPages) return;
  const n = Math.max(1, Math.min(totalPages, parseInt(number, 10) || 1));
  showPage(n);
}

function nextPage() {
  /* للأمام: نبدأ من أعلى الصفحة الجديدة */
  if (currentPage < totalPages) showPage(currentPage + 1, false);
}

function prevPage() {
  /* للخلف: نبدأ من أسفل الصفحة السابقة ليكمل القارئ صعودًا */
  if (currentPage > 1) showPage(currentPage - 1, true);
}

function applyZoom(newZoom) {
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  updateZoomLabel();
  /* إن وُجدت كتابة على الصفحة الحالية احفظها قبل إعادة الرسم */
  if (typeof Ink !== "undefined" && Ink.writeNow) Ink.writeNow();
  showPage(currentPage);
}

/* تفعيل أزرار شريط الكتابة (Ink.bindUi) مرة واحدة */
if (typeof Ink !== "undefined" && Ink.bindUi && !window.__inkUiBound) {
  window.__inkUiBound = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Ink.bindUi());
  } else {
    Ink.bindUi();
  }
}

/* ------------------------------ الأحداث ------------------------------ */

if (el.nextBtn) el.nextBtn.addEventListener("click", nextPage);
if (el.prevBtn) el.prevBtn.addEventListener("click", prevPage);
if (el.zoomInBtn) el.zoomInBtn.addEventListener("click", () => applyZoom(zoom + ZOOM_STEP));
if (el.zoomOutBtn) el.zoomOutBtn.addEventListener("click", () => applyZoom(zoom - ZOOM_STEP));
if (el.fitBtn) {
  el.fitBtn.addEventListener("click", () => {
    zoom = 1;
    updateZoomLabel();
    showPage(currentPage);
  });
}

if (el.pageNum) {
  el.pageNum.addEventListener("change", () => goTo(el.pageNum.value));
  el.pageNum.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goTo(el.pageNum.value);
      el.pageNum.blur();
    }
  });
}

if (el.fullscreenBtn) {
  el.fullscreenBtn.addEventListener("click", () => {
    const wrap = document.querySelector(".reader-frame-wrap") || document.documentElement;
    if (!document.fullscreenElement) {
      if (wrap.requestFullscreen) wrap.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });
}

document.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  switch (e.key) {
    case "ArrowLeft":
    case "PageDown":
    case " ":
      e.preventDefault();
      nextPage();
      break;
    case "ArrowRight":
    case "PageUp":
      e.preventDefault();
      prevPage();
      break;
    case "Home":
      goTo(1);
      break;
    case "End":
      goTo(totalPages);
      break;
    case "+":
    case "=":
      applyZoom(zoom + ZOOM_STEP);
      break;
    case "-":
      applyZoom(zoom - ZOOM_STEP);
      break;
  }
});

/* ------------------------- التنقل بعجلة الفأرة ------------------------- */
/* مثل قارئ الـ PDF: الصفحة معروضة كاملة داخل الشاشة، فحركة العجلة
   تنتقل مباشرةً إلى الصفحة التالية أو السابقة بلا تمرير داخلي.
   الاستثناء الوحيد: بعد التكبير تصير الصفحة أطول من الشاشة، فنسمح
   بالتمرير داخلها، وعند بلوغ حدودها ينتقل القارئ للصفحة المجاورة. */

function wheelDelta(e) {
  /* توحيد الوحدة: بعض المتصفحات تعيد أسطرًا أو صفحات لا بكسلات */
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 16;
  else if (e.deltaMode === 2) d *= 400;
  return d;
}

function onWheel(e) {
  if (!totalPages || isLoading) return;
  /* Ctrl/Alt + عجلة = تكبير أو تنقل المتصفح، لا نعتراضه */
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  /* لا نقلب الصفحة أثناء الضغط (رسم/كتابة) حتى لا تضيع الكتابة الجارية */
  if (pointerIsDown) return;

  const c = el.container;
  if (!c) return;

  const delta = wheelDelta(e);
  if (!delta) return;

  const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
  const canScrollDown = c.scrollTop < maxScroll - 2;
  const canScrollUp = c.scrollTop > 2;

  /* الصفحة مكتملة أمام الشاشة => العجلة تقلب الصفحة مباشرةً.
     أما إن طالت عن الشاشة (بعد التكبير) فالتمرير الداخلي له الأولوية. */
  const overflow = pageOverflows();
  if (overflow && delta > 0 && canScrollDown) { wheelAccum = 0; return; }
  if (overflow && delta < 0 && canScrollUp) { wheelAccum = 0; return; }

  /* بلغنا الحد => نراكم المقدار ونقلب الصفحة عند تجاوز العتبة */
  e.preventDefault();

  /* انعكس اتجاه اللفّة => ابدأ القياس من جديد */
  if (wheelAccum !== 0 && Math.sign(wheelAccum) !== Math.sign(delta)) {
    wheelAccum = 0;
  }
  wheelAccum += delta;
  if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;

  const now = Date.now();
  if (now - wheelLastTurn < WHEEL_COOLDOWN_MS) return;

  wheelAccum = 0;
  wheelLastTurn = now;
  if (delta > 0) nextPage();
  else prevPage();
}

if (el.container) {
  /* passive:false ضروري حتى يعمل preventDefault */
  el.container.addEventListener("wheel", onWheel, { passive: false });
  el.container.addEventListener("pointerdown", () => { pointerIsDown = true; });
  window.addEventListener("pointerup", () => { pointerIsDown = false; });
  window.addEventListener("pointercancel", () => { pointerIsDown = false; });
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (totalPages && renderWidth() !== currentRenderWidth) showPage(currentPage);
  }, 320);
});

document.addEventListener("fullscreenchange", () => {
  if (totalPages) showPage(currentPage);
});

/* ------------------------------ التشغيل ------------------------------ */

async function checkServer() {
  try {
    const res = await fetch("__ping", { cache: "no-store" });
    if (!res.ok) throw new Error("bad-status");
    const info = await res.json();
    if (!info.pymupdf) throw new Error("no-pymupdf");
    return true;
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);

    if (window.location.protocol === "file:") {
      showError(
        "الموقع مفتوح مباشرة بدون خادم، ولهذا لا يمكن عرض الكتب.",
        "الحل: أغلق هذه الصفحة ثم افتح ملف «تشغيل الموقع.bat»"
      );
    } else if (msg === "no-pymupdf") {
      showError(
        "مكتبة عرض الكتب (PyMuPDF) غير مثبتة على هذا الجهاز.",
        "افتح نافذة الأوامر ونفّذ:  pip install pymupdf  ثم أعد تشغيل الموقع"
      );
    } else {
      showError(
        "تعذر الاتصال بخادم الموقع.",
        "تأكد من تشغيل الخادم عبر ملف «تشغيل الموقع.bat»"
      );
    }
    return false;
  }
}

async function init() {
  setTitle();
  updateZoomLabel();

  applyPdfLinks();

  if (!bookKey) {
    showError("لم يتم تحديد كتاب.", "");
    return;
  }

  showLoading(true, "جاري تجهيز الكتاب...");

  if (!(await checkServer())) return;

  try {
    const res = await fetch(api("info"), { cache: "no-store" });
    const info = await res.json();
    if (!info.ok) throw new Error(info.error || "خطأ غير معروف");
    totalPages = info.pages;
    if (info.width && info.height) pageAspect = info.height / info.width;
    /* الخادم يعيد المسار الفعلي للملف (تسمية النسخة المحلولة قد تختلف) */
    if (info.pdf) {
      pdfPath = info.pdf;
      applyPdfLinks();
    }
    updatePageIndicator();
    showPage(loadProgress());
  } catch (err) {
    showLoading(false);
    showError("تعذر فتح الكتاب: " + (err.message || err), "المسار: " + pdfPath);
  }
}

init();