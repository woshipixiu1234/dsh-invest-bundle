#!/usr/bin/env node
/**
 * 生成 market/index.json —— 插件市场「发现」页可直接读取的格式 1 索引。
 *
 * 用法：
 *   node scripts/gen-market-index.mjs            # 写文件
 *   node scripts/gen-market-index.mjs --check     # 只检查是否与仓库现状一致（CI 用）
 *
 * 索引里的每个版本都固定到提交号：索引 URL 指向 main，但安装目标不会随 main 漂移。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_PATH = join(ROOT, 'package.json')
const INDEX_PATH = join(ROOT, 'market', 'index.json')
const check = process.argv.includes('--check')

const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))
if (!pkg.name || !pkg.version) throw new Error('package.json 缺少 name / version')

const repositoryUrl = (pkg.repository?.url ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace(/#.*$/, '')
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repositoryUrl)) {
  throw new Error(`package.json 的 repository.url 不是 GitHub 仓库地址：${JSON.stringify(pkg.repository?.url)}`)
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const commit = git('rev-parse', 'HEAD')
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`HEAD 不是完整的提交号：${commit}`)
const publishTimestamp = Number(git('log', '-1', '--format=%ct'))

const index = {
  format: 1,
  title: {
    en: `${pkg.name} index`,
    zh: '投研插件索引源',
  },
  description: {
    en: 'A one-plugin index source maintained by the author, so that dsh-invest-bundle can be searched for and installed from the Discover tab before the community catalog lists it.',
    zh: '由作者维护的单插件索引源，用来在插件市场的「发现」页直接搜到并安装 dsh-invest-bundle。',
  },
  metadata: {
    categories: { skill: { title: { en: 'Skills', zh: '技能' } } },
    labels: {},
    sortKeys: {},
  },
  plugins: [
    {
      name: pkg.name,
      title: {
        en: 'Investment research bundle: 10 tools + 23 skills',
        zh: '投研插件：10 个工具 + 23 个技能 + 四大师 workflow',
      },
      description: {
        en: 'DSH-native equity research: search / page extraction / source audit / cross-verification / numeric rigor / channel probe, plus 23 skills adapted from ai-berkshire. Ships a six-phase four-masters workflow (Duan Yongping, Buffett, Munger, Li Lu) whose four agents run in parallel in the workflow panel, a spec-driven chart engine, and a Markdown-to-PDF pipeline that renders a cover, tables, figures, captions and page numbers.',
        zh: 'DSH 原生投研插件：检索、正文抓取、信源审计、跨源验证、数值严谨工具与通道探测共 10 个工具，外加 23 个技能（改造自 ai-berkshire 的四大师方法）。内置六阶段四大师 workflow —— 段永平/巴菲特/芒格/李录四个 Agent 在 workflow 面板并行推进 —— 再交叉质证、成稿、spec 驱动出图，最后由 Markdown 管线渲染成带封面/表格/图注/页码的图文 PDF。',
      },
      author: (pkg.author ?? '').replace(/\s*<.*?>\s*/u, '').trim() || 'dsh-invest-bundle contributors',
      homepage: pkg.homepage ?? repositoryUrl,
      repository: { url: repositoryUrl },
      metadata: {
        category: 'skill',
        keywords: ['investment', 'research', 'equity', 'valuation', 'earnings', '投研', '研报', '财报', '估值'],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repositoryUrl, commit },
          engines: {},
        },
      ],
    },
  ],
}

const text = JSON.stringify(index, null, 2) + '\n'
if (check) {
  // 只校验「索引能不能用」而不是字节相等：索引里固定的是生成它那一次的提交号，
  // 每提交一次都会落后于 HEAD，字节比对必然失败。真正会出事的是版本号漂移。
  const problems = []
  let current
  try {
    current = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
  } catch (error) {
    problems.push(`market/index.json 无法解析：${error.message}`)
  }
  if (current !== undefined) {
    const plugin = current.plugins?.[0]
    const version = plugin?.versions?.[0]
    if (current.format !== 1) problems.push('format 必须是 1')
    if (plugin?.name !== pkg.name) problems.push(`插件名 ${JSON.stringify(plugin?.name)} 与 package.json 的 ${JSON.stringify(pkg.name)} 不一致`)
    if (version?.version !== pkg.version) {
      problems.push(`索引版本 ${JSON.stringify(version?.version)} 与 package.json 的 ${JSON.stringify(pkg.version)} 不一致 —— 跑 node scripts/gen-market-index.mjs`)
    }
    if (version?.source?.type !== 'git') problems.push('source.type 必须是 git（npm 发布前不能用 npm 源）')
    if (version?.source?.url !== repositoryUrl) problems.push(`source.url ${JSON.stringify(version?.source?.url)} 与仓库地址 ${repositoryUrl} 不一致`)
    if (!/^[0-9a-f]{40}$/.test(version?.source?.commit ?? '')) problems.push('source.commit 必须是 40 位小写十六进制提交号')
    const shallow = git('rev-parse', '--is-shallow-repository') === 'true'
    if (!shallow) {
      try {
        git('cat-file', '-e', `${version.source.commit}^{commit}`)
      } catch {
        problems.push(`source.commit ${version.source.commit?.slice(0, 7)} 不在本仓库历史里`)
      }
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`- ${problem}`)
    process.exit(1)
  }
  console.log(`market/index.json 可用：${pkg.name}@${pkg.version}`)
  process.exit(0)
}

writeFileSync(INDEX_PATH, text, 'utf8')
console.log(`已写入 market/index.json：${pkg.name}@${pkg.version} @ ${commit.slice(0, 7)}`)
console.log(`索引 URL：https://raw.githubusercontent.com/${repositoryUrl.replace('https://github.com/', '')}/main/market/index.json`)
console.log(`安装目标：git+${repositoryUrl}.git#${commit}`)
