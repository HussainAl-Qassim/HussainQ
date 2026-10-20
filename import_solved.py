# -*- coding: utf-8 -*-
""" ============================================================
    استيراد جماعي للكتب المحلولة
    ------------------------------------------------------------
    ضع ملفات PDF المحلولة التي حمّلتها في مجلد «مجلد الاستيراد»،
    ثم شغّل «استيراد كتب محلولة.bat».

    الأداة:
      1) تقرأ اسم كل ملف (عربي أو إنجليزي)
      2) تستخرج الصف + المادة + الفصل الدراسي
      3) تتحقق أن الملف PDF صالح (%PDF + عدد صفحات > 0)
      4) تنسخه إلى  كتب/gradeN/<key>-<sem>-solved.pdf
      5) تطبع تقريرًا: ما نجح، وما لم يُتعرف عليه

    ملاحظة: النسخ لا النقل — ملفاتك الأصلية تبقى كما هي.
    ============================================================ """
import os
import re
import shutil
import sys
import time

# طرفية ويندوز قد تكون بترميز cp1252 الذي لا يحتمل العربية،
# فنفرق UTF-8 على الخرج حتى لا ينهار print عند أول كلمة عربية.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
INBOX = os.path.join(HERE, "مجلد الاستيراد")
KUTUB = os.path.join(HERE, "كتب")

# المفاتيح الرسمية لكل صف (مطابقة لـ js/data.js)
GRADE_KEYS = {
    1: ["lughati", "math", "science", "islamic", "social",
        "english", "digital", "lifeskills", "pe"],
    2: ["lughati", "math", "science", "islamic", "social",
        "english", "digital", "lifeskills", "art", "pe"],
    3: ["lughati", "math", "science", "islamic", "social",
        "english", "digital", "lifeskills", "art", "critical", "pe"],
}

# خرائط التعرف على المادة (الترتيب مهم: الأدق أولًا)
SUBJECT_MAP = [
    ("lifeskills", ["حياتيه", "حياتية", "أسرية", "اسرية", "lifeskills"]),
    ("critical",   ["تفكير", "ناقد", "critical"]),
    ("islamic",    ["إسلامية", "اسلامية", "توحيد", "فقه",
                    "حديث", "تفسير", "islamic"]),
    ("social",     ["اجتماعيات", "اجتماعية", "تاريخ",
                    "جغرافيا", "social"]),
    ("english",    ["إنجليزي", "انجليزي", "super goal", "english"]),
    ("digital",    ["رقمية", "رقميه", "حاسب", "تقنية", "digital"]),
    ("lughati",    ["لغتي", "لغتى", "عربية", "lughati"]),
    ("science",    ["علوم", "science"]),
    ("math",       ["رياضيات", "math"]),
    ("art",        ["فنية", "فنيه", "فنون", "art"]),
    # البدنية آخرًا حتى لا تبتلع «رياضيات»
    ("pe",         ["بدنية", "بدنيه", "دفاع عن النفس", "pe"]),
]

GRADE_PATTERNS = [
    (1, ["أول متوسط", "اول متوسط", "أولى متوسط", "الاول متوسط",
         "1 متوسط", "١ متوسط"]),
    (2, ["ثاني متوسط", "ثانى متوسط", "ثانية متوسط", "الثاني متوسط",
         "2 متوسط", "٢ متوسط"]),
    (3, ["ثالث متوسط", "ثالثة متوسط", "الثالث متوسط",
         "3 متوسط", "٣ متوسط"]),
]

SEM_PATTERNS = [
    (3, ["ف3", "ف 3", "الفصل الثالث", "third"]),
    (2, ["ف2", "ف 2", "الفصل الثاني", "الفصل الثانى", "second"]),
    (1, ["ف1", "ف 1", "الفصل الأول", "الفصل الاول", "first"]),
]

def norm(s):
    """توحيد النص: إزالة التشكيل وتوحيد الألف/الياء/التاء المربوطة."""
    s = s.lower()
    s = re.sub(r"[\u064b-\u0652\u0670]", "", s)      # تشكيل
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = re.sub(r"[_\-.]+", " ", s)
    return s


def detect_grade(name):
    n = norm(name)
    for g, pats in GRADE_PATTERNS:
        for p in pats:
            if norm(p) in n:
                return g
    return None


def detect_subject(name, grade):
    n = norm(name)
    allowed = GRADE_KEYS.get(grade, [])
    for key, pats in SUBJECT_MAP:
        for p in pats:
            if norm(p) in n:
                if not allowed or key in allowed:
                    return key
                return None
    return None


def detect_sem(name):
    n = norm(name)
    for s, pats in SEM_PATTERNS:
        for p in pats:
            if norm(p) in n:
                return s
    return 1  # كل كتب المشروع sems=1


