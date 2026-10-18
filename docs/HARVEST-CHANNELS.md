# DSH Harvest 11 条检索通道 · 配置与验证报告

- 生成时间：2026-10-18 21:04（Windows / node v24.21.0 / Python 3.12.10）
- 插件：`@stifer/dsh-harvest` 0.2.0，实现见 `lib/backends.js`（659 行）
- 结论先行：**11 条里现在真能用 3 条（web / youtube / v2ex）；github 只差「一次 gh 登录 + 一次 DSH 重启」；其余 7 条要么需要你登录浏览器，要么不值得配。**
- **web 通道已经不需要 Tavily Key**（走 Exa 免 Key 端点），Tavily Key 降级为「可选提速」。

---

## 〇、本次已落地的机器改动（回滚请对照此表）

| # | 改动 | 位置 | 说明 |
|---|------|------|------|
| 1 | 安装 yt-dlp 2026.08.19 | `%APPDATA%\Python\Python312\Scripts\yt-dlp.exe` | `python -m pip install --user yt-dlp` |
| 2 | 硬拷贝 yt-dlp 到 PATH 目录 | `%APPDATA%\npm\yt-dlp.exe` | 该目录已在用户 PATH 且 DSH 进程可见；pip 升级后需重新拷贝 |
| 3 | 新增 yt-dlp 配置文件 | `%APPDATA%\yt-dlp\config` | 内容 `--ignore-errors` + `--no-warnings`，修掉「结果里混入首播/直播条目导致整条通道 exit≠0 被 SKIP」的抖动 |
| 4 | 安装 mcporter 0.15.0 | `C:\Users\woshi\.npm-global\`（`mcporter.ps1`/`.cmd`） | 插件 `SHIM_DIR` 默认就是 `~/.npm-global`，所以必须装这里，不是默认 npm prefix |
| 5 | 注册 Exa 免 Key 检索端点 | `C:\Users\woshi\.mcporter\mcporter.json` | `{"mcpServers":{"exa":{"baseUrl":"https://mcp.exa.ai/mcp"}}}`，web 通道从此免 Key |
| 6 | 安装 gh 2.102.0 | `C:\Program Files\GitHub CLI\gh.exe` | `winget install --id GitHub.cli`，机器级 PATH 已写入；**当前 DSH 进程 PATH 是启动快照，需重启 DSH** |

未改动 `C:\Users\woshi\.dsh\profiles\desktop\` 下任何文件（package.json / cordis.patch.yml / node_modules 均未触碰）。

---

## 一、11 条通道状态表

| 通道 | 依赖命令（backends.js 实际调用） | 当前状态 | 缺什么 | 金融研报优先级 |
|------|------------------------------|----------|--------|----------------|
| **web** | `mcporter call exa.web_search_exa(...)`，或 TAVILY_API_KEY 走 Tavily | ✅ **可用（免 Key）** | 无；可选加 Tavily Key 提额度/提稳定性 | **高** |
| **youtube** | `yt-dlp "ytsearch<n>:<q>" --dump-json --no-warnings --skip-download` | ✅ **可用** | 无（已装 + 已加 `--ignore-errors`） | **中** |
| **v2ex** | `https://www.v2ex.com/api/topics/hot.json`（公开 API，无需 Key） | ✅ **可用（功能受限）** | 无；官方 API 无关键词搜索，只按 title 过滤热帖，过滤不到就回退热帖 | 低 |
| **github** | `gh search repos <q> --sort stars --limit n --json ...` | ⚠️ **装好未登录 + 进程未见 PATH** | ①`gh auth login` ②重启 DSH | **中**（因子库/研报复现/量化工具） |
| **linkedin** | `mcporter call "linkedin-scraper.search_people(...)"` | ⛔ 需 Session | uv/uvx、`mcp-server-linkedin`、mcporter 里名为 `linkedin-scraper` 的 server、LinkedIn 登录态 | 中（合规风险高，见 §四） |
| **twitter / X** | `opencli twitter search <q> --limit n -f json` | ⛔ 需登录 | opencli、Chrome 扩展、Chrome 里已登录 X | 中 |
| **reddit** | `opencli reddit search <q> --limit n -f json` | ⛔ 需登录 | 同上（或 `rdt-cli` + Cookie） | 低 |
| **xiaohongshu** | `opencli xiaohongshu search <q> --limit n -f json` | ⛔ 需登录 | 同上 | 低 |
| **bilibili** | `bili search <q> --type video -n <n> --json` | ⛔ 未安装（且参数不匹配） | `pip install bilibili-cli` + 插件发的是 `-n`（其 README 用 `--max`），装上也大概率空结果 | 低 |
| **telegram** | `python -c <TG_SCRIPT>`，仓库在 `D:\myprogram\tools\mcp-telegram`（可 `TELEGRAM_MCP_PATH` 覆盖） | ⛔ 未配置 | 仓库 + Telegram api_id/hash + 手机验证 session | 不用（见 §四） |
| **linuxdo** | `python -c <LINUXDO_SCRIPT>`，仓库在 `D:\myprogram\tools\linuxdo-mcp` | ⛔ 未配置 | 仓库 + `LINUXDO_COOKIE` | 不用 |

