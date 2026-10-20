/* ===== منطق الموقع: عرض الكتب، التبويبات، البحث ===== */

let currentGrade = 1;
let searchQuery = "";
let solvedMap = {};      // { "1": ["math", ...], "2": [...], "3": [...] } من الخادم
let solvedTotal = 0;

const booksGrid = document.getElementById("booksGrid");
const noResults = document.getElementById("noResults");
const gradeTabs = document.querySelectorAll(".grade-card[data-grade]");
const searchInput = document.getElementById("searchInput");
const currentGradeTitle = document.getElementById("currentGradeTitle");

const SEM_LABELS = { 1: "الفصل الأول", 2: "الفصل الثاني", 3: "الفصل الثالث" };

/* ===== طريقة فتح الكتب: قارئ الموقع أم ملف الـ PDF الأصلي =====
   يختار المستخدم الطريقة مرة واحدة فنحفظ اختياره في المتصفح:
   "reader" = القارئ الداخلي (عجلة الفأرة، القلم والتظليل، حفظ آخر صفحة)
   "pdf"    = ملف الـ PDF الأصلي في تبويب جديد (عارض المتصفح نفسه) */
const OPEN_MODE_KEY = "msp_open_mode";
let openMode = localStorage.getItem(OPEN_MODE_KEY) === "pdf" ? "pdf" : "reader";

/* مسار ملف الـ PDF الأصلي على الخادم */
function pdfHref(bookKey, sem, isSolved) {
  const suffix = isSolved ? "-solved" : "";
  return encodeURI(`كتب/grade${currentGrade}/${bookKey}-${sem}${suffix}.pdf`);
}

/* رابط فتح الكتاب حسب الطريقة المختارة */
function bookHref(book, sem, isSolved) {
  if (openMode === "pdf") return pdfHref(book.key, sem, isSolved);
  const kind = isSolved ? "&kind=solved" : "";
  return (
    `reader.html?book=${book.key}&grade=${currentGrade}&sem=${sem}${kind}` +
    `&name=${encodeURIComponent(book.name)}`
  );
}

/* ملف PDF يُفتح في تبويب جديد، أما القارئ الداخلي فيبقى في نفس التبويب */
function linkAttrs() {
  return openMode === "pdf" ? ' target="_blank" rel="noopener"' : "";
}

/* وصف طريقة الفتح الحالية في التلميحات */
function openHint() {
  return openMode === "pdf" ? "في ملف PDF" : "داخل الموقع";
}

/* إنشاء بطاقة كتاب */
function createBookCard(book, index) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.style.animationDelay = `${index * 0.05}s`;

  let buttons = "";
  for (let sem = 1; sem <= book.sems; sem++) {
    /* حسب الطريقة المختارة: القارئ الداخلي أو ملف PDF الأصلي */
    const readerUrl = bookHref(book, sem, false);

    buttons += `
      <a class="sem-btn" href="${readerUrl}"${linkAttrs()} title="فتح ${book.name} - ${SEM_LABELS[sem]} ${openHint()}">
        📖 ${SEM_LABELS[sem]}
      </a>
    `;
  }

  /* أزرار النسخة المحلولة: تعمل إن كان ملف الحلول مضافًا، وإلا تشرح طريقة إضافته */
  const solvedHere = solvedMap[currentGrade] || [];
  let solvedButtons = "";
  for (let sem = 1; sem <= book.sems; sem++) {
    if (solvedHere.indexOf(book.key) !== -1) {
      const solvedUrl = bookHref(book, sem, true);
      solvedButtons += `
        <a class="sem-btn sem-btn-solved" href="${solvedUrl}"${linkAttrs()} title="فتح النسخة المحلولة من ${book.name} - ${SEM_LABELS[sem]}">
          🧮 محلولة
        </a>
      `;
    } else {
      solvedButtons += `
        <button type="button" class="sem-btn sem-btn-ghost"
                data-solved-missing="${book.key}" data-solved-sem="${sem}" data-solved-name="${book.name}"
                title="النسخة المحلولة غير مضافة بعد — اضغط لمعرفة طريقة إضافتها">
          🧮 محلولة
        </button>
      `;
    }
  }

  card.innerHTML = `
    <div class="book-header">
      <div class="book-icon">${book.icon}</div>
      <div class="book-info">
        <h3>${book.name}</h3>
        <p>${book.desc}</p>
      </div>
    </div>
    <div class="semester-buttons">${buttons}</div>
    <div class="semester-buttons solved-buttons">${solvedButtons}</div>
  `;

  return card;
}

