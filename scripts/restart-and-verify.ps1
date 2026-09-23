# Restart dsh web (so the freshly installed dsh-settings-order host half
# registers its settings namespace), then verify the install end to end and
# leave a report behind.
#
# This script is meant to be launched DETACHED from the DSH session it is about
# to restart (Start-Process -WindowStyle Hidden ...), because killing the
# listener on $Port also kills the agent process that would otherwise run it.
#
# What it does, in order:
#   1. wait $DelaySeconds so the launching turn can finish;
#   2. kill whatever listens on $Port (the watchdog cmd/npm script brings dsh web
#      back within ~5s and appends the new token URL to ~/.dsh/dsh-web.log);
#   3. pick up the new token URL;
#   4. assert the boot manifest carries the plugin's client row and that the
#      advertised client bundle is actually served;
#   5. run e2e/settings-order-e2e.mjs against the new instance;
#   6. write verify-report.txt and open the new URL in the default browser.
param(
    [int]$DelaySeconds = 120,
    [int]$Port = 3080,
    [string]$Root
)

# Repository root: -Root, or this script's own parent directory (any checkout works).
$root = if ($Root) { $Root } else { Split-Path -Parent $PSScriptRoot }
$log = Join-Path $env:USERPROFILE '.dsh\dsh-web.log'
$report = Join-Path $root 'verify-report.txt'
$urlFile = Join-Path $root 'new-dsh-url.txt'

function W($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $report -Value $line -ErrorAction SilentlyContinue
}

Set-Content -Path $report -Value ("dsh-settings-order post-install verification{0}started {1}{0}" -f "`r`n", (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -ErrorAction SilentlyContinue

$before = @(Get-Content $log -ErrorAction SilentlyContinue).Count
W "计划重启：${DelaySeconds}s 后；当前日志行数=$before"
Start-Sleep -Seconds $DelaySeconds

# --- restart ---------------------------------------------------------------
$pattern = "^\s*TCP\s+\S+:{0}\s+\S+\s+LISTENING\s+(\d+)\s*$" -f $Port
$pids = @(netstat -ano | Select-String -Pattern $pattern | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique)
W ("终止监听 {0} 的进程: {1}" -f $Port, ($pids -join ','))
foreach ($procId in $pids) {
    Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
}

$url = $null
for ($i = 0; $i -lt 150 -and -not $url; $i++) {
    Start-Sleep -Seconds 2
    $lines = @(Get-Content $log -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $before) {
        $url = $lines[$before..($lines.Count - 1)] |
            Select-String -Pattern 'dsh web: (http://\S+)' |
            ForEach-Object { $_.Matches[0].Groups[1].Value } |
            Select-Object -Last 1
    }
}
W ("新地址: " + $url)
if (-not $url) {
    W "FAILED: 重启后没有拿到新的访问地址，请查看 $log 的末尾"
    exit 1
}
Set-Content -Path $urlFile -Value $url -Encoding utf8

# --- reachable? ------------------------------------------------------------
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$index = $null
for ($i = 0; $i -lt 60 -and -not $index; $i++) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri $url -WebSession $session -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) { $index = $response }
    } catch { }
}
if (-not $index) {
    W "FAILED: 新实例不可访问"
    exit 1
}
W ("index 可访问：status={0} bytes={1}" -f $index.StatusCode, $index.RawContentLength)

# --- boot manifest + served bundle ----------------------------------------
$html = $index.Content
$marker = 'dsh-settings-order'
$count = ([regex]::Matches($html, [regex]::Escape($marker))).Count
W ("启动清单中 '{0}' 出现 {1} 次（期望 >=1）" -f $marker, $count)

$urls = [regex]::Matches($html, '/plugins/\?\?[^"''<>\\ ]*client\.js[^"''<>\\ ]*') |
    ForEach-Object { $_.Value } | Select-Object -Unique
$mine = $urls | Where-Object { $_ -match [regex]::Escape($marker) }
if (-not $mine) {
    W "FAILED: 启动清单里没有该插件的 client bundle 地址"
} else {
    foreach ($u in $mine) {
        $abs = "http://127.0.0.1:$Port" + ($u -replace '&amp;', '&')
        try {
            $bundle = Invoke-WebRequest -Uri $abs -WebSession $session -UseBasicParsing -TimeoutSec 30
            $body = $bundle.Content
            W ("BUNDLE OK status={0} bytes={1} hasApply={2} hasLoader={3}" -f `
                $bundle.StatusCode, $bundle.RawContentLength, ($body -match 'exports\.apply'), ($body -match '__ModuleLoader__'))
        } catch {
            W ("FAILED bundle {0} -> {1}" -f $abs, $_.Exception.Message)
        }
    }
}

$bootErrors = Get-Content $log -Tail 200 -ErrorAction SilentlyContinue |
    Select-String -Pattern 'error|Error|failed|FAIL' -SimpleMatch:$false
if ($bootErrors) {
    W "启动日志中的可疑行："
    foreach ($line in $bootErrors) { W ("  " + $line.Line) }
} else {
    W "启动日志尾部没有错误行"
}

# --- live end-to-end -------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }
$env:DSH_E2E_URL = $url
W "运行 e2e: $node $root\e2e\settings-order-e2e.mjs $Port"
try {
    $out = & $node (Join-Path $root 'e2e\settings-order-e2e.mjs') $Port 2>&1 | Out-String
    W "e2e 输出："
    Add-Content -Path $report -Value $out
    Write-Output $out
} catch {
    W ("FAILED: e2e 运行异常 " + $_.Exception.Message)
}

# --- hand the instance back ------------------------------------------------
try {
    Start-Process $url
    W "已在默认浏览器打开新地址"
} catch {
    W ("打开浏览器失败: " + $_.Exception.Message)
}
W "完成"