def validate_pdf(path):
    """يتحقق أن الملف PDF صالح ويعيد (عدد الصفحات، سبب الخطأ)."""
    try:
        with open(path, "rb") as fh:
            if fh.read(5) != b"%PDF-":
                return None, "ليس PDF (لا يبدأ بـ %PDF)"
    except Exception as e:
        return None, "تعذّرت القراءة: %r" % e
    try:
        try:
            import pymupdf
        except ImportError:      # إصدارات أقدم تسمّيه fitz
            import fitz as pymupdf
        doc = pymupdf.open(path)
        pages = doc.page_count
        doc.close()
        if pages <= 0:
            return None, "عدد الصفحات صفر"
        return pages, None
    except Exception as e:
        return None, "PDF تالف أو غير مقروء: %r" % e


def conventional(name):
    """هل الاسم مطابق أصلاً لـ key-sem[-solved].pdf ؟"""
    return re.match(r"^([a-z]+)-([123])(?:-solved)?\.pdf$", name, re.I)


def main():
    print("=" * 62)
    print("  استيراد جماعي للكتب المحلولة")
    print("=" * 62)

    if not os.path.isdir(INBOX):
        os.makedirs(INBOX)
        print("\n[!] أنشأتُ لك مجلد الاستيراد لأول مرة:")
        print("    %s" % INBOX)
        print("\nضع فيه ملفات PDF المحلولة ثم أعد تشغيل الأداة.")
        return 0

    files = [f for f in sorted(os.listdir(INBOX)) if f.lower().endswith(".pdf")]
    if not files:
        print("\n[!] مجلد الاستيراد فارغ — لا ملفات PDF.")
        print("    %s" % INBOX)
        return 0

    print("\nوجدتُ %d ملف PDF في مجلد الاستيراد.\n" % len(files))

    ok, skipped, unknown = [], [], []

    for name in files:
        src = os.path.join(INBOX, name)

        # 1) التحقق من صلاحية الملف أولًا
        pages, err = validate_pdf(src)
        if err:
            skipped.append((name, err))
            print("[تخطي] %s\n        السبب: %s" % (name, err))
            continue

        # 2) تحديد الهدف: اسم مطابق أم اسم عربي يُحلَّل
        conv = conventional(name)
        if conv:
            key, sem = conv.group(1).lower(), int(conv.group(2))
            grade = next((g for g in (1, 2, 3) if key in GRADE_KEYS[g]), None)
            if grade is None:
                skipped.append((name, "مفتاح غير معروف: %s" % key))
                print("[تخطي] %s\n        السبب: مفتاح غير معروف" % name)
                continue
        else:
            grade = detect_grade(name)
            key = detect_subject(name, grade) if grade else None
            sem = detect_sem(name)
            if not grade or not key:
                unknown.append(name)
                what = "الصف والمادة" if not grade else "المادة"
                print("[؟]    %s  (%d صفحة)\n        لم أتعرف على %s"
                      % (name, pages, what))
                continue

        # 3) النسخ إلى المكان الصحيح (مع إعادة محاولة إن كان الهدف مقفلًا)
        gdir = os.path.join(KUTUB, "grade%d" % grade)
        os.makedirs(gdir, exist_ok=True)
        target = os.path.join(gdir, "%s-%d-solved.pdf" % (key, sem))

        done = False
        for attempt in range(4):
            try:
                shutil.copy2(src, target)
                done = True
                break
            except PermissionError:
                time.sleep(1.0)
            except Exception as e:
                skipped.append((name, repr(e)))
                print("[تخطي] %s\n        السبب: %r" % (name, e))
                break

        if done:
            ok.append((name, grade, key, sem, pages))
            print("[OK]   %s\n        -> كتب/grade%d/%s-%d-solved.pdf "
                  "(%d صفحة)" % (name, grade, key, sem, pages))
        elif not skipped or skipped[-1][0] != name:
            skipped.append((name, "الملف الهدف مقفل"))
            print("[تخطي] %s\n        السبب: الهدف مقفل "
                  "(أغلق صفحة القارئ ثم أعد المحاولة)" % name)

    # ------------------------------------------------------------
    # التقرير النهائي
    # ------------------------------------------------------------
    print("\n" + "=" * 62)
    print("  التقرير")
    print("=" * 62)
    print("نجح الاستيراد  : %d" % len(ok))
    print("تُخُطّي         : %d" % len(skipped))
    print("لم يُتعرف عليه  : %d" % len(unknown))

    if unknown:
        print("\n--- ملفات لم أتعرف عليها: سمِّها يدويًا ثم أعد التشغيل ---")
        print("الصيغة:  <key>-<sem>-solved.pdf")
        print("مثال:    math-1-solved.pdf   (رياضيات أول متوسط)")
        print("\nالمفاتيح المتاحة:")
        for g in (1, 2, 3):
            print("  الصف %d: %s" % (g, ", ".join(GRADE_KEYS[g])))
        print("\nملفاتك غير المعروفة:")
        for nm in unknown:
            print("  - %s" % nm)

    if ok:
        print("\n[OK] حدّث صفحة الموقع (Ctrl+F5) وستظهر أزرار «محلولة» "
              "باللون الأخضر.")

    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n[خطأ غير متوقع] %r" % e)
    try:
        input("\nاضغط Enter للإغلاق...")
    except Exception:
        pass
