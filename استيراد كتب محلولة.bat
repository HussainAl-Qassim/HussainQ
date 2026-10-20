@echo off
chcp 65001 >nul
REM فرض UTF-8 على خرج بايثون حتى تظهر العربية صحيحة ولا ينهار print
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
title استيراد كتب محلولة - منصة كتب المرحلة المتوسطة
cd /d "%~dp0"

REM التحقق من وجود بايثون
where python >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo [X] خطأ: بايثون غير مثبت على هذا الجهاز.
  echo     الرجاء تثبيت بايثون من https://www.python.org
  echo     وضع علامة على Add Python to PATH أثناء التثبيت.
  echo.
  pause
  exit /b
)

echo.
echo ====================================================
echo    استيراد جماعي للكتب المحلولة
echo ====================================================
echo.
echo  كيف تعمل هذه الأداة:
echo    1) حمّل ملفات PDF المحلولة من أي مصدر تثق به.
echo    2) ضعها كلها في مجلد «مجلد الاستيراد» بجانب هذا الملف.
echo    3) شغّل هذه الأداة — تتعرف على الصف والمادة من اسم الملف
echo       وتنسخها تلقائيًا إلى المكان الصحيح.
echo.
echo  الأداة تنسخ ولا تنقل، فلا تفقد ملفاتك الأصلية.
echo  وتتجاهل أي ملف تالف أو غير PDF.
echo.
echo  ملاحظة: ملفات الكتب لا تُرفع على GitHub أبدًا (مستثناة)،
echo          فتبقى على جهازك فقط.
echo ====================================================
echo.

REM مكتبة فحص صلاحية PDF (PyMuPDF) — تُثبَّت تلقائيًا عند الحاجة
python -c "import pymupdf" >nul 2>nul
if %errorlevel% neq 0 (
  echo [i] جاري تثبيت مكتبة فحص PDF لأول مرة، قد يستغرق دقيقة...
  python -m pip install --quiet pymupdf
  if %errorlevel% neq 0 (
    python -m pip install --quiet --user pymupdf
  )
  echo.
)

python "%~dp0import_solved.py"

echo.
echo ====================================================
echo  انتهت الأداة. إن نجح الاستيراد، حدّث صفحة الموقع
echo  بـ Ctrl+F5 وستظهر أزرار «محلولة» باللون الأخضر.
echo ====================================================
echo.
pause
