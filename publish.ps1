# 一键发布：自动升级缓存版本号 -> 提交 -> 推送到 GitHub
# GitHub Pages 会在推送后约 1 分钟自动更新网站
Set-Location $PSScriptRoot
$changes = git status --porcelain
if (-not $changes) { Write-Host '没有检测到改动，无需发布。' -ForegroundColor Yellow; exit }

$sw = Join-Path $PSScriptRoot 'sw.js'
$text = [IO.File]::ReadAllText($sw)
$m = [regex]::Match($text, "CACHE_VERSION = 'v(\d+)'")
if ($m.Success) {
    $n = [int]$m.Groups[1].Value + 1
    $text = $text.Replace($m.Value, "CACHE_VERSION = 'v$n'")
    [IO.File]::WriteAllText($sw, $text, (New-Object Text.UTF8Encoding $false))
    Write-Host "缓存版本已升级为 v$n"
}

git add -A
git commit -m ("Update " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
git pull --rebase --autostash
git push
if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host '发布成功！约 1 分钟后生效：' -ForegroundColor Green
    Write-Host 'https://sgldlm.github.io/lucky-draw-200/' -ForegroundColor Green
} else {
    Write-Host '推送失败，请检查网络或 GitHub 登录。' -ForegroundColor Red
}
