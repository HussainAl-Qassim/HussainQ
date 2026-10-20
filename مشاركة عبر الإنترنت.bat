@echo off
chcp 65001 >nul
title مشاركة الموقع عبر الإنترنت - منصة كتب المرحلة المتوسطة
cd /d "%~dp0"

echo.
echo ====================================================
echo    مشاركة الموقع عبر الإنترنت (أي جهاز، أي شبكة)
echo ====================================================
echo.
echo  تنشئ هذه الأداة رابطًا عامًا مؤقتًا (https) يمكن فتحه من
echo  أي جهاز وأي شبكة في العالم، حتى بدون واي فاي مشترك.
echo.
echo  كل شيء تلقائي — ما عليك إلا نقرة واحدة:
echo    1) اترك هذه النافذة مفتوحة. الأداة تشغّل الخادم بنفسها إن كان
echo       مطفأً، وتمنع ويندوز من النوم طوال مدة المشاركة.
echo    2) انسخ الرابط (يبدأ بـ https://...trycloudflare.com) وأرسله
echo       للمدرسة، أو امسح رمز QR بالجوال.
echo.
echo  ملاحظات مهمة:
echo    * جهازك هذا يجب أن يبقى شغّالًا ومتصلًا بالإنترنت طوال الوقت،
echo      لأن الكتب تُقرأ من قرصه مباشرة، فلا حاجة لنسخ أي ملف إطلاقًا.
echo    * الرابط يتغيّر في كل مرة تعيد فيها تشغيل هذه الأداة، فأعد إرساله.
echo    * لإيقاف المشاركة: أغلق هذه النافذة فقط.
echo ====================================================
echo.

REM ---- قراءة رقم المنفذ ----
set "PORT=8080"
if exist "server-port.txt" set /p PORT=<server-port.txt
echo [i] المنفذ المستهدف: %PORT%

REM ---- التحقق من خادم الموقع، وتشغيله تلقائيًا إن كان مطفأً ----
python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:%PORT%/__ping',timeout=3)" >nul 2>nul
if not errorlevel 1 goto SERVER_OK

echo [i] الخادم غير مشغّل حاليًا — جاري تشغيله تلقائيًا في نافذة منفصلة...
echo     ستظهر نافذة باسم «خادم الموقع»؛ اتركها مفتوحة.
start "خادم الموقع" cmd /k "تشغيل الموقع.bat"

set /a WAITED=0
:WAIT_SERVER
timeout /t 2 /nobreak >nul
set /a WAITED+=2
python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:%PORT%/__ping',timeout=3)" >nul 2>nul
if not errorlevel 1 goto SERVER_OK
if %WAITED% GEQ 60 goto SERVER_FAILED
echo     ما زال التجهيز جارٍ... ^(%WAITED% ثانية^)
goto WAIT_SERVER

:SERVER_FAILED
echo.
echo [X] تعذر تشغيل الخادم خلال 60 ثانية.
echo     تحقق من نافذة «خادم الموقع» لمعرفة السبب ^(غالبًا بايثون غير مثبّت^).
echo.
pause
exit /b

:SERVER_OK
echo [OK] الخادم يعمل على المنفذ %PORT%.
echo.

REM ---- تجهيز أداة النفق cloudflared ----
set "CF=%~dp0cloudflared.exe"
if not exist "%CF%" (
  echo [i] جاري تنزيل أداة النفق cloudflared لأول مرة...
  echo     قد يستغرق التنزيل دقيقة حسب سرعة الإنترنت.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CF%' -UseBasicParsing"
  if not exist "%CF%" (
    echo [X] تعذر تنزيل cloudflared. تحقق من اتصال الإنترنت ثم أعد المحاولة.
    echo.
    pause
    exit /b
  )
  echo [OK] تم تنزيل cloudflared بنجاح.
)
echo.

REM ---- منع ويندوز من النوم طوال مدة المشاركة ----
del /q "keep-awake.pid" 2>nul
if exist "%~dp0keep-awake.ps1" start "منع النوم" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keep-awake.ps1"
echo [OK] تم منع ويندوز من النوم طوال مدة المشاركة.
echo      ^(يُلغى هذا المنع تلقائيًا عند إغلاق هذه النافذة^)
echo.

REM ---- تنظيف ملف رابط سابق ----
del /q "public-url.txt" 2>nul

echo [i] جاري إنشاء الرابط العام... انتظر عدة ثوانٍ.
echo     سيظهر الرابط أدناه فور جهوزه، ويُفتح رمز QR تلقائيًا في المتصفح،
echo     ويظهر الرابط أيضًا داخل الموقع في قسم «افتح الموقع على جهاز آخر».
echo.
echo ====================================================
echo   نافذة المشاركة — اتركها مفتوحة أثناء المشاركة
echo   لإيقاف المشاركة: أغلق هذه النافذة أو اضغط Ctrl+C
echo ====================================================
echo.

REM ---- تشغيل النفق في الأمامية، وتمرير خرجه إلى PowerShell لاستخراج الرابط فور ظهوره ----
REM  تشغيله في الأمامية يضمن توقف النفق تلقائيًا عند إغلاق هذه النافذة.
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:%PORT% 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "$port='%PORT%'; $found=$false; $input | ForEach-Object { Write-Host $_; if (-not $found) { $m=[regex]::Match($_,'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $found=$true; $u=$m.Value; Set-Content -LiteralPath 'public-url.txt' -Value $u -Encoding ASCII; try { Set-Clipboard $u } catch {}; Write-Host ''; Write-Host '===================================================='; Write-Host '  PUBLIC URL (any device, any network):'; Write-Host ('  ' + $u); Write-Host '===================================================='; Write-Host ''; try { Start-Process ('http://127.0.0.1:' + $port + '/__qr?url=' + [uri]::EscapeDataString($u)) } catch {} } } }"

REM ---- عند انتهاء النفق (إغلاق الأداة أو انقطاعه) ----
REM  إيقاف منع النوم حتى يرجع نظام الطاقة في جهازك لوضعه الطبيعي
set "AWAKEPID="
if exist "keep-awake.pid" set /p AWAKEPID=<keep-awake.pid
if defined AWAKEPID taskkill /PID %AWAKEPID% /F >nul 2>&1
del /q "keep-awake.pid" 2>nul

del /q "public-url.txt" 2>nul
echo.
echo ====================================================
echo   تم إيقاف المشاركة. يمكنك إغلاق هذه النافذة.
echo ====================================================
echo.
pause
