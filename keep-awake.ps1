# ============================================================
#  منع ويندوز من النوم أثناء مشاركة الموقع
# ============================================================
#  يستخدم SetThreadExecutionState من ويندوز، وهو منع "مؤقت ومرتبطة
#  بهذه العملية فقط": بمجرد إغلاق هذه النافذة (أو موت العملية) يرجع
#  نظام الطاقة لوضعه الطبيعي تلقائيًا. لا يغيّر أي إعداد في جهازك.
#
#  تُشغَّل هذه الأداة تلقائيًا من «مشاركة عبر الإنترنت.bat».
# ============================================================

$definition = @'
using System;
using System.Runtime.InteropServices;

public static class PowerState {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
'@

try {
    Add-Type -TypeDefinition $definition -ErrorAction Stop
} catch {
    # إذا تعذر تحميل النوع (نظام قديم مثلًا) نخرج بهدوء بدون إزعاج المستخدم
    exit 0
}

$ES_CONTINUOUS       = [uint32]0x80000000
$ES_SYSTEM_REQUIRED  = [uint32]0x00000001

# منع نوم النظام مع إبقاء الشاشة كما هي (لا نمنع إطفاء الشاشة، فقط النوم)
[void][PowerState]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

# نكتب رقم هذه العملية حتى تستطيع أداة المشاركة إيقافها عند الإغلاق
try {
    $pidFile = Join-Path $PSScriptRoot "keep-awake.pid"
    Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
} catch { }

try {
    Write-Host ""
    Write-Host "  [OK] تم منع ويندوز من النوم أثناء المشاركة." -ForegroundColor Green
    Write-Host "       سيبقى الموقع متاحًا للمدرسة حتى لو تركت الجهاز." -ForegroundColor Green
    Write-Host ""
    Write-Host "  يغلق هذا المنع تلقائيًا عند إيقاف المشاركة." -ForegroundColor DarkGray
    Write-Host ""

    # نبقي العملية حيّة، ونراقب أداة النفق في الوقت نفسه:
    # إذا توقف cloudflared فمعنى ذلك أن المشاركة انتهت (أُغلقت النافذة بزر X
    # مثلًا، وهذا لا يسمح لملف الـ bat بإيقافنا) => نحرّر منع النوم فورًا.
    # مهلة سماح أولى (45 ثانية) حتى يبدأ النفق فعليًا في نافذة المشاركة.
    Start-Sleep -Seconds 45
    while ($true) {
        if (-not (Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Seconds 20
    }
}
finally {
    # إلغاء المنع: ES_CONTINUOUS وحدها تعيد النظام لسلوكه الطبيعي
    [void][PowerState]::SetThreadExecutionState($ES_CONTINUOUS)
}