### 实测证据（2026-10-18 真实调用 harvest_scout 全平台 + 逐条命令）

```
[web]         ✅ 返回真实研报，例如「西部证券-半导体设备/零部件行业专题报告」
                 http://www.cy-mmm.com/doc-a98180e28c4b476bf975cd1e706b7a89.html
                 「半导体设备14家中报扫描…」https://caifuhao.eastmoney.com/news/20260831104016458911070
[youtube]     ✅ 返回真实视频，例如「0926-摩根士丹利-半导体生产设备：科技月报2026年9月-260923」
                 https://www.youtube.com/watch?v=uzQ6I-QCXoA
[v2ex]        ✅ 返回热帖（与金融无关，说明只吃公开热帖）https://www.v2ex.com/t/1249646
[SKIP:github] spawn gh ENOENT
[SKIP:twitter] Command failed: … 无法将 C:\Users\woshi\.npm-global\opencli.ps1 识别为 cmdlet/脚本 (CommandNotFoundException)
[SKIP:reddit]      同上
[SKIP:xiaohongshu] 同上
[SKIP:bilibili] spawn bili ENOENT
[SKIP:linkedin] Command failed: … mcporter call "linkedin-scraper.search_people(...)" --output json
[SKIP:telegram] telegram: probe failed (environment not configured or session/cookie missing)
[SKIP:linuxdo] linuxdo: probe failed (environment not configured or session/cookie missing)
```

附带验证（非 11 通道，但同属插件核心能力）：
`harvest_extract`（正文穿透抓取）**可用**，直接抓 `https://www.nxny.com/report/view_6223383.html` 成功（`[ok/direct]`），带 Jina Reader 兜底，无需 Key。

---

## 二、需要你（用户）做的事

### A 组：注册 / 拿 Key（都是可选，web 已能免 Key 跑）

**A1 · Tavily API Key（可选，推荐）**
- 要什么：`tvly-` 开头的 API Key
- 去哪拿：<https://app.tavily.com/> → 注册（邮箱/GitHub）→ API Keys → 复制。免费额度 1000 credits/月
- 大约几分钟：3 分钟
- 拿到后填哪（两种方式，二选一，填完重启 DSH）：
  - 方式 1（最省事，用户级环境变量）：
    ```powershell
    [Environment]::SetEnvironmentVariable('TAVILY_API_KEY','tvly-你的Key','User')
    ```
  - 方式 2（写进 DSH 凭据，仅当 `%USERPROFILE%\.dsh\settings.yaml` 存在且含 `tavilyApiKeyEnv: X` 时才生效）
    ```yaml
    # C:\Users\woshi\.dsh\.credentials.yaml —— refs 段
    TAVILY_API_KEY: tvly-你的Key
    ```
    ⚠️ 该文件当前是**加密包**（含 version/records/payload/refs），不要手改明文；请用 DSH 设置界面或直接用方式 1。
- 作用：web 通道改走 Tavily（可配 `TAVILY_ENDPOINT` 自建/代理），比 Exa 公共端点更稳、额度可预期。

**A2 · GitHub（两种做法，选其一）**
- 做法 1（推荐，无需拿 Key）：见 B1 的 `gh auth login`
- 做法 2（纯 Token）：<https://github.com/settings/tokens> → Fine-grained token，只读 `public_repo` 权限即可搜仓库
  - 填哪：用户环境变量 `GH_TOKEN`，然后重启 DSH
  - 几分钟：3 分钟