/* عرض كتب الصف المحدد مع تطبيق البحث */
function renderBooks() {
  const gradeData = BOOKS_DATA[currentGrade];
  if (!gradeData) return;

  currentGradeTitle.textContent = `كتب ${gradeData.gradeName}`;
  booksGrid.innerHTML = "";

  const query = searchQuery.trim().toLowerCase();
  const filtered = gradeData.books.filter((book) => {
    if (!query) return true;
    return (
      book.name.toLowerCase().includes(query) ||
      book.desc.toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) {
    noResults.hidden = false;
  } else {
    noResults.hidden = true;
    filtered.forEach((book, i) => {
      booksGrid.appendChild(createBookCard(book, i));
    });
  }
}

/* تحديث الإحصائيات في قسم الترحيب */
function renderStats() {
  let subjects = 0;
  let files = 0;

  Object.values(BOOKS_DATA).forEach((grade) => {
    subjects += grade.books.length;
    grade.books.forEach((book) => {
      files += book.sems;
    });
  });

  document.getElementById("subjectsCount").textContent = subjects;
  document.getElementById("booksCount").textContent = files;
}

/* أحداث تبويبات الصفوف */
gradeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    gradeTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentGrade = tab.dataset.grade;
    renderBooks();
  });
});

/* زر تبديل طريقة فتح الكتب: القارئ الداخلي أم ملف PDF الأصلي */
const openModeBtn = document.getElementById("openModeBtn");
const openModeLabel = document.getElementById("openModeLabel");

function paintOpenMode() {
  if (!openModeBtn || !openModeLabel) return;
  const isPdf = openMode === "pdf";
  openModeLabel.textContent = isPdf ? "📄 ملف PDF" : "📖 داخل الموقع";
  openModeBtn.title = isPdf
    ? "الآن تفتح الكتب كملفات PDF أصلية — اضغط للرجوع إلى القارئ داخل الموقع"
    : "الآن تفتح الكتب داخل الموقع — اضغط لتفتحها كملفات PDF أصلية";
  openModeBtn.classList.toggle("is-pdf", isPdf);
}

if (openModeBtn) {
  openModeBtn.addEventListener("click", () => {
    openMode = openMode === "pdf" ? "reader" : "pdf";
    localStorage.setItem(OPEN_MODE_KEY, openMode);
    paintOpenMode();
    renderBooks();
  });
  paintOpenMode();
}

/* حدث البحث الفوري */
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderBooks();

  if (searchQuery.trim()) {
    document.getElementById("books").scrollIntoView({ behavior: "smooth" });
  }
});

/* ------------------------------ النسخ المحلولة ------------------------------ */

const solvedModal = document.getElementById("solvedModal");
const solvedDrop = document.getElementById("solvedDrop");
const solvedFileInput = document.getElementById("solvedFile");
const solvedProgress = document.getElementById("solvedProgress");
const solvedProgressBar = document.getElementById("solvedProgressBar");
const solvedProgressText = document.getElementById("solvedProgressText");
const solvedResult = document.getElementById("solvedResult");

let solvedPending = null;      // { key, sem, name } للنسخة الجاري رفعها
let solvedUploading = false;

function openSolvedModal(key, sem, name) {
  if (!solvedModal) return;
  solvedPending = { key: key, sem: sem, name: name };

  const set = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };
  set("solvedModalName", `${name} — ${SEM_LABELS[sem] || ""}`);
  set("solvedModalFile", `${key}-${sem}-solved.pdf`);
  set("solvedModalFolder", `كتب/grade${currentGrade}`);
  set("solvedDropTarget", `سيُحفظ باسم: ${key}-${sem}-solved.pdf`);

  if (solvedProgress) solvedProgress.hidden = true;
  if (solvedProgressBar) solvedProgressBar.style.width = "0%";
  if (solvedResult) solvedResult.hidden = true;
  if (solvedFileInput) solvedFileInput.value = "";
  if (solvedDrop) solvedDrop.classList.remove("dragover");

  solvedModal.hidden = false;
}

function closeSolvedModal() {
  if (solvedUploading) return;      // لا نغلق أثناء الرفع
  if (solvedModal) solvedModal.hidden = true;
}

function showSolvedResult(text, ok) {
  if (!solvedResult) return;
  solvedResult.textContent = text;
  solvedResult.className = "solved-result " + (ok ? "ok" : "err");
  solvedResult.hidden = false;
}

function solvedReaderUrl(p) {
  return `reader.html?book=${p.key}&grade=${currentGrade}&sem=${p.sem}` +
         `&kind=solved&name=${encodeURIComponent(p.name)}`;
}

