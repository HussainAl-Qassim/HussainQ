@echo off
chcp 65001 >nul
title منصة كتب المرحلة المتوسطة
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
echo ================================================
echo    منصة كتب المرحلة المتوسطة
echo ================================================
echo.

REM التحقق من مكتبة عرض الكتب (PyMuPDF) وتثبيتها تلقائيًا عند الحاجة
python -c "import pymupdf" >nul 2>nul
if %errorlevel% neq 0 (
  echo [i] جاري تثبيت مكتبة عرض الكتب لأول مرة، قد يستغرق دقيقة...
  python -m pip install --quiet pymupdf
  if %errorlevel% neq 0 (
    python -m pip install --quiet --user pymupdf
  )
  echo [OK] تم تثبيت المكتبة.
  echo.
)

REM مكتبة رمز QR (اختيارية — لمسح الرمز بالجوال)
python -c "import segno" >nul 2>nul
if %errorlevel% neq 0 (
  python -m pip install --quiet segno >nul 2>nul
  if %errorlevel% neq 0 (
    python -m pip install --quiet --user segno >nul 2>nul
  )
)

echo [OK] جاري تشغيل الموقع...
echo.
echo    سيفتح المتصفح تلقائيًا، وستظهر عناوين الأجهزة الأخرى
echo    في النافذة أدناه (الجوال والتابلت على نفس الشبكة).
echo.
echo    لإغلاق الموقع: اضغط Ctrl+C في هذه النافذة
echo.
echo ================================================
echo.

REM تشغيل الخادم (الخادم يفتح المتصفح نفسه ويعرض عناوين الشبكة)
python "%~dp0server.py"
pause