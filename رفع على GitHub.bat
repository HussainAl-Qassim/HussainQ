@echo off
chcp 65001 >nul
title رفع المشروع على GitHub - منصة كتب المرحلة المتوسطة
cd /d "%~dp0"

echo.
echo ====================================================
echo    رفع المشروع على GitHub
echo ====================================================
echo.
echo  تُرفع ملفات الكود فقط. الكتب PDF كبيرة ومستثناة،
echo  فلا تُرفع ولا تبطئ العملية.
echo.

REM ---- 01 التحقق من أداة gh ----
where gh >nul 2>nul
if errorlevel 1 goto NO_GH
echo [OK] أداة GitHub CLI موجودة.
goto CHECK_AUTH

:NO_GH
echo [X] أداة GitHub CLI غير مثبتة على هذا الجهاز.
echo     ثبّتها من الرابط التالي ثم أعد تشغيل هذه الأداة:
echo     https://cli.github.com
echo.
pause
exit /b

REM ---- 02 تسجيل الدخول إلى GitHub ----
:CHECK_AUTH
gh auth status >nul 2>nul
if not errorlevel 1 goto AUTH_OK
echo.
echo [i] لم تسجّل الدخول بعد. ستبدأ عملية تسجيل الدخول الآن.
echo     اختر بالترتيب: GitHub.com ثم HTTPS ثم Yes ثم Login with a web browser
echo.
gh auth login
if errorlevel 1 goto AUTH_FAIL

:AUTH_OK
echo [OK] تسجيل الدخول سليم.
echo.

REM ---- 03 حفظ أي تغييرات جديدة ----
git add -A
git diff --cached --quiet
if not errorlevel 1 goto NO_CHANGES
echo [i] توجد تغييرات جديدة. اكتب وصفًا لها ثم اضغط Enter.
set /p MSG= الوصف: 
if "%MSG%"=="" set "MSG=تحديث"
git commit -m "%MSG%"
echo [OK] تم حفظ التغييرات.
goto AFTER_COMMIT

:AUTH_FAIL
echo.
echo [X] فشل تسجيل الدخول إلى GitHub.
echo.
pause
exit /b

:NO_CHANGES
echo [i] لا توجد تغييرات جديدة لحفظها.

:AFTER_COMMIT
echo.

REM ---- 04 فحص وجود مستودع بعيد ----
git remote get-url origin >nul 2>nul
if errorlevel 1 goto CREATE_REPO

echo [i] المستودع البعيد موجود. جاري رفع التحديثات...
echo.
git push
if errorlevel 1 goto PUSH_FAIL
goto DONE

:CREATE_REPO
echo [i] لا يوجد مستودع بعيد بعد، سننشئ واحدًا الآن.
echo.
set /p REPONAME= اسم المستودع على GitHub [saudi-middle-school-books]: 
if "%REPONAME%"=="" set "REPONAME=saudi-middle-school-books"
set /p VIS= النوع public للعام أو private للخاص [public]: 
if "%VIS%"=="" set "VIS=public"
if /i not "%VIS%"=="private" set "VIS=public"
echo.
echo [i] جاري إنشاء المستودع ورفع الملفات. انتظر عدة ثوانٍ.
echo.
gh repo create %REPONAME% --%VIS% --source=. --remote=origin --push
if errorlevel 1 goto CREATE_FAIL
goto DONE

:PUSH_FAIL
echo.
echo [X] فشل الرفع. تأكد من اتصال الإنترنت ثم أعد المحاولة.
echo.
pause
exit /b

:CREATE_FAIL
echo.
echo [X] فشل إنشاء المستودع.
echo     قد يكون الاسم %REPONAME% مستخدمًا مسبقًا في حسابك.
echo     أعد التشغيل واختر اسمًا آخر.
echo.
pause
exit /b

:DONE
echo.
echo ====================================================
echo   تم الرفع بنجاح
echo ====================================================
set "REPOURL="
for /f "delims=" %%u in ('git remote get-url origin') do set "REPOURL=%%u"
set "REPOURL=%REPOURL:.git=%"
echo   %REPOURL%
echo.
echo   ملاحظة: الكتب PDF غير مرفوعة، لأنها كبيرة ومستثناة.
echo.
if defined REPOURL start "" "%REPOURL%"
pause
