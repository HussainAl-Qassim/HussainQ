#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خادم منصة كتب المرحلة المتوسطة  (النسخة 2)
=========================================================
* يحوّل صفحات أي كتاب PDF إلى صور JPEG لحظيًا عبر مكتبة PyMuPDF
  => الكتب تُفتح داخل الموقع مباشرة (مثل موقع كتبي / حلول)
  => يعمل على جميع المتصفحات (Brave / Chrome / Edge / Firefox)
  => لا يتأثر بحجم ملف PDF الأصلي (حتى 300 ميجابايت)
* يدعم تنزيل ملف الـ PDF الأصلي (HTTP Range Requests)
* يحفظ الصور المولّدة في ذاكرة مؤقتة في الرام (بدون كتابة على القرص)
"""

import os
import re
import io
import sys
import json
import socket
import hashlib
import threading
import socketserver
import webbrowser
import subprocess
import time
from urllib.parse import urlparse, parse_qs
from http.server import SimpleHTTPRequestHandler

try:
    import pymupdf
except ImportError:  # pragma: no cover
    pymupdf = None

try:
    import segno          # توليد رمز QR لمشاركة الموقع (اختياري)
except ImportError:  # pragma: no cover
    segno = None

PORT = 8080
PORT_RANGE = 10           # إذا كان المنفذ مشغولًا نجرب المنافذ التالية تلقائيًا
ACTUAL_PORT = PORT        # يُحدَّد بعد بدء الخادم فعليًا
ROOT = os.path.dirname(os.path.abspath(__file__))
BOOKS_DIR = os.path.join(ROOT, "كتب")
PORT_FILE = os.path.join(ROOT, "server-port.txt")   # يكتب فيه الخادم رقم المنفذ الفعلي
PUBLIC_URL_FILE = os.path.join(ROOT, "public-url.txt")  # يكتبه نفق الإنترنت (الرابط العام)

# ذاكرة مؤقتة في الرام لصور الصفحات (لا نكتب على القرص نهائيًا)
PAGE_CACHE_LIMIT_MB = 120   # أقصى حجم لصور الصفحات في الرام (بالميجابايت)
PAGE_WIDTH = 1300           # عرض الصورة الافتراضي (بكسل)
JPEG_QUALITY = 72
MAX_UPLOAD_MB = 300          # أقصى حجم لملف نسخة محلولة يُرفع من المتصفح

SUBJECT_RE = re.compile(r"^[a-z0-9]{1,20}$")
GRADES = ("1", "2", "3")

# ---------------------------------------------------------------- النسخ المحلولة
# النسخة المحلولة = ملف PDF منفصل يضيفه المستخدم (الحلول ليست منشورة من وزارة
# التعليم، لذا لا تُحمَّل تلقائيًا). نقبل عدة تسميات شائعة حتى يعمل الموقع مع أي
# ملف يضيفه المستخدم، بالإضافة إلى مجلد إسقاط اختياري: كتب/محلولة/gradeX/
SOLVED_DIR_NAME = "محلولة"
SOLVED_NAME_PATTERNS = (
    "%s-%s-solved.pdf",
    "%s-%s-hulul.pdf",
    "%s-%s-hلول.pdf",
    "%s-%s-محلول.pdf",
    "%s-%s-حلول.pdf",
)
SOLVED_KINDS = ("s", "solved", "hulul", "1", "true")
BOOK_RE = re.compile(r"^([a-z0-9]+)-([123])$")   # اسم ملف كتاب أصلي: key-sem

# ---------------------------------------------------------------- ذاكرة المستندات
_doc_lock = threading.Lock()     # حماية قائمة المستندات المفتوحة
_render_lock = threading.Lock()  # PyMuPDF غير آمن مع الخيوط => تسلسل التصوير
_docs = {}
_doc_order = []
MAX_OPEN_DOCS = 3


def solved_candidates(grade, book, sem):
    """كل التسميات المقبولة لملف النسخة المحلولة (بالترتيب)."""
    grade_dir = os.path.join(BOOKS_DIR, "grade%s" % grade)
    paths = [os.path.join(grade_dir, pat % (book, sem)) for pat in SOLVED_NAME_PATTERNS]
    drop_dir = os.path.join(BOOKS_DIR, SOLVED_DIR_NAME, "grade%s" % grade)
    paths.append(os.path.join(drop_dir, "%s-%s.pdf" % (book, sem)))
    paths += [os.path.join(drop_dir, pat % (book, sem)) for pat in SOLVED_NAME_PATTERNS]
    return paths


def find_solved_pdf(grade, book, sem):
    """أول ملف نسخة محلولة موجود فعليًا، وإلا None."""
    for path in solved_candidates(grade, book, sem):
        if os.path.isfile(path):
            return path
    return None


def book_pdf_path(grade, book, sem, kind="book"):
    """مسار ملف الكتاب: الأصلي (kind=book) أو النسخة المحلولة (kind=solved)."""
    if kind == "solved":
        found = find_solved_pdf(grade, book, sem)
        if found:
            return found
        # لا يوجد ملف => نعيد المسار الأساسي لتظهر رسالة خطأ واضحة
        return solved_candidates(grade, book, sem)[0]
    return os.path.join(BOOKS_DIR, "grade%s" % grade, "%s-%s.pdf" % (book, sem))


def solved_available():
    """قائمة المواد التي لها نسخة محلولة فعليًا، لكل صف."""
    found = {}
    for grade in GRADES:
        keys = []
        try:
            names = os.listdir(os.path.join(BOOKS_DIR, "grade%s" % grade))
        except OSError:
            names = []
        for name in names:
            if not name.lower().endswith(".pdf"):
                continue
            match = BOOK_RE.match(name[:-4])
            if not match:
                continue
            book, sem = match.group(1), match.group(2)
            if find_solved_pdf(grade, book, sem):
                keys.append(book)
        found[grade] = sorted(set(keys))
    return found


def solved_count():
    return sum(len(v) for v in solved_available().values())


def lan_ips():
    """جمع عناوين IPv4 الخاصة بالجهاز (للوصول من الجوال وأجهزة الشبكة)."""
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    # طريقة احتياطية موثوقة على ويندوز
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))   # لا يُرسل أي بيانات — لكشف الواجهة النشطة فقط
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith("127.") and ip not in ips:
            ips.insert(0, ip)
    except Exception:
        pass
    return ips


def qr_png_bytes(text, scale=6, border=2):
    """توليد رمز QR كصورة PNG إن كانت مكتبة segno مثبتة، وإلا None."""
    if segno is None:
        return None
    try:
        buf = io.BytesIO()
        segno.make(text, error="M").save(
            buf, kind="png", scale=scale, border=border
        )
        return buf.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------- نفق الإنترنت العام
_cf_alive = {"ts": 0.0, "alive": False}
_CF_CACHE_SEC = 8.0


def cloudflared_running():
    """هل أداة النفق (cloudflared) تعمل الآن؟ نتيجة مخزّنة لثوانٍ قليلة."""
    now = time.time()
    if now - _cf_alive["ts"] < _CF_CACHE_SEC:
        return _cf_alive["alive"]
    alive = False
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq cloudflared.exe", "/NH"],
            capture_output=True, text=True, timeout=3, creationflags=flags,
        )
        alive = "cloudflared.exe" in (out.stdout or "").lower()
    except Exception:
        alive = False
    _cf_alive["ts"] = now
    _cf_alive["alive"] = alive
    return alive


def read_public_url():
    """الرابط العام المؤقت (trycloudflare) إن كانت أداة المشاركة تعمل الآن."""
    try:
        if not os.path.exists(PUBLIC_URL_FILE):
            return None
        if not cloudflared_running():
            return None
        with open(PUBLIC_URL_FILE, "r", encoding="utf-8") as fh:
            url = fh.read().strip()
        if url.startswith("http://") or url.startswith("https://"):
            return url
    except Exception:
        return None
    return None


def get_document(path):
    """فتح مستند PDF والاحتفاظ به في الذاكرة مع إغلاق الأقدم (LRU)."""
    key = os.path.normcase(os.path.abspath(path))
    with _doc_lock:
        doc = _docs.get(key)
        if doc is not None:
            if key in _doc_order:
                _doc_order.remove(key)
            _doc_order.append(key)
            return doc

        while len(_doc_order) >= MAX_OPEN_DOCS:
            old_key = _doc_order.pop(0)
            old_doc = _docs.pop(old_key, None)
            try:
                if old_doc is not None:
                    old_doc.close()
            except Exception:
                pass

        doc = pymupdf.open(path)
        if doc.page_count == 0:
            doc.close()
            raise ValueError("ملف الكتاب تالف أو ناقص (صفر صفحات) — أعد تحميله")
        _docs[key] = doc
        _doc_order.append(key)
        return doc


def forget_document(path):
    """إخراج مستند من الذاكرة (بعد استبدال ملفه على القرص)."""
    key = os.path.normcase(os.path.abspath(path))
    with _doc_lock:
        doc = _docs.pop(key, None)
        if key in _doc_order:
            _doc_order.remove(key)
    if doc is not None:
        try:
            doc.close()
        except Exception:
            pass


def render_page_jpeg(path, page_number, width):
    """تصوير صفحة واحدة إلى JPEG."""
    doc = get_document(path)
    if page_number < 1 or page_number > doc.page_count:
        raise ValueError("رقم الصفحة خارج نطاق الكتاب")
    with _render_lock:
        page = doc.load_page(page_number - 1)
        rect = page.rect
        if rect.width <= 0:
            raise ValueError("أبعاد الصفحة غير صحيحة")
        scale = float(width) / float(rect.width)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
        data = pix.tobytes("jpeg", jpg_quality=JPEG_QUALITY)
        del pix
    return data


# ---------------------------------------------------------------- ذاكرة الصور المؤقتة
# نحفظ صور الصفحات في الرام فقط: أسرع، ولا يستهلك مساحة القرص
_page_cache = {}
_page_order = []
_page_bytes = 0
_page_lock = threading.Lock()


def cache_get(key):
    """جلب صورة من الذاكرة (مع تحديث ترتيب الاستخدام)."""
    with _page_lock:
        data = _page_cache.get(key)
        if data is not None:
            try:
                _page_order.remove(key)
            except ValueError:
                pass
            _page_order.append(key)
        return data


def cache_put(key, data):
    """إضافة صورة إلى الذاكرة مع حذف الأقدم عند تجاوز الحد."""
    global _page_bytes
    limit = PAGE_CACHE_LIMIT_MB * 1024 * 1024
    with _page_lock:
        if key in _page_cache:
            return
        _page_cache[key] = data
        _page_order.append(key)
        _page_bytes += len(data)
        while _page_bytes > limit and _page_order:
            old_key = _page_order.pop(0)
            old_data = _page_cache.pop(old_key, None)
            if old_data is not None:
                _page_bytes -= len(old_data)


def cache_stats():
    with _page_lock:
        return len(_page_cache), _page_bytes


def cache_clear():
    """تفريغ ذاكرة الصور (بعد استبدال ملف كتاب على القرص)."""
    global _page_bytes
    with _page_lock:
        _page_cache.clear()
        del _page_order[:]
        _page_bytes = 0


# ---------------------------------------------------------------- معالج الطلبات
class BooksHandler(SimpleHTTPRequestHandler):
    server_version = "MiddleSchoolBooks/2.0"

    def __init__(self, *args, **kwargs):
        self._has_cache_header = False
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- أدوات مساعدة ------------------------------------------------
    def send_response(self, code, message=None):
        # يُصفَّر مع كل استجابة: الاتصال الواحد قد يخدم عدة طلبات متتالية
        self._has_cache_header = False
        super().send_response(code, message)

    def send_header(self, keyword, value):
        if keyword.lower() == "cache-control":
            self._has_cache_header = True
        super().send_header(keyword, value)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        if not self._has_cache_header:
            # ملفات الواجهة (HTML/CSS/JS) لا ترسل ترويسة كاش خاصة بها،
            # فيطبّق المتصفح تخزينًا تخمينيًا قد يعرض عليه كودًا قديمًا.
            # نجبره على إعادة التحقق دائمًا: مع Last-Modified يعيد
            # الخادم 304 إن لم يتغيّر الملف، فيبقى سريعًا وحديثًا معًا.
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    @staticmethod
    def one(qs, key, default=""):
        values = qs.get(key)
        if not values:
            return default
        return values[0].strip()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def parse_book(self, qs):
        grade = self.one(qs, "g")
        book = self.one(qs, "b").lower()
        sem = self.one(qs, "s")
        kind = "solved" if self.one(qs, "k").lower() in SOLVED_KINDS else "book"
        if grade not in GRADES:
            raise ValueError("رقم الصف غير صحيح")
        if sem not in GRADES:
            raise ValueError("رقم الفصل غير صحيح")
        if not SUBJECT_RE.match(book):
            raise ValueError("اسم المادة غير صحيح")
        path = book_pdf_path(grade, book, sem, kind)
        if not os.path.isfile(path):
            if kind == "solved":
                raise ValueError(
                    "النسخة المحلولة غير مضافة بعد — أضف ملف PDF باسم: %s"
                    % os.path.basename(solved_candidates(grade, book, sem)[0])
                )
            raise ValueError("ملف الكتاب غير موجود: %s-%s.pdf" % (book, sem))
        return {"g": grade, "b": book, "s": sem, "k": kind, "path": path}

    # --- التوجيه -----------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/__"):
            self.handle_api(parsed)
            return
        range_header = self.headers.get("Range")
        if range_header and parsed.path.lower().endswith(".pdf"):
            self.serve_file_with_range(parsed.path, range_header)
            return
        super().do_GET()

    # --- رفع نسخة محلولة من المتصفح ----------------------------------
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.lower() != "/__upload_solved":
            self.send_json({"ok": False, "error": "مسار غير معروف"}, 404)
            return

        qs = parse_qs(parsed.query)
        grade = self.one(qs, "g")
        book = self.one(qs, "b").lower()
        sem = self.one(qs, "s")

        # نفس قواعد التحقق المستخدمة في القراءة
        if grade not in GRADES:
            self.send_json({"ok": False, "error": "رقم الصف غير صحيح"}, 400)
            return
        if sem not in GRADES:
            self.send_json({"ok": False, "error": "رقم الفصل غير صحيح"}, 400)
            return
        if not SUBJECT_RE.match(book):
            self.send_json({"ok": False, "error": "اسم المادة غير صحيح"}, 400)
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json({"ok": False, "error": "لم يتم إرسال أي ملف"}, 400)
            return
        if length > MAX_UPLOAD_MB * 1024 * 1024:
            self.send_json({"ok": False,
                            "error": "الملف أكبر من %d ميجابايت" % MAX_UPLOAD_MB}, 413)
            return

        # نقرأ على دفعات حتى لا نحمّل ملفًا ضخمًا في الذاكرة مرة واحدة
        target = solved_candidates(grade, book, sem)[0]
        tmp = target + ".part"
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            written = 0
            head = b""
            with open(tmp, "wb") as fh:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 256, remaining))
                    if not chunk:
                        break
                    if written < 8:
                        head += chunk[:8 - len(head)]
                    fh.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)

            if written < 1024:
                raise ValueError("الملف صغير جدًا ولا يبدو كتابًا صحيحًا")
            if not head.startswith(b"%PDF"):
                raise ValueError("الملف ليس PDF — اختر ملف PDF صالحًا")

            # على ويندوز: المستند المفتوح في الذاكرة يقفل ملفه ويمنع استبداله،
            # لذا نُخرجه من الذاكرة أولًا لتحرير المقبض ثم نستبدل الملف.
            try:
                forget_document(target)
            except Exception:
                pass

            # نستبدل أي نسخة سابقة، ثم نتأكد أن بايثون قادر على فتحه
            if os.path.isfile(target):
                try:
                    os.remove(target)
                except OSError:
                    # قد يبقى الملف مقفولًا لحظيًا => os.replace يستبدله مباشرة
                    pass
            os.replace(tmp, target)
        except ValueError as exc:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_json({"ok": False, "error": str(exc)}, 400)
            return
        except PermissionError:
            # ويندوز: الملف ما زال مقفولًا من عملية أخرى
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_json({
                "ok": False,
                "error": "الملف مقفول حاليًا — أغلق صفحة هذا الكتاب ثم أعد المحاولة",
            }, 409)
            return
        except Exception as exc:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_json({"ok": False, "error": "تعذر حفظ الملف: %s" % exc}, 500)
            return

        # الملف على القرص تغيّر => نفرّغ أي نسخة قديمة منه في الذاكرة
        forget_document(target)
        cache_clear()

        # التحقق النهائي: نفتح الملف للتأكد من سلامته وعدد صفحاته
        pages = 0
        if pymupdf is not None:
            try:
                doc = get_document(target)
                pages = doc.page_count
            except Exception as exc:
                try:
                    os.remove(target)
                except OSError:
                    pass
                self.send_json({"ok": False,
                                "error": "الملف تالف أو لا يمكن فتحه: %s" % exc}, 400)
                return

        rel = os.path.relpath(target, ROOT).replace("\\", "/")
        self.send_json({"ok": True, "saved": rel, "pages": pages,
                        "total": solved_count()})

    def handle_api(self, parsed):
        qs = parse_qs(parsed.query)
        route = parsed.path.lower()

        if route == "/__ping":
            cached, cached_bytes = cache_stats()
            payload = {"ok": True, "pymupdf": pymupdf is not None,
                            "version": getattr(pymupdf, "__version__", "") if pymupdf else "",
                            "cachedPages": cached,
                            "cachedMB": round(cached_bytes / 1048576.0, 1),
                            "port": ACTUAL_PORT,
                            "hosts": lan_ips(),
                            "qr": segno is not None,
                            "solvedCount": solved_count()}
            public_url = read_public_url()
            if public_url:
                payload["publicUrl"] = public_url
            self.send_json(payload)
            return

        if route == "/__qr":
            # رمز QR لعنوان الموقع (يُستخدم من أجهزة الجوال لفتحه بسرعة)
            url = self.one(qs, "url") or "http://localhost:%d/index.html" % ACTUAL_PORT
            data = qr_png_bytes(url)
            if data is None:
                self.send_json({"ok": False,
                                "error": "مكتبة QR (segno) غير مثبتة — نفّذ: pip install segno"},
                               501)
                return
            try:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if route == "/__solved":
            # أي المواد لها نسخة محلولة مضافة فعليًا (يستخدمه الموقع لإظهار الأزرار)
            available = solved_available()
            self.send_json({
                "ok": True,
                "available": available,
                "total": sum(len(v) for v in available.values()),
                "dropFolder": "كتب/" + SOLVED_DIR_NAME,
                "naming": "%s" % (SOLVED_NAME_PATTERNS[0],),
            })
            return

        if pymupdf is None:
            self.send_json({"ok": False, "error": "مكتبة PyMuPDF غير مثبتة على الجهاز (نفّذ: pip install pymupdf)"}, 500)
            return

        try:
            book = self.parse_book(qs)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if route == "/__info":
            self.api_info(book)
        elif route == "/__page":
            self.api_page(book, qs)
        else:
            self.send_json({"ok": False, "error": "مسار غير معروف"}, 404)

    # --- معلومات الكتاب ----------------------------------------------
    def api_info(self, book):
        try:
            doc = get_document(book["path"])
            rect = doc.load_page(0).rect
            rel_pdf = os.path.relpath(book["path"], ROOT).replace("\\", "/")
            self.send_json({
                "ok": True,
                "pages": doc.page_count,
                "width": round(rect.width, 1),
                "height": round(rect.height, 1),
                "kind": book["k"],
                "pdf": rel_pdf,
            })
        except ValueError as exc:
            # خطأ في البيانات/الطلب (ملف تالف، صفر صفحات) => 400 لا 500
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    # --- صورة صفحة ----------------------------------------------------
    def api_page(self, book, qs):
        try:
            number = int(self.one(qs, "p"))
        except ValueError:
            self.send_json({"ok": False, "error": "رقم الصفحة غير صحيح"}, 400)
            return

        try:
            width = int(self.one(qs, "w") or PAGE_WIDTH)
        except ValueError:
            width = PAGE_WIDTH
        width = max(600, min(2400, width))

        key = hashlib.md5(
            ("%s|%d|%d|%d" % (book["path"], number, width, JPEG_QUALITY)).encode("utf-8")
        ).hexdigest()

        data = cache_get(key)
        if data is None:
            try:
                data = render_page_jpeg(book["path"], number, width)
            except ValueError as exc:
                # رقم صفحة خارج النطاق أو ملف تالف => خطأ من جهة الطلب (400)
                self.send_json({"ok": False, "error": str(exc)}, 400)
                return
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, 500)
                return
            cache_put(key, data)

        try:
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=604800")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # --- تنزيل الـ PDF الأصلي مع دعم Range ----------------------------
    def serve_file_with_range(self, url_path, range_header):
        path = self.translate_path(url_path)
        if not os.path.isfile(path):
            self.send_error(404, "File not found")
            return

        file_size = os.path.getsize(path)
        try:
            unit, rng = range_header.split("=")
            if unit.strip().lower() != "bytes":
                raise ValueError
            start_s, end_s = rng.split("-")
            start = int(start_s) if start_s.strip() else 0
            end = int(end_s) if end_s.strip() else file_size - 1
        except ValueError:
            self.send_error(400, "Bad Range header")
            return

        if start >= file_size or start < 0:
            self.send_error(416, "Range Not Satisfiable")
            return

        end = min(end, file_size - 1)
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, file_size))
        self.send_header("Content-Length", str(length))
        self.end_headers()

        with open(path, "rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(262144, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))
        sys.stdout.flush()


# ---------------------------------------------------------------- التشغيل
def main():
    global ACTUAL_PORT

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True

    line = "=" * 56
    print(line)
    print("  📚 منصة كتب المرحلة المتوسطة")
    print(line)
    print()

    hosts = lan_ips()

    # نبدأ الخادم مع تجربة منافذ بديلة إن كان المنفذ مشغولًا
    httpd = None
    last_error = None
    for offset in range(PORT_RANGE):
        port = PORT + offset
        try:
            httpd = socketserver.ThreadingTCPServer(("0.0.0.0", port), BooksHandler)
            ACTUAL_PORT = port
            break
        except OSError as exc:      # المنفذ مشغول
            last_error = exc
            continue

    if httpd is None:
        print("  [X] تعذر تشغيل الخادم: جميع المنافذ %d-%d مشغولة." % (PORT, PORT + PORT_RANGE - 1))
        print("      أغلق أي برنامج يستخدم هذه المنافذ ثم أعد المحاولة.")
        if last_error:
            print("      التفاصيل: %s" % last_error)
        return

    # نكتب رقم المنفذ الفعلي في ملف ليعرفه أي برنامج آخر (مثل نفق الإنترنت)
    try:
        with open(PORT_FILE, "w", encoding="ascii") as fh:
            fh.write(str(ACTUAL_PORT))
    except Exception:
        pass

    print("  ✅ الموقع يعمل على هذا الجهاز:")
    print("     http://localhost:%d" % ACTUAL_PORT)
    print()
    if hosts:
        print("  📱 من الأجهزة الأخرى على نفس الشبكة (جوال / تابلت / جهاز آخر):")
        for ip in hosts:
            print("     http://%s:%d" % (ip, ACTUAL_PORT))
    else:
        print("  ⚠️  لم يتم اكتشاف عنوان شبكة — تأكد من اتصال الجهاز بالواي فاي.")
    print()
    print("  📖 عرض الكتب داخل الموقع: يعمل")
    if pymupdf is None:
        print()
        print("  ⚠️  تنبيه: مكتبة PyMuPDF غير مثبتة، لن يمكن عرض الكتب داخل الموقع.")
        print("      نفّذ الأمر:  pip install pymupdf")
    else:
        print("  🔧 محرك العرض: PyMuPDF %s" % getattr(pymupdf, "__version__", "?"))
    print()
    print("  (لإيقاف الخادم: اضغط Ctrl+C)")
    print()

    # رمز QR في نافذة الأوامر إن أمكن (لمسحه بالجوال)
    if hosts and segno is not None:
        share_url = "http://%s:%d" % (hosts[0], ACTUAL_PORT)
        try:
            segno.make(share_url, error="M").terminal(border=2)
            print()
            print("  🔳 امسح الرمز أعلاه بجوالك لفتح الموقع")
            print()
        except Exception:
            pass

    # فتح المتصفح على الجهاز نفسه
    try:
        webbrowser.open("http://localhost:%d/index.html" % ACTUAL_PORT)
    except Exception:
        pass

    httpd.daemon_threads = True
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nتم إيقاف الخادم.")
    finally:
        try:
            httpd.server_close()
        except Exception:
            pass
        try:
            if os.path.exists(PORT_FILE):
                os.remove(PORT_FILE)
        except Exception:
            pass


if __name__ == "__main__":
    main()