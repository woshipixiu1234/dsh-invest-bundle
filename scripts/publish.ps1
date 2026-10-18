# publish.ps1 — dsh-invest-bundle 一键发布（GitHub 仓库 + npm + 插件市场收录 PR）
#
# 需要你本人登录的两处：GitHub（gh auth login）与 npm（npm login，若发 npm）。
# 只依赖 gh、git、node、npm 都在 PATH 上；脚本可重复运行（每步都先检查现状）。
#
# 典型用法：
#   pwsh -NoProfile -File scripts/publish.ps1 -Owner <你的GitHub用户名> -GitEmail <你的邮箱>
#   # 仓库刚建，市场要求满 1 天才能提 PR：
#   pwsh -NoProfile -File scripts/publish.ps1 -Owner <name> -RepoOnly
#   # 第二天：
#   pwsh -NoProfile -File scripts/publish.ps1 -Owner <name> -PrOnly
#   # 只想看会执行什么：
#   pwsh -NoProfile -File scripts/publish.ps1 -Owner <name> -DryRun

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'dsh-invest-bundle',
  [string]$GitName = '',
  [string]$GitEmail = '',
  [switch]$SkipNpm,
  [switch]$RepoOnly,
  [switch]$PrOnly,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'docs\awesome-dsh-plugin-entry.yml'
if (-not $GitName) { $GitName = $Owner }

function Say($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Step($desc, [scriptblock]$body) {
  Write-Host "-> $desc"
  if ($DryRun) { Write-Host '   (DryRun: 未执行)' -ForegroundColor DarkGray; return }
  & $body
}
function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "缺少命令: $cmd" }
}

Need git; Need node; Need gh; if (-not $SkipNpm) { Need npm }

Say "0. 预检"
$ghOk = (& gh auth status 2>&1 | Out-String)
if ($ghOk -notmatch 'Logged in to') { throw "GitHub 未登录，先跑: gh auth login" }
Write-Host '   gh: 已登录' -ForegroundColor Green
if (-not $SkipNpm) {
  $npmUser = (& npm whoami 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "npm 未登录，先跑: npm login" }
  Write-Host "   npm: $npmUser" -ForegroundColor Green
}

Say "1. 写入元数据（repository / homepage / bugs / 投稿文件）"
Step "node scripts/set-owner.mjs $Owner $Repo" { node (Join-Path $PSScriptRoot 'set-owner.mjs') $Owner $Repo }

if (-not $PrOnly) {
  Say "2. 初始化 git 仓库并提交"
  if (-not (Test-Path (Join-Path $root '.git'))) {
    Step 'git init -b main' { git -C $root init -b main | Out-Null }
  } else { Write-Host '   已有 .git，跳过 init' }
  Step "git config（仅本仓库）user.name=$GitName" { git -C $root config user.name $GitName }
  if ($GitEmail) { Step "git config user.email=$GitEmail" { git -C $root config user.email $GitEmail } }
  else { Write-Host '   未给 -GitEmail，沿用已有配置' -ForegroundColor Yellow }
  Step 'git add -A' { git -C $root add -A }
  $staged = (git -C $root status --porcelain | Out-String).Trim()
  if ($staged) {
    Step 'git commit' { git -C $root commit -m 'feat: dsh-invest-bundle 0.1.0 — 6 tools + 22 investment skills' | Out-Null }
  } else { Write-Host '   无改动，跳过提交' }

  Say "3. 创建/更新 GitHub 仓库并推送"
  $url = "https://github.com/$Owner/$Repo"
  $exists = $true
  if (-not $DryRun) {
    & gh repo view "$Owner/$Repo" 2>&1 | Out-Null
    $exists = ($LASTEXITCODE -eq 0)
  }
  if ($exists) {
    Step 'git remote add origin（如缺）' {
      $has = (git -C $root remote | Out-String) -match 'origin'
      if (-not $has) { git -C $root remote add origin "$url.git" }
    }
    Step 'git push -u origin main' { git -C $root push -u origin main }
  } else {
    Step "gh repo create $Repo --public --source . --push" {
      & gh repo create $Repo --public --source $root --push --description 'DSH investment research bundle: 6 tools + 22 skills adapted from ai-berkshire' | Out-Null
    }
  }
  Step 'gh repo edit --add-topic dsh-plugin' { & gh repo edit "$Owner/$Repo" --add-topic dsh-plugin | Out-Null }

  if (-not $SkipNpm) {
    Say "4. 发布到 npm"
    $published = (& npm view "$Repo@0.1.0" version 2>&1 | Out-String).Trim()
    if ($published -eq '0.1.0') { Write-Host '   npm 上已有 0.1.0，跳过 publish' }
    else {
      Step 'npm publish' { & npm publish --access public | Out-Null }
      Step 'npm view 校验' { & npm view $Repo version }
    }
  }
}

if (-not $RepoOnly) {
  Say "5. 提交收录 PR（awesome-dsh-plugin）"
  if (-not $DryRun) {
    $created = (& gh api "repos/$Owner/$Repo" --jq .created_at 2>&1 | Out-String).Trim()
    if ($created -match '^\d{4}-') {
      $age = ((Get-Date).ToUniversalTime() - [datetime]::Parse($created, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)).TotalHours
      Write-Host ("   仓库创建于 $created（{0:N1} 小时前）" -f $age)
      if ($age -lt 24) {
        Write-Host '   市场要求仓库满 24 小时才能收录，PR 步骤已跳过。明天跑：' -ForegroundColor Yellow
        Write-Host "     pwsh -NoProfile -File scripts/publish.ps1 -Owner $Owner -PrOnly" -ForegroundColor Yellow
        return
      }
    }
  }
  $work = Join-Path $env:TEMP 'awesome-dsh-plugin'
  if (-not (Test-Path $work)) {
    Step 'gh repo fork --clone' { & gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone $work | Out-Null }
  } else { Write-Host "   复用已有克隆: $work" }
  $target = Join-Path $work "data\plugins\${Owner}__${Repo}.yml"
  Step "写入 $target" {
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item $entry $target -Force
  }
  Step 'git checkout -b / commit' {
    git -C $work checkout -B "add-$Repo" | Out-Null
    git -C $work add "data/plugins/${Owner}__${Repo}.yml" | Out-Null
    git -C $work commit -m "Add $Owner/$Repo" | Out-Null
  }
  Step 'git push -u origin' { git -C $work push -u origin "add-$Repo" --force | Out-Null }
  Step 'gh pr create' {
    & gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --head "${Owner}:add-$Repo" `
      --title "Add $Owner/$Repo" `
      --body "Investment research bundle for DSH: 6 tools (search / page fetch / source audit / claim verification / numeric rigor / channel health) and 22 skills, 21 of them adapted from ai-berkshire (MIT)." | Out-Null
  }
}

Say '完成'
Write-Host "仓库: https://github.com/$Owner/$Repo"
if (-not $SkipNpm) { Write-Host "npm:  https://www.npmjs.com/package/$Repo" }
Write-Host '市场看到条目通常需要一天内（站点与 dshmarket 自动重建）。'