/* بعد نجاح الرفع: نحدّث الخريطة والأزرار دون إعادة تحميل الصفحة */
function markSolvedAdded(p, pages) {
  const list = solvedMap[currentGrade] || [];
  if (list.indexOf(p.key) === -1) list.push(p.key);
  solvedMap[currentGrade] = list;
  solvedTotal += 1;

  const counter = document.getElementById("solvedCount");
  if (counter) counter.textContent = solvedTotal;
  const note = document.getElementById("solvedNote");
  if (note) {
    note.textContent = `🧮 متوفر حاليًا ${solvedTotal} نسخة محلولة — أزرار «محلولة» الذهبية في البطاقات.`;
  }

  if (solvedResult) {
    const a = document.createElement("a");
    a.className = "solved-open-btn";
    a.textContent = "📖 فتح النسخة المحلولة";
    a.href = solvedReaderUrl(p);
    solvedResult.appendChild(document.createElement("br"));
    solvedResult.appendChild(a);
  }
  renderBooks();
}
/* رفع ملف الحلول إلى الخادم مع إظهار نسبة التقدم */
function uploadSolved(file) {
  if (!solvedPending || solvedUploading) return;

  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showSolvedResult("الملف ليس PDF — اختر ملف PDF صالحًا.", false);
    return;
  }

  solvedUploading = true;
  if (solvedProgress) solvedProgress.hidden = false;
  if (solvedProgressBar) solvedProgressBar.style.width = "4%";
  if (solvedProgressText) solvedProgressText.textContent = "جاري الرفع...";
  if (solvedResult) solvedResult.hidden = true;

  const p = solvedPending;
  const url = `__upload_solved?g=${encodeURIComponent(currentGrade)}` +
              `&b=${encodeURIComponent(p.key)}&s=${encodeURIComponent(p.sem)}`;

  /* XHR بدل fetch لأنه يعطينا حدث تقدم الرفع */
  const xhr = new XMLHttpRequest();
  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/pdf");

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 92);
    if (solvedProgressBar) solvedProgressBar.style.width = Math.max(4, pct) + "%";
    if (solvedProgressText) {
      solvedProgressText.textContent =
        `جاري الرفع... ${Math.round((e.loaded / e.total) * 100)}%`;
    }
  };

  xhr.onload = () => {
    solvedUploading = false;
    if (solvedProgressBar) solvedProgressBar.style.width = "100%";

    let data = {};
    try { data = JSON.parse(xhr.responseText || "{}"); } catch (e) {}

    if (xhr.status === 200 && data.ok) {
      if (solvedProgressText) solvedProgressText.textContent = "تم الرفع ✓";
      showSolvedResult(
        `✅ تم إضافة النسخة المحلولة (${data.pages || "?"} صفحة).`, true
      );
      markSolvedAdded(p, data.pages);
    } else {
      if (solvedProgressText) solvedProgressText.textContent = "فشل الرفع";
      showSolvedResult(
        "❌ " + (data.error || "تعذر رفع الملف (رمز " + xhr.status + ")"), false
      );
    }
  };

  xhr.onerror = () => {
    solvedUploading = false;
    if (solvedProgressText) solvedProgressText.textContent = "فشل الرفع";
    showSolvedResult(
      "❌ تعذر الاتصال بالخادم. تأكد أن «تشغيل الموقع.bat» ما زال يعمل.", false
    );
  };

  xhr.send(file);
}

/* منطقة السحب والإفلات داخل النافذة */
if (solvedDrop) {
  solvedDrop.addEventListener("click", () => {
    if (!solvedUploading && solvedFileInput) solvedFileInput.click();
  });

  ["dragenter", "dragover"].forEach((ev) => {
    solvedDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      solvedDrop.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((ev) => {
    solvedDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      solvedDrop.classList.remove("dragover");
    });
  });

  solvedDrop.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) uploadSolved(files[0]);
  });
}

if (solvedFileInput) {
  solvedFileInput.addEventListener("change", () => {
    if (solvedFileInput.files && solvedFileInput.files.length) {
      uploadSolved(solvedFileInput.files[0]);
    }
  });
}



/* تفويض الأحداث: البطاقات تُعاد إنشاؤها عند كل بحث أو تغيير صف */
booksGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-solved-missing]");
  if (!btn) return;
  openSolvedModal(btn.dataset.solvedMissing, btn.dataset.solvedSem, btn.dataset.solvedName);
});

if (solvedModal) {
  solvedModal.addEventListener("click", (e) => {
    if (e.target === solvedModal || e.target.closest("[data-close-solved]")) closeSolvedModal();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSolvedModal();
});

/* جلب قائمة النسخ المحلولة الموجودة فعليًا من الخادم */
async function loadSolved() {
  if (window.location.protocol === "file:") return;
  try {
    const res = await fetch("__solved", { cache: "no-store" });
    const data = await res.json();
    if (!data || !data.ok) return;
    solvedMap = data.available || {};
    solvedTotal = data.total || 0;

    const counter = document.getElementById("solvedCount");
    if (counter) counter.textContent = solvedTotal;

    const note = document.getElementById("solvedNote");
    if (note) {
      note.textContent = solvedTotal > 0
        ? `🧮 متوفر حاليًا ${solvedTotal} نسخة محلولة — أزرار «محلولة» الخضراء في البطاقات.`
        : "🧮 النسخ المحلولة: أضف ملفات الحلول لتعمل أزرار «محلولة» في كل بطاقة (اضغط أي زر رمادي للتفاصيل).";
    }
    renderBooks();
  } catch (e) {
    /* الخادم متوقف — تبقى الأزرار في وضع «غير مضافة» */
  }
}

/* التشغيل الأول */
renderStats();
renderBooks();
loadSolved();