# 发布到 DSH 插件市场 — 操作手册

本包已通过本地验收（6 个工具注册成功、22 个技能加载、13 个 Python 脚本可跑、通道探测 4/13 可用）。
发布链路上有 **两个必须你本人登录** 的环节：GitHub 与 npm。其余全部已就绪。

---

## 0. 现状核对（先跑这些，确认环境）

```powershell
gh auth status            # 现在：not logged into any GitHub hosts
npm whoami                # 现在：ENEEDAUTH
npm view dsh-invest-bundle # 现在：404 → 包名可用
node -v                   # v24.x
```

---

## 1. 填你自己的 GitHub 账号（一条命令搞定元数据 + 投稿文件）

```powershell
cd D:\DSH-Workspaces\06-金融学习与skill转插件\packages\dsh-invest-bundle
node scripts/set-owner.mjs <你的 GitHub 用户名>
```

它会改写 `package.json` 的 `repository` / `homepage` / `bugs` / `author`，
并生成 `docs/awesome-dsh-plugin-entry.yml`（即要提交给 awesome-dsh-plugin 的那一个文件）。

> npm 包的 `repository` 字段必须指回被收录的 GitHub 仓库，否则市场不会把 npm 下载量
> 关联到你的条目——所以第 1 步必须在 `npm publish` **之前**做。

---

## 2. 登录 GitHub 并建仓库（需要你）

```powershell
gh auth login                                           # 选 GitHub.com → HTTPS → 浏览器登录
git init -b main
git add -A
git config user.name  "<你的名字>"                       # 只在本仓库生效，不动全局
git config user.email "<你的邮箱>"
git commit -m "feat: dsh-invest-bundle 0.1.0 — 6 tools + 22 investment skills"
gh repo create dsh-invest-bundle --public --source . --push `
  --description "DSH investment research bundle: 6 tools + 22 skills adapted from ai-berkshire"
gh repo edit --add-topic dsh-plugin
```

**⚠️ 市场规则：仓库创建需满 1 天**（CI 自动查，用来过滤「提 PR 前几分钟才建仓」）。
所以：今天建仓 + 推送 → 明天再提 PR。提前提交会被 CI 拦，不算问题，改天重交即可。

---

## 3. 发布到 npm（可选，但推荐；需要你）

```powershell
npm login                    # 浏览器/OTP 登录
npm publish                  # publishConfig.access 已是 public
npm view dsh-invest-bundle   # 应能看到 0.1.0
```

不发布 npm 也能上架（市场直接按 git 安装），只是没有下载量数字。
若之后想改用 GitHub Release 的预构建 tarball，再在条目里加 `tarball:`。

---

## 4. 提交收录 PR（需要你）

目标仓库：`github.com/awesome-dsh-plugin/awesome-dsh-plugin`

```powershell
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
# 把 docs/awesome-dsh-plugin-entry.yml 复制成：
#   data/plugins/<owner>__dsh-invest-bundle.yml
git checkout -b add-dsh-invest-bundle
git add data/plugins/<owner>__dsh-invest-bundle.yml
git commit -m "Add <owner>/dsh-invest-bundle"
git push -u origin add-dsh-invest-bundle
gh pr create --title "Add <owner>/dsh-invest-bundle" --body "Investment research bundle for DSH: 6 tools + 22 skills adapted from ai-berkshire (MIT)."
```

硬规则（已逐条对齐，别改坏）：

| 规则 | 本包状态 |
| --- | --- |
| `package.json` 声明 `dsh.bundle.patch` | ✅ `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| 仓库根有 `cordis.patch.yml` | ✅ `- insert: - id: invest-bundle  name: dsh-invest-bundle` |
| 真实可跑代码（非占位/纯 README） | ✅ 6 个工具 + 22 个技能 + 13 个脚本，本地全跑通 |
| 仓库创建满 1 天 | ⏳ 建仓后等 1 天 |
| 加 `dsh-plugin` topic | 第 2 步的 `gh repo edit --add-topic` |
| 一个 PR 只加一个文件 | ✅ 只加 `data/plugins/<owner>__dsh-invest-bundle.yml` |
| 不改别人条目、不手改 README | ✅ 只新增文件 |
| 描述属实、无营销词 | ✅ 只写「6 个工具 + 22 个技能」，与代码一致 |
| 非纯聚合包 | ✅ 自带行为，不依赖其他插件 |
| 官方 `@deepseek-ai/*` 用 peerDependencies | ✅ 本包零依赖、不 import 任何 `@deepseek-ai/*` |

---

## 5. 上架后用户怎么装

- 市场发现：在「插件 → 发现 → 索引源」添加 `https://awesome-dsh-plugin.com/index.json`
  （社区市场 bundle `dshmarket` 默认读 `https://awesome-dsh-plugin.com/plugins.json`，无需配置）。
- 装本机验证过的形态：`link:` 本地路径、npm 包名、git 地址三种都行（本机用的是 `link:`）。

---

## 6. 许可与署名（已处理好，勿删）

上游 ai-berkshire 是 **MIT**（© 2026 xbtlin）。MIT 的硬性要求只有一条：
**保留版权声明与许可声明**——所以这些文件是合规要件，不是装饰，发布时不能在提交里漏掉、也不能被
`.gitignore` 或 `files[]` 排除：

| 文件 | 内容 |
| --- | --- |
| `LICENSE` | 本包 MIT 全文 |
| `NOTICE.md` | 上游仓库 + 固定提交 + 改造范围 + **上游 MIT 全文**（附录 A） |
| `skills/UPSTREAM-NOTICE.md` | 技能子目录的署名（单独拷走 21 个技能时也不丢声明） |
| `tools/UPSTREAM-NOTICE.md` | 脚本子目录的署名（12 个 `.py` + 1 个 `.sh` 为原样复制） |

边界也写清楚：`skills/invest` 与本包 `index.js`/`lib/` 是原创；`lib/channels.js` 的通道清单
参考了 `@stifer/dsh-harvest` 的行为设计，但代码为独立实现、未复制其源码。

随时可复核（不需要登录）：

```powershell
node test\license-check.mjs            # 离线：声明齐全、无其他协议混入、打包覆盖
node test\license-check.mjs --remote   # 联网：按固定提交号与上游逐字节比对
# 当前结果：13/13 脚本与上游完全相同；21/21 技能与上游不同（确为改造）；invest 为原创
```

> 想换版权署名（比如换成你自己的名字），只改 `LICENSE` 里的 `Copyright (c) 2026 …` 一行即可，
> 上游那行 **`Copyright (c) 2026 xbtlin` 必须原样保留**在 `NOTICE.md` / 两个 `UPSTREAM-NOTICE.md` 里。

---

## 7. 上架前的本地验收（无需登录，随时可跑）

```powershell
cd D:\DSH-Workspaces\06-金融学习与skill转插件\packages\dsh-invest-bundle
node test/verify-skills.mjs    # 22/22 frontmatter 合法
node test/smoke.mjs            # 检索/抓取/审计/验证/通道全链路
node test/register.mjs         # 假 ctx：注册 6 工具 + 22 技能
node test/tools-check.mjs      # 13 个 Python 脚本真实调用
node test/pack-check.mjs       # 打包产物（52 个文件 / 213 KB）

## 8. 本次发布的实际状态（2026-10-18）

| 环节 | 状态 | 地址 / 证据 |
| --- | --- | --- |
| GitHub 仓库 | ✅ 已发布（public） | https://github.com/woshipixiu1234/dsh-invest-bundle |
| 许可证 | ✅ GitHub 识别为 **MIT** | `gh api repos/… --jq .license.spdx_id` → `MIT` |
| topics | ✅ 已加 `dsh-plugin` 等 6 个 | dsh-plugin / dsh / investment-research / equity-research / value-investing / ai-berkshire |
| Release | ✅ v0.1.0 + 稳定名 tarball（218,367 B） | https://github.com/woshipixiu1234/dsh-invest-bundle/releases/tag/v0.1.0 |
| CI（ubuntu + windows） | ✅ 绿 | `.github/workflows/verify.yml` |
| 从 GitHub 克隆后可用性 | ✅ 已验证 | clone 后 `register.mjs` PASS、22/22 技能合法 |
| npm 发布 | ⏸ 未做（可选） | 需要 `npm login`；安装不依赖 npm（git / tarball 均可） |
| awesome-dsh-plugin PR | ✅ 已开 [PR #7926](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7926) | 首个 run 会因「仓库不足 1 天」变红，按检查器自己的说明留 PR 不动，它在 2026-10-19 13:31 UTC 之后自动转绿（`regate.yml` 会重跑） |

投稿文件就一份：`data/plugins/woshipixiu1234__dsh-invest-bundle.yml`（内容同 `docs/awesome-dsh-plugin-entry.yml`）。
若需要重开 PR（例如分支被删）：

```powershell
cd D:\DSH-Workspaces\06-金融学习与skill转插件\packages\dsh-invest-bundle
pwsh -File scripts\publish.ps1 -Owner woshipixiu1234 -PrOnly
```

---

## 9. 插件市场索引源（自建，立即可搜到）

社区目录 `awesome-dsh-plugin` 合入 PR #7926 之后，所有人都能在市场里搜到本插件。合入之前，用仓库自带的索引源，让自己（或任何拿到这个 URL 的人）立刻在「插件 → 发现」里搜到并安装：

- 索引文件：`market/index.json`（格式 1，用官方 `parseMarketIndex` 校验通过）
- 索引 URL：https://raw.githubusercontent.com/woshipixiu1234/dsh-invest-bundle/main/market/index.json
- 安装目标：`git+https://github.com/woshipixiu1234/dsh-invest-bundle.git#<commit>` —— 索引里固定提交号，不随 main 漂移

加进本机需要两处 profile 改动（重启 DSH 生效）：

1. `C:\Users\woshi\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 增加
   `@deepseek-ai/dsh-experimental-plugin-market-bundle` —— DSH 自带的可选组合包，提供「插件 → 发现」页与 `plugin_market` 工具。
2. `C:\Users\woshi\.dsh\profiles\desktop\cordis.patch.yml` 增加：

```yaml
- id: plugin-market
  config:
    indexes:
      - https://raw.githubusercontent.com/woshipixiu1234/dsh-invest-bundle/main/market/index.json
      - https://awesome-dsh-plugin.com/index.json
```

等价做法：在「插件 → 发现 → 索引源」里用界面添加这两个 URL。第二个源（社区目录，2953 个插件）可选；只加第一个也能搜到本插件。

索引的维护：改了 `package.json` 的 version 之后重跑 `node scripts/gen-market-index.mjs`（写入版本号、HEAD 提交号、提交时间戳），提交推送即生效——索引 URL 指向 main，但安装目标仍固定在那个提交。CI 里 `node scripts/gen-market-index.mjs --check` 保证文件不会和仓库现状脱节。

关掉「发现」页恢复原状：从 `dsh.profile.bundles` 删掉那一行、删掉 `plugin-market` 的 patch 条目，重启即可（本插件本身不受影响，仍是 profile 里的一条 bundle）。
