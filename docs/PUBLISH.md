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
node test/pack-check.mjs       # 打包产物（正在补）
```