**A3 · Telegram api_id / api_hash（不建议，见 §四）**
- 去哪拿：<https://my.telegram.org> → API development tools
- 额外还要：手机号验证生成的 session 文件、`pip install` 依赖、`D:\myprogram\tools\mcp-telegram` 仓库
- 几分钟：15 分钟起，且易失效。**不做也完全不影响金融研报主线。**

### B 组：登录 / 授权

**B1 · GitHub CLI 登录（高性价比，2 分钟）**
```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' auth login --web --git-protocol https
# 浏览器里点授权 → 然后【重启 DSH】（让新 PATH 生效，否则插件 spawn gh 仍报 ENOENT）
```
- 验证：`gh auth status` 显示 `Logged in to github.com`，且 `harvest_scout(platforms=["github"])` 不再 SKIP。

**B2 · OpenCLI（X / Reddit / 小红书 / B站字幕，10 分钟）**
> 本会话的安全策略拦下了自动安装（`npm i -g @jackwener/opencli` 被拒），需要你自己执行并确认。
```powershell
# 1) Chrome 装扩展（必须）
#    https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk
# 2) 装 CLI（注意前缀必须是 ~/.npm-global，插件 SHIM_DIR 只认这里）
npm i -g --prefix C:\Users\woshi\.npm-global @jackwener/opencli
# 3) 确认能连上 Chrome
opencli doctor      # 期望看到 Extension: connected
```
- 还要：Chrome 里**登录** reddit.com / x.com / xiaohongshu.com（用你自己的会话，插件不保存密码）
- 几分钟：10 分钟（不含登录时间）
- 前置：Chrome 已装（`C:\Program Files\Google\Chrome\Application\chrome.exe` 存在）

**B3 · LinkedIn（10 分钟，合规见 §四）**
```powershell
winget install --id astral-sh.uv -e --silent
& powershell.exe -NoProfile -Command "& 'C:\Users\woshi\.npm-global\mcporter.ps1' config add linkedin-scraper --command uvx --arg mcp-server-linkedin@latest --env UV_HTTP_TIMEOUT=300 --scope home"
```
- 注意：mcporter 里的 server 名必须是 **`linkedin-scraper`**（插件按这个名字调用）
- 还要：按 `mcp-server-linkedin` README 配你自己的 LinkedIn 登录态（cookie/session），本项目不代持账号密码
- 几分钟：10 分钟

---

## 三、修复后的验证命令（直接粘进 pwsh）

```powershell
# 0) 先确认 PATH 里已经有 GitHub CLI（重启 DSH 后新开的终端里跑）
$env:Path -split ';' | Select-String 'GitHub CLI'

# 1) web（Exa 免 Key 通路）
& powershell.exe -NoProfile -Command "& 'C:\Users\woshi\.npm-global\mcporter.ps1' call exa.web_search_exa query='半导体设备 2026 研报' numResults=3 --output text"
#    ✅ 恢复标志：出现 >=3 组 "Title:" / "URL:" 文本块；❌ 报 Unknown MCP server 说明 mcporter.json 丢了

# 2) youtube
& "$env:APPDATA\npm\yt-dlp.exe" "ytsearch2:半导体设备 2026" --dump-json --no-warnings --skip-download
#    ✅ 恢复标志：>=2 行 JSON，含 "title" 与 "webpage_url"；退出码 0

# 3) v2ex
(Invoke-RestMethod 'https://www.v2ex.com/api/topics/hot.json')[0..1] | Select-Object title,url
#    ✅ 恢复标志：返回 2 条 {title,url}

# 4) github（先跑 gh auth login）
& 'C:\Program Files\GitHub CLI\gh.exe' auth status
& 'C:\Program Files\GitHub CLI\gh.exe' search repos quantitative-finance --limit 3 --json fullName,stargazersCount
#    ✅ 恢复标志：auth status 有 "Logged in to github.com"，search 返回 JSON 数组

# 5) bilibili（需先 pip install bilibili-cli）
bili search "半导体设备 2026" --type video -n 3 --json
#    ✅ 恢复标志：返回 JSON 数组且元素含 bvid/title；❌ 报 unrecognized arguments: -n 说明参数不匹配（需改插件或加 shim）

# 6) opencli（X / Reddit / 小红书）
opencli doctor
opencli twitter search "半导体设备" --limit 3 -f json
#    ✅ 恢复标志：doctor 显示 Extension: connected，search 返回 JSON

# 7) linkedin（需 uvx + server 已 add）
& powershell.exe -NoProfile -Command "& 'C:\Users\woshi\.npm-global\mcporter.ps1' call \"linkedin-scraper.search_people(keyword: 'semiconductor analyst', limit: 2)\" --output json"

# 8) telegram / linuxdo 只判断前置条件
Test-Path 'D:\myprogram\tools\mcp-telegram'
Test-Path 'D:\myprogram\tools\linuxdo-mcp'
[Environment]::GetEnvironmentVariable('LINUXDO_COOKIE','User')
```

