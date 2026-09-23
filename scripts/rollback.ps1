# Roll back the dsh-settings-order install.
#
#   1. drop "dsh-settings-order" from the profile's dsh.profile.bundles list;
#   2. pnpm-remove the file: dependency from the profile;
#   3. kill whatever listens on $Port so the watchdog brings dsh web back up
#      without the plugin.
#
# Run it DETACHED (Start-Process -WindowStyle Hidden ...) when you invoke it
# from a DSH session, because step 3 kills the process hosting that session.
param(
    [int]$Port = 3080,
    [switch]$KeepRunning,
    [string]$Root
)

# Repository root: -Root, or this script's own parent directory (any checkout works).
$root = if ($Root) { $Root } else { Split-Path -Parent $PSScriptRoot }

$profile = Join-Path $env:USERPROFILE '.dsh\profiles\web'
$pkgPath = Join-Path $profile 'package.json'
$log = Join-Path $env:USERPROFILE '.dsh\dsh-web.log'

# --- 1. bundles list -------------------------------------------------------
$js = @'
const fs = require("node:fs");
const path = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
const next = bundles.filter((name) => name !== "dsh-settings-order");
pkg.dsh.profile.bundles = next;
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log("bundles: " + bundles.length + " -> " + next.length);
'@
node -e $js $pkgPath

# --- 2. dependency ---------------------------------------------------------
dsh plugin --profile web remove dsh-settings-order

if ($KeepRunning) {
    Write-Output "已卸载；dsh web 未重启（-KeepRunning），请自行重启使改动生效。"
    exit 0
}

# --- 3. restart through the watchdog ---------------------------------------
$before = @(Get-Content $log -ErrorAction SilentlyContinue).Count
$pattern = "^\s*TCP\s+\S+:{0}\s+\S+\s+LISTENING\s+(\d+)\s*$" -f $Port
$pids = @(netstat -ano | Select-String -Pattern $pattern | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique)
Write-Output ("终止监听 {0} 的进程: {1}" -f $Port, ($pids -join ','))
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
Write-Output ("新地址: " + $url)
if ($url) {
    Set-Content -Path (Join-Path $root 'new-dsh-url.txt') -Value $url -Encoding utf8
    Start-Process $url
}