**一键看全貌（DSH 侧）**：重启 DSH 后让 agent 跑一次
`harvest_scout(query="A股 半导体设备 2026 研报", limit=2)`
输出里 `[SKIP:xxx]` 消失 = 该通道恢复；当前基线是 8 条 SKIP（github/twitter/reddit/xiaohongshu/bilibili/linkedin/telegram/linuxdo）。

---

## 四、不建议配的通道及理由

| 通道 | 不建议理由 |
|------|-----------|
| **telegram** | 需要 api_id/hash + 手机验证 session，session 失效无提示；频道内容多为未授权转载的二级研报，属「不可控来源」，与「一手研报/合规引用」的目标相反 |
| **linuxdo** | 与金融研报零交集；插件对它做了 429 熔断 + 缓存，Cookie 一失效就长期静默 SKIP，维护成本高于收益 |
| **xiaohongshu / reddit** | 与 A股/港股研报主线弱相关；都要 Chrome 常驻 + 登录态，风向内容噪音大，验证成本高 |
| **bilibili** | 插件硬编码 `-n`，与 bilibili-cli 的 `--max` 不匹配（装上大概率为空结果）；且安装被本会话安全策略拦了两次，收益低。真要 B 站字幕，走 OpenCLI 的 `bilibili subtitle BVxxx` 更实际 |
| **付费数据源（Wind/Choice/彭博/同花顺 iFinD）** | 不在插件能力范围内，必须走机构授权 API；任何绕过授权的抓取都不可采用 |

保留建议：**web + youtube + v2ex（已通）+ github（登录即可）+ harvest_extract（已通）** 已能覆盖「研报检索 → 正文精读 → 视频/会议解读 → 开源复现」的主线，剩下的 7 条属于锦上添花。

---

## 五、已知坑（踩过的，写下来省时间）

1. **SHIM_DIR 只认 `~/.npm-global`**：`backends.js:23` 为 `process.env.DSH_HARVEST_BIN || path.join(os.homedir(), '.npm-global')`。所以 opencli/mcporter 必须装到这里；本机默认 npm prefix 是 `%APPDATA%\npm`，装错地方等于没装。
2. **web 通道双通路**：有 `TAVILY_API_KEY`/`TAVILY_ENDPOINT` 走 Tavily，否则走 `mcporter exa`。没有 Key 也能用，别被「需 Key」的直觉骗了。
3. **`.credentials.yaml` 是加密包**（version/records/payload/refs），不能手改明文；加 Key 优先用用户环境变量 + 重启 DSH。
4. **yt-dlp 是硬拷贝到 `%APPDATA%\npm`**：将来 `pip install -U yt-dlp` 后要重新 copy 到 PATH 目录，否则插件仍调用旧版本。
5. **DSH 进程 PATH 是启动快照**：gh 装完当前进程仍 `spawn gh ENOENT`，重启即好。
6. **yt-dlp 退出码抖动**：搜索结果里若混入首播/正在直播条目，yt-dlp 默认整批 non-zero 退出 → 插件判失败。已用 `%APPDATA%\yt-dlp\config` 的 `--ignore-errors` 修掉（改前该查询 exit≠0，改后 exit=0 且返回 3 条）。
7. **pwsh 里中文输出乱码**不影响数据内容；判断成败只看退出码与 JSON 是否成形。
8. **v2ex 不是搜索**：官方公开 API 只有热帖流，插件靠 title 关键词过滤，命中不到就回退热帖，所以金融场景常出无关结果，别当主力。
