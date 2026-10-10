import { test, expect, mock } from 'claude-code/testing'
import { previewScene, previewPixels, previewLane, laneTip, paceOf, moodOf, dayShare, receiptText, setLang, doingText, workflowName, handoffBrief } from './register'
import { newLane, bubbleSpot } from './sprites'
import { crabSvg, dashSvg } from './desktop'
import { TABLES } from './strings'

const USAGE = {
  startedAt: Date.now() - 5_520_000,
  context: { tokens: 164_000, window: 200_000, percent: 82 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString() },
  ],
  cost: { usd: 3.21 },
}

// 终端里允许出现的字符: ASCII、中日韩文字、全角逗号、以及确定单宽的方块/框线字符
//   ● (v1.4 的 rc 绿点): Claude Code 自己每条回复前面都用它; · (v1.4 工具栏上的今天用量): Claude Code 自己的提示行也用它. 宽度都和引擎算的一致
const SAFE = /^[\x20-\x7E\u4E00-\u9FFF，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓●·]*$/
const CWD = 'D:\\work\\my-app'

// 模拟三种系统: 工作目录、环境变量、是不是 macOS、打不开的命令 (退出码 3)
// Windows 这里故意不给 OS 变量, 靠 C:\ 这种路径认出来
// root = 项目根目录 (不给就和 cwd 一样)
type Sys = { cwd: string; root?: string; env: Record<string, string>; mac?: boolean; broken?: string[] }
const WIN: Sys = { cwd: CWD, env: { USERPROFILE: 'C:\\Users\\me' } }
const MAC: Sys = { cwd: '/Users/me/my-app', env: { HOME: '/Users/me' }, mac: true }
const LINUX: Sys = {
  cwd: '/home/me/my-app',
  env: { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/home/me/.config/claude' },
  broken: ['xdg-open'],
}
const WSL: Sys = { cwd: '/home/me/my-app', env: { HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu-22.04' }, broken: ['wslview'] }

type Calls = { run: string[][]; cmd: string[]; dirs: string[]; toasts: string[]; opens: any[]; closes: string[]; clock?: any; forks: string[]; copies: string[]; writes: Array<{ path: string; text: string }>; fills: Array<{ text: string; mode: string }>; lists: string[] }
// 新功能的测试用: 可变的用量 / 子代理列表 / 手动拨的时钟 (只替换 clock.now, 定时器仍是空的)
// mockClock: 用 mock.clock(on) 从这个时刻起的内存时钟代替下面三个假时钟 (定时器会真的走, 测试拨 calls.clock)
// toolGate: 工具调用等它放行才结束 (测 "工具在跑时" 用)
// lang: 存进 store 的界面语言 (默认 zh, 旧测试都按中文写; null = 不存, 走 auto -> 英文)
// fork / copyOk / writeFails / language: 交接功能用 ($.model.fork 的回答、剪贴板成不成、写文件抛不抛错、Claude 的 language 设置)
// fillResult: $.prompt.fill 的回答 (默认填进去了; 可以模拟对话框挡着 / 没有输入框)
// handoffs: 交接文件夹 (<配置目录>/handoffs/my-app/) 里的东西, 给 $.fs.list / $.fs.read 用 (不给 = 文件夹不存在); draft: 输入框里已经打的字
type HandoffFile = { name: string; text?: string; mtimeMs?: number; kind?: 'file' | 'dir' }
// toolError: 这次工具调用要不要报错 (isError)
// toolResult: 这次工具调用返回的 result (比如 WebSearch 的结果列表)
type Opts = { toolResult?: (e: any) => any; toolError?: (e: any) => boolean; handoffs?: () => HandoffFile[] | undefined; draft?: string; fillResult?: (e: any) => any; usage?: () => any; agents?: () => any[]; now?: () => number; mockClock?: number; store?: Record<string, unknown>; toolGate?: () => Promise<void>; lang?: 'en' | 'zh' | null; fork?: () => Promise<any>; copyOk?: boolean; writeFails?: boolean; language?: string }

function mocks(on: any, calls: Calls, sys: Sys = WIN, opts: Opts = {}) {
  // 存储用内存里的假存储: 测试里的 /hud top 不能写进用户真实的偏好文件
  mock.store(on, { ...(opts.lang === null ? {} : { lang: opts.lang ?? 'zh' }), ...opts.store })
  if (opts.mockClock !== undefined) calls.clock = mock.clock(on, { now: opts.mockClock })
  else {
    on('clock.now', async () => ({ value: opts.now ? opts.now() : Date.now() }))
    on('clock.every', async () => ({ value: undefined }))
    on('clock.after', async () => ({ value: undefined }))
  }
  on('ui.render', async ($: any, e: any) => $.ui.resolve(e).Text({ children: ['engine-base'] }))
  on('ui.toast', async ($: any, e: any) => {
    calls.toasts.push(String(e?.text ?? ''))
    return { value: undefined }
  })
  // 引擎只把「按钮处理还没结束时」打开的面板算作用户要的 (任何宽度都放); 处理完了才打开的算没人要, 144 列以下不放.
  //   这里记下每次打开时是不是还在按钮处理里 (duringPress)
  let pressDepth = 0
  on('ui.press', async ($: any, e: any, next: any) => {
    pressDepth += 1
    try {
      return await next(e)
    } finally {
      pressDepth -= 1
    }
  })
  on('ui.open', async ($: any, e: any) => {
    calls.opens.push({ ...e, duringPress: pressDepth > 0 })
    return { value: { isPlaced: true } }
  })
  on('ui.close', async ($: any, e: any) => {
    calls.closes.push(String(e?.id ?? ''))
    return { value: undefined }
  })
  // 交接文件夹: 路径按结尾认 (测试引擎可能把 C:\ 路径规整成本机写法)
  const inHandoffs = (p: unknown) => /[\\/]handoffs[\\/]my-app$/.test(String(p ?? '').replace(/[\\/]+$/, ''))
  on('fs.list', async ($: any, e: any) => {
    calls.lists.push(String(e?.path ?? ''))
    const files = opts.handoffs?.()
    if (!files || !inHandoffs(e?.path)) throw new Error('ENOENT: no such file or directory')
    return { value: files.map(f => ({ name: f.name, kind: f.kind ?? 'file', size: (f.text ?? '').length, mtimeMs: f.mtimeMs ?? 0, isLink: false })) }
  })
  on('fs.read', async ($: any, e: any, next: any) => {
    const path = String(e?.path ?? '')
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const f = opts.handoffs?.()?.find(h => h.name === path.slice(cut + 1))
    if (f && inHandoffs(path.slice(0, cut))) return { value: f.text ?? '' }
    return next(e)
  })
  on('prompt.read', async () => ({ value: { text: opts.draft ?? '', cursor: (opts.draft ?? '').length } }))
  on('turn.start', async ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async ($: any, e: any) => {
    if (opts.toolGate) await opts.toolGate()
    return opts.toolError?.(e) ? { result: {}, text: 'boom', isError: true } : { result: opts.toolResult?.(e) ?? {}, text: 'ok' }
  })
  on('classic.SubagentStart', async () => ({}))
  on('classic.SessionStart', async () => ({}))
  on('prompt.fill', async ($: any, e: any) => {
    const r = opts.fillResult ? opts.fillResult(e) : { isFilled: true }
    if (r?.isFilled) calls.fills.push({ text: String(e.text), mode: String(e.mode) })
    return r
  })
  on('classic.SubagentStop', async () => ({}))
  on('classic.PermissionRequest', async () => ({}))
  on('classic.Notification', async () => ({}))
  on('session.compact', async () => ({ messages: [{ role: 'user', text: '(summary)', toolUses: [] }] }))
  on('prompt.edit', async ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', async ($: any, e: any) => ({ text: e.text }))
  on('ui.log', async () => ({ value: undefined }))
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: opts.usage ? opts.usage() : USAGE }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: sys.cwd }))
  on('session.root', async () => ({ value: sys.root ?? sys.cwd }))
  // 测试跑在 Windows 上, 引擎可能把 /System/... 规整成本机写法, 只比结尾
  on('fs.exists', async ($: any, e: any) => ({ value: !!sys.mac && /[\\/]System[\\/]Library[\\/]CoreServices$/.test(String(e.path ?? e)) }))
  on('settings.read', async () => ({ value: { effortLevel: 'medium', ...(opts.language ? { language: opts.language } : {}) } }))
  on('model.fork', async ($: any, e: any) => {
    calls.forks.push(String(e.prompt ?? ''))
    return { value: opts.fork ? await opts.fork() : { isAnswered: true, text: '## Goal\nHANDOFF BODY', usage: {} } }
  })
  on('ui.copy', async ($: any, e: any) => {
    if (opts.copyOk === false) return { value: { isCopied: false } }
    calls.copies.push(String(e.text ?? ''))
    return { value: { isCopied: true } }
  })
  on('fs.write', async ($: any, e: any) => {
    if (opts.writeFails) throw new Error('EACCES: permission denied')
    calls.writes.push({ path: String(e.path), text: String(e.text) })
    return { value: undefined }
  })
  on('agent.list', async () => ({ value: opts.agents ? opts.agents() : [{ id: 'a', description: 'x', type: 'fork', status: 'running' }] }))
  on('command.register', async ($: any, e: any) => ({ value: { command: e.name } }))
  on('agent.spawn', async ($: any, e: any) => ({ model: 'claude-sonnet-5-5', agentId: 'sp-' + String(e.description ?? 'x').replace(/[^A-Za-z0-9]+/g, '-') }))
  on('command.run', async ($: any, e: any) => {
    calls.cmd.push(e.command)
    return { value: {} }
  })
  on('session.id', async () => ({ value: 'abc-123' }))
  on('env.get', async ($: any, e: any) => ({ value: sys.env[String(e.name ?? e)] }))
  on('process.run', async ($: any, e: any) => {
    const argv: string[] = e.argv ?? e
    calls.run.push(argv)
    calls.dirs.push(String(e.init?.cwd ?? ''))
    if (sys.broken?.includes(argv[0])) return { value: { exitCode: 3, stdout: '', stderr: '' } }
    const s = JSON.stringify(argv)
    if (argv[0] === 'node') {
      // 统计脚本: 与本机实测的一个会话同量级
      return { value: { exitCode: 0, stdout: JSON.stringify({ found: true, input: 1646, output: 716680, cacheRead: 332073078, cacheWrite: 12632343 }), stderr: '' } }
    }
    const stdout = s.includes('show-current') ? 'codex/research\n' : ' M a.py\n M b.py\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
}

async function start($: any, on: any, sys: Sys = WIN, opts: Opts = {}) {
  const calls: Calls = { run: [], cmd: [], dirs: [], toasts: [], opens: [], closes: [], forks: [], copies: [], writes: [], fills: [], lists: [] }
  mocks(on, calls, sys, opts)
  await $.session.start({ cwd: sys.cwd } as any)
  return calls
}

async function mountHint($: any, surface: 'terminal' | 'desktop', cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface,
    component: 'PromptHint',
    requestId: 'hint',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { isDraft: false, isWorking, hint: '? for shortcuts' },
  } as any)
}

async function mountBand($: any, cols: number, hasSurvey = false) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: true },
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

async function strings(ui: any): Promise<string[]> {
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  const labels = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label))
  return [...texts, ...labels]
}

test('面板在输入框下方，引擎自己的提示行保留；有档位、本周用量；面板里没有螃蟹 (螃蟹在上方的散步道)', async ($, on) => {
  await start($, on)
  for (const cols of [140, 118]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const all = await strings(ui)
      for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      expect(all).toContain('本周')
      expect(all).toContain('5小时')
      expect(all).toContain('my-app')
      expect(all.some(t => t.includes('medium'))).toBe(true)
      expect(all).toContain('engine-base')
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('三行的每一列宽度一致（网格对齐）', async ($, on) => {
  await start($, on)
  const ui = await mountHint($, 'terminal', 118)
  const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
  const widthOf = (k: string) => boxes.find((b: any) => b.key === k)?.props.width
  for (const c of [0, 1, 2]) {
    expect(widthOf('r1c' + c)).toBeDefined()
    expect(widthOf('r2c' + c)).toBe(widthOf('r1c' + c))
    expect(widthOf('r3c' + c)).toBe(widthOf('r1c' + c))
  }
  await ui.unmount()
})

test('工作中和闲置时，每一段的位置和宽度完全相同', async ($, on) => {
  await start($, on)
  const shape = async (working: boolean) => {
    const ui = await mountHint($, 'terminal', 118, working)
    const boxes = (await ui.findAll({ type: 'Box' })).map((b: any) => [b.key, b.props.width])
    const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
    await ui.unmount()
    return JSON.stringify({ boxes, buttons })
  }
  expect(await shape(true)).toBe(await shape(false))
})

test('点项目名经 cmd start 打开文件夹；双击只开一次；点本周跑 /usage', async ($, on) => {
  const calls = await start($, on)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => a[0] === 'cmd.exe')
  expect(opens.length).toBe(1)
  expect(opens[0]).toEqual(['cmd.exe', '/d', '/c', 'start', 'cc-hud', CWD])
  await ui.press({ key: 'btn-wk' })
  expect(calls.cmd).toContain('usage')
  await ui.unmount()
})

// v0.16: 面板去掉螃蟹那 15+2 列后各档分界前移 17 列: 完整版 81 列起, 中等版 51-80 列, 精简版不到 51 列
//   (旧测试里的列数减 17, 格子几何完全不变)
test('80 列 (macOS 默认窗口) 用中等版: 3 行 x 2 列 (没有螃蟹)，右列是三根用量条', async ($, on) => {
  await start($, on)
  for (const cols of [65, 73, 80]) {
    const ui = await mountHint($, 'terminal', cols)
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    const keys = boxes.map((b: any) => b.key).sort()
    expect(keys).toEqual(['r1c0', 'r1c1', 'r2c0', 'r2c1', 'r3c0', 'r3c1'])
    const w = boxes.map((b: any) => b.props.width)
    expect(new Set(w).size).toBe(1)
    const all = await strings(ui)
    for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    for (const want of ['模型', '项目', '状态', '上下文', '5小时', '本周', 'my-app']) expect(all.some(s => s.includes(want)) ? 'ok' : 'missing ' + want).toBe('ok')
    await ui.unmount()
  }
})

test('很窄的终端用一行精简版 (没有螃蟹)；桌面端不画面板，只留引擎自己的提示行', async ($, on) => {
  await start($, on)
  const t = await mountHint($, 'terminal', 45)
  expect(await t.find({ type: 'Raster' })).toBeUndefined()
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true)
  expect((await t.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-crab')).toBe(false)
  for (const s of await strings(t)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await t.unmount()
  const d = await mountHint($, 'desktop', 140)
  expect(await d.find({ type: 'Raster' })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /%/ })).toBeUndefined()
  expect(await d.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await d.unmount()
})

test('每种工具跑的时候大螃蟹的精灵 (散步道里那只) 和状态文字都能画出来', async ($, on) => {
  setLang('zh')
  const seen: Record<string, string> = {}
  const cases: Array<[string, string]> = [
    ['Read', '读文件'],
    ['Edit', '改文件'],
    ['Bash', '跑命令'],
    ['WebSearch', '搜网页'],
    ['Agent', '派子代理'],
    ['TodoWrite', '记待办'],
    ['mcp__zotero__search', 'zotero:search'],
    ['mcp__Claude_Browser__resize_window', 'Claude_Browser:resize_window'],
  ]
  // 每个格子 = 3 个 u32: 字符 / 前景 / 背景; 字符只能是 空格 ▀ ▄
  const okChars = new Set([32, 0x2580, 0x2584])
  const check = (b64: string, cells: number) => {
    const bin = atob(b64)
    const words = new Uint32Array(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer)
    expect(words.length).toBe(cells * 3)
    for (let i = 0; i < words.length; i += 3) expect(okChars.has(words[i]) ? 'ok' : 'bad ' + words[i]).toBe('ok')
  }
  for (const [tool, label] of cases) {
    for (const opts of [{}, { pct: 85, agents: 2 }, { pct: 97 }, { working: false, agents: 3 }]) {
      const r = previewScene(tool, opts)
      expect(r.label).toContain(label)
      r.frames.forEach((b64, i) => check(b64, i % 2 === 0 ? 15 * 3 : 8 * 1))
      // 动画: 24 帧里至少有 2 种不同的画面
      expect(new Set(r.frames.filter((_, i) => i % 2 === 0)).size > 1 ? 'animated' : 'static').toBe('animated')
    }
  }
})

test('token 统计: 读会话记录 (含子代理) 得到总数和输出数；本会话标签和折合花费', async ($, on) => {
  const calls = await start($, on)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/scripts[\\/]count-tokens\.js$/)
  expect(node?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  let text = ''
  for (let i = 0; i < 5 && !text.includes('M'); i++) {
    const ui = await mountHint($, 'terminal', 124)
    const all = await strings(ui)
    text = all.find(s => s.includes(' out ') || s.includes('统计中')) ?? all.join(' | ')
    expect(all).toContain('token')
    expect(all.some(s => s.trim() === '本会话')).toBe(true)
    expect(all.some(s => s.startsWith('$3.21'))).toBe(true)
    await ui.unmount()
  }
  // 1646 + 716680 + 332073078 + 12632343 = 345,423,747
  expect(text).toContain('345.4M')
  expect(text).toContain('out 717k')
})

test('macOS: 会话记录在 ~/.claude 下、路径用 /；点项目名用 open 打开', async ($, on) => {
  const calls = await start($, on, MAC)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[1]).toMatch(/\/scripts\/count-tokens\.js$/)
  expect(node?.[2]).toBe('/Users/me/.claude/projects/-Users-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'open')).toEqual([['open', '/Users/me/my-app']])
  expect(calls.run.some(a => a[0] === 'cmd.exe')).toBe(false)
  await ui.unmount()
})

test('Linux: 设置了 CLAUDE_CONFIG_DIR 就在它下面找会话记录；xdg-open 打不开时改用 gio open', async ($, on) => {
  const calls = await start($, on, LINUX)
  const node = calls.run.find(a => a[0] === 'node')
  expect(node?.[2]).toBe('/home/me/.config/claude/projects/-home-me-my-app/abc-123.jsonl')
  expect(node?.[4]).toBe('/home/me/.config/claude/projects')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview'].includes(a[0]))
  expect(opens).toEqual([
    ['xdg-open', '/home/me/my-app'],
    ['gio', 'open', '/home/me/my-app'],
  ])
  await ui.unmount()
})

test('Claude 在终端里 cd 进子目录后：项目名、分支、会话记录、打开的文件夹都还按项目根目录', async ($, on) => {
  const CD: Sys = { root: CWD, cwd: CWD + '\\docs\\research', env: { USERPROFILE: 'C:\\Users\\me' } }
  const calls = await start($, on, CD)
  const node = calls.run.findIndex(a => a[0] === 'node')
  expect(calls.run[node]?.[2]).toBe('C:\\Users\\me\\.claude\\projects\\D--work-my-app\\abc-123.jsonl')
  const gitDirs = calls.run.map((a, i) => (a[0] === 'git' ? calls.dirs[i] : null)).filter(d => d !== null)
  expect(gitDirs.length > 0 && gitDirs.every(d => d === CWD)).toBe(true)
  const ui = await mountHint($, 'terminal', 140)
  const all = await strings(ui)
  expect(all).toContain('my-app')
  expect(all.includes('research')).toBe(false)
  await ui.press({ key: 'btn-project' })
  expect(calls.run.filter(a => a[0] === 'cmd.exe')).toEqual([['cmd.exe', '/d', '/c', 'start', 'cc-hud', CWD]])
  await ui.unmount()
})

test('WSL: 点项目名时没有 wslview 就经 wslpath 交给 Windows 的 explorer.exe', async ($, on) => {
  const calls = await start($, on, WSL)
  expect(calls.run.find(a => a[0] === 'node')?.[2]).toBe('/home/me/.claude/projects/-home-me-my-app/abc-123.jsonl')
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-project' })
  const opens = calls.run.filter(a => ['xdg-open', 'gio', 'wslview', 'sh'].includes(a[0]))
  expect(opens).toEqual([
    ['wslview', '/home/me/my-app'],
    ['sh', '-c', 'explorer.exe "$(wslpath -w "$1")"; exit 0', 'sh', '/home/me/my-app'],
  ])
  await ui.unmount()
})

async function mountDesktop($: any, cols: number, isWorking = false) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface: 'desktop',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols, rows: 40, isFullscreen: false },
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: cols, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} },
  } as any)
}

test('客户端版: 螃蟹和仪表盘两张 SVG, 无底板无边框无链接行; 内容齐全、转义正确; 螃蟹图在同一状态下不变', async ($, on) => {
  await start($, on)
  let crabFirst = ''
  for (let i = 0; i < 3; i++) {
    const ui = await mountDesktop($, 110)
    const svgs: any[] = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(2)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    const crab = svgs.find(s => String(s.props.alt).includes('螃蟹'))
    const dash = svgs.find(s => !String(s.props.alt).includes('螃蟹'))
    expect(crab?.props.isInteractive).toBeUndefined()
    // SVG 必须带明确宽高, 否则客户端可能按默认 300x150 放大
    expect([crab?.props.width, crab?.props.height]).toEqual([80, 40]) // v0.21: 顶上多留一行给跳
    const src = String(dash?.props.source ?? '')
    for (const want of ['my-app', 'medium', '本周', '5小时', '上下文', '$3.21', 'token', '345.4M', 'out ', '717k'])
      expect(src.includes(want) ? 'ok' : 'missing ' + want).toBe('ok')
    // 不再画底板和边框
    expect(/stroke=/.test(src) || /<rect x="0\.5" y="0\.5"/.test(src) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/stroke=/.test(String(crab?.props.source)) ? 'has frame' : 'no frame').toBe('no frame')
    expect(/&(?!amp;|lt;|gt;|quot;|#39;)/.test(src)).toBe(false)
    expect(src.length).toBeLessThan(131072)
    if (i === 0) crabFirst = String(crab?.props.source)
    else expect(String(crab?.props.source)).toBe(crabFirst)
    await ui.unmount()
  }
  // 很窄的客户端窗口: 自动只放一行用量条
  const narrow = await mountDesktop($, 55)
  const nd: any = (await narrow.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
  expect(String(nd?.props.source)).toContain('height="22"')
  await narrow.unmount()
})

test('/hud top / bottom 不再挪面板: 只回一句话, 不写 store; 面板照旧在输入框下方, 横栏里只有散步道; 有问卷时让位', async ($, on) => {
  await start($, on)
  for (const arg of ['top', 'bottom']) {
    const r: any = await $.command.run({ command: 'hud', args: arg } as any)
    expect(String(r?.text ?? r?.value?.text ?? JSON.stringify(r))).toContain('终端版面板固定在输入框下方，螃蟹在上方')
  }
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  await hint.unmount()
  // 横栏 (AbovePrompt) 里只有散步道 (Client): 天空行 + 3 行版 = 4 行, 没有面板的格子, 没有 Button
  const band = await mountBand($, 140)
  const cl: any = await band.find({ type: 'Client' })
  expect([cl?.props.width, cl?.props.height]).toEqual([140, 4])
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect((await band.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  expect((await band.findAll({ type: 'Button' })).length).toBe(0)
  await band.unmount()
  const survey = await mountBand($, 140, true)
  expect(await survey.find({ type: 'Client' })).toBeUndefined()
  await survey.unmount()
})

test('store 里以前存的 position=above (测试曾写进用户的 Mac) 一律忽略: 面板照旧在输入框下方', async ($, on) => {
  await start($, on, WIN, { store: { position: 'above' } })
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Box' })).some((b: any) => b.key === 'r1c0')).toBe(true)
  await hint.unmount()
  const band = await mountBand($, 140)
  expect((await band.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  await band.unmount()
})

// ======================== v0.12 新功能 ========================

// 收据和看板里还会出现间隔点 ·
const SAFE2 = /^[\x20-\x7E\u4E00-\u9FFF，│█▏▎▍▌▋▊▉─━╸▁▂▃▄▅▆▇✓·]*$/
const H = 3600_000
const iso = (ms: number) => new Date(ms).toISOString()
const lim = (kind: string, percentUsed: number, resetsAt: number) => ({ kind, percentUsed, resetsAt: iso(resetsAt) })
// 终端显示宽度 (中文 2 列)
const dwT = (s: string) => [...s].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)
// 一格里所有文字 + 按钮的总宽度
async function cellWidth(ui: any, key: string): Promise<number> {
  const box: any = (await ui.findAll({ type: 'Box' })).find((b: any) => b.key === key)
  let w = 0
  for (const c of box?.children ?? []) {
    if (typeof c === 'string') w += dwT(c)
    else if (c?.type === 'Button') w += dwT(String(c.props?.label ?? ''))
    else if (c?.type === 'Text') w += dwT((c.children ?? []).filter((x: any) => typeof x === 'string').join(''))
  }
  return w
}

async function mountTurn($: any, requestId: string, durationMs: number) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface: 'terminal',
    component: 'TurnDuration',
    requestId,
    viewport: { columns: 140, rows: 40, isFullscreen: true },
    props: { word: 'Baked', durationMs },
  } as any)
}

async function mountPane($: any, surface: 'terminal' | 'desktop', cols: number) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface,
    component: 'Pane',
    requestId: 'hud-agents',
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '子代理', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { top: 0, bodyRows: 30, totalRows: 10 }, view: {} },
  } as any)
}

test('配速: 公式、情绪档位、窗口刚开始不外推、没读数不报警', () => {
  const now = 1_800_000_000_000
  // 5小时窗口已过 1h 用了 90%: 配速 4.5, 约 6.7 分钟后用完 -> 慌张
  const a = paceOf(lim('five_hour', 90, now + 4 * H), now)!
  expect(Math.abs((a.ratio ?? 0) - 4.5) < 1e-9).toBe(true)
  expect(Math.round((a.runOutIn ?? 0) / 60000)).toBe(7)
  expect(a.willRunOut).toBe(true)
  expect(moodOf(a)).toBe('panic')
  // 已过 2h 用了 50%: 配速 1.25, 2h 后用完 (重置还要 3h) -> 冒汗
  const b = paceOf(lim('five_hour', 50, now + 3 * H), now)!
  expect(Math.abs((b.ratio ?? 0) - 1.25) < 1e-9).toBe(true)
  expect(b.runOutIn).toBe(2 * H)
  expect(moodOf(b)).toBe('sweat')
  // 已过 3h 用了 23.5%: 配速 0.39 -> 悠闲
  const c = paceOf(lim('five_hour', 23.5, now + 2 * H), now)!
  expect(c.willRunOut).toBe(false)
  expect(moodOf(c)).toBe('chill')
  // 已过 2.5h 用了 45%: 配速 0.9 -> 正常
  expect(moodOf(paceOf(lim('five_hour', 45, now + 2.5 * H), now))).toBe('normal')
  // 本周用了 96% -> 慌张; 取两个里更紧张的
  const w = paceOf(lim('seven_day', 96, now + 3 * 24 * H), now)
  expect(moodOf(c, w)).toBe('panic')
  expect(moodOf(c, b)).toBe('sweat')
  // 负路径: 窗口才过 3 分钟 (不到 2%) 用了 3% -> 不外推, 不报警
  const early = paceOf(lim('five_hour', 3, now + 5 * H - 3 * 60000), now)!
  expect(early.ratio).toBeUndefined()
  expect(early.willRunOut).toBe(false)
  expect(moodOf(early)).toBe('normal')
  // 本周窗口满 1 天才算配速: 才过 7h 用了 6% (按速度外推 4 天多用完) -> 不外推, 不报警; 23h 用了 30% 也不算
  const wk7h = paceOf(lim('seven_day', 6, now + 7 * 24 * H - 7 * H), now)!
  expect(wk7h.ratio).toBeUndefined()
  expect(wk7h.willRunOut).toBe(false)
  expect(moodOf(wk7h)).toBe('normal')
  expect(paceOf(lim('seven_day', 30, now + 7 * 24 * H - 23 * H), now)!.willRunOut).toBe(false)
  // 过了 25h 用了 30%: 配速 2.0, 约 58h 后用完 (重置还要 143h) -> 报警, 冒汗
  const wk25h = paceOf(lim('seven_day', 30, now + 7 * 24 * H - 25 * H), now)!
  expect(wk25h.willRunOut).toBe(true)
  expect(moodOf(wk25h)).toBe('sweat')
  // 已过比例 (时间刻度用): 1h/5h = 0.2; 3 天/7 天; 窗口刚开始不外推也照样有 (0.01); 用量不到 1% 也有
  expect(Math.abs((a.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  expect(Math.abs((w?.elapsedFrac ?? -1) - 4 / 7) < 1e-9).toBe(true)
  expect(Math.abs((early.elapsedFrac ?? -1) - 0.01) < 1e-9).toBe(true)
  expect(Math.abs((paceOf(lim('five_hour', 0, now + 4 * H), now)?.elapsedFrac ?? -1) - 0.2) < 1e-9).toBe(true)
  // 重置时刻已过 -> 1; 重置时间比窗口还远 (时钟不准) -> 夹到 0
  expect(paceOf(lim('five_hour', 40, now - H), now)?.elapsedFrac).toBe(1)
  expect(paceOf(lim('five_hour', 40, now + 6 * H), now)?.elapsedFrac).toBe(0)
  // 负路径: 没有重置时间 / 没有读数 / 不认识的窗口
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'five_hour', percentUsed: 99 }, now)?.elapsedFrac).toBeUndefined()
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.willRunOut).toBe(false)
  expect(paceOf({ kind: 'spend_limit', percentUsed: 80, resetsAt: iso(now + H) }, now)?.elapsedFrac).toBeUndefined()
  expect(moodOf(undefined, undefined)).toBe('normal')
})

test('配速预警上面板: 会用完时 5小时 的百分比变红, 写红色 "30m用完" (放不下换 "2h用完", 再放不下照常写暗色重置倒计时); 红色的时间一定带 "用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  // 5小时: 已过 2h 用了 80% -> 30 分钟后用完 ("30m用完" 正好 7 列); 本周: 已过 4 天用了 12% -> 不报警, 3 天后重置
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const noOld = async (ui: any) => {
    for (const x of await ui.findAll({ type: 'Text' })) {
      expect(/后重置|后用完|约/.test(x.text) ? 'old text: ' + x.text : 'ok').toBe('ok')
      // 只有一个时间的红字会被看成重置倒计时: 红色的时间必须带 "用完"
      if (x.props.color === '#f87171' && /\d+[mhd]/.test(x.text)) expect(x.text.includes('用完') ? 'ok' : 'bare red time: ' + x.text).toBe('ok')
    }
  }
  // 完整版 (140 列, 附加 7 列) 和中等版 (73 列, 附加 11 列): "30m用完"
  for (const cols of [140, 73]) {
    const ui = await mountHint($, 'terminal', cols)
    const h5 = await meterOf(ui, 'h5')
    expect(h5.extra?.text).toBe('30m用完')
    expect(h5.extra?.color).toBe('#f87171')
    expect(h5.extra?.bold).toBe(true)
    expect(h5.pct?.color).toBe('#f87171')
    expect(h5.pct?.bold).toBe(true)
    // 本周照旧: 暗色倒计时, 百分比不是红的
    const wk = await meterOf(ui, 'wk')
    expect(wk.extra?.text).toBe('3d0h')
    expect(wk.extra?.color).toBe('#71717a')
    expect(wk.pct?.color === '#f87171').toBe(false)
    // 只有 5小时 那段写了 "用完"
    expect((await ui.findAll({ type: 'Text' })).filter((x: any) => x.text.includes('用完')).length).toBe(1)
    await noOld(ui)
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    await ui.unmount()
  }
  // 中等版窄的时候 (65 列, 附加 5 列) 连 "30m用完" 也放不下: 照常写暗色的重置倒计时 (3h00m), 只有百分比红
  const mid = await mountHint($, 'terminal', 65)
  const m5 = await meterOf(mid, 'h5')
  expect(m5.extra?.text).toBe('3h00m')
  expect(m5.extra?.color).toBe('#71717a')
  expect(m5.pct?.color).toBe('#f87171')
  await noOld(mid)
  await mid.unmount()
  // 精简版: 只有 5小时 那个百分比是红的 (上下文 82% 不是)
  //   v1.1: 一行版最前面多了 [设置] [交接], 45 列的终端放不下 5小时 那根条了: 在 100 列里切到精简来看
  await $.command.run({ command: 'hud', args: 'compact' } as any)
  const narrow = await mountHint($, 'terminal', 100)
  const pctTexts = (await narrow.findAll({ type: 'Text' })).filter((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')
  expect(pctTexts.length).toBe(1)
  await narrow.unmount()
  await $.command.run({ command: 'hud', args: 'full' } as any)
  // 用完还早 (2 小时后): 完整版 7 列放不下 "2h00m用完" -> 换粗一点的红色 "2h用完"; 中等版 11 列放得下
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late = await mountHint($, 'terminal', 140)
  const l5 = await meterOf(late, 'h5')
  expect(l5.extra?.text).toBe('2h用完')
  expect(l5.extra?.color).toBe('#f87171')
  await noOld(late)
  await late.unmount()
  // 本周会用完 (过了 30h 用了 25%, 3 天多后用完): 完整版写红色 "3d用完", 不写光秃秃的 "3d18h"
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 25, t + 7 * 24 * H - 30 * H)] }
  const wkWarn = await mountHint($, 'terminal', 140)
  const ww = await meterOf(wkWarn, 'wk')
  expect(ww.extra?.text).toBe('3d用完')
  expect(ww.extra?.color).toBe('#f87171')
  expect(ww.pct?.color).toBe('#f87171')
  await noOld(wkWarn)
  await wkWarn.unmount()
  // 负路径 (用户截图那种): 本周才过 7h 用了 6% -> 不满 1 天不预警: 暗色重置倒计时 "6d17h", 百分比不红
  usage = { ...USAGE, rateLimits: [lim('five_hour', 10, t + 4 * H), lim('seven_day', 6, t + 7 * 24 * H - 7 * H)] }
  const wkEarly = await mountHint($, 'terminal', 140)
  const we = await meterOf(wkEarly, 'wk')
  expect(we.extra?.text).toBe('6d17h')
  expect(we.extra?.color).toBe('#71717a')
  expect(we.pct?.color === '#f87171').toBe(false)
  await wkEarly.unmount()
  usage = { ...USAGE, rateLimits: [lim('five_hour', 50, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const late90 = await mountHint($, 'terminal', 73)
  expect((await meterOf(late90, 'h5')).extra?.text).toBe('2h00m用完')
  await late90.unmount()
  // 负路径: 配速正常时没有 "用完", 百分比不红, 文字只是暗色的重置倒计时
  usage = { ...USAGE, rateLimits: [lim('five_hour', 23.5, t + 2 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  for (const cols of [140, 73, 45]) {
    const ok = await mountHint($, 'terminal', cols)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => x.text.includes('用完'))).toBe(false)
    expect((await ok.findAll({ type: 'Text' })).some((x: any) => /^\d+%$/.test(x.text.trim()) && x.props.color === '#f87171')).toBe(false)
    if (cols !== 45) {
      const o5 = await meterOf(ok, 'h5')
      expect(o5.extra?.text).toBe('2h00m')
      expect(o5.extra?.color).toBe('#71717a')
    }
    await noOld(ok)
    await ok.unmount()
  }
})

test('大螃蟹的精灵 (散步道里那只) 的情绪: 悠闲戴墨镜、冒汗有汗滴、慌张举钳加 "!"; 客户端 SVG 也画出来', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const chill = previewPixels('', { working: false, mood: 'chill' })
  const C = chill.colors
  expect(chill.big.every(px => at(px, 3, 1) === C.shades && at(px, 7, 1) === C.shades)).toBe(true)
  // 负路径: 正常时没有墨镜
  expect(previewPixels('', { working: false, mood: 'normal' }).big.some(px => at(px, 3, 1) === C.shades)).toBe(false)
  const sweat = previewPixels('Read', { working: true, mood: 'sweat' })
  expect(sweat.big.some(px => at(px, 1, 0) === C.sweat || at(px, 1, 1) === C.sweat)).toBe(true)
  const panicIdle = previewPixels('', { working: false, mood: 'panic' })
  expect(panicIdle.big.some(px => at(px, 13, 0) === C.alarm && at(px, 13, 3) === C.alarm)).toBe(true)
  // 举钳: 左钳竖在 x=0 的第 0-1 行
  expect(panicIdle.big.every(px => at(px, 0, 0) === C.body || at(px, 0, 1) === C.body)).toBe(true)
  // v1.3 (A): 干活时慌张也不在头边画红条 (汗珠甩进天空行, 见 v1.3 的测试)
  const panicWork = previewPixels('Bash', { working: true, mood: 'panic' })
  expect(panicWork.big.some(px => at(px, 1, 0) === C.alarm)).toBe(false)
  // 庆祝时不画情绪标记
  expect(previewPixels('', { working: false, celebrating: true, mood: 'panic' }).big.some(px => at(px, 1, 0) === C.alarm)).toBe(false)
  const svg = (mood: any, mode: any = 'idle') => crabSvg({ mode, kind: 'think', heat: 'ok', agents: 0, mood }, 5)
  expect(svg('chill')).toContain('#09090b')
  expect(svg('normal')).not.toContain('#09090b')
  expect(svg('sweat')).toContain('#60a5fa')
  expect(svg('panic')).toContain('#ef4444')
  expect(svg('panic', 'work')).not.toContain('#ef4444')
})

test('每轮收据: 引擎那行原样保留, 后面追加花费/改文件/工具次数; 对不上的行不显示', async ($, on) => {
  let t = Date.now() + 600_000
  let usage: any = { ...USAGE, cost: { usd: 1 } }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  // 负路径: 这一轮开始之前就画出来的行 (更早的回合)
  const old = await mountTurn($, 'msg-old', 9000)
  await old.unmount()
  t += 1000
  await $.turn.start({ text: 'hi', turnId: 'r-1' } as any)
  await $.tool.call({ tool: 'Edit', file_path: 'D:\\work\\my-app\\a.ts', old_string: 'x', new_string: 'y\nz' } as any)
  await $.tool.call({ tool: 'Write', file_path: 'D:\\work\\my-app\\b.ts', content: '1\n2\n3\n' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  usage = { ...usage, cost: { usd: 1.42 } }
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-1', reason: 'answer' } as any)
  t += 50
  const row = await mountTurn($, 'msg-r1', 9050)
  const texts = (await row.findAll({ type: 'Text' })).map((x: any) => x.text)
  expect(texts).toContain('engine-base')
  expect(texts).toContain(' · $0.42 · 改 2 个文件 +5 -1 · 工具 3 次')
  for (const s of texts) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await row.unmount()
  // 同一行重画还是同一张收据
  const again = await mountTurn($, 'msg-r1', 9050)
  expect((await again.findAll({ type: 'Text' })).some((x: any) => x.text.includes('$0.42'))).toBe(true)
  await again.unmount()
  // 负路径: 更早的那行、以及收据已经配给别的行之后新来的行, 都不显示
  for (const id of ['msg-old', 'msg-r1-dup']) {
    const r = await mountTurn($, id, 9000)
    expect((await r.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual(['engine-base'])
    await r.unmount()
  }
  // 负路径: 时长对不上 (30s vs 9s) 的行不显示
  t += 5000
  await $.turn.start({ text: 'again', turnId: 'r-2' } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\a.ts' } as any)
  t += 9000
  await $.turn.complete({ answer: '', durationMs: 9000, isAborted: false, turnId: 'r-2', reason: 'answer' } as any)
  const off = await mountTurn($, 'msg-r2-wrong', 30000)
  expect((await off.findAll({ type: 'Text' })).map((x: any) => x.text)).toEqual(['engine-base'])
  await off.unmount()
  // 没花钱、没改文件的那段省掉
  const r2 = await mountTurn($, 'msg-r2', 9000)
  expect((await r2.findAll({ type: 'Text' })).map((x: any) => x.text)).toContain(' · 工具 1 次')
  await r2.unmount()
  // 什么都没有 -> 空串 (只留引擎那行)
  expect(receiptText({ turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 0, usd: 0, files: 0, add: 0, del: 0, tools: 0 })).toBe('')
})

test('一键压缩: 上下文 >=75% 时三档都有 [压缩] 按钮, 点了跑 /compact 且防连点; 格子宽度不变', async ($, on) => {
  let usage: any = { ...USAGE }
  const calls = await start($, on, WIN, { usage: () => usage })
  const widths: Record<number, number> = {}
  for (const cols of [140, 65, 45]) {
    const ui = await mountHint($, 'terminal', cols)
    const btn: any = await ui.find({ type: 'Button', key: 'btn-compact' })
    expect(btn?.props.label).toBe('压缩')
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    if (cols !== 45) widths[cols] = await cellWidth(ui, cols === 140 ? 'r2c0' : 'r1c1')
    await ui.unmount()
  }
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-compact' })
  await ui.press({ key: 'btn-compact' })
  expect(calls.cmd.filter(c => c === 'compact').length).toBe(1)
  await ui.unmount()
  // 负路径: 50% 时没有按钮, 但那一格的总宽度和有按钮时一样
  usage = { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } }
  for (const cols of [140, 65]) {
    const low = await mountHint($, 'terminal', cols)
    expect(await low.find({ type: 'Button', key: 'btn-compact' })).toBeUndefined()
    expect(await cellWidth(low, cols === 140 ? 'r2c0' : 'r1c1')).toBe(widths[cols])
    await low.unmount()
  }
})

test('额度恢复提醒: 用到 >=30% 后重置时刻已过才提醒一次, 不重复; 用量从高位掉到 <5% 也算', async ($, on) => {
  let t = Date.now() + 1_200_000
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 40, t + H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { usage: () => usage, now: () => t })
  const end = () => $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'z', reason: 'answer' } as any)
  const restored = () => calls.toasts.filter(x => x.includes('额度已恢复')).length
  await end()
  expect(restored()).toBe(0) // 负路径: 还没到重置时刻
  t += 2 * H // 读数没变 (闲着没请求), 但重置时刻已过
  await end()
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  await end()
  expect(restored()).toBe(1) // 不重复
  // 新窗口: 先低后高, 再掉到 <5%
  usage = { ...usage, rateLimits: [lim('five_hour', 2, t + 5 * H)] }
  await end()
  expect(restored()).toBe(1) // 负路径: 低位开始的新窗口不提醒
  usage = { ...usage, rateLimits: [lim('five_hour', 35, t + 5 * H)] }
  await end()
  usage = { ...usage, rateLimits: [lim('five_hour', 3, t + 5 * H)] }
  await end()
  expect(restored()).toBe(2)
})

test('子代理看板: 点 "+1代理" 或 /hud agents 打开侧边面板; 显示描述/时长/最后工具/状态; 5 分钟没动静标红; 结束后保留', async ($, on) => {
  let t = Date.now() + 1_800_000
  let list: any[] = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'running' }]
  const calls = await start($, on, WIN, { agents: () => list, now: () => t })
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'Explore' } as any)
  const hint = await mountHint($, 'terminal', 140)
  const btn: any = await hint.find({ type: 'Button', key: 'btn-agents' })
  expect(btn?.props.label).toBe('+1代理')
  await hint.press({ key: 'btn-agents' })
  await hint.press({ key: 'btn-agents' })
  expect(calls.opens.length).toBe(1)
  expect(calls.opens[0]).toMatchObject({ id: 'hud-agents', closeOnEscape: true })
  await hint.unmount()
  await $.command.run({ command: 'hud', args: 'agents' } as any)
  expect(calls.opens.length).toBe(2)
  expect(calls.cmd.includes('agents')).toBe(false) // 没有去跑内置的 /agents
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await mountPane($, surface, 100)
    const all = await strings(pane)
    expect(all.some(s => s.includes('查文献'))).toBe(true)
    expect(all.some(s => s.includes('运行中'))).toBe(true)
    expect(all.some(s => s.includes('可能卡住'))).toBe(false)
    for (const s of all) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    // 只留引擎自己的 x 和 Esc, 不再画我们自己的 "关闭"
    expect(await pane.find({ type: 'Button', key: 'btn-agents-close' })).toBeUndefined()
    expect((await pane.findAll({ type: 'Button' })).length).toBe(0)
    await pane.unmount()
  }
  t += 6 * 60_000 // 6 分钟没有任何工具动作
  const stuck = await mountPane($, 'terminal', 100)
  const red = (await stuck.findAll({ type: 'Text' })).find((x: any) => x.text.includes('可能卡住'))
  expect(red?.props.color).toBe('#f87171')
  await stuck.unmount()
  // 结束: 保留在 "已结束" 里, 显示用时 (窄面板两行一个)
  await $.classic.SubagentStop({ agent_id: 'k1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: '找到 3 篇' } as any)
  list = [{ id: 'k1', description: '查文献', type: 'Explore', status: 'completed' }]
  const done = await mountPane($, 'terminal', 44)
  const txt = await strings(done)
  expect(txt.some(s => s.includes('已完成'))).toBe(true)
  expect(txt.some(s => s.includes('已结束'))).toBe(true)
  expect(txt.some(s => s.includes('用时 6m00s'))).toBe(true)
  expect(txt.some(s => s.includes('可能卡住'))).toBe(false)
  await done.unmount()
  // 没有子代理在跑时状态格里没有那个按钮
  list = []
  const quiet = await mountHint($, 'terminal', 140)
  expect(await quiet.find({ type: 'Button', key: 'btn-agents' })).toBeUndefined()
  await quiet.unmount()
})

test('点档位文字跑 /effort, 双击只算一次; 五格保持彩色', async ($, on) => {
  const calls = await start($, on)
  for (const cols of [140, 65]) {
    const ui = await mountHint($, 'terminal', cols)
    const b: any = await ui.find({ type: 'Button', key: 'btn-effort' })
    expect(b?.props.label).toBe('medium')
    const pip: any = (await ui.findAll({ type: 'Text' })).find((x: any) => x.text === '▁')
    expect(pip?.props.color).toBe('#60a5fa')
    await ui.unmount()
  }
  // 精简版 (有位置时) 也能点
  await $.command.run({ command: 'hud' } as any)
  const c = await mountHint($, 'terminal', 120)
  expect(((await c.find({ type: 'Button', key: 'btn-effort' })) as any)?.props.label).toBe('medium')
  expect((await c.findAll({ type: 'Box' })).some((b: any) => b.key === 'seg-ctx')).toBe(true) // 精简版 (一行, 没有螃蟹)
  expect(await c.find({ type: 'Raster' })).toBeUndefined()
  await c.unmount()
  await $.command.run({ command: 'hud' } as any)
  await $.command.run({ command: 'hud' } as any)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-effort' })
  await ui.press({ key: 'btn-effort' })
  expect(calls.cmd.filter(c => c === 'effort').length).toBe(1)
  await ui.unmount()
})

test('大螃蟹的精灵 (面板那套, v0.16 起画在散步道里) 不带子代理小螃蟹; 客户端 SVG 仍画 n 只', () => {
  const tools = ['Read', 'Edit', 'Bash', 'WebSearch', 'TodoWrite', 'Agent', '']
  for (const tool of tools) {
    for (const working of [true, false]) {
      const none = previewPixels(tool, { working, agents: 0, frames: 24 })
      for (const n of [1, 2, 3]) {
        const r = previewPixels(tool, { working, agents: n, frames: 24 })
        const C = r.colors
        // 大面板和精简版里都没有小螃蟹的颜色, 画面和没有子代理时逐帧相同
        for (const px of [...r.big, ...r.mini]) expect(px.flat().some(c => c === C.kid || c === C.kidLeg || c === C.kidEye)).toBe(false)
        expect(JSON.stringify(r.big)).toBe(JSON.stringify(none.big))
        expect(JSON.stringify(r.mini)).toBe(JSON.stringify(none.mini))
      }
    }
  }
  // 客户端 (不动): 干活 / 闲着 / 睡觉 / 庆祝时都画 n 只
  for (const n of [0, 1, 2, 3]) {
    for (const mode of ['work', 'idle', 'sleep', 'celebrate'] as const) {
      const svg = crabSvg({ mode, kind: 'read', heat: 'ok', agents: n }, 5)
      expect((svg.match(/class="kid"/g) ?? []).length).toBe(n)
      expect(svg.includes('#d4d4d8')).toBe(n === 0 && mode === 'work')
    }
  }
})

test('新按钮 ([压缩] / +1代理 / 档位) 放进去后, 从 51 到 200 列每一格的内容都不超出格子宽度', async ($, on) => {
  await start($, on)
  for (const cols of [51, 53, 65, 70, 73, 80, 81, 83, 101, 118, 123, 140, 200]) {
    for (const working of [false, true]) {
      const ui = await mountHint($, 'terminal', cols, working)
      const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
      expect(boxes.length > 0).toBe(true)
      for (const b of boxes) {
        const w = await cellWidth(ui, b.key)
        expect(w <= b.props.width ? 'ok' : `${cols} 列 ${b.key}: 内容 ${w} > 格子 ${b.props.width}`).toBe('ok')
      }
      await ui.unmount()
    }
  }
})

test('配速只比线性快一点 (1.05) 不报警; 明显偏快 (1.3) 才算会用完', async () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  // 5 小时窗口过了一半 (还剩 2.5 小时), 按线性该用 50%
  const resetsAt = new Date(now + 2.5 * 3600_000).toISOString()
  const slight = paceOf({ kind: 'five_hour', percentUsed: 52.5, resetsAt }, now)
  expect(slight?.willRunOut).toBe(false)
  expect(moodOf(slight)).toBe('normal')
  const fast = paceOf({ kind: 'five_hour', percentUsed: 65, resetsAt }, now)
  expect(fast?.willRunOut).toBe(true)
  expect(moodOf(fast)).toBe('sweat')
})

// ======================== v0.13: 时间刻度 / 宽度 ========================

// 一根用量条所在的那一格 (三档都按开头的标签按钮找: 上下文 btn-ctx / 精简版压缩时 btn-compact, 5小时 btn-h5, 本周 btn-wk)
// 返回: 条的每一格 (字符 + 颜色)、百分比、附加文字、百分比前面有几列、整格内容宽度
// (界面树里 Text 不带 key, 所以按格子里的子元素顺序认); boxes = 先取好的 Box 列表 (一次画面只取一次, 省时间)
const textOf = (c: any) => (typeof c === 'string' ? c : (c?.children ?? []).filter((x: any) => typeof x === 'string').join(''))
const widthOf = (c: any) => (c?.type === 'Button' ? dwT(String(c.props?.label ?? '')) : dwT(textOf(c)))
function meterIn(boxes: any[], k: 'ctx' | 'h5' | 'wk') {
  const btns = k === 'ctx' ? ['btn-ctx', 'btn-compact'] : ['btn-' + k]
  const box: any = boxes.find((b: any) => {
    const c0: any = (b.children ?? [])[0]
    return c0?.type === 'Button' && btns.includes(String(c0.props?.key))
  })
  const kids: any[] = box?.children ?? []
  const cells = kids.filter(c => c?.type === 'Text' && /^[━│]$/.test(textOf(c))).map(c => ({ text: textOf(c), color: c.props?.color }))
  const pi = kids.findIndex(c => c?.type === 'Text' && /^\s*(\d+%|--)$/.test(textOf(c)))
  let pctAt = 0
  for (let i = 0; i < pi; i++) pctAt += widthOf(kids[i])
  const el = (c: any) => (c ? { text: textOf(c).trim(), color: c.props?.color, bold: c.props?.bold } : undefined)
  return {
    box: box?.key as string | undefined,
    boxW: box?.props?.width as number | undefined,
    used: kids.reduce((w: number, c: any) => w + widthOf(c), 0),
    cells,
    pct: el(kids[pi]),
    extra: pi >= 0 && kids[pi + 1]?.type === 'Text' ? el(kids[pi + 1]) : undefined,
    pctAt: pi >= 0 ? pctAt : -1,
  }
}
const meterOf = async (ui: any, k: 'ctx' | 'h5' | 'wk') => meterIn(await ui.findAll({ type: 'Box' }), k)
async function tickOf(ui: any, k: 'ctx' | 'h5' | 'wk') {
  const { cells } = await meterOf(ui, k)
  return { bw: cells.length, idx: cells.map((c: any, i: number) => (c.text === '│' ? i : -1)).filter((i: number) => i >= 0), cells }
}

test('时间刻度: 5小时/本周 的条里正好一道亮色 │, 位置 = 已过时间/窗口 (四舍五入到格), 随时间右移; 条长不变; 上下文没有; 三档都有', async ($, on) => {
  let t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const set = (...ls: any[]) => (usage = { ...USAGE, rateLimits: ls })
  // 列数 = 旧版 (有螃蟹时) 的列数减 17, 格子几何不变; 最后一档在 80 列里切到精简 (一行版)
  //   v1.1: 一行版最前面多了 [设置] [交接], 48 列的终端放不下 5小时 那根条了, 改在 80 列里看一行版的刻度
  const widths = [[183, false], [123, false], [101, false], [88, false], [83, false], [73, false], [65, false], [80, true]] as const
  for (const [cols, compact] of widths) {
    if (compact) await $.command.run({ command: 'hud', args: 'compact' } as any)
    const seen: number[] = []
    // 5小时 已过 1h (0.2) -> 4h (0.8); 本周 已过 1 天 -> 6 天
    for (const [hrs, days] of [
      [1, 1],
      [4, 6],
    ]) {
      set(lim('five_hour', 23.5, t + (5 - hrs) * H), lim('seven_day', 12, t + (7 - days) * 24 * H))
      const ui = await mountHint($, 'terminal', cols)
      const a = await tickOf(ui, 'h5')
      expect(a.bw >= 3 ? 'ok' : `${cols} 列${compact ? ' (精简)' : ''}: 5小时的条只有 ${a.bw} 格`).toBe('ok')
      expect(a.idx).toEqual([Math.min(a.bw - 1, Math.round((hrs / 5) * a.bw))])
      expect(a.cells[a.idx[0]].color).toBe('#e5e5e5')
      // 刻度替换那一格的 ━, 条的总格数不变
      expect(a.cells.filter((c: any) => c.text === '━').length).toBe(a.bw - 1)
      if (cols >= 51) {
        const w = await tickOf(ui, 'wk')
        expect(w.idx).toEqual([Math.min(w.bw - 1, Math.round((days / 7) * w.bw))])
        expect(w.cells[w.idx[0]].color).toBe('#e5e5e5')
      }
      // 负路径: 上下文那根没有刻度
      const c = await tickOf(ui, 'ctx')
      expect(c.bw > 0 && c.idx.length === 0 ? 'ok' : `${cols} 列${compact ? ' (精简)' : ''}: 上下文的条 ${c.bw} 格, 刻度 ${c.idx}`).toBe('ok')
      for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      seen.push(a.idx[0])
      await ui.unmount()
    }
    expect(seen[1] > seen[0] ? 'ok' : `${cols} 列: 刻度没有右移 ${seen}`).toBe('ok')
    if (compact) await $.command.run({ command: 'hud', args: 'full' } as any)
  }
  // 刻度在彩色段里 (用量超过时间) 和暗色段里 (用量落后) 都是同一种亮色; 123 列 (旧版 140 列) 5小时 的条 17 格
  // 百分比有滚动过渡: 多画几次, 等 5小时 的数字停到目标值再看彩色段
  const settled = async (want: string) => {
    for (let i = 0; i < 40; i++) {
      const ui = await mountHint($, 'terminal', 123)
      if ((await meterOf(ui, 'h5')).pct?.text === want) return ui
      await ui.unmount()
    }
    throw new Error('5小时 的百分比没有停到 ' + want)
  }
  set(lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const ahead = await settled('80%')
  const ah = await tickOf(ahead, 'h5')
  expect(ah.bw).toBe(17)
  expect(ah.idx).toEqual([7]) // 0.4 x 17 = 6.8 -> 7
  expect(ah.cells[ah.idx[0] - 1].color === '#3f3f46').toBe(false) // 前一格是彩色
  expect(ah.cells[ah.idx[0] + 1].color === '#3f3f46').toBe(false) // 后一格也是彩色 (80% 已经超过刻度)
  await ahead.unmount()
  set(lim('five_hour', 10, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  const behind = await settled('10%')
  const bh = await tickOf(behind, 'h5')
  expect(bh.idx).toEqual([14]) // 0.8 x 17 = 13.6 -> 14
  expect(bh.cells[bh.idx[0] - 1].color).toBe('#3f3f46')
  expect(bh.cells[bh.idx[0]].color).toBe('#e5e5e5')
  await behind.unmount()
  // >=90% 用量条呼吸闪烁时, 刻度不跟着变色
  set(lim('five_hour', 95, t + 1 * H), lim('seven_day', 12, t + 3 * 24 * H))
  for (let i = 0; i < 3; i++) {
    const hot = await mountHint($, 'terminal', 123)
    const hh = await tickOf(hot, 'h5')
    expect(hh.cells[hh.idx[0]].color).toBe('#e5e5e5')
    await hot.unmount()
  }
  // 窗口刚开始 (过了 3 分钟, 配速不外推) 刻度照样画; 用量只占第 0 格那 1 格彩色时, 刻度让到第 1 格, 不盖住彩色
  set(lim('five_hour', 3, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const early = await settled('3%')
  const eh = await tickOf(early, 'h5')
  expect(eh.idx).toEqual([1])
  expect(['#3f3f46', '#e5e5e5'].includes(eh.cells[0].color)).toBe(false)
  await early.unmount()
  // 负路径: 用量 0% (没有彩色格) -> 刻度留在第 0 格
  set(lim('five_hour', 0, t + 5 * H - 3 * 60000), lim('seven_day', 12, t + 3 * 24 * H))
  const empty = await settled('0%')
  expect((await tickOf(empty, 'h5')).idx).toEqual([0])
  await empty.unmount()
  // 负路径: 没有重置时间 -> 不画刻度
  set({ kind: 'five_hour', percentUsed: 40 }, lim('seven_day', 12, t + 3 * 24 * H))
  for (const [cols, compact] of [[123, false], [65, false], [80, true]] as const) {
    if (compact) await $.command.run({ command: 'hud', args: 'compact' } as any)
    const none = await mountHint($, 'terminal', cols)
    const nh = await tickOf(none, 'h5')
    expect(nh.bw > 0 && nh.idx.length === 0 ? 'ok' : `${cols} 列${compact ? ' (精简)' : ''}: 5小时的条 ${nh.bw} 格, 刻度 ${nh.idx}`).toBe('ok')
    if (cols >= 51) expect((await tickOf(none, 'wk')).idx.length).toBe(1)
    await none.unmount()
    if (compact) await $.command.run({ command: 'hud', args: 'full' } as any)
  }
})

// 宽度测试用的三种读数: 上下文 82% (有 [压缩] 按钮) / 5小时 会用完 / 上下文 50% (没按钮)
const widthUsages = (t: number) => [
  { ...USAGE },
  { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] },
  { ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } },
]

// 注意: 面板宽度 = 终端列数 - 2, 所以 81 列起是完整版, 51-80 列是中等版 (v0.16 面板没有螃蟹, 比旧版各少 17 列)
test('完整版: 上下文 / 5小时 / 本周 三格总宽都正好等于列宽; 5小时/本周 附加 7 列, 省下的给条', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [81, 87, 88, 100, 102, 123, 183]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r2c0', 'r2c1', 'r2c2'])
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        // 条长 = 列宽 - 标签 7 - 百分比 5 - 1 - 附加; 上下文附加 11 列时 5小时/本周 用 7 列;
        // 上下文的条不到 6 格、退到 5 列时, 三格都用 5 列 (条一样长, 不比 0.12 短)
        const inner = (ms[0].boxW ?? 0) - 7
        const wantCtx = inner - 17 >= 6 ? inner - 17 : inner - 11
        const wantLim = inner - 17 >= 6 ? inner - 13 : inner - 11
        expect(ms.map(m => m.cells.length)).toEqual([wantCtx, wantLim, wantLim])
        // 上下文附加 11 列时 (102 列起), 5小时/本周 的条比它长 4 格
        if (cols >= 102) expect(ms[1].cells.length - ms[0].cells.length).toBe(4)
        expect(ms[1].cells.length >= 5).toBe(true)
        await ui.unmount()
      }
    }
  }
})

test('中等版: 右列三根条一样长, 百分比竖着对齐, 每格总宽等于列宽', { timeoutMs: 30_000 }, async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  for (const u of widthUsages(t)) {
    usage = u
    for (const cols of [51, 59, 65, 73, 80]) {
      for (const working of [false, true]) {
        const ui = await mountHint($, 'terminal', cols, working)
        const boxes = await ui.findAll({ type: 'Box' })
        const ms = [meterIn(boxes, 'ctx'), meterIn(boxes, 'h5'), meterIn(boxes, 'wk')]
        expect(ms.map(m => m.box)).toEqual(['r1c1', 'r2c1', 'r3c1'])
        const lens = ms.map(m => m.cells.length)
        expect(lens[0] >= 3 && new Set(lens).size === 1 ? 'ok' : `${cols} 列 条长 ${lens}`).toBe('ok')
        const offs = ms.map(m => m.pctAt)
        expect(offs[0] > 0 && new Set(offs).size === 1 ? 'ok' : `${cols} 列 百分比位置 ${offs}`).toBe('ok')
        for (const m of ms) expect(m.used === m.boxW ? 'ok' : `${cols} 列 ${m.box}: 内容 ${m.used} != 列宽 ${m.boxW}`).toBe('ok')
        await ui.unmount()
      }
    }
  }
})

test('客户端仪表盘: 5小时/本周 的条上有亮色细竖线刻度 (略高出条, 随已过时间右移); 文字 "2h00m" / 红色 "30m 用完"; 没有 "后重置"', async ($, on) => {
  const t = Date.now()
  let usage: any = { ...USAGE, rateLimits: [lim('five_hour', 80, t + 3 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  await start($, on, WIN, { usage: () => usage, now: () => t })
  const dash = async (cols: number) => {
    const ui = await mountDesktop($, cols)
    const d: any = (await ui.findAll({ type: 'Svg' })).find((s: any) => !String(s.props.alt).includes('螃蟹'))
    const src = String(d?.props.source ?? '')
    await ui.unmount()
    return src
  }
  const redSpans = (src: string) => (src.match(/<tspan fill="#f87171"/g) ?? []).length
  const warn = await dash(140)
  expect((warn.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(warn).toContain('30m 用完')
  expect(warn).toContain('3d0h')
  expect(redSpans(warn)).toBe(2) // 5小时 的百分比 + "30m 用完"
  expect(/后重置|后用完|约/.test(warn)).toBe(false)
  // 窄的时候缩写也留着 "用完" ("4d12h 用完" -> "4d 用完"), 不出现光秃秃的红色时间 (会被看成重置倒计时)
  const redTexts = (src: string) => [...src.matchAll(/<tspan fill="#f87171"[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1].trim())
  const seenRed = new Set<string>()
  for (const width of [900, 760, 640, 560, 480, 420, 360]) {
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: { pct: 30, extra: '1h54m' }, week: { pct: 6, extra: '4d12h 用完', warn: true, tick: 0.04 }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width })
    for (const r of redTexts(svg)) {
      expect(/^\d+%$/.test(r) || r.includes('用完') ? 'ok' : `${width}px: bare red "${r}"`).toBe('ok')
      seenRed.add(r)
    }
  }
  expect(seenRed.has('4d12h 用完')).toBe(true)
  // 负路径: 配速正常 -> 没有 "用完", 没有红字; 刻度照样有
  //   (重置时间按这个测试自己的 t 算: USAGE 的是文件加载时算的, 机器忙时跑到这里已经过了一分多钟, 会显示 1h59m)
  usage = { ...USAGE, rateLimits: [lim('five_hour', 23.5, t + 2 * H), lim('seven_day', 12, t + 3 * 24 * H)] }
  const ok = await dash(140)
  expect(ok).toContain('2h00m')
  expect(ok.includes('用完')).toBe(false)
  expect(redSpans(ok)).toBe(0)
  expect((ok.match(/class="tick"/g) ?? []).length).toBe(2)
  expect(/后重置/.test(ok)).toBe(false)
  // 一行精简版也有刻度
  const narrow = await dash(55)
  expect((narrow.match(/class="tick"/g) ?? []).length).toBe(2)
  // 直接画: 刻度比条高, 在条的范围内, 已过比例越大越靠右; 不给 tick 不画
  const one = (tick?: number) => {
    const m = { pct: 30, extra: '1h54m', tick }
    const svg = dashSvg({ model: 'Opus 5.5', effort: 'medium', project: 'p', branch: '', session: '1m', cost: '', ctx: { pct: 10, extra: '' }, five: m, week: { pct: 3, extra: '' }, status: { text: '', tone: 'idle' }, tools: '', tokenTotal: '', tokenOutput: '' }, { width: 900 })
    const tk = svg.match(/<rect class="tick" x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="#e5e5e5"\/>/)
    return { svg, tk }
  }
  const a = one(0.2)
  const b = one(0.8)
  expect(a.tk && b.tk ? 'ok' : 'no tick').toBe('ok')
  expect(Number(b.tk![1]) > Number(a.tk![1])).toBe(true)
  // 条: y-6 高 5; 刻度: y-7.5 高 8 (上下各高出 1.5)
  const bar = a.svg.match(/<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="5" rx="2.5" fill="#3a3a40"\/>/g) ?? []
  expect(bar.length).toBe(3)
  const fiveBar = bar[1].match(/x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)"/)!
  const [bx, by, bw] = [Number(fiveBar[1]), Number(fiveBar[2]), Number(fiveBar[3])]
  for (const r of [a, b, one(0), one(1)]) {
    const [tx, ty, tw, th] = r.tk!.slice(1).map(Number)
    expect(ty < by && ty + th > by + 5).toBe(true)
    expect(tx >= bx - 0.05 && tx + tw <= bx + bw + 0.05).toBe(true)
  }
  expect(Math.abs(Number(a.tk![1]) + 0.75 - (bx + bw * 0.2)) < 0.1).toBe(true)
  expect(one(undefined).tk).toBeNull()
  expect(one(undefined).svg.includes('class="tick"')).toBe(false)
  expect(one(undefined).svg.includes('后重置')).toBe(false)
})

// ======================== v0.14-v0.16: 螃蟹散步道 (输入框正上方的横栏; v0.16 起是 Client 模块 walkway.tsx) ========================

// 散步道里还会出现气泡的「」和 ！, 以及盲文点粒子
const SAFE3 = /^[\x20-\x7E一-鿿，│█▀▄▏▎▍▌▋▊▉▐▖▗▘▙▚▛▜▝▞▟─━╸▁▂▃▄▅▆▇✓·「」！⠁-⣿]*$/
const KID_C = 0xf2a07b
const KID_L = 0xa4553d
const BODY = 0xd97757
const EYE = 0x1c1917
const isBraille = (ch: string) => ch.length > 0 && ch.codePointAt(0)! > 0x2800 && ch.codePointAt(0)! <= 0x28ff
const popcount = (n: number) => n.toString(2).replace(/0/g, '').length

async function mountAbove($: any, cols: number, maxRows: number, o: { working?: boolean; fullscreen?: boolean; survey?: boolean } = {}) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: cols + 5, rows: 40, isFullscreen: o.fullscreen ?? true },
    props: { hasSurvey: !!o.survey, isWorking: !!o.working, maxRows, bodyColumns: cols, scroll: { top: 0, bodyRows: maxRows, totalRows: 4 }, view: {} },
  } as any)
}
// Client 画出来的散步道: 每行一个 Box, 里面几段 Text -> 还原成每一格 (字符 + 颜色) 和半格像素
type WCell = { ch: string; fg?: number; bg?: number }
async function walkOf(ui: any) {
  const client: any = await ui.find({ type: 'Client' })
  const root: any = await ui.find({ in: 'walkway', type: 'Box', key: 'walk' })
  const num = (c?: string) => (c ? parseInt(c.slice(1), 16) : undefined)
  const rows: WCell[][] = (root?.children ?? []).map((row: any) => {
    const cells: WCell[] = []
    for (const t of row.children ?? []) {
      const fg = num(t.props?.color)
      const bg = num(t.props?.backgroundColor)
      for (const ch of (t.children ?? []).filter((x: any) => typeof x === 'string').join('')) {
        cells.push({ ch, fg, bg })
        if (dwT(ch) === 2) cells.push({ ch: '', fg, bg })
      }
    }
    return cells
  })
  const hpx: number[][] = []
  for (const r of rows) {
    const top: number[] = []
    const bot: number[] = []
    for (const c of r) {
      const q = quadOf(c)
      top.push(q[0] ?? -1, q[1] ?? -1)
      bot.push(q[2] ?? -1, q[3] ?? -1)
    }
    hpx.push(top, bot)
  }
  // 整格像素 = 每格左半边 (螃蟹落在半格上时, 它从下一格开始算; 和 bx 的算法一致)
  const px = hpx.map(row => row.filter((_, i) => i % 2 === 0))
  const text = rows.map(r => r.map(c => c.ch).join(''))
  const dots = rows.map(r => r.filter(c => isBraille(c.ch)).reduce((n, c) => n + popcount(c.ch.codePointAt(0)! - 0x2800), 0))
  // 大螃蟹的身体在哪几列 (身体色; 小螃蟹浅一号、道具别的颜色都不算)
  const crab = [...new Set(px.flatMap(row => row.map((c, x) => (c === BODY ? x : -1)).filter(x => x >= 0)))].sort((a, b) => a - b)
  // 半格位置: 身体色最左的那个半格
  const hcrab = hpx.flatMap(row => row.map((c, x) => (c === BODY ? x : -1)).filter(x => x >= 0))
  return { client, rows, px, hpx, text, dots, crab, bx: crab.length ? crab[0] : -1, hx: hcrab.length ? Math.min(...hcrab) : -1 }
}
// 一格 -> 四个半格像素 [左上, 右上, 左下, 右下]; 四分之一方块按位是前景色, 其余是背景色 (没有背景色 = 空)
const QUAD = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
function quadOf(c: WCell): number[] {
  const m = QUAD.indexOf(c.ch)
  if (m < 0 || c.ch === '') return [-1, -1, -1, -1]
  return [1, 2, 4, 8].map(bit => (m & bit ? (c.fg ?? -1) : (c.bg ?? -1)))
}
// 数小螃蟹: 某一行像素里浅橙色的连续段 (两只之间至少空 1 格)
function kidCount(px: number[][], y: number): number {
  const row = px[y] ?? []
  let n = 0
  row.forEach((c, x) => {
    if (c === KID_C && row[x - 1] !== KID_C) n++
  })
  return n
}
const decode = (b64: string) => new Uint32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer)
const mixDark = (c: number, t: number) => {
  const d = 0x27272a
  const ch = (s: number) => Math.round(((c >> s) & 255) * (1 - t) + ((d >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const lowUsage = () => ({ ...USAGE, context: { tokens: 100_000, window: 200_000, percent: 50 } })

test('散步道按 maxRows 退档: >=4 天空行 + 3 行版, 3 天空行 + 2 行版, 2 只有 2 行版, 1 行版, 0 不画; 天空行平时是空的; 宽度不超过 bodyColumns; 没有 Button; 问卷时让位', async ($, on) => {
  await start($, on, WIN, { usage: lowUsage, agents: () => [] })
  for (const cols of [40, 100, 200]) {
    for (const [maxRows, total, sky] of [
      [10, 4, true],
      [4, 4, true],
      [3, 3, true],
      [2, 2, false],
      [1, 1, false],
    ] as Array<[number, number, boolean]>) {
      const ui = await mountAbove($, cols, maxRows)
      const w = await walkOf(ui)
      expect([w.client?.props.width, w.client?.props.height]).toEqual([cols, total])
      expect(w.rows.length).toBe(total)
      for (const r of w.rows) expect(r.length <= cols ? 'ok' : `${cols}: 一行 ${r.length} 格`).toBe('ok')
      // 天空行: 闲着时一个像素都没有 (把上面的正文和螃蟹隔开)
      if (sky) expect(w.text[0].trim()).toBe('')
      expect(w.crab.length > 0).toBe(true)
      expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
      expect((await ui.findAll({ type: 'Button', in: 'walkway' })).length).toBe(0)
      for (const s of w.text) expect(SAFE3.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      await ui.unmount()
    }
  }
  const zero = await mountAbove($, 100, 0)
  expect(await zero.find({ type: 'Client' })).toBeUndefined()
  expect(await zero.find({ type: 'Text', text: /engine-base/ })).toBeDefined()
  await zero.unmount()
  const survey = await mountAbove($, 100, 10, { survey: true })
  expect(await survey.find({ type: 'Client' })).toBeUndefined()
  await survey.unmount()
})

test('悬停: 指针停到大螃蟹上 -> 立刻停下举钳, 气泡 (用量摘要 + 小贴士) 在停下那一刻定好位置和全文, 不压螃蟹也不出横栏; 离开约 0.5 秒后接着走; 队伍也停', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [{ id: 'k', description: 'k', type: 'x', status: 'running' }] })
  for (const [cols, maxRows] of [
    [120, 4],
    [70, 4],
    [120, 3],
  ]) {
    const ui = await mountAbove($, cols, maxRows)
    await clock.advance(10)
    await ui.advance(3000) // 子代理在跑: 大螃蟹在走
    const w0 = await walkOf(ui)
    await ui.advance(450)
    const w1 = await walkOf(ui)
    expect(w1.bx !== w0.bx).toBe(true)
    // 指针移到大螃蟹的格子上
    const top = maxRows >= 3 ? 1 : 0
    await ui.pointer({ type: 'move', x: w1.bx + 2, y: top + 1, in: 'walkway' } as any)
    const h0 = await walkOf(ui)
    const tipRow = h0.text[top]
    expect(tipRow.includes('上下文 50%') ? 'ok' : `${cols}x${maxRows}: 没有气泡 "${tipRow}"`).toBe('ok')
    await ui.advance(1500)
    const h1 = await walkOf(ui)
    expect(h1.bx).toBe(h0.bx) // 停着
    // 气泡不重算 (只比气泡那段; v0.19 起举钳分两步, 螃蟹那几格会从半举变成举起)
    const bubbleOf = (t: string) => t.replace(/[▀-▟].*$/, '').trimEnd()
    expect(bubbleOf(h1.text[top] ?? '')).toBe(bubbleOf(h0.text[top] ?? ''))
    // 气泡不压螃蟹: 气泡那几格 (字的颜色, 连着的一段) 没有螃蟹的身体
    const cellsTop = h1.rows[top]
    const start0 = cellsTop.findIndex(c => c.ch === '上')
    let end0 = start0
    while (end0 < cellsTop.length && cellsTop[end0].fg === 0xd4d4d8 && !'▀▄'.includes(cellsTop[end0].ch || 'x')) end0++
    expect(start0 >= 0 && end0 > start0).toBe(true)
    expect(h1.crab.some(x => x >= start0 && x < end0) ? `${cols}x${maxRows}: 气泡 ${start0}-${end0} 压到螃蟹 ${h1.crab}` : 'ok').toBe('ok')
    expect(end0 <= cols).toBe(true)
    if (maxRows >= 4) expect(h1.px[top * 2][h1.bx + 11]).toBe(BODY) // 3 行版: 右钳举到最上面一行
    // 队伍也停: 小螃蟹的像素不动
    expect(JSON.stringify(h1.px.map(r => r.map(c => (c === KID_C ? 1 : 0))))).toBe(JSON.stringify(h0.px.map(r => r.map(c => (c === KID_C ? 1 : 0)))))
    // 指针离开: 约 0.5 秒后接着走, 气泡收起
    await ui.pointer({ type: 'leave', x: w1.bx + 2, y: top + 1, in: 'walkway' } as any)
    await ui.advance(300)
    expect((await walkOf(ui)).bx).toBe(h0.bx)
    await ui.advance(1200)
    const after = await walkOf(ui)
    expect(after.bx !== h0.bx).toBe(true)
    expect(after.text[top].includes('上下文 50%')).toBe(false)
    // 按下不做任何事 (不会停, 也不报错)
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'walkway' } as any)
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'walkway' } as any)
    await ui.unmount()
  }
})

test('悬停: 指针在横栏别处时大螃蟹不停 (闲着时眼睛看过去); 不是全屏也照样能画 (没有指针事件就没有悬停)', async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [{ id: 'k', description: 'k', type: 'x', status: 'running' }] })
  const ui = await mountAbove($, 120, 4)
  await clock.advance(10)
  await ui.advance(1500)
  const w0 = await walkOf(ui)
  await ui.pointer({ type: 'move', x: w0.bx > 40 ? 2 : 117, y: 2, in: 'walkway' } as any)
  await ui.advance(900)
  expect((await walkOf(ui)).bx !== w0.bx).toBe(true)
  await ui.unmount()
  const main = await mountAbove($, 120, 4, { fullscreen: false })
  expect((await walkOf(main)).crab.length > 0).toBe(true)
  await main.unmount()
})

test('悬停气泡的写法: 每条小贴士、每种宽度都放得下; 先省时间, 再把小贴士截短, 最后才只留摘要', () => {
  setLang('zh')
  const T0 = 1_900_000_200_000 - (1_900_000_200_000 % 300_000)
  for (let k = 0; k < 5; k++) {
    const now = T0 + k * 60_000 + 1000
    const five = lim('five_hour', 24, now + 2 * H)
    const week = lim('seven_day', 12, now + 3 * 24 * H)
    const fit = laneTip(50, five, week, paceOf(five, now), paceOf(week, now), now)
    const noTime = '上下文 50% · 5小时 24% · 本周 12%'
    const tipMin = dwT(noTime + ' · 小贴士 /hud ') + 3
    for (let room = 4; room <= 140; room++) {
      const t = fit(room)
      expect(dwT(t) <= room ? 'ok' : `第 ${k} 条, ${room} 格: "${t}" 放不下`).toBe('ok')
      // "上下文 50%" 占 10 格, 截短时末尾还有 "..": 12 格起开头完整
      if (room >= 12) expect(t.startsWith('上下文 50%') ? 'ok' : `第 ${k} 条, ${room} 格: "${t}"`).toBe('ok')
      if (room >= tipMin) expect(t.includes('小贴士 /hud') ? 'ok' : `第 ${k} 条, ${room} 格: 没有小贴士 "${t}"`).toBe('ok')
    }
    expect(fit(140).includes('2h00m 重置') && fit(140).includes('小贴士 /hud')).toBe(true)
  }
})

test('大螃蟹就是面板那只: 有工具在跑时停下原地做这个工具的动作, 道具画在右边 (读文件看纸 / 跑命令终端 / 上网地球); 在想时照旧走, 头顶冒思考点点进天空行', () => {
  const props: Array<[string, number]> = [
    ['read', 0xd4d4d8],
    ['edit', 0xd4d4d8],
    ['bash', 0x3f3f46],
    ['search', 0x15803d], // v1.4: 雷达的绿圈 (左半边在道具区里)
    ['fetch', 0x3b82f6], // v1.4: 网页顶上的蓝条
  ]
  for (const [tool, color] of props) {
    const r = previewLane({ w: 80, sky: true, frames: 30, working: true, tool: f => (f >= 10 ? (tool as any) : '') })
    // 工具开始后: 停下, 姿势是 tool
    for (let f = 11; f < 30; f++) {
      expect(r.frames[f].pose).toBe('tool')
      expect(r.frames[f].bx).toBe(r.frames[11].bx)
    }
    // 道具在螃蟹右边 3 列 (bx+12..14), 和面板里一样
    const fr = r.frames[20]
    const zone = fr.px.flatMap(row => row.slice(fr.bx + 12, fr.bx + 15))
    expect(zone.includes(color) ? 'ok' : `${tool}: 道具区没有 ${color.toString(16)}`).toBe('ok')
    // 走路的时候道具区是空的
    const wf = r.frames[5]
    expect(wf.pose).toBe('walk')
    expect(wf.px.flatMap(row => row.slice(wf.bx + 12, wf.bx + 15)).every(c => c === -1)).toBe(true)
  }
  // 小螃蟹在大螃蟹用工具时停下, 原地慢慢跳 (每 5 帧起落一次)
  const k = previewLane({ w: 90, sky: true, frames: 60, working: true, running: () => ['a', 'b'], tool: f => (f >= 30 ? 'read' : '') })
  const kidTop = (fr: any) => fr.px.findIndex((row: number[]) => row.includes(KID_C))
  const tops = k.frames.slice(32, 60).map(kidTop)
  expect(new Set(tops).size).toBe(2)
  let same = 0
  for (let i = 1; i < tops.length; i++) if (tops[i] === tops[i - 1]) same++
  expect(same * 2 > tops.length).toBe(true) // 慢: 相邻帧大多不变
  expect(new Set(k.frames.slice(32, 60).map(fr => fr.kids.map(q => q.x).join(','))).size).toBe(1) // 不走
  // 在想 (主会话在跑, 没有工具): 走, 头顶冒思考点点, 往上飘进天空行
  const t = previewLane({ w: 80, sky: true, frames: 60, working: true, tool: '' })
  const thought = mixDark(t.colors.thought, 0.2)
  expect(t.frames.some(fr => fr.pt.some(p => p.color === thought && p.y < 0 && p.sky))).toBe(true)
  expect(t.frames.some(fr => fr.bx !== t.frames[0].bx)).toBe(true)
  // 没有天空行: 不冒点点
  const n = previewLane({ w: 80, frames: 60, working: true, tool: '' })
  expect(n.frames.every(fr => fr.pt.every(p => p.color !== thought))).toBe(true)
})

test('情绪照面板: 悠闲闲着戴墨镜, 冒汗有汗滴, 慌张出 "!", 上下文 >=80% 身体变红; 一轮结束举钳; 睡着闭眼', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const chill = previewLane({ w: 60, frames: 10, working: false, mood: 'chill' })
  expect(chill.frames.every(fr => at(fr.px, fr.bx + 3, 1) === 0x09090b)).toBe(true) // 墨镜
  const sweat = previewLane({ w: 60, frames: 24, working: true, mood: 'sweat' })
  expect(sweat.frames.some(fr => fr.px.flat().includes(0x60a5fa))).toBe(true) // 汗滴
  const panic = previewLane({ w: 60, frames: 24, working: false, mood: 'panic' })
  expect(panic.frames.some(fr => fr.px.flat().includes(0xef4444))).toBe(true) // "!"
  const hot = previewLane({ w: 60, frames: 4, working: false, pct: 85 })
  expect(hot.frames[0].px.flat().includes(0xe5484d) && !hot.frames[0].px.flat().includes(BODY)).toBe(true)
  const cel = previewLane({ w: 60, frames: 6, working: false, celebrating: true })
  expect(cel.frames.every(fr => at(fr.px, fr.bx, 0) === BODY || at(fr.px, fr.bx, 1) === BODY)).toBe(true) // 左钳举起
  const sleep = previewLane({ w: 60, frames: 30, working: false, sleeping: true })
  // v1.4: 睡着是一字眼 (眼睛那一行连着两格眼睛色)
  const lined = (fr: any) => fr.px.some((row: number[]) => row[fr.bx + 3] === EYE && row[fr.bx + 4] === EYE && row[fr.bx + 7] === EYE && row[fr.bx + 8] === EYE)
  expect(sleep.frames.every(fr => fr.pose === 'sleep' && lined(fr))).toBe(true)
})

test('小螃蟹: 7x4 (比大螃蟹小一大截), 眼睛四周都是身体, 看前面时也只在身体里挪; N 只互不重叠也不贴住; 每帧最多挪 1 格; 碰到两端整队掉头; 放不下记 +N', { timeoutMs: 30_000 }, () => {
  for (const n of [1, 3, 5]) {
    for (const mood of ['chill', 'panic'] as const) {
      const ids = Array.from({ length: n }, (_, i) => 'k' + i)
      const r = previewLane({ w: 100, sky: true, frames: 300, working: true, mood, running: () => ids })
      const dirs = new Set<number>()
      r.frames.forEach((fr, f) => {
        expect(fr.kids.length).toBe(n)
        const xs = [fr.bx, ...fr.kids.map(k => k.x)]
        for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= r.kw + 1 ? 'ok' : `n=${n} f=${f} 挨得太近 ${xs}`).toBe('ok')
        if (f > 0) {
          const prev = [r.frames[f - 1].bx, ...r.frames[f - 1].kids.map(k => k.x)]
          xs.forEach((x, i) => expect(Math.abs(x - prev[i]) <= 1).toBe(true))
        }
        dirs.add(fr.dir)
        // 每只小螃蟹的眼睛: 上下左右都是身体
        for (const k of fr.kids) {
          if (k.x < 1 || k.state !== 'walk') continue
          const eyes: Array<[number, number]> = []
          fr.px.forEach((row, y) => row.forEach((c, x) => c === EYE && x >= k.x && x < k.x + 7 && eyes.push([x, y])))
          expect(eyes.length).toBe(2)
          for (const [x, y] of eyes) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(fr.px[y + dy][x + dx]).toBe(KID_C)
        }
      })
      expect(dirs.size).toBe(2)
    }
  }
  expect(previewLane({ w: 100, sky: true, frames: 1 }).kw).toBe(7)
  const many = previewLane({ w: 60, sky: true, frames: 5, running: () => Array.from({ length: 12 }, (_, i) => 'k' + i) })
  expect(many.frames[4].kids.length).toBe(many.cap)
  expect(many.frames[4].hidden).toBe(12 - many.cap)
})

test('大螃蟹一直有动静: 主会话或子代理在跑都走 (速度跟心情); 全闲时隔 20-40 秒溜达 3-8 格再东张西望', () => {
  const moves = (o: any) => {
    const r = previewLane({ w: 120, sky: true, frames: 120, ...o })
    return r.frames.filter((fr, f) => f > 0 && fr.bx !== r.frames[f - 1].bx).length
  }
  expect(moves({ working: false, running: () => ['a'] }) > 20).toBe(true)
  const m = ['chill', 'normal', 'sweat', 'panic'].map(mood => moves({ working: true, mood }))
  expect(m[0] < m[1] && m[1] < m[2] && m[2] < m[3] ? 'ok' : 'speeds ' + m).toBe('ok')
  const idle = previewLane({ w: 80, sky: true, frames: 420, working: false })
  const stepAt = idle.frames.map((fr, f) => (f && fr.bx !== idle.frames[f - 1].bx ? f : -1)).filter(f => f >= 0)
  expect(stepAt[0] >= 133 && stepAt[0] <= 270 ? 'ok' : 'first stroll at ' + stepAt[0]).toBe('ok')
  const first = stepAt.filter(f => f < stepAt[0] + 30)
  expect(first.length >= 3 && first.length <= 8).toBe(true)
  const stop = first[first.length - 1]
  expect(idle.frames[stop + 3].pose).toBe('idle') // v0.19: 溜达快走完时慢下来, 最后半步多等一会儿
  const eyesAt = (fr: any) => JSON.stringify(fr.px.map((row: number[]) => row.map((c, x) => (c === EYE ? x : -1)).filter(x => x >= 0)))
  expect(new Set(idle.frames.slice(stop + 1, stop + 20).map(eyesAt)).size > 1).toBe(true)
})

test('散步道: 打字时停下低头 (眼睛往下), 停手约 1.5 秒恢复; 发出消息跳一下 (蹲 / 腾空 / 落地), 落地冒尘土', () => {
  const r = previewLane({ w: 80, sky: true, frames: 50, working: true, typing: f => f >= 10 && f < 30 })
  for (let f = 11; f < 30; f++) {
    expect(r.frames[f].pose).toBe('type')
    expect(r.frames[f].bx).toBe(r.frames[10].bx)
  }
  const eyeRows = (fr: any) => fr.px.map((row: number[], y: number) => (row.includes(EYE) ? y : -1)).filter((y: number) => y >= 0)
  expect(eyeRows(r.frames[20]).every((y: number) => y >= 2 + 3)).toBe(true) // 天空行 2 像素 + 低头: 眼睛在螃蟹区第 3 行
  expect(r.frames[35].pose).toBe('walk')
  const j = previewLane({ w: 80, sky: true, frames: 12, working: false, jumpAt: 3 })
  expect(j.frames.slice(3, 7).map(fr => fr.pose)).toEqual(['jump', 'jump', 'jump', 'jump'])
  expect(j.frames[2].pt.length).toBe(0)
  const landed = j.frames[6].pt.filter(p => p.color === j.dust).length
  expect(landed >= 4 && landed <= 6).toBe(true) // 落地冒 4-6 粒
  expect(j.frames[7].pose).toBe('jump') // v0.19: 跳 750ms (蹲 / 起跳 / 最高 / 落下 / 压扁 / 弹回)
  expect(j.frames[8]?.pose).toBe('idle')
  expect(j.frames[4].px[2 + 5].filter(c => c === BODY).length).toBe(0) // 腾空: 最下面一行没有腿
  expect(j.frames[4]?.px.slice(0, 2).some(row => row.includes(BODY))).toBe(true) // 真的离地: 身体进了天空行
})

test('粒子: 走路时同时 3-5 粒尘土 (小跑 5-7 粒), 方向散开不排成一行; 不超过 24 个; 都在横栏里; 只有往上飘的进天空行; 只画在空格子里; 每帧最多挪 1 个点位, 颜色不跳; 静止时没有', { timeoutMs: 30_000 }, () => {
  const dustCount = (fr: any, dust: number) => fr.pt.filter((p: any) => p.color === dust).length
  for (const [mood, lo, hi] of [
    ['normal', 3, 5],
    ['panic', 5, 7],
  ] as Array<[any, number, number]>) {
    const r = previewLane({ w: 100, sky: true, frames: 120, working: true, mood, tool: '' })
    const counts = r.frames.slice(20).map(fr => dustCount(fr, r.dust))
    const ok = counts.filter(c => c >= lo && c <= hi).length
    expect(ok >= counts.length * 0.8 ? 'ok' : `${mood}: 只有 ${ok}/${counts.length} 帧在 ${lo}-${hi} 粒 (${counts.join(',')})`).toBe('ok')
    // 不全在同一行
    expect(r.frames.slice(20).some(fr => new Set(fr.pt.filter((p: any) => p.color === r.dust).map((p: any) => p.y >> 2)).size > 1 || new Set(fr.pt.map((p: any) => p.y)).size > 1)).toBe(true)
  }
  const check = (r: any, label: string) => {
    let any = 0
    r.frames.forEach((fr: any, f: number) => {
      expect(fr.pt.length <= r.max).toBe(true)
      for (const p of fr.pt) {
        expect(p.x >= 0 && p.x < 100 * 2 && p.y < 12 && p.y >= -4).toBe(true)
        if (p.y < 0) expect(p.sky ? 'ok' : `${label}: 尘土进了天空行`).toBe('ok')
      }
      const w = decode(fr.cells)
      for (let i = 0; i < w.length / 3; i++) {
        const ch = w[i * 3]
        if (ch >= 0x2800 && ch <= 0x28ff) {
          any++
          expect(ch > 0x2800).toBe(true)
          const x = i % 100
          const row = Math.floor(i / 100)
          expect(fr.px[row * 2][x] === -1 && fr.px[row * 2 + 1][x] === -1).toBe(true)
        }
      }
      if (f > 0)
        for (const q of fr.pt) {
          if (q.age === 0) continue
          const from = r.frames[f - 1].pt.find((p: any) => p.age === q.age - 1 && p.color === q.color && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= 1)
          expect(from ? 'ok' : `${label} f=${f}: 粒子跳了`).toBe('ok')
        }
    })
    return any
  }
  expect(check(previewLane({ w: 100, sky: true, frames: 150, working: true }), 'walk') > 0).toBe(true)
  expect(check(previewLane({ w: 100, sky: true, frames: 150, working: true, mood: 'panic', running: () => ['a', 'b'] }), 'trot') > 0).toBe(true)
  const cel = previewLane({ w: 100, sky: true, frames: 20, working: false, celebrating: f => f >= 2 && f < 12 })
  expect(check(cel, 'celebrate') > 0).toBe(true)
  const gold = mixDark(cel.colors.spark, 0.25)
  const peak = Math.max(...cel.frames.map(fr => fr.pt.filter((p: any) => p.color === gold).length))
  expect(peak >= 6 && peak <= 10 ? 'ok' : '庆祝闪光最多 ' + peak).toBe('ok')
  expect(cel.frames.some(fr => fr.pt.some((p: any) => p.color === gold && p.y < 0))).toBe(true) // 往上飘进天空行
  // 静止 (闲着趴着, 还没到溜达的时候): 一个粒子都没有
  expect(previewLane({ w: 100, sky: true, frames: 120, working: false }).frames.every(fr => fr.pt.length === 0)).toBe(true)
  // 小螃蟹离场: 跳出顶边的地方冒一小团 (4-6 粒)
  const leave = previewLane({ w: 100, sky: true, frames: 60, working: false, running: f => (f < 5 ? ['a', 'b'] : ['a']) })
  const gone = leave.frames.findIndex((fr, f) => f > 5 && fr.kids.length === 1)
  const puff = leave.frames[gone].pt.filter((p: any) => p.color === leave.dust && p.age === 0 && p.y <= 1).length
  expect(gone > 0 && puff >= 4 && puff <= 6).toBe(true)
})

test('粒子接上真的横栏 (mock.clock + 散步道帧钟): 主会话在跑时连续 100 帧, 热身之后至少 80% 的帧里同时有 3-5 粒尘土, 而且不全在同一行', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [] })
  const ui = await mountAbove($, 140, 4, { working: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10)
  const counts: number[] = []
  const rows: number[] = []
  for (let i = 0; i < 100; i++) {
    await ui.advance(150)
    const w = await walkOf(ui)
    // 尘土 = 天空行以下的盲文点 (天空行里只有思考点点)
    counts.push(w.dots.slice(1).reduce((a, b) => a + b, 0))
    rows.push(w.dots.slice(1).filter(n => n > 0).length)
  }
  const warm = counts.slice(15)
  const ok = warm.filter(c => c >= 3 && c <= 5).length
  expect(ok >= warm.length * 0.8 ? 'ok' : `只有 ${ok}/${warm.length} 帧在 3-5 粒 (${warm.join(',')})`).toBe('ok')
  expect(rows.slice(15).some(n => n > 1)).toBe(true)
  await ui.unmount()
})

test('散步道: 子代理结束后那只挥手约 1.5 秒, 然后离场 (3 行版往上跳出顶边, 2 行版走上面那行; 不和队里的重叠); 1 行版挥完直接消失', () => {
  const end = 20
  const r3 = previewLane({ w: 90, sky: true, frames: 60, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  const st = (r: any, f: number) => r.frames[f].kids.find((k: any) => k.id === 'b')?.state ?? (r.frames[f].gone.some((k: any) => k.id === 'b') ? 'exit' : 'none')
  expect(st(r3, end - 1)).toBe('walk')
  for (let f = end; f < end + 9; f++) expect(st(r3, f)).toBe('wave')
  expect(st(r3, end + 11)).toBe('hop')
  const out3 = r3.frames.findIndex((fr, f) => f > end && st(r3, f) === 'none')
  expect(out3 > 0 && (out3 - end) * 150 <= 3000).toBe(true)
  for (let f = end; f < out3; f++) {
    const xs = [r3.frames[f].bx, ...r3.frames[f].kids.map(k => k.x)]
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i] >= 8).toBe(true)
  }
  // 跳出去的那只不进天空行
  for (let f = end; f < out3; f++) expect(r3.frames[f].px[0].concat(r3.frames[f].px[1]).includes(KID_C)).toBe(false)
  const r2 = previewLane({ w: 80, rows: 2, frames: 120, working: true, running: f => (f < end ? ['a', 'b', 'c'] : ['a', 'c']) })
  expect(st(r2, end + 11)).toBe('exit')
  const out2 = r2.frames.findIndex((fr, f) => f > end && st(r2, f) === 'none')
  expect(out2 > 0 && (out2 - end) * 150 <= 10_000).toBe(true)
  const one = previewLane({ w: 80, rows: 1, frames: 40, working: true, running: f => (f < end ? ['a', 'b'] : ['a']) })
  expect(kidCount(one.frames[end + 12].px, 0)).toBe(1)
})

test('散步道接上真的子代理: 3 个运行中画 3 只; 只有子代理在跑时大螃蟹也在走; 结束的那只几秒内离场 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = ['a', 'b', 'c'].map(id => ({ id, description: id, type: 'Explore', status: 'running' }))
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  await clock.advance(10)
  await ui.advance(3000)
  const a = await walkOf(ui)
  expect(kidCount(a.px, 2 + 4)).toBe(3) // 天空行 2 像素 + 小螃蟹第 3 行 (最宽那行下面一行)
  await ui.advance(1500)
  expect((await walkOf(ui)).bx !== a.bx).toBe(true)
  list = list.map(k => (k.id === 'b' ? { ...k, status: 'completed' } : k))
  await clock.advance(200) // hooks 每帧重画 (有子代理时), 子代理列表跟着更新
  await ui.advance(5000)
  expect(kidCount((await walkOf(ui)).px, 2 + 4)).toBe(2)
  await ui.unmount()
})

test('5 分钟没有任何动静才睡; 子代理在跑不算闲; 打字时停下, 约 1.5 秒后接着走 (mock.clock + 散步道帧钟)', { timeoutMs: 60_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let list: any[] = []
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => list, usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  // v1.4: 睡着 = 闭成一字眼 (4 分钟开始打瞌睡时眼睛还睁着; 5 分钟钻进沙里, 钻好了闭眼)
  //   (睡在沙里时钳子被沙盖住, walkOf 按最左的身体像素猜的 bx 会偏, 所以按「两段一字眼」的形状找, 不靠 bx)
  const lined = (px: number[][]) => px.some(r => r.some((c, i) => c === EYE && r[i + 1] === EYE && r[i + 4] === EYE && r[i + 5] === EYE))
  const peek = async () => {
    const w = await walkOf(ui)
    return { open: !lined(w.px), x: w.bx }
  }
  await ui.advance(4 * 60_000)
  expect((await peek()).open).toBe(true)
  await ui.advance(63_000) // 钻沙 1.8 秒, 钻好 (第 1.5 秒) 才闭眼
  expect((await peek()).open).toBe(false) // 5 分钟没动静: 钻进沙里, 闭成一字眼
  const typed = (text: string) => $.prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: 'x' } as any)
  await clock.advance(1000)
  await typed('')
  await ui.advance(150)
  expect((await peek()).open).toBe(true) // 打字把它叫醒 (低头看输入框)
  // 子代理在跑: 大螃蟹走; 打字的那 1.5 秒里停下, 之后接着走
  list = [{ id: 'k', description: 'k', type: 'Explore', status: 'running' }]
  await $.classic.SubagentStart({ agent_id: 'k', agent_type: 'Explore' } as any)
  await clock.advance(200)
  await ui.advance(1800)
  const x1 = (await peek()).x
  await ui.advance(900)
  expect((await peek()).x !== x1).toBe(true)
  await clock.advance(1000)
  await typed('x')
  await ui.advance(150)
  const t0 = (await peek()).x
  await ui.advance(1050)
  expect((await peek()).x).toBe(t0)
  await ui.advance(1500)
  expect((await peek()).x !== t0).toBe(true)
  // 子代理一直在跑: 6 分钟后也没睡, 还在走
  await ui.advance(6 * 60_000)
  const x2 = (await peek()).x
  await ui.advance(900)
  expect((await peek()).x !== x2).toBe(true)
  await ui.unmount()
})

test('气泡: 一轮结束「搞定 12s」, 约 5 秒后消失; 新的顶掉旧的 (压缩完了 / 额度刷新了); 放在螃蟹旁边, 不压螃蟹, 不进天空行', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...lowUsage(), rateLimits: [lim('five_hour', 40, T + 30_000), lim('seven_day', 12, T + 3 * 24 * H)] }
  const calls = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const clock = calls.clock
  const ui = await mountAbove($, 120, 4)
  const bubble = async () => {
    const w = await walkOf(ui)
    const row = w.text.findIndex(t => t.includes('「'))
    if (row < 0) return undefined
    const x = [...w.text[row]].findIndex(ch => ch === '「')
    const text = w.text[row].slice(w.text[row].indexOf('「'), w.text[row].indexOf('」') + 1)
    const start0 = w.rows[row].findIndex(c => c.ch === '「')
    return { row, x, text, start: start0, crab: w.crab }
  }
  await ui.advance(300)
  expect(await bubble()).toBeUndefined()
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(12_000)
  await $.turn.complete({ answer: '', durationMs: 12_000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(2_200) // v0.16.2: 结束后约 2 秒没有新的一段才算做完
  await ui.advance(150)
  const b = await bubble()
  expect(b?.text).toBe('「搞定 12s」')
  expect(b?.row).toBe(1) // 螃蟹区第一行, 不进天空行
  expect(b!.crab.some(x => x >= b!.start && x < b!.start + dwT(b!.text))).toBe(false)
  await ui.advance(3900)
  expect((await bubble())?.text).toBe('「搞定 12s」')
  await ui.advance(1500)
  expect(await bubble()).toBeUndefined()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  await clock.advance(200)
  await ui.advance(150)
  expect((await bubble())?.text).toBe('「压缩完了」')
  expect(calls.toasts.some(x => x.includes('额度已恢复'))).toBe(false)
  await clock.advance(20_000) // 重置时刻 (T+30s) 过了, 约每 6 秒查一次
  expect(calls.toasts).toContain('5 小时额度已恢复，可以继续了')
  await ui.advance(150)
  expect((await bubble())?.text).toBe('「额度刷新了」')
  await ui.unmount()
})

test('气泡: 配速变成会用完说一次红色「慢点！…用完」(每个窗口一次); 上下文第一次到 75% 说「上下文快满了」; 等你批准权限说「等你点头」', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  let usage: any = { ...lowUsage(), rateLimits: [lim('five_hour', 10, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: () => usage })
  const ui = await mountAbove($, 120, 4)
  const bubble = async () => {
    await clock.advance(200) // hooks 重画, 推新 props
    await ui.advance(150)
    const w = await walkOf(ui)
    const row = w.text.findIndex(t => t.includes('「'))
    if (row < 0) return undefined
    const t = w.text[row]
    const i = w.rows[row].findIndex(c => c.ch === '「')
    return { text: t.slice(t.indexOf('「'), t.indexOf('」') + 1), color: w.rows[row][i].fg }
  }
  expect(await bubble()).toBeUndefined()
  usage = { ...usage, rateLimits: [lim('five_hour', 50, T + 3 * H), lim('seven_day', 12, T + 3 * 24 * H)] }
  await ui.redraw()
  const slow = await bubble()
  expect(slow?.text).toBe('「慢点！2h00m用完」')
  expect(slow?.color).toBe(0xf87171)
  await ui.advance(5500)
  expect(await bubble()).toBeUndefined()
  usage = { ...usage, context: { tokens: 160_000, window: 200_000, percent: 80 } }
  await ui.redraw()
  expect((await bubble())?.text).toBe('「上下文快满了」')
  await ui.advance(5500)
  expect(await bubble()).toBeUndefined()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
  await ui.advance(5500)
  await $.classic.Notification({ message: 'idle', notification_type: 'idle_prompt' } as any)
  expect(await bubble()).toBeUndefined()
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' } as any)
  expect((await bubble())?.text).toBe('「等你点头」')
  await ui.unmount()
})

test('/hud crab 关掉后横栏里不画散步道 (存进 store, 重开会话也记得), 再开回来', async ($, on) => {
  await start($, on)
  await $.command.run({ command: 'hud', args: 'crab' } as any)
  const off = await mountAbove($, 100, 4)
  expect(await off.find({ type: 'Client' })).toBeUndefined()
  await off.unmount()
  await $.session.start({ cwd: CWD } as any)
  const still = await mountAbove($, 100, 4)
  expect(await still.find({ type: 'Client' })).toBeUndefined()
  await still.unmount()
  await $.command.run({ command: 'hud', args: 'crab on' } as any)
  const on2 = await mountAbove($, 100, 4)
  expect(await on2.find({ type: 'Client' })).toBeDefined()
  await on2.unmount()
})

test('发出消息 (prompt.submit): 螃蟹蹲一下、腾空 (不画腿)、落地冒尘土, 然后回到趴着 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: lowUsage })
  const ui = await mountAbove($, 110, 4)
  const shot = async () => {
    const w = await walkOf(ui)
    // 大螃蟹最上 / 最下一行像素 (从螃蟹区顶上算, 天空行是 -2 / -1): 趴着 0-4, 蹲 1-5, 最高 -2..1 (收腿), 落地压扁 1-4
    const ys = w.px.map((row, y) => (row.some(c => c === BODY) ? y - 2 : -99)).filter(y => y > -99)
    return { span: [ys[0], ys[ys.length - 1]], dots: w.dots.reduce((a, b) => a + b, 0) }
  }
  await ui.advance(600)
  expect(await shot()).toEqual({ span: [0, 4], dots: 0 })
  const r: any = await $.prompt.submit({ text: 'hi' } as any)
  expect(r.text).toBe('hi')
  await ui.advance(150)
  expect((await shot()).span).toEqual([1, 5]) // 蹲 (蓄力)
  await ui.advance(150)
  expect((await shot()).span).toEqual([-2, 1]) // 最高: 进了天空行, 收腿
  await ui.advance(300)
  const land = await shot()
  expect(land.span).toEqual([1, 4]) // 落地压扁
  expect(land.dots > 0).toBe(true)
  await ui.advance(1500)
  expect(await shot()).toEqual({ span: [0, 4], dots: 0 })
  await ui.unmount()
})

test('工具在跑时 (接上真的横栏): 大螃蟹停下原地做这个工具的动作, 道具画在右边; 工具结束后接着走 (mock.clock + 散步道帧钟)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  let open: () => void = () => {}
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [], toolGate: () => new Promise<void>(r => (open = r)) })
  const ui = await mountAbove($, 100, 4, { working: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10)
  await ui.advance(1500)
  // v1.4: 跑命令的屏幕敲命令时几乎被字盖满 (上面三行旧输出各 3 格), 认屏幕上任何一种颜色
  for (const [tool, colors] of [
    ['Read', [0xd4d4d8]],
    ['Bash', [0x3f3f46, 0x71717a, 0x4ade80]],
    ['WebSearch', [0x15803d, 0x4ade80]], // v1.4: 雷达
  ] as Array<[string, number[]]>) {
    const call = $.tool.call({ tool, file_path: 'D:\work\my-app\a.ts', command: 'ls', query: 'x' } as any)
    await clock.settle()
    await ui.advance(300)
    const a = await walkOf(ui)
    await ui.advance(900)
    const b = await walkOf(ui)
    expect(b.bx).toBe(a.bx) // 停下
    const zone = b.px.flatMap(row => row.slice(b.bx + 12, b.bx + 15))
    expect(colors.some(c => zone.includes(c)) ? 'ok' : `${tool}: 螃蟹右边没有道具`).toBe('ok')
    open()
    await call
    await ui.advance(2500) // v1.4: 搜索的「找到了」撑约 1.8 秒
    expect((await walkOf(ui)).bx !== b.bx).toBe(true) // 工具结束: 接着走 (在想)
  }
  await ui.unmount()
})

// ======================== v0.16.1 / v0.16.2: 后台子代理 (一次提问里主线程结束好几段) ========================
// Claude Code 2.1.289 默认把 Agent 子代理放到后台. 子代理结束后, 它的结果作为一次 prompt.submit 送回主线程
// (origin.kind = 'task-notification'): 主线程闲着时另起一段, 正在跑时塞进这一段 (带 turnId).
// 一次提问 = 从用户自己发消息 (composer) 起; 做完 = 最后一段结束、没有子代理在跑、等约 2 秒没有新的一段
async function bgSetup($: any, on: any) {
  const T = 1_900_000_000_000
  let list: any[] = []
  let usd = 1
  const calls = await start($, on, WIN, { mockClock: T, agents: () => list, usage: () => ({ ...lowUsage(), cost: { usd } }) })
  const clock = calls.clock
  const band = await mountAbove($, 120, 4)
  const props = async () => ((await band.find({ type: 'Client' })) as any)?.props.props
  const kid = (id: string, status = 'running') => ({ id, description: id, type: 'general-purpose', status })
  const ids = new Set<string>()
  const setStatus = () => (list = [...ids].map(id => kid(id, ended.has(id) ? 'completed' : 'running')))
  const ended = new Set<string>()
  return {
    clock,
    band,
    props,
    spend: (d: number) => (usd += d),
    // 用户自己回车 / 后台子代理的结果送回来 (闲着时 or 塞进正在跑的一段)
    userSays: (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any),
    notice: (intoTurn?: string) => $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' }, ...(intoTurn ? { turnId: intoTurn } : {}) } as any),
    // 主线程派一个后台子代理: Agent 工具马上返回 ("Backgrounded agent"), 子代理接着在后台跑
    spawn: async (id: string) => {
      await $.tool.call({ tool: 'Agent', description: id, prompt: id, run_in_background: true } as any)
      ids.add(id)
      setStatus()
      await $.classic.SubagentStart({ agent_id: id, agent_type: 'general-purpose' } as any)
    },
    finish: async (id: string) => {
      ended.add(id)
      setStatus()
      await $.classic.SubagentStop({ agent_id: id, agent_type: 'general-purpose', agent_transcript_path: '', stop_hook_active: false, last_assistant_message: 'ok' } as any)
    },
  }
}
const done = (turnId: string, durationMs: number) => ({ answer: '', durationMs, isAborted: false, turnId, reason: 'answer' }) as any
const rowText = async ($: any, id: string, durationMs: number) => {
  const r = await mountTurn($, id, durationMs)
  const texts = (await r.findAll({ type: 'Text' })).map((x: any) => x.text)
  await r.unmount()
  return texts.find((t: string) => t.startsWith(' · ')) ?? ''
}

test('实测 1 的顺序: 主线程停下等 2 个子代理, 每结束一个送一次结果 -> 只庆祝一次, N = 整次提问; 最后一行配合计; 送结果不让螃蟹跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('读 a.txt 和 b.txt')
  expect((await b.props()).jumpSeq).toBe(p0.jumpSeq + 1) // 用户回车: 跳一下
  await $.turn.start({ text: '读 a.txt 和 b.txt', turnId: 't1' } as any)
  await b.spawn('k1')
  await b.spawn('k2')
  b.spend(0.17)
  await b.clock.advance(13_000)
  await $.turn.complete(done('t1', 13_000)) // "Waiting for 2 background agents to finish"
  expect(await rowText($, 'row-1', 13_000)).toBe(' · $0.17 · 工具 2 次') // 这一段
  await b.clock.advance(2_000)
  await b.finish('k1')
  await b.notice() // k1 的结果送回来 (主线程闲着: 另起一段)
  await $.turn.start({ text: '<task-notification>', turnId: 't2' } as any)
  b.spend(0.01)
  await b.clock.advance(1_000)
  await $.turn.complete(done('t2', 1_000)) // "Worked for 1s"
  expect(await rowText($, 'row-2', 1_000)).toBe(' · $0.01')
  await b.clock.advance(3_000)
  await b.finish('k2') // 最后一个子代理结束, 它的结果还没送到: 不能先庆祝 (等待放宽到约 10 秒)
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 't3' } as any)
  await $.tool.call({ tool: 'Write', file_path: CWD + '/summary.md', content: ['1', '2', '3', ''].join(String.fromCharCode(10)) } as any)
  b.spend(0.06)
  await b.clock.advance(5_000)
  await $.turn.complete(done('t3', 5_000))
  // 最后一行: 引擎写整次提问的时长 13+2+1+3+3+5 = 27 秒 -> 整次提问的合计
  expect(await rowText($, 'row-3', 27_000)).toBe(' · $0.24 · 改 1 个文件 +3 -0 · 工具 3 次')
  // 防抖: 刚结束时还不庆祝, 约 2 秒后庆祝一次
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 27s」')
  expect(p.jumpSeq).toBe(p0.jumpSeq + 1) // 两次送结果都没让螃蟹跳
  const hint = await mountHint($, 'terminal', 140)
  expect((await hint.findAll({ type: 'Text' })).some((x: any) => x.text.includes('上一轮 27s，3 次工具'))).toBe(true)
  await hint.unmount()
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('实测 2 的顺序: 主线程不停、先后派 4 个子代理, 最后一个结束时主线程刚好结束一段, 随后来了结果 -> 只庆祝一次, N = 34s; 两行收据各配各的; 迟到的通知不再庆祝', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('把四个文件都读一遍')
  await $.turn.start({ text: '把四个文件都读一遍', turnId: 'm1' } as any)
  await b.spawn('a1')
  await b.spawn('b1')
  await b.clock.advance(5_000)
  await b.finish('a1')
  await b.finish('b1')
  await b.notice('m1') // 结果塞进正在跑的这一段
  await b.notice('m1')
  await b.spawn('a2')
  await b.spawn('b2')
  await b.clock.advance(10_000)
  await b.finish('a2')
  await b.notice('m1')
  b.spend(0.2)
  await b.clock.advance(15_000)
  await b.finish('b2') // 最后一个子代理和这一段同时结束
  await $.turn.complete(done('m1', 30_000)) // "Churned for 30s"
  expect(await rowText($, 'row-30s', 30_000)).toBe(' · $0.20 · 工具 4 次')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // 0.16.1 在这里提前庆祝了 "搞定 31s"
  await b.notice() // b2 的结果送回来, 主线程又跑一段
  await $.turn.start({ text: '<task-notification>', turnId: 'm2' } as any)
  b.spend(0.01)
  await b.clock.advance(3_000)
  await $.turn.complete(done('m2', 3_000)) // "Churned for 34s"
  expect(await rowText($, 'row-34s', 34_000)).toBe(' · $0.21 · 工具 4 次') // 合计
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 34s」')
  expect(p.jumpSeq).toBe(p0.jumpSeq + 1) // 只有用户回车那一下
  // 庆祝之后又来了迟到的通知: 接着记账, 不再庆祝
  await b.notice()
  await $.turn.start({ text: '<task-notification>', turnId: 'm3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('m3', 1_000))
  await b.clock.advance(12_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理跑完之前用户又发了新消息 -> 上一次提问作废; 旧子代理的结果后来送到算新提问的接续; 只庆祝一次, N 从新消息算起', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('第一个问题')
  await $.turn.start({ text: '第一个问题', turnId: 'q1' } as any)
  await b.spawn('k1')
  await b.clock.advance(10_000)
  await $.turn.complete(done('q1', 10_000))
  await b.clock.advance(5_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.userSays('第二个问题') // 子代理还在跑, 用户发了新消息: 第一个问题作废
  await $.turn.start({ text: '第二个问题', turnId: 'q2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('q2', 2_000))
  await b.clock.advance(3_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 还在跑: 先不庆祝
  await b.finish('k1')
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq) // k1 的结果还没送到
  await b.notice() // 主线程闲着: 结果另起一段, 算第二个问题的接续, 不是新提问
  await $.turn.start({ text: '<task-notification>', turnId: 'q3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('q3', 1_000))
  await b.clock.advance(2_100)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1) // 只庆祝一次
  expect(p.say?.text).toBe('「搞定 7s」') // 从第二个问题算到最后一段结束 (2 + 3 + 1 + 1), 不是从第一个问题算起的 22 秒
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('子代理的结果塞进正在跑的一段 (带 turnId): 这一段结束后约 2 秒庆祝 (欠的通知已到, 不等 10 秒); N = 整次提问; 送结果不跳', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('查一下 c.txt')
  await $.turn.start({ text: '查一下 c.txt', turnId: 'm1' } as any)
  await b.spawn('k1')
  await b.clock.advance(4_000)
  await b.finish('k1')
  const p1 = await b.props()
  await b.notice('m1') // 主线程还在跑: 结果直接塞进这一段, 不会另起一段
  expect((await b.props()).jumpSeq).toBe(p1.jumpSeq)
  await b.clock.advance(2_000)
  await $.turn.complete(done('m1', 6_000))
  await b.clock.advance(1_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(1_200)
  const p = await b.props()
  expect(p.celebSeq).toBe(p0.celebSeq + 1)
  expect(p.say?.text).toBe('「搞定 6s」')
  await b.clock.advance(15_000)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  await b.band.unmount()
})

test('没有子代理的普通提问: 结束后约 2 秒庆祝一次; 结束前再说一句会取消这次等待 (说的是新提问, 从新的算)', { timeoutMs: 30_000 }, async ($, on) => {
  const b = await bgSetup($, on)
  const p0 = await b.props()
  await b.userSays('你好')
  await $.turn.start({ text: '你好', turnId: 'n1' } as any)
  b.spend(0.02)
  await b.clock.advance(3_000)
  await $.turn.complete(done('n1', 3_000))
  expect(await rowText($, 'row-n1', 3_000)).toBe(' · $0.02')
  await b.clock.advance(1_500)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq)
  await b.clock.advance(700)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 1)
  expect((await b.props()).say?.text).toBe('「搞定 3s」')
  // 第二个问题: 结束后 1 秒内用户又说了一句 -> 第二个问题不庆祝, 第三个做完才庆祝
  await b.userSays('再来')
  await $.turn.start({ text: '再来', turnId: 'n2' } as any)
  await b.clock.advance(2_000)
  await $.turn.complete(done('n2', 2_000))
  await b.clock.advance(1_000)
  await b.userSays('还有')
  await $.turn.start({ text: '还有', turnId: 'n3' } as any)
  await b.clock.advance(1_000)
  await $.turn.complete(done('n3', 1_000))
  await b.clock.advance(2_100)
  expect((await b.props()).celebSeq).toBe(p0.celebSeq + 2)
  expect((await b.props()).say?.text).toBe('「搞定 1s」')
  await b.band.unmount()
})

// v0.16.2: token 只算主线程和认得的子代理; 引擎自己的分叉 (压缩 / 记忆) 带的 id 谁的列表里都没有, 不算
test('token: 主线程 + 认得的子代理才算, 先到的子代理用量等认出来再补上, 认不出的分叉不算', async ($, on) => {
  const IN: Record<string, number> = { '': 100, 'fork-x': 200, k1: 40 }
  on('turn.step', async function* ($: any, e: any) {
    const n = IN[String(e.agentId ?? '')] ?? 0
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: n, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  } as any)
  // 统计脚本跑不起来: 底数为 0, 面板只显示本次启动以来的实时累计, 数字小到能逐个核对
  const calls = await start($, on, { ...WIN, broken: ['node'] }, { agents: () => [] })
  const step = async (agentId?: string) => {
    const it: any = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    while (!(await it.next()).done) {}
  }
  const detail = async () => {
    const ui = await mountHint($, 'terminal', 140)
    calls.toasts.length = 0
    await ui.press({ key: 'btn-token' })
    await ui.unmount()
    return calls.toasts.find(x => x.includes('token：')) ?? '(没有明细)'
  }
  await step() // 主线程 100
  await step('k1') // 子代理还没登记: 先记着
  await step('fork-x') // 引擎自己的分叉: 一直认不出来
  expect(await detail()).toContain('新输入 100，输出 1')
  await $.classic.SubagentStart({ agent_id: 'k1', agent_type: 'general-purpose' } as any)
  expect(await detail()).toContain('新输入 140，输出 2')
  await step('k1') // 认出来以后直接算
  expect(await detail()).toContain('新输入 180，输出 3')
})

// ================= v0.17: English UI, settings toolbar, handoff =================
// 下面的测试按英文写 (lang: null = store 里没存 -> auto -> Claude 的 language 设置不是中文 -> 英文)
const CJK = /[\u4e00-\u9fff]/
const EN: Opts = { lang: null }
// 上下文 40%, 没有子代理: 不出 [压缩], 状态写 "Ready"
const CALM: Opts = { lang: null, agents: () => [], usage: () => ({ ...USAGE, context: { tokens: 80_000, window: 200_000, percent: 40 } }) }

test('English is the default: panel labels, status and tools read in English with no CJK, at full and mid widths', async ($, on) => {
  await start($, on, WIN, CALM)
  for (const cols of [140, 65]) {
    const ui = await mountHint($, 'terminal', cols)
    const all = await strings(ui)
    for (const s of all) {
      expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
      expect(CJK.test(s) ? 'cjk: ' + s : 'ok').toBe('ok')
    }
    for (const w of ['Model', 'Project', 'Context', '5h', 'Week', 'Status']) expect(all.some(t => t.startsWith(w))).toBe(true)
    if (cols === 140) for (const w of ['Session', 'Tools', 'Tokens']) expect(all.some(t => t.startsWith(w))).toBe(true)
    expect(all.some(t => t.includes('Ready'))).toBe(true)
    await ui.unmount()
  }
})

test('English grid: every column is the same width on all three rows, and the 7-wide labels are not clipped', async ($, on) => {
  await start($, on, WIN, CALM)
  for (const cols of [140, 118, 81, 65, 51]) {
    const ui = await mountHint($, 'terminal', cols)
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    const widthOf = (k: string) => boxes.find((b: any) => b.key === k)?.props.width
    const n = cols >= 81 ? 3 : 2
    for (let c = 0; c < n; c++) {
      expect(widthOf('r1c' + c)).toBeDefined()
      expect(widthOf('r2c' + c)).toBe(widthOf('r1c' + c))
      expect(widthOf('r3c' + c)).toBe(widthOf('r1c' + c))
    }
    const all = await strings(ui)
    expect(all.some(t => t.startsWith('Context'))).toBe(true)
    await ui.unmount()
  }
})

test('/hud lang zh switches to Chinese and is remembered across sessions; /hud lang en and /hud lang auto switch back', async ($, on) => {
  await start($, on, WIN, EN)
  const r: any = await $.command.run({ command: 'hud', args: 'lang zh' } as any)
  expect(String(r?.text ?? '')).toContain('中文')
  let ui = await mountHint($, 'terminal', 140)
  expect(await strings(ui)).toContain('上下文')
  await ui.unmount()
  await $.session.start({ cwd: WIN.cwd } as any)
  ui = await mountHint($, 'terminal', 140)
  expect(await strings(ui)).toContain('上下文')
  await ui.unmount()
  const back: any = await $.command.run({ command: 'hud', args: 'lang en' } as any)
  expect(String(back?.text ?? '')).toContain('English')
  ui = await mountHint($, 'terminal', 140)
  expect((await strings(ui)).some(t => t.startsWith('Context'))).toBe(true)
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'lang auto' } as any)
  ui = await mountHint($, 'terminal', 140)
  expect((await strings(ui)).some(t => t.startsWith('Context'))).toBe(true)
  await ui.unmount()
})

test('auto language follows Claude Code\'s language setting: Chinese when it is Chinese, English otherwise', async ($, on) => {
  await start($, on, WIN, { lang: null, language: 'chinese' })
  const ui = await mountHint($, 'terminal', 140)
  expect(await strings(ui)).toContain('上下文')
  await ui.unmount()
})

test('English texts: turn receipt, hover tip, and the subagent board', async ($, on) => {
  setLang('en')
  expect(receiptText({ turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 0, usd: 0.42, files: 2, add: 5, del: 1, tools: 3 })).toBe(' · $0.42 · 2 files changed +5 -1 · 3 tool calls')
  expect(receiptText({ turnId: 'x', startedAt: 0, completedAt: 0, durationMs: 0, usd: 0, files: 1, add: 0, del: 0, tools: 1 })).toBe(' · 1 file changed · 1 tool call')
  const now = 1_900_000_200_000
  const five = lim('five_hour', 24, now + 2 * H)
  const fit = laneTip(50, five, undefined, paceOf(five, now), undefined, now)
  expect(fit(140).startsWith('Context 50% · 5h 24%')).toBe(true)
  expect(fit(140)).toContain('tip: /hud')
  expect(CJK.test(fit(140))).toBe(false)
  await start($, on, WIN, EN)
  await $.command.run({ command: 'hud', args: 'agents' } as any)
  const pane = await $.ui.mount({ plugin: 'cc-hud', surface: 'terminal', component: 'Pane', requestId: 'hud-agents', viewport: { columns: 100, rows: 40, isFullscreen: true }, props: { bodyColumns: 90 } } as any)
  const texts = (await pane.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
  expect(texts).toContain('Subagents')
  expect(CJK.test(texts)).toBe(false)
  await pane.unmount()
})

test('desktop card reads in English too', async ($, on) => {
  setLang('en')
  const svg = dashSvg({
    model: 'Opus 5.5', effort: 'medium', project: 'my-app', branch: 'main', session: '1h', cost: '$1.00',
    ctx: { pct: 40, extra: '400k / 1.0M' }, five: { pct: 30, extra: 'out 40m', warn: true }, week: { pct: 10, extra: '3d' },
    status: { text: 'Ready', tone: 'idle' }, tools: '', tokenTotal: '1.2M', tokenOutput: '40k',
  } as any)
  for (const w of ['Context', '5h', 'Week', 'Model', 'Project', 'Session', 'Status', 'Tools']) expect(svg).toContain('>' + w + '<')
  expect(CJK.test(svg)).toBe(false)
})

// ---- the toolbar ----
const btn = async (ui: any, key: string) => (await ui.find({ type: 'Button', key })) as any

test('toolbar: [settings] and [handoff] sit above the grid in the full and mid layouts, and at the front of the one-line layout', async ($, on) => {
  await start($, on, WIN, EN)
  for (const cols of [140, 65]) {
    const ui = await mountHint($, 'terminal', cols)
    expect((await btn(ui, 'btn-settings'))?.props.label).toBe('settings')
    expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('handoff')
    expect(await btn(ui, 'opt-lang-zh')).toBeUndefined() // closed by default
    const info: any = await ui.find({ type: 'Box', key: 'info' })
    expect(info.children.map((c: any) => c.props?.key)).toEqual(['tb0', 'r1', 'r2', 'r3']) // toolbar first, then the grid
    await ui.unmount()
  }
  // v1.1: 一行版最前面也有 [settings] [handoff] (不然切到精简以后点不回来, 也交接不了)
  const one = await mountHint($, 'terminal', 45)
  expect((await btn(one, 'btn-settings'))?.props.label).toBe('settings')
  expect((await btn(one, 'btn-handoff'))?.props.label).toBe('handoff')
  await one.unmount()
})

test('settings: open shows Lang / Crab / Panel; 中文 switches the panel and toolbar to Chinese and is remembered; [settings] again closes', async ($, on) => {
  await start($, on, WIN, EN)
  let ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-settings' })
  await ui.unmount()
  ui = await mountHint($, 'terminal', 140)
  for (const k of ['opt-lang-en', 'opt-lang-zh', 'opt-crab-on', 'opt-crab-off', 'opt-panel-full', 'opt-panel-compact', 'opt-panel-off']) expect(await btn(ui, k)).toBeDefined()
  await ui.press({ key: 'opt-lang-zh' })
  await ui.unmount()
  ui = await mountHint($, 'terminal', 140)
  const all = await strings(ui)
  expect(all).toContain('上下文')
  expect((await btn(ui, 'btn-settings'))?.props.label).toBe('设置')
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('交接')
  for (const s of all) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await ui.press({ key: 'btn-settings' })
  await ui.unmount()
  ui = await mountHint($, 'terminal', 140)
  expect(await btn(ui, 'opt-lang-zh')).toBeUndefined()
  await ui.unmount()
  await $.session.start({ cwd: WIN.cwd } as any)
  ui = await mountHint($, 'terminal', 140)
  expect(await strings(ui)).toContain('上下文')
  await ui.unmount()
})

test('settings: Crab off hides the crab strip; Panel compact switches to the one-line layout ([settings] [handoff] stay at the front)', async ($, on) => {
  await start($, on, WIN, EN)
  let ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-settings' })
  await ui.unmount()
  ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'opt-crab-off' })
  await ui.unmount()
  const band = await mountAbove($, 120, 4)
  expect(await band.find({ type: 'Client' })).toBeUndefined()
  await band.unmount()
  ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'opt-panel-compact' })
  await ui.unmount()
  ui = await mountHint($, 'terminal', 140)
  expect((await btn(ui, 'btn-settings'))?.props.label).toBe('settings')
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('handoff')
  expect((await ui.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))).toBe(false)
  await ui.unmount()
})

test('settings options fit the width: one toolbar row at 140 columns, wrapped onto a second row at 65 (never wider than the panel)', async ($, on) => {
  await start($, on, WIN, EN)
  for (const [cols, rows] of [[140, 1], [65, 2]] as const) {
    let ui = await mountHint($, 'terminal', cols)
    if (!(await btn(ui, 'opt-lang-zh'))) await ui.press({ key: 'btn-settings' })
    await ui.unmount()
    ui = await mountHint($, 'terminal', cols)
    const info: any = await ui.find({ type: 'Box', key: 'info' })
    const tb = info.children.filter((c: any) => /^tb\d$/.test(c.props?.key ?? ''))
    expect(tb.length).toBe(rows)
    const flat = (n: any): string => (typeof n === 'string' ? n : n?.props?.label ?? (n?.children ?? []).map(flat).join(''))
    for (const row of tb) expect(dwT(flat(row)) <= info.props.width ? 'ok' : 'too wide: ' + flat(row)).toBe('ok')
    await ui.unmount()
  }
})

// ---- handoff ----
// 测试里 ui.press 会等按键开始的活全部做完 (含分叉); /hud handoff 不等, 用 mock.clock 的 settle 让后台的活跑完
const T0 = 1_900_000_000_000

test('handoff: Claude writes it through a fork; it is copied and saved under ~/.claude/handoffs/<project>/ with a header', async ($, on) => {
  const calls = await start($, on, WIN, EN)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-handoff' })
  await ui.unmount()
  expect(calls.forks.length).toBe(1)
  expect(calls.forks[0]).toMatch(/handoff/i)
  expect(calls.copies.length).toBe(1)
  const text = calls.copies[0] ?? ''
  expect(text.startsWith('# Handoff: my-app (codex/research) · ')).toBe(true)
  expect(text).toContain('claude --resume abc-123')
  expect(text).toContain('HANDOFF BODY')
  expect(calls.writes.length).toBe(1)
  // 测试引擎可能把 C:\ 路径规整成本机写法: 只比结尾
  expect(calls.writes[0]?.path).toMatch(/\\\.claude\\handoffs\\my-app\\\d{4}-\d\d-\d\d-\d{4}\.md$/)
  expect(calls.writes[0]?.text).toBe(text)
  const toast = calls.toasts.find(t => t.startsWith('Handoff copied'))
  expect(toast).toBeDefined()
  expect(toast).toContain('~\\.claude\\handoffs\\my-app\\')
})

test('handoff: /hud handoff does the same from the command line, in the background', async ($, on) => {
  const calls = await start($, on, WIN, { ...EN, mockClock: T0 })
  const r: any = await $.command.run({ command: 'hud', args: 'handoff' } as any)
  expect(String(r?.text ?? '')).toMatch(/^Writing a handoff prompt/)
  await calls.clock.settle()
  expect(calls.copies.length).toBe(1)
  expect(calls.writes.length).toBe(1)
})

test('handoff: the chip shows progress while Claude writes, and a second press or /hud handoff while it runs is ignored', async ($, on) => {
  let clk: any
  const calls = await start($, on, WIN, { ...EN, mockClock: T0, fork: async () => (await clk.sleep(20_000), { isAnswered: true, text: 'BODY', usage: {} }) })
  clk = calls.clock
  let ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-handoff' })
  await ui.unmount()
  await clk.advance(8000)
  ui = await mountHint($, 'terminal', 140)
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('writing handoff... 8s')
  await ui.press({ key: 'btn-handoff' })
  const r: any = await $.command.run({ command: 'hud', args: 'handoff' } as any)
  expect(String(r?.text ?? '')).toMatch(/already being written/)
  await ui.unmount()
  await clk.advance(12_000)
  await clk.settle()
  expect(calls.forks.length).toBe(1)
  expect(calls.copies.length).toBe(1)
  ui = await mountHint($, 'terminal', 140)
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('handoff')
  await ui.unmount()
})

test('handoff failures: nothing to fork, API error, clipboard failure, and file-write failure each get a clear toast', async ($, on) => {
  let answer: any = undefined
  const o: Opts = { ...EN, mockClock: T0, fork: async () => answer ?? { isAnswered: true, text: 'BODY', usage: {} } }
  const calls = await start($, on, WIN, o)
  const run = async () => {
    const before = { toasts: calls.toasts.length, copies: calls.copies.length, writes: calls.writes.length }
    await $.command.run({ command: 'hud', args: 'handoff' } as any)
    await calls.clock.settle()
    return { toasts: calls.toasts.slice(before.toasts), copies: calls.copies.length - before.copies, writes: calls.writes.length - before.writes }
  }
  answer = { isAnswered: false, reason: 'nothing-to-fork' }
  const none = await run()
  expect(none.toasts.some(t => t.startsWith('Nothing to hand off yet'))).toBe(true)
  expect(none.copies + none.writes).toBe(0)
  answer = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} }
  const api = await run()
  expect(api.toasts.some(t => t.includes('API error 529'))).toBe(true)
  expect(api.copies + api.writes).toBe(0)
  answer = undefined
  o.copyOk = false
  const noCopy = await run()
  expect(noCopy.toasts.some(t => t.startsWith("Couldn't copy"))).toBe(true)
  expect(noCopy.writes).toBe(1)
  o.copyOk = true
  o.writeFails = true
  const noWrite = await run()
  expect(noWrite.toasts.some(t => t.startsWith('Handoff copied') && t.includes("couldn't save"))).toBe(true)
  expect(noWrite.copies).toBe(1)
})

test('handoff nudge: at 85% context the chip turns orange and the crab says 「Handoff?」 once; it re-arms after context drops below 70%', async ($, on) => {
  let pct = 86
  const usage = () => ({ ...USAGE, context: { tokens: pct * 2000, window: 200_000, percent: pct } })
  await start($, on, WIN, { ...EN, usage })
  const say = async () => {
    const band = await mountAbove($, 120, 4)
    const s = (await band.find({ type: 'Client' }))?.props?.props?.say
    await band.unmount()
    return s
  }
  const s1 = await say()
  expect(s1?.text).toBe('「Handoff?」')
  expect((await say())?.seq).toBe(s1.seq) // said once
  // 引擎不给 Text 留 key: 从设置栏那一行 (tb0) 里取 [交接] 按钮前面那个左方括号
  const bracket = async (u: any) => {
    const kids: any[] = ((await u.find({ type: 'Box', key: 'tb0' })) as any)?.children ?? []
    return kids[kids.findIndex(c => c.props?.key === 'btn-handoff') - 1]?.props
  }
  const ui = await mountHint($, 'terminal', 140)
  expect((await bracket(ui))?.color).toBe('#d97757')
  await ui.unmount()
  pct = 60
  await say()
  pct = 90
  const s2 = await say()
  expect(s2?.text).toBe('「Handoff?」')
  expect(s2.seq > s1.seq).toBe(true)
  pct = 40
  const calm = await mountHint($, 'terminal', 140)
  expect((await bracket(calm))?.color).toBe('#71717a')
  await calm.unmount()
})

test('string tables: English and Chinese have exactly the same keys, and text vs function entries match', () => {
  const shape = (o: any, pre = ''): string[] =>
    Object.keys(o).sort().flatMap(k => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? shape(o[k], pre + k + '.') : [pre + k + ':' + (typeof o[k] === 'function' ? 'fn' + o[k].length : Array.isArray(o[k]) ? 'list' + o[k].length : typeof o[k])]))
  expect(shape(TABLES.en)).toEqual(shape(TABLES.zh))
  const enText = JSON.stringify(TABLES.en, (k, v) => (typeof v === 'function' ? v(...Array(v.length).fill('1')) : v))
  expect(CJK.test(enText.replace(/中文/g, '')) ? 'cjk in en table' : 'ok').toBe('ok')
})

// ================= v0.18: subagents & workflows on the board =================
const WF_SCRIPT = "export const meta = { name: 'review-changes', description: 'Review changed files' }\nawait agent('x')"
const NOBODY: Opts = CALM // 英文、没有列表里的子代理、上下文 40% (不弹上下文提示)
async function startWorkflow($: any, toolUseId = 'toolu_wf1', input: any = { script: WF_SCRIPT }) {
  await $.tool.call({ tool: 'Workflow', ...input, tool_use_id: toolUseId } as any)
}
async function spawnWf($: any, description: string, runId = 'wf_k3x9abcd', agentIndex = 1, toolUseId = 'toolu_wf1') {
  const r: any = await $.agent.spawn({ prompt: 'do it', description, subagentType: 'general-purpose', tool_use_id: toolUseId, workflow: { runId, agentIndex } } as any)
  return String(r?.agentId ?? '')
}
const paneText = async (pane: any) => (await pane.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')

test('what a subagent is doing: tool plus its main argument, project paths made relative', () => {
  const root = 'D:\\work\\my-app'
  const cases: Array<[any, string]> = [
    [{ tool: 'Bash', command: 'npm test\nnpm run lint' }, 'Bash npm test'],
    [{ tool: 'PowerShell', command: '  Get-ChildItem  ' }, 'PowerShell Get-ChildItem'],
    [{ tool: 'Read', file_path: 'D:\\work\\my-app\\hooks\\register.tsx' }, 'Read hooks\\register.tsx'],
    [{ tool: 'Edit', file_path: 'C:\\elsewhere\\x.md', old_string: 'a', new_string: 'b' }, 'Edit C:\\elsewhere\\x.md'],
    [{ tool: 'Write', file_path: '/home/me/notes.txt', content: 'x' }, 'Write /home/me/notes.txt'],
    [{ tool: 'NotebookEdit', notebook_path: 'D:\\work\\my-app\\a.ipynb', new_source: 'x' }, 'NotebookEdit a.ipynb'],
    [{ tool: 'Grep', pattern: 'TODO', path: 'D:\\work\\my-app\\src' }, 'Grep "TODO" src'],
    [{ tool: 'Grep', pattern: 'x+y' }, 'Grep "x+y"'],
    [{ tool: 'Glob', pattern: '**/*.ts' }, 'Glob **/*.ts'],
    [{ tool: 'WebFetch', url: 'https://code.claude.com/docs/en/plugins', prompt: 'p' }, 'WebFetch code.claude.com/docs/en/plugins'],
    [{ tool: 'WebSearch', query: 'claude code mods' }, 'WebSearch claude code mods'],
    [{ tool: 'Agent', description: 'scan docs', prompt: 'p' }, 'Agent scan docs'],
    [{ tool: 'mcp__github__get_issue', number: 1 }, 'github:get_issue'],
    [{ tool: 'TodoWrite', todos: [] }, 'TodoWrite'],
  ]
  for (const [e, want] of cases) expect(doingText(e, root)).toBe(want)
  expect(doingText({ tool: 'Read', file_path: '/home/me/my-app/src/a.ts' }, '/home/me/my-app')).toBe('Read src/a.ts')
})

test('workflow names come from the script\'s meta, a saved workflow\'s name, or the script file', () => {
  expect(workflowName({ tool: 'Workflow', script: WF_SCRIPT })).toBe('review-changes')
  expect(workflowName({ tool: 'Workflow', script: 'export const meta = {\n  description: "d",\n  name: "audit"\n}' })).toBe('audit')
  expect(workflowName({ tool: 'Workflow', name: 'nightly-review' })).toBe('nightly-review')
  expect(workflowName({ tool: 'Workflow', scriptPath: '/tmp/s/flows/triage.js' })).toBe('triage')
  expect(workflowName({ tool: 'Workflow', script: 'no meta here' })).toBe('')
})

test('workflow agents show on the board grouped under the workflow name, with what each one is doing; other subagents get their own group', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await startWorkflow($)
  const a = await spawnWf($, 'review: bugs', 'wf_k3x9abcd', 1)
  const b = await spawnWf($, 'review: perf', 'wf_k3x9abcd', 2)
  await $.agent.spawn({ prompt: 'p', description: 'Explore codebase', subagentType: 'Explore', tool_use_id: 'toolu_a1' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', path: 'D:\\work\\my-app\\src', agentId: a } as any)
  await $.tool.call({ tool: 'Read', file_path: 'D:\\work\\my-app\\hooks\\register.tsx', agentId: b } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'sp-Explore-codebase' } as any)
  const pane = await mountPane($, 'terminal', 120)
  const txt = await paneText(pane)
  expect(txt).toContain('── review-changes · 2 running · 0 done ')
  expect(txt).toContain('── Other subagents ')
  expect(txt).toContain('Doing')
  for (const want of ['review: bugs', 'Grep "TODO" src', 'review: perf', 'Read hooks\\register.tsx', 'Explore codebase', 'Bash npm test']) expect(txt).toContain(want)
  // the workflow group comes first, its agents in start order, then the other subagents
  const at = (w: string) => txt.indexOf(w)
  expect(at('review-changes') < at('review: bugs') && at('review: bugs') < at('review: perf') && at('review: perf') < at('Other subagents') && at('Other subagents') < at('Explore codebase')).toBe(true)
  for (const s of await strings(pane)) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await pane.unmount()
})

test('without a workflow the board is not grouped (as before), and shows the Doing column', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await $.agent.spawn({ prompt: 'p', description: 'Explore codebase', subagentType: 'Explore', tool_use_id: 'toolu_a1' } as any)
  await $.tool.call({ tool: 'Glob', pattern: '**/*.ts', agentId: 'sp-Explore-codebase' } as any)
  const pane = await mountPane($, 'terminal', 120)
  const txt = await paneText(pane)
  expect(txt).toContain('Glob **/*.ts')
  expect(txt).toContain('Doing')
  expect(txt.includes('──')).toBe(false)
  await pane.unmount()
})

test('a workflow with no name in its script is labelled by its run id', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await startWorkflow($, 'toolu_anon', { script: 'await agent("x")' })
  await spawnWf($, 'anon step', 'wf_zz81', 1, 'toolu_anon')
  const pane = await mountPane($, 'terminal', 120)
  expect(await paneText(pane)).toContain('── wf_zz81 · 1 running · 0 done ')
  await pane.unmount()
})

test('the panel counts workflow agents in +N agents, and they walk as baby crabs', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await startWorkflow($)
  const a = await spawnWf($, 'review: bugs')
  const hint = await mountHint($, 'terminal', 140)
  expect((await btn(hint, 'btn-agents'))?.props.label).toBe('+1 agent')
  await hint.unmount()
  const band = await mountAbove($, 120, 4)
  expect((await band.find({ type: 'Client' }))?.props?.props?.agents).toContain(a)
  await band.unmount()
})

test('a workflow agent moves to Ended when its run finishes, keeping what it last did', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await startWorkflow($)
  const a = await spawnWf($, 'review: bugs')
  await $.tool.call({ tool: 'Bash', command: 'npm test\nmore', agentId: a } as any)
  await $.turn.complete({ agentId: a, answer: 'ok', durationMs: 5000, isAborted: false, reason: 'answer' } as any)
  const pane = await mountPane($, 'terminal', 120)
  const txt = await paneText(pane)
  expect(txt).toContain('running 0 · ended 1')
  expect(txt).toContain('Ended')
  expect(txt).toContain('Bash npm test')
  expect(txt.includes('more')).toBe(false)
  await pane.unmount()
  const hint = await mountHint($, 'terminal', 140)
  expect(await btn(hint, 'btn-agents')).toBeUndefined()
  await hint.unmount()
})

test('the board opens by itself once per workflow run, quietly; ordinary subagents do not open it', async ($, on) => {
  const calls = await start($, on, WIN, NOBODY)
  await $.agent.spawn({ prompt: 'p', description: 'plain helper', subagentType: 'Explore', tool_use_id: 'toolu_a1' } as any)
  expect(calls.opens.length).toBe(0)
  await startWorkflow($)
  await spawnWf($, 'review: bugs', 'wf_run1', 1)
  await spawnWf($, 'review: perf', 'wf_run1', 2)
  expect(calls.opens.filter((o: any) => o.id === 'hud-agents').length).toBe(1)
  await startWorkflow($, 'toolu_wf2')
  await spawnWf($, 'second run', 'wf_run2', 1, 'toolu_wf2')
  expect(calls.opens.filter((o: any) => o.id === 'hud-agents').length).toBe(2)
  expect(calls.toasts.length).toBe(0)
})

test('narrow board: each agent takes two lines and the second one starts with what it is doing', async ($, on) => {
  await start($, on, WIN, NOBODY)
  await startWorkflow($)
  const a = await spawnWf($, 'review: bugs')
  await $.tool.call({ tool: 'WebFetch', url: 'https://code.claude.com/docs', prompt: 'x', agentId: a } as any)
  const pane = await mountPane($, 'terminal', 60)
  // 每一行是一个 Box (key k-<id> / k2-<id>), 它的 text 是整行
  const first: any = await pane.find({ type: 'Box', key: 'k-' + a })
  const second: any = await pane.find({ type: 'Box', key: 'k2-' + a })
  expect(String(first?.text ?? '')).toContain('review: bugs')
  expect(String(second?.text ?? '').trim().startsWith('WebFetch code.claude.com/docs')).toBe(true)
  await pane.unmount()
})

test('the board in Chinese: group header, other subagents and the Doing column', async ($, on) => {
  await start($, on, WIN, { lang: 'zh', agents: () => [] })
  await startWorkflow($)
  await spawnWf($, 'review: bugs')
  await $.agent.spawn({ prompt: 'p', description: 'Explore codebase', subagentType: 'Explore', tool_use_id: 'toolu_a1' } as any)
  const pane = await mountPane($, 'terminal', 120)
  const txt = await paneText(pane)
  expect(txt).toContain('── review-changes · 1 个在跑 · 0 个完成 ')
  expect(txt).toContain('── 其他子代理 ')
  expect(txt).toContain('在做什么')
  for (const s of await strings(pane)) expect(SAFE2.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await pane.unmount()
})

// ================= v0.19: half-cell walking at 75ms frames =================
// previewLane 默认按 150ms 报告一帧 (旧测试的写法); fine: true 时每 75ms 报告一帧, 带半格位置 hx 和半格像素 hpx
const QUADS_ONLY = /[▐▖▗▘▙▚▛▜▝▞▟▌]/
// 编码好的一帧 -> 半格像素 (盲文点和空格都当空)
function cellsToHpx(b64: string, cols: number, rows: number): number[][] {
  const w = decode(b64)
  const hp: number[][] = []
  for (let r = 0; r < rows; r++) {
    const top: number[] = []
    const bot: number[] = []
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3
      const ch = String.fromCodePoint(w[i] ?? 32)
      const fg = w[i + 1] === 0x01000000 ? undefined : w[i + 1]
      const bg = w[i + 2] === 0x01000000 ? undefined : w[i + 2]
      const q = quadOf({ ch, fg, bg })
      top.push(q[0] ?? -1, q[1] ?? -1)
      bot.push(q[2] ?? -1, q[3] ?? -1)
    }
    hp.push(top, bot)
  }
  return hp
}
const colorsIn = (hp: number[][], c: number, r: number) => new Set([hp[r * 2]?.[c * 2], hp[r * 2]?.[c * 2 + 1], hp[r * 2 + 1]?.[c * 2], hp[r * 2 + 1]?.[c * 2 + 1]])

test('walking goes half a cell at a time: the crab stands on half cells, moves at most half a cell per 75ms frame, at the same speed as before', () => {
  const r = previewLane({ w: 100, sky: true, frames: 120, working: true, fine: true }) // 120 帧 x 75ms = 9 秒
  const hx = r.frames.map(fr => fr.hx)
  expect(hx.some(x => x % 2 === 1)).toBe(true)
  for (let f = 1; f < hx.length; f++) expect(Math.abs((hx[f] ?? 0) - (hx[f - 1] ?? 0)) <= 1 ? 'ok' : `f=${f}: ${hx[f - 1]} -> ${hx[f]}`).toBe('ok')
  // 正常速度和以前一样: 每 450ms 一格 = 每 225ms (3 帧) 半格 -> 9 秒约 40 个半格
  const steps = hx.filter((x, f) => f > 0 && x !== hx[f - 1]).length
  expect(steps >= 38 && steps <= 40 ? 'ok' : 'half steps ' + steps).toBe('ok')
  // 报告的整格位置 = 向上取整的半格位置
  for (const fr of r.frames) expect(fr.bx).toBe((fr.hx + 1) >> 1)
})

test('on a half cell the crab is drawn with quarter blocks, and the picture decodes back exactly wherever a cell holds at most two colours', { timeoutMs: 30_000 }, () => {
  const r = previewLane({ w: 90, sky: true, frames: 150, working: true, fine: true, running: () => ['a', 'b'] })
  let odd = 0
  for (const fr of r.frames) {
    const rows = 4 // 天空行 + 3 行
    const back = cellsToHpx(fr.cells, 90, rows)
    const words = decode(fr.cells)
    if (fr.hx % 2 === 1) {
      odd++
      const text = [...Array(words.length / 3).keys()].map(i => String.fromCodePoint(words[i * 3] ?? 32)).join('')
      expect(QUADS_ONLY.test(text)).toBe(true)
    }
    const bad: string[] = []
    for (let rr = 0; rr < rows; rr++)
      for (let c = 0; c < 90; c++) {
        if (colorsIn(fr.hpx, c, rr).size > 2) continue
        if (isBraille(String.fromCodePoint(words[(rr * 90 + c) * 3] ?? 32))) continue
        for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) if (back[rr * 2 + dy]?.[c * 2 + dx] !== fr.hpx[rr * 2 + dy]?.[c * 2 + dx]) bad.push(`r${rr}c${c}`)
      }
    expect(bad.length ? 'mismatch at ' + bad.slice(0, 5).join(' ') : 'ok').toBe('ok')
  }
  expect(odd > 10).toBe(true)
})

test('a cell that would need three colours keeps the shape: holes stay holes, the extra colour joins the nearest one', () => {
  // 小螃蟹的腿 (深一号) 落在半格上时, 一格里会有身体、腿和空: 腿画成身体色, 腿之间的空照样空着
  const r = previewLane({ w: 90, sky: true, frames: 150, working: true, fine: true, running: () => ['a'] })
  const fr = r.frames.find(f => f.kids[0] && f.kids[0].hx % 2 === 1)!
  expect(fr).toBeDefined()
  const back = cellsToHpx(fr.cells, 90, 4)
  const legRow = back[2 * 1 + 5] ?? [] // 天空行 2 像素 + 小螃蟹最下面一行 (第 5 行)
  const want = fr.hpx[2 * 1 + 5] ?? []
  // 空的地方一个不少
  for (let x = 0; x < want.length; x++) if (want[x] === -1) expect(legRow[x]).toBe(-1)
  // 有腿的地方都有颜色 (身体色或腿色)
  for (let x = 0; x < want.length; x++) if (want[x] === KID_L) expect([KID_L, KID_C]).toContain(legRow[x])
})

test('legs move with the steps: while walking the crab only changes its pose when it actually takes a step', () => {
  const r = previewLane({ w: 120, sky: true, frames: 90, working: true, fine: true, mood: 'chill' })
  const crop = (fr: any) => JSON.stringify(fr.hpx.slice(2).map((row: number[]) => row.slice(fr.hx, fr.hx + 2 * r.cw)))
  let changes = 0
  for (let f = 1; f < r.frames.length; f++) {
    const a = r.frames[f - 1]!
    const b = r.frames[f]!
    if (a.pose !== 'walk' || b.pose !== 'walk') continue
    if (a.hx === b.hx) expect(crop(b) === crop(a) ? 'ok' : `f=${f}: pose changed without a step`).toBe('ok')
    else if (crop(b) !== crop(a)) changes++
  }
  expect(changes > 5).toBe(true)
})

test('stopping on a half cell finishes onto a whole cell (so props are crisp) without the reported cell position moving', () => {
  const walk = previewLane({ w: 100, sky: true, frames: 60, working: true, fine: true })
  const s = walk.frames.findIndex((fr, f) => f > 10 && fr.hx % 2 === 1) + 1
  expect(s > 1).toBe(true)
  const r = previewLane({ w: 100, sky: true, frames: s + 30, working: true, fine: true, tool: f => (f >= s ? 'read' : '') })
  const before = r.frames[s - 1]!
  const stop = r.frames[s]!
  expect(before.hx % 2).toBe(1)
  expect(stop.pose).toBe('tool')
  expect(stop.hx % 2).toBe(0)
  for (let f = s; f < s + 30; f++) {
    expect(r.frames[f]?.hx).toBe(stop.hx)
    expect(r.frames[f]?.bx).toBe(before.bx)
  }
  // 道具区 (螃蟹右边 3 列) 每格最多两种颜色: 画得清楚
  const fr = r.frames[s + 10]!
  for (let c = fr.bx + 12; c < fr.bx + 15; c++) for (let rr = 1; rr < 4; rr++) expect(colorsIn(fr.hpx, c, rr).size <= 2).toBe(true)
})

test('the real crab strip runs at 75ms: sampled every 75ms the crab moves at most half a cell, and stands on half cells part of the time (mock.clock + walkway clock)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_200_000
  const { clock } = await start($, on, WIN, { mockClock: T, usage: lowUsage, agents: () => [{ id: 'k', description: 'k', type: 'x', status: 'running' }] })
  const ui = await mountAbove($, 120, 4)
  await clock.advance(10)
  await ui.advance(1500)
  const hx: number[] = []
  let quarter = false
  for (let i = 0; i < 40; i++) {
    await ui.advance(75)
    const w = await walkOf(ui)
    hx.push(w.hx)
    if (w.text.some(t => QUADS_ONLY.test(t))) quarter = true
  }
  for (let i = 1; i < hx.length; i++) expect(Math.abs((hx[i] ?? 0) - (hx[i - 1] ?? 0)) <= 1 ? 'ok' : `${hx[i - 1]} -> ${hx[i]}`).toBe('ok')
  expect(hx.some(x => x % 2 === 1)).toBe(true)
  expect(new Set(hx).size > 5).toBe(true)
  expect(quarter).toBe(true)
  await ui.unmount()
})

// ================= v0.19 step 2: in-between frames for every move =================
const mixC = (a: number, b: number, t: number) => {
  const ch = (k: number) => Math.round(((a >> k) & 255) * (1 - t) + ((b >> k) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const HOT = 0xe5484d
// 大螃蟹身体色所在的像素行 (含天空行 2 像素): [最上, 最下]
function bodySpan(fr: any): [number, number] {
  const ys: number[] = fr.px.map((row: number[], y: number) => (row.some(c => c === BODY) ? y : -1)).filter((y: number) => y >= 0)
  return [ys[0] ?? -1, ys[ys.length - 1] ?? -1]
}
// 钳子的姿势: 钳子那一列 (左 bx, 右 bx+11) 从身体最上面那行往下第几行有身体色: 举起 01 / 半举 1 / 平伸 2
function armOf(fr: any, side: 'L' | 'R'): string {
  const x = fr.bx + (side === 'R' ? 11 : 0)
  const top = bodySpan(fr)[0]
  const rows = [0, 1, 2].filter(d => fr.px[top + d]?.[x] === BODY).join('')
  return rows === '01' ? 'up' : rows === '1' ? 'mid' : rows === '2' ? 'out' : '?' + rows
}
const stepFramesOf = (r: any) => r.frames.map((fr: any, f: number) => (f > 0 && fr.hx !== r.frames[f - 1].hx ? f : -1)).filter((f: number) => f >= 0)

test('sending a message: the crab crouches, really jumps into the sky row, lands with a squash and a puff of dust, then stands (750ms)', () => {
  const r = previewLane({ w: 80, sky: true, frames: 16, working: false, fine: true, jumpAt: 2 })
  expect(r.frames.slice(2, 14).map(bodySpan)).toEqual([[3, 7], [3, 7], [1, 5], [0, 3], [0, 3], [0, 3], [1, 5], [3, 6], [2, 6], [2, 6], [2, 6], [2, 6]])
  expect(r.frames.slice(2, 12).every(fr => fr.pose === 'jump')).toBe(true)
  expect(r.frames[12]?.pose).toBe('idle')
  // 落地 (第 8 帧) 冒 5 粒尘土
  expect(r.frames[9]?.pt.filter(p => p.color === r.dust && p.age === 0).length).toBe(5)
  // 压扁: 身体最上面那行比站着宽 (10 格 vs 8 格)
  const topWidth = (fr: any) => (fr.px[bodySpan(fr)[0]] ?? []).filter((c: number) => c === BODY).length
  expect(topWidth(r.frames[9])).toBe(10)
  expect(topWidth(r.frames[12])).toBe(8)
})

test('a finished turn: the crab really hops twice with its claws up, then keeps its claws up until the celebration ends', () => {
  const r = previewLane({ w: 80, sky: true, frames: 40, working: false, fine: true, celebrating: f => f >= 2 && f < 34 })
  const air = r.frames.map(fr => bodySpan(fr)[0] < 2)
  const hops = air.filter((v, i) => v && !air[i - 1]).length
  expect(hops).toBe(2)
  expect(air.slice(18).some(Boolean)).toBe(false) // 两下都在头 1.2 秒里
  for (let f = 2; f < 34; f++) expect(armOf(r.frames[f], 'L')).toBe('up')
})

test('using tools: tapping claws pass through a half-raised pose instead of snapping between down and up', () => {
  for (const tool of ['edit', 'bash'] as const) {
    const r = previewLane({ w: 80, sky: true, frames: 30, working: true, fine: true, tool })
    const frames = r.frames.slice(4).filter(fr => fr.pose === 'tool')
    for (const side of tool === 'edit' ? (['R'] as const) : (['L', 'R'] as const)) {
      const seq = frames.map(fr => armOf(fr, side))
      expect(seq.includes('mid') ? 'ok' : `${tool} ${side}: ${seq}`).toBe('ok')
      for (let i = 1; i < seq.length; i++) {
        const pair = seq[i - 1] + '>' + seq[i]
        expect(pair === 'out>up' || pair === 'up>out' ? `${tool} ${side}: snapped ${pair}` : 'ok').toBe('ok')
      }
    }
  }
})

test('pointing at the crab: the claw goes up in two steps and comes down in two steps', () => {
  const r = previewLane({ w: 80, sky: true, frames: 14, working: false, fine: true, hold: f => f >= 3 && f < 8 })
  expect(r.frames.slice(2, 11).map(fr => armOf(fr, 'R'))).toEqual(['out', 'mid', 'up', 'up', 'up', 'up', 'mid', 'out', 'out'])
})

test('blinking: the eyes go half-closed, closed, half-closed, instead of snapping shut', () => {
  const r = previewLane({ w: 80, sky: true, frames: 130, working: false, fine: true })
  const HALF = mixC(BODY, EYE, 0.75)
  const SHUT = mixC(BODY, EYE, 0.45)
  const seq = r.frames.map(fr => {
    const all = fr.px.flat()
    return all.includes(EYE) ? 'open' : all.includes(HALF) ? 'half' : all.includes(SHUT) ? 'shut' : '?'
  })
  const shut = seq.map((v, i) => (v === 'shut' ? i : -1)).filter(i => i > 0 && i < seq.length - 1)
  expect(shut.length >= 2).toBe(true)
  for (const i of shut) expect([seq[i - 1], seq[i + 1]]).toEqual(['half', 'half'])
})

test('sleeping: the crab breathes slowly and evenly (about 2 seconds each way)', () => {
  const r = previewLane({ w: 80, sky: true, frames: 140, working: false, sleeping: true, fine: true })
  const tops = r.frames.map(fr => bodySpan(fr)[0]) // 身体最上面那行 (头边往上飘的泡泡不算)
  const changes = tops.map((t, i) => (i > 0 && t !== tops[i - 1] ? i : -1)).filter(i => i > 0)
  expect(changes.length >= 3).toBe(true)
  for (let i = 1; i < changes.length; i++) expect((changes[i] ?? 0) - (changes[i - 1] ?? 0)).toBe(27)
})

test('turning red at 80% context fades in over about a second; at 95% it pulses smoothly instead of flashing', () => {
  const center = (fr: any) => fr.px[4]?.[fr.bx + 5]
  const r = previewLane({ w: 80, sky: true, frames: 40, working: false, fine: true, pct: f => (f < 5 ? 50 : 85) })
  const cs = r.frames.map(center)
  expect(cs[4]).toBe(BODY)
  expect(cs[5] === HOT ? 'snapped to red' : 'ok').toBe('ok')
  expect(new Set(cs.slice(5, 25).filter(c => c !== BODY && c !== HOT)).size >= 5).toBe(true)
  expect(cs.slice(25).every(c => c === HOT)).toBe(true)
  const p = previewLane({ w: 80, sky: true, frames: 16, working: false, fine: true, pct: 97 })
  expect(new Set(p.frames.slice(0, 8).map(center)).size >= 4).toBe(true)
})

test('walking eases in: the first steps after starting take longer, then it settles into its pace', () => {
  const r = previewLane({ w: 120, sky: true, frames: 60, fine: true, working: f => f >= 10 })
  const steps = stepFramesOf(r)
  expect([steps[0] - 10, ...steps.slice(1, 6).map((s: number, i: number) => s - steps[i])]).toEqual([5, 4, 3, 3, 3, 3])
})

test('turning around at the end of the strip: the crab stops for a moment with its eyes already turned, then walks back', () => {
  const r = previewLane({ w: 40, sky: true, frames: 200, fine: true, working: true, mood: 'panic' })
  const flips = r.frames.map((fr, f) => (f > 0 && fr.dir !== r.frames[f - 1]?.dir ? f : -1)).filter(f => f > 0 && f < 195)
  expect(flips.length > 0).toBe(true)
  for (const f of flips) for (let k = f; k < f + 4; k++) expect(r.frames[k]?.hx).toBe(r.frames[f]?.hx)
})

test('a stroll slows down for its last steps before it stops', () => {
  const r = previewLane({ w: 80, sky: true, frames: 900, fine: true, working: false })
  const steps = stepFramesOf(r)
  const run = [steps[0]]
  for (let i = 1; i < steps.length && steps[i] - steps[i - 1] < 10; i++) run.push(steps[i])
  const gaps = run.slice(1).map((s: number, i: number) => s - run[i])
  expect(gaps.length >= 5).toBe(true)
  expect(gaps[0]).toBe(4)
  expect(gaps.slice(-2)).toEqual([4, 5])
})

test('a finished subagent waves with a neutral pose between left and right, not a hard flip', () => {
  const r = previewLane({ w: 90, sky: true, frames: 60, working: true, fine: true, running: f => (f < 10 ? ['a', 'b'] : ['a']) })
  const seq = r.frames
    .map(fr => {
      const k = fr.kids.find(q => q.id === 'b')
      if (!k || k.state !== 'wave') return ''
      const row = fr.hpx[2 + 2] ?? []
      const l = row[k.hx] === KID_C
      const rr = row[k.hx + 13] === KID_C
      return l && !rr ? 'A' : rr && !l ? 'B' : !l && !rr ? 'N' : '?'
    })
    .filter(Boolean)
  expect(seq.length > 10 && seq.includes('N')).toBe(true)
  for (let i = 1; i < seq.length; i++) expect(['AB', 'BA'].includes((seq[i - 1] ?? '') + (seq[i] ?? '')) ? 'snapped' : 'ok').toBe('ok')
})

test('a leaving subagent hops up along a little arc, drifting outward by up to a cell, without entering the sky row', () => {
  const r = previewLane({ w: 90, sky: true, frames: 120, working: true, fine: true, running: f => (f < 10 ? ['a', 'b'] : ['a']) })
  const hopping = r.frames.filter(fr => fr.kids.some(k => k.id === 'b' && k.state === 'hop'))
  expect(hopping.length > 0).toBe(true)
  const drift = hopping.map(fr => {
    const k = fr.kids.find(q => q.id === 'b')!
    const xs = fr.hpx.slice(2).flatMap(row => row.map((c, x) => (c === KID_C && Math.abs(x - k.hx) < 16 ? x : -1)).filter(x => x >= 0))
    return xs.length ? Math.min(...xs) - k.hx : 0
  })
  expect(Math.min(...drift)).toBe(-2)
  for (const fr of hopping) expect(fr.hpx.slice(0, 2).flat().includes(KID_C)).toBe(false)
})

// ================= v0.20.1: not fullscreen -> say how to click =================
// 普通画面 (不是全屏) 时终端不把鼠标点击交给 Claude Code, 工具栏点不动: 在工具栏那一行旁边提示怎么办
async function mountHintMain($: any, cols: number) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface: 'terminal',
    component: 'PromptHint',
    requestId: 'hint-main',
    viewport: { columns: cols, rows: 40, isFullscreen: false },
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  } as any)
}
const toolbarText = async (ui: any) => String(((await ui.find({ type: 'Box', key: 'tb0' })) as any)?.text ?? '')

test('not fullscreen: the toolbar says clicking needs /tui fullscreen (or type /hud handoff); in fullscreen it does not', async ($, on) => {
  await start($, on, WIN, CALM)
  const main = await mountHintMain($, 140)
  const t = await toolbarText(main)
  expect(t).toContain('clicks need /tui fullscreen, or type /hud handoff')
  for (const s of await strings(main)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await main.unmount()
  const full = await mountHint($, 'terminal', 140)
  expect(await toolbarText(full)).not.toContain('fullscreen')
  await full.unmount()
})

test('not fullscreen, in Chinese: the hint reads in Chinese', async ($, on) => {
  await start($, on, WIN, { ...CALM, lang: 'zh' })
  const main = await mountHintMain($, 140)
  expect(await toolbarText(main)).toContain('点击需要 /tui fullscreen，也可以输入 /hud handoff')
  for (const s of await strings(main)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  await main.unmount()
})

test('not fullscreen in a narrow window: the hint gets shorter or steps aside, and the toolbar never gets wider than the panel', async ($, on) => {
  await start($, on, WIN, CALM)
  for (const cols of [100, 81, 65, 51]) {
    const main = await mountHintMain($, cols)
    const info: any = await main.find({ type: 'Box', key: 'info' })
    const t = await toolbarText(main)
    expect(dwT(t) <= info.props.width ? 'ok' : `${cols}: "${t}" is wider than ${info.props.width}`).toBe('ok')
    expect(info.children.filter((c: any) => /^tb\d$/.test(c.props?.key ?? '')).length).toBe(1) // 提示不另起一行
    await main.unmount()
  }
  const mid = await mountHintMain($, 65)
  expect(await toolbarText(mid)).toContain('/tui fullscreen') // 中等宽度放短的那句
  await mid.unmount()
})

// ================= v1.4: remote control 的 rc 绿点 (全屏时 Claude Code 把 /rc 画在顶部 logo 里, 一滚就看不到) =================
const RC_OFF = 'Remote Control disconnected.'
const runRc = ($: any) => $.command.run({ command: 'remote-control', args: '' } as any)
async function cmdOutput($: any, command = 'remote-control', text = RC_OFF) {
  const ui = await $.ui.mount({ plugin: 'cc-hud', surface: 'terminal', component: 'CommandOutput', requestId: 'out-' + command, props: { command, args: '', text, isErrored: false } } as any)
  await ui.unmount()
}
const rcDot = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as any[]).find(t => t.text === '●')
async function hasRc($: any, mount: (cols: number) => Promise<any> = cols => mountHint($, 'terminal', cols), cols = 140) {
  const ui = await mount(cols)
  const has = !!(await btn(ui, 'btn-rc'))
  await ui.unmount()
  return has
}

test('remote control: after /remote-control a green dot rc sits at the right end of the toolbar; pressing it runs /remote-control again', async ($, on) => {
  const calls = await start($, on, WIN, CALM)
  expect(await hasRc($)).toBe(false)
  await runRc($)
  for (const cols of [140, 65]) {
    const ui = await mountHint($, 'terminal', cols)
    expect((await btn(ui, 'btn-rc'))?.props.label).toBe('rc')
    expect((await rcDot(ui))?.props.color).toBe('#4ade80')
    const info: any = await ui.find({ type: 'Box', key: 'info' })
    const t = await toolbarText(ui)
    expect(t.endsWith('● rc') ? 'ok' : `${cols}: "${t}"`).toBe('ok')
    expect(dwT(t)).toBe(info.props.width) // 靠右, 正好到面板右边
    for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
    await ui.unmount()
  }
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-rc' }) // 弹出 Claude Code 自己的窗口: 链接、二维码、断开
  expect(calls.cmd.filter(c => c === 'remote-control').length).toBe(2)
  await ui.unmount()
})

test('remote control: Disconnect (its output row appears) takes the rc away; Continue or Esc (no output) keeps it; /clear keeps it', async ($, on) => {
  await start($, on, WIN, CALM)
  await runRc($)
  await runRc($) // 开着时再跑, 窗口里选了「继续」: 什么都不打印
  expect(await hasRc($)).toBe(true)
  await $.session.start({ cwd: WIN.cwd, source: 'clear' } as any) // 清空后 remote control 还开着
  expect(await hasRc($)).toBe(true)
  await runRc($)
  await cmdOutput($) // 选了「断开」
  expect(await hasRc($)).toBe(false)
})

test('remote control: an old "disconnected" row drawn again later (a scroll) and other commands\' output leave the rc alone', async ($, on) => {
  const { clock } = await start($, on, WIN, { ...CALM, mockClock: 1_900_000_000_000 })
  await runRc($)
  await cmdOutput($, 'cost', 'Total cost: $0.12') // 别的命令的输出
  expect(await hasRc($)).toBe(true)
  await cmdOutput($) // 断开
  await runRc($) // 又打开
  await clock.advance(10_000)
  await cmdOutput($) // 滚动时, 之前那行「disconnected」又画了一次
  expect(await hasRc($)).toBe(true)
})

test('remote control: no rc when not fullscreen (Claude Code draws its own /rc at the bottom right there); the one-line panel shows it right after the buttons', async ($, on) => {
  await start($, on, WIN, CALM)
  await runRc($)
  expect(await hasRc($, cols => mountHintMain($, cols))).toBe(false)
  await $.command.run({ command: 'hud', args: 'compact' } as any)
  const ui = await mountHint($, 'terminal', 140)
  const line: any = await ui.find({ type: 'Box', key: 'hud-line' })
  const keys: string[] = line.children.map((c: any) => c.props?.key)
  expect(keys.slice(0, 2)).toEqual(['seg-bar', 'seg-rc'])
  expect((await rcDot(ui))?.props.color).toBe('#4ade80')
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'full' } as any)
})

// ================= v1.4: 工具栏上的「今天用了多少」(清单第 4 项; 用户选了 A: 靠右, 完整的一句, 挨着 rc; 网格不动) =================
const DAY = 86_400_000
const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
const midnightOf = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
// 下午 2 点; 本周额度在 3.5 天后 (从今天 0 点算) 重置 -> 今天 0 点剩 70% 时, 每天能用 20%
const PT = midnightOf(1_900_000_000_000) + 14 * 3600_000
const PAT = midnightOf(PT) + 3.5 * DAY
const weekAt = (pct: () => number, at = PAT) => () => ({
  ...USAGE,
  context: { tokens: 80_000, window: 200_000, percent: 40 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: new Date(PT + 2 * 3600_000).toISOString() },
    { kind: 'seven_day', percentUsed: pct(), resetsAt: new Date(at).toISOString() },
  ],
})
const dayStore = (start: number, at = PAT, day = dayKey(PT)) => ({ paceDay: { day, start, resetsAt: new Date(at).toISOString() } })
const findText = async (ui: any, text: string) => ((await ui.findAll({ type: 'Text' })) as any[]).find(t => t.text === text)

test('today\'s share: used today = now - first reading of the day; per day = what was left then / days to the reset counting today', () => {
  const mid = midnightOf(PT)
  expect(dayShare(30, 51, mid + 3.5 * DAY, mid)).toEqual({ today: 21, daily: 20, over: true })
  expect(dayShare(30, 40, mid + 3.5 * DAY, mid)).toEqual({ today: 10, daily: 20, over: false })
  expect(dayShare(60, 70, mid + 0.4 * DAY, mid).daily).toBe(40) // 今天就重置: 剩下的全是今天的
  expect(dayShare(30, 29, mid + 3.5 * DAY, mid).today).toBe(0)
})

test('toolbar: today\'s use and the daily share sit at the right end, next to rc; the grid is unchanged; today\'s number turns orange once over', async ($, on) => {
  let pct = 51
  await start($, on, WIN, { ...CALM, lang: null, mockClock: PT, usage: weekAt(() => pct), store: dayStore(30) })
  let ui = await mountHint($, 'terminal', 140)
  let t = await toolbarText(ui)
  const info: any = await ui.find({ type: 'Box', key: 'info' })
  expect(t.endsWith('today 21% · 20%/day') ? 'ok' : t).toBe('ok')
  expect(dwT(t)).toBe(info.props.width)
  expect((await findText(ui, '21%'))?.props.color).toBe('#fb923c')
  for (const s of await strings(ui)) expect(SAFE.test(s) ? 'ok' : 'unsafe: ' + s).toBe('ok')
  const week: any = await ui.find({ type: 'Box', key: 'r2c2' })
  expect(String(week?.text ?? '')).not.toContain('day') // 本周那格照旧
  await ui.unmount()
  pct = 40
  ui = await mountHint($, 'terminal', 140)
  expect((await toolbarText(ui)).endsWith('today 10% · 20%/day')).toBe(true)
  expect((await findText(ui, '10%'))?.props.color).toBe('#d4d4d8')
  await ui.unmount()
  await runRc($)
  ui = await mountHint($, 'terminal', 140)
  t = await toolbarText(ui)
  expect(t.endsWith('today 10% · 20%/day   ● rc') ? 'ok' : t).toBe('ok')
  await ui.unmount()
})

test('toolbar in Chinese: 今天用了 21% · 每天能用 20%', async ($, on) => {
  await start($, on, WIN, { ...CALM, lang: 'zh', mockClock: PT, usage: weekAt(() => 51), store: dayStore(30) })
  const ui = await mountHint($, 'terminal', 140)
  const t = await toolbarText(ui)
  expect(t.endsWith('今天用了 21% · 每天能用 20%') ? 'ok' : t).toBe('ok')
  await ui.unmount()
})

test('today\'s start: the first reading of the day is remembered across sessions and reloads; a new day or a new week window starts over', async ($, on) => {
  let pct = 30
  let at = PAT
  let tnow = PT
  await start($, on, WIN, { ...CALM, lang: null, now: () => tnow, usage: () => weekAt(() => pct, at)() })
  const tb = async () => {
    const ui = await mountHint($, 'terminal', 140)
    const t = await toolbarText(ui)
    await ui.unmount()
    return t
  }
  expect(await tb()).toContain('today 0% · 20%/day')
  pct = 51
  expect(await tb()).toContain('today 21% · 20%/day')
  await $.session.start({ cwd: WIN.cwd } as any) // 重新加载 / 新会话: 从存储里读回今天的起点
  expect(await tb()).toContain('today 21%')
  tnow += DAY // 第二天: 起点重新记
  expect(await tb()).toContain('today 0%')
  pct = 55
  at = PAT + 7 * DAY // 本周额度重置了 (重置时间跳了一周): 也重新记
  expect(await tb()).toContain('today 0%')
})

test('crab: sweats once today\'s use is over the daily share, even when the week as a whole is on pace', async ($, on) => {
  let pct = 51
  await start($, on, WIN, { ...CALM, mockClock: PT, usage: weekAt(() => pct), store: dayStore(30) })
  let band = await mountBand($, 140)
  expect(((await band.find({ type: 'Client' })) as any)?.props.props.mood).toBe('sweat')
  await band.unmount()
  pct = 40
  band = await mountBand($, 140)
  expect(((await band.find({ type: 'Client' })) as any)?.props.props.mood).not.toBe('sweat') // 整周还慢于时间: 平常或悠闲
  await band.unmount()
})

test('toolbar: a shorter form when room runs out; none without a weekly limit; the one-line panel puts the short form last when it fits', async ($, on) => {
  let limits = true
  await start($, on, WIN, { ...CALM, lang: null, mockClock: PT, usage: () => (limits ? weekAt(() => 51)() : { ...USAGE, rateLimits: [] }), store: dayStore(30) })
  let ui = await mountHint($, 'terminal', 51)
  const t = await toolbarText(ui)
  const info: any = await ui.find({ type: 'Box', key: 'info' })
  expect(t.endsWith('today 21/20%') ? 'ok' : t).toBe('ok')
  expect(dwT(t) <= info.props.width).toBe(true)
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'compact' } as any)
  ui = await mountHint($, 'terminal', 170)
  const line: any = await ui.find({ type: 'Box', key: 'hud-line' })
  const keys: string[] = line.children.map((c: any) => c.props?.key)
  expect(keys[keys.length - 1]).toBe('seg-pace')
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'full' } as any)
  limits = false
  ui = await mountHint($, 'terminal', 140)
  expect(await toolbarText(ui)).not.toContain('today')
  await ui.unmount()
})

test('desktop: the toolbar row ends with today\'s use (the full sentence) and, after /remote-control, the green rc', async ($, on) => {
  const calls = await start($, on, WIN, { ...CALM, lang: null, mockClock: PT, usage: weekAt(() => 51), store: dayStore(30) })
  let ui = await mountDesktop($, 110)
  const share: any = await ui.find({ type: 'Box', key: 'd-share' })
  expect(String(share?.text ?? '')).toBe('today 21% · 20%/day')
  expect((await findText(ui, '21%'))?.props.color).toBe('#fb923c')
  expect(await btn(ui, 'btn-rc')).toBeUndefined()
  await ui.unmount()
  await runRc($)
  ui = await mountDesktop($, 110)
  expect((await btn(ui, 'btn-rc'))?.props.label).toBe('rc')
  expect((await rcDot(ui))?.props.color).toBe('#4ade80')
  await ui.press({ key: 'btn-rc' })
  expect(calls.cmd.filter(c => c === 'remote-control').length).toBe(2)
  await ui.unmount()
})

// ================= v1.4 第 14 项: 终端的新动作同步到客户端 (用户: "终端改了比如说搜网页 同步改到客户端") =================
const crabD = (o: any = {}) => crabSvg({ mode: 'idle', kind: 'think', heat: 'ok', agents: 0, mood: 'normal', ...o }, 5)
const hasRect = (svg: string, x: number, y: number, fill: string, w = 1, h = 1) => svg.includes(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"`)

test('desktop search: a green radar ring with a sweeping light instead of the globe; when found, blips light up for 1.8 s and the right claw goes up', () => {
  const run = crabD({ mode: 'work', kind: 'search' })
  expect(hasRect(run, 13, 0, '#15803d')).toBe(true) // 雷达环 (和终端同一个绿)
  expect(run).toContain('fill="#4ade80"') // 扫过去的亮点
  expect(run).not.toContain('#3b82f6') // 不再是地球
  const found = crabD({ mode: 'work', kind: 'think', end: { kind: 'search', ok: true, ms: 0, hits: 3 } })
  expect((found.match(/class="blip"/g) ?? []).length).toBe(3)
  expect(found).toMatch(/<set attributeName="opacity" to="0" begin="1.8s"/) // 1.8 秒后收起
  expect(hasRect(found, 11, 0, 'currentColor', 1, 2)).toBe(true) // 右钳举起
  const half = crabD({ mode: 'work', kind: 'think', end: { kind: 'search', ok: true, ms: 1000, hits: 9 } })
  expect((half.match(/class="blip"/g) ?? []).length).toBe(5) // 最多 5 个
  expect(half).toMatch(/<set attributeName="opacity" to="0" begin="0.8s"/) // 已经过了 1 秒: 还剩 0.8 秒
})

test('desktop fetch: the page flies in from the right with a blue bar and lines loading; when fetched it folds away with two sparkles (0.9 s)', () => {
  const run = crabD({ mode: 'work', kind: 'fetch', toolMs: 0 })
  expect(run).toMatch(/type="translate" values="4 0;0 0"[^>]*fill="freeze"/) // 从右边飞进来
  expect(hasRect(run, 13, 0, '#60a5fa', 3, 1)).toBe(true) // 蓝条
  expect(run).not.toContain('#3b82f6')
  const done = crabD({ mode: 'work', kind: 'think', end: { kind: 'fetch', ok: true, ms: 0 } })
  expect(done).toMatch(/attributeName="height" values="4;0"/) // 收起来
  expect((done.match(/fill="#facc15"/g) ?? []).length).toBe(2) // 两点亮光
  expect(done).toMatch(/<set attributeName="opacity" to="0" begin="0.9s"/)
})

test('desktop bash: types first, then output scrolls; the last line turns green when it finishes, red when it fails; after 15 s it steams', () => {
  const early = crabD({ mode: 'work', kind: 'bash', toolMs: 1000 })
  expect(early).toMatch(/<set attributeName="opacity" to="1" begin="0.35s"/) // 敲完命令 (1.35 秒) 开始滚输出
  expect(early).toMatch(/class="impatient"[^>]*><set attributeName="opacity" to="1" begin="14s"/) // 15 秒时不耐烦
  const late = crabD({ mode: 'work', kind: 'bash', toolMs: 15_000 })
  expect(late).toMatch(/class="impatient"[^>]*><set attributeName="opacity" to="1" begin="0s"/)
  expect(late).toContain('class="steam"')
  const ok = crabD({ mode: 'work', kind: 'think', end: { kind: 'bash', ok: true, ms: 0 } })
  expect(hasRect(ok, 13, 3, '#4ade80', 3, 1)).toBe(true)
  expect(ok).toMatch(/<set attributeName="opacity" to="0" begin="0.6s"/)
  const bad = crabD({ mode: 'work', kind: 'think', end: { kind: 'bash', ok: false, ms: 0 } })
  expect(hasRect(bad, 13, 3, '#ef4444', 3, 1)).toBe(true)
})

test('desktop edit: one ink dot per claw tap (blue for a moment); when the edit is done the page flies up into the headroom', () => {
  const run = crabD({ mode: 'work', kind: 'edit' })
  expect((run.match(/class="ink"/g) ?? []).length).toBe(12)
  expect(run).toContain('fill="#60a5fa"') // 刚点下去是蓝的
  const done = crabD({ mode: 'work', kind: 'think', end: { kind: 'edit', ok: true, ms: 0 } })
  expect(done).toMatch(/type="translate" values="0 0;0 -2"/)
})

test('desktop nap: dozes at 4 minutes (line eyes, drooping claws, nodding), sleeps in the sand with a nightcap at 5; waking pops it out and the cap flies off', () => {
  const doze = crabD({ doze: true })
  expect(doze).toContain('class="line-eye"')
  expect(doze).not.toMatch(/dur="12s"/) // 不挥手
  expect(hasRect(doze, 0, 3, 'currentColor', 2, 1)).toBe(true) // 钳子耷拉
  const sleep = crabD({ mode: 'sleep' })
  expect(sleep).toContain('fill="#c8a96a"') // 沙堆
  expect(sleep).toContain('fill="#4f46e5"') // 睡帽
  expect(sleep).toContain('class="line-eye"')
  const burrow = crabD({ mode: 'sleep', sleepMs: 0 })
  expect(burrow).toMatch(/type="translate" values="0 0;0 1"[^>]*fill="freeze"/) // 钻进沙里
  const wake = crabD({ wake: { from: 'sand', ms: 0 } })
  expect(wake).toContain('class="cap-off"') // 睡帽飞走
  expect(wake).not.toContain('class="line-eye"')
})

test('desktop: while you type the crab looks down at the prompt; the sunglasses get a glint', () => {
  expect(crabD({ typing: true })).toMatch(/<rect x="4" y="2" width="1" height="1" fill="#1c1917"/)
  expect(crabD({ mood: 'chill' })).toContain('width="0.5" height="0.5" fill="#fafafa"')
})

const deskCrabSrc = async (ui: any) => String(((await ui.findAll({ type: 'Svg' })) as any[]).find(x => String(x.props.alt).includes('螃蟹'))?.props.source ?? '')

test('desktop card follows the hooks: a running command schedules its 15 s steam; a failed one leaves a red line for a moment', { timeoutMs: 30_000 }, async ($, on) => {
  let open: () => void = () => {}
  const { clock } = await start($, on, WIN, { mockClock: 1_900_000_400_000, lang: 'zh', agents: () => [], usage: lowUsage, toolError: e => e.tool === 'Bash', toolGate: () => new Promise<void>(r => (open = r)) })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  const ui = await mountDesktop($, 110, true)
  const call = $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  await clock.settle()
  // 刚开始跑: 冒热气排在第 15 秒 (没把开始时间交给客户端的话会是第 0 秒)
  expect(await deskCrabSrc(ui)).toMatch(/class="impatient"[^>]*><set attributeName="opacity" to="1" begin="15s"/)
  open()
  await call
  await clock.settle()
  expect(hasRect(await deskCrabSrc(ui), 13, 3, '#ef4444', 3, 1)).toBe(true) // 报错: 最后一行变红
  await ui.unmount()
})

test('desktop card follows the hooks: long idle dozes at 4 minutes, then sleeps in the sand at 5; any activity wakes it', async ($, on) => {
  let tnow = 1_900_000_500_000
  await start($, on, WIN, { lang: 'zh', agents: () => [], usage: lowUsage, now: () => tnow })
  const crab = async () => {
    const ui = await mountDesktop($, 110)
    const svg = await deskCrabSrc(ui)
    await ui.unmount()
    return svg
  }
  tnow += 4.5 * 60_000 // 从会话开始就没动静
  expect(await crab()).toContain('class="line-eye"')
  tnow += 60_000
  const sleep = await crab()
  expect(sleep).toContain('fill="#4f46e5"')
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: 'b', cursor: 1, start: 0, end: 0, inputText: 'b' }) // 你回来打字了
  const woke = await crab()
  expect(woke).toContain('class="cap-off"') // 蹦出来, 睡帽飞走
  expect(woke).not.toContain('class="line-eye"')
})

// ================= v0.21: the desktop SVG crab gets the same smoothness =================
const deskCrab = (o: any = {}) => crabSvg({ mode: 'idle', kind: 'think', heat: 'ok', agents: 0, mood: 'normal', ...o }, 5)
const moveAnims = (svg: string) => svg.match(/<animateTransform[^>]*>/g) ?? []

test('desktop crab: bobbing and breathing glide smoothly instead of jumping a pixel at a time', () => {
  const work = deskCrab({ mode: 'work', kind: 'read' })
  expect(moveAnims(work).some(a => a.includes('values="0 0;0 1;0 0"') && a.includes('calcMode="spline"'))).toBe(true)
  const sleep = deskCrab({ mode: 'sleep' })
  expect(moveAnims(sleep).some(a => a.includes('values="0 0;0 1;0 0"') && a.includes('dur="4s"') && a.includes('calcMode="spline"'))).toBe(true)
  // 汗珠往下掉、扫描线、睡觉泡泡: 平滑滑动
  expect(deskCrab({ mode: 'work', kind: 'read' })).toMatch(/<animate attributeName="y" values="0;3"[^>]*calcMode="linear"/)
  expect(deskCrab({ mood: 'sweat' })).toMatch(/<animate attributeName="y" values="0;2"[^>]*calcMode="linear"/)
  expect(sleep).toMatch(/<animate attributeName="y" values="5;0"[^>]*calcMode="linear"/)
})

test('desktop crab: tapping, typing and waving pass through a half-raised claw; blinking goes half-closed', () => {
  const MID_R = '<rect x="11" y="1" width="1" height="1"'
  const MID_L = '<rect x="0" y="1" width="1" height="1"'
  expect(deskCrab({ mode: 'work', kind: 'edit' })).toContain(MID_R)
  const bash = deskCrab({ mode: 'work', kind: 'bash' })
  expect(bash).toContain(MID_R)
  expect(bash).toContain(MID_L)
  expect(deskCrab({ mode: 'idle' })).toContain(MID_R) // 挥手
  expect(deskCrab({ mode: 'idle' })).toContain('#4b3127') // 半闭的眼睛
  expect(deskCrab({ mode: 'sleep' })).not.toContain('#4b3127')
})

test('desktop crab: at 95% it pulses smoothly; a fresh red fades in over a second and picks up where it left off', () => {
  const crit = deskCrab({ heat: 'crit' })
  expect(crit).toMatch(/<animate attributeName="color" values="#e5484d;#d97757;#e5484d"[^>]*calcMode="spline"/)
  expect(crit).not.toMatch(/attributeName="(fill|color)"[^>]*calcMode="discrete"/)
  const fresh = deskCrab({ heat: 'hot', heatFrom: 'ok', heatMs: 300 })
  expect(fresh).toContain('<animate attributeName="color" from="#d97757" to="#e5484d" dur="1s" begin="-0.3s" fill="freeze"/>')
  expect(deskCrab({ heat: 'hot', heatFrom: 'ok', heatMs: 1500 })).not.toContain('from="#d97757"') // 渐变早就播完了
  expect(deskCrab({ heat: 'hot' })).not.toContain('from="#d97757"')
})

test('desktop crab: a finished turn hops twice into the headroom and a sent message jumps; a redrawn picture carries on mid-move', () => {
  const cel = deskCrab({ mode: 'celebrate', celebMs: 400 })
  expect(moveAnims(cel).some(a => a.includes('0 -2') && a.includes('begin="-0.4s"') && a.includes('fill="freeze"'))).toBe(true)
  const jump = deskCrab({ mode: 'work', kind: 'think', jumpMs: 200 })
  expect(moveAnims(jump).some(a => a.includes('0 -2') && a.includes('begin="-0.2s"') && a.includes('fill="freeze"'))).toBe(true)
  expect(moveAnims(deskCrab({ mode: 'work', kind: 'think', jumpMs: 800 })).some(a => a.includes('fill="freeze"'))).toBe(false)
  expect(moveAnims(deskCrab({ mode: 'work', kind: 'think' })).some(a => a.includes('fill="freeze"'))).toBe(false)
  // 顶上留一行给跳: viewBox 从 -2 开始, 8 行高
  expect(deskCrab()).toContain('viewBox="0 -2 16 8"')
  expect(deskCrab()).toContain('height="40"')
})

test('desktop panel: sending a message makes the crab jump, and finishing a turn makes it hop (mock.clock)', { timeoutMs: 30_000 }, async ($, on) => {
  const T = 1_900_000_000_000
  const { clock } = await start($, on, WIN, { mockClock: T, agents: () => [], usage: lowUsage })
  const crabSrc = async () => {
    const ui = await $.ui.mount({ plugin: 'cc-hud', surface: 'desktop', component: 'AbovePrompt', requestId: 'd-band', viewport: { columns: 140, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { top: 0, bodyRows: 10, totalRows: 4 }, view: {} } } as any)
    const svgs: any[] = await ui.findAll({ type: 'Svg' })
    const src = String(svgs.find(x => String(x.props.alt).includes('crab') || String(x.props.alt).includes('螃蟹'))?.props.source ?? '')
    await ui.unmount()
    return src
  }
  const freeze = (src: string) => moveAnims(src).filter(a => a.includes('fill="freeze"'))
  expect(freeze(await crabSrc()).length).toBe(0)
  // 和真的一样: 发出消息, 紧接着这一轮开始 (只发消息不开始一轮的话, 约 2 秒后就算这次提问做完、开始庆祝)
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(100)
  expect(freeze(await crabSrc()).some(a => a.includes('0 -2'))).toBe(true)
  await clock.advance(1500)
  expect(freeze(await crabSrc()).length).toBe(0) // 跳完了, 换图时不再带那一跳
  await clock.advance(1400)
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await clock.advance(2200)
  const src = await crabSrc()
  expect(freeze(src).some(a => a.includes('0 -2'))).toBe(true)
})

// ================= v0.22: panic = flailing claws + sweat flung off the head (option A) =================
const SWEAT = 0x60a5fa
const ALARM = 0xef4444

test('panic in the crab strip: the claws flail in turn (never both up), sweat is flung up into the sky row instead of sticking beside a claw, and the "!" stays', () => {
  const r = previewLane({ w: 80, sky: true, frames: 40, working: false, fine: true, mood: 'panic' })
  const L = r.frames.map(fr => armOf(fr, 'L'))
  const R = r.frames.map(fr => armOf(fr, 'R'))
  for (let i = 0; i < r.frames.length; i++) expect(L[i] === 'up' && R[i] === 'up' ? `frame ${i}: both claws up` : 'ok').toBe('ok')
  for (const side of [L, R]) expect(side.includes('up') && side.includes('mid')).toBe(true)
  // 螃蟹那几行 (天空行以下) 里没有汗滴; 汗珠只在天空行, 在头的外侧
  for (const fr of r.frames) expect(fr.px.slice(2).flat().includes(SWEAT) ? 'sweat beside the crab' : 'ok').toBe('ok')
  const flung = r.frames.flatMap(fr => fr.px.slice(0, 2).flatMap(row => row.map((c, x) => (c === SWEAT ? x - fr.bx : -99)).filter(x => x > -99)))
  expect(flung.length > 0).toBe(true)
  expect(flung.every(x => x <= 2 || x >= 9)).toBe(true)
  expect(flung.some(x => x <= 1) && flung.some(x => x >= 10)).toBe(true) // 往两边甩出去
  expect(r.frames.some(fr => fr.px.flat().includes(ALARM))).toBe(true)
})

test('panic in the panel sprite: claws take turns and no sweat drop sits beside them; while working there is no head-side mark either (v1.3)', () => {
  const at = (px: number[][], x: number, y: number) => px[y]?.[x]
  const p = previewPixels('', { working: false, mood: 'panic' })
  const B = p.colors.body
  expect(p.big.some(px => at(px, 0, 0) === B && at(px, 11, 0) === B)).toBe(false) // 不会两只同时举到最上面
  expect(p.big.some(px => at(px, 0, 0) === B) && p.big.some(px => at(px, 11, 0) === B)).toBe(true) // 两只轮流举
  expect(p.big.some(px => at(px, 1, 0) === p.colors.sweat || at(px, 1, 1) === p.colors.sweat)).toBe(false)
  const work = previewPixels('Bash', { working: true, mood: 'panic' })
  expect(work.big.some(px => at(px, 1, 0) === p.colors.alarm || at(px, 1, 1) === p.colors.alarm)).toBe(false)
  expect(work.big.some(px => at(px, 1, 0) === p.colors.sweat || at(px, 1, 1) === p.colors.sweat)).toBe(false)
})

test('panic on the desktop: the claws flail through a half-raised pose, sweat is flung into the headroom, and the eyes no longer shake', () => {
  const svg = deskCrab({ mood: 'panic' })
  expect(svg).toContain('<rect x="11" y="1" width="1" height="1"') // 右钳半举
  expect(svg).toContain('<rect x="0" y="1" width="1" height="1"') // 左钳半举
  expect(svg).not.toMatch(/attributeName="y" values="0;2"/) // 头边那颗往下滑的汗滴没了
  expect(svg).toMatch(/fill="#60a5fa"[^>]*>(<animate[^>]*>)*<animate attributeName="y" values="-1;-2;-2/) // 汗珠往顶上甩
  expect(svg).not.toContain('values="-1 0;1 0"') // 眼睛不再左右抖
  expect(svg).toContain('#ef4444')
})

// ================= v1.1: desktop toolbar (Settings / Handoff as native buttons above the card) =================
const sel = async (ui: any, key: string) => (await ui.find({ type: 'Select', key })) as any
const svgCount = async (ui: any) => ((await ui.findAll({ type: 'Svg' })) as any[]).length
const dashOf = async (ui: any) => {
  const all: any[] = await ui.findAll({ type: 'Svg' })
  return String(all[all.length - 1]?.props.source ?? '')
}

test('desktop toolbar: Settings and Handoff are native buttons above the crab and the dashboard; Settings opens three dropdowns', async ($, on) => {
  await start($, on, WIN, EN)
  const ui = await mountDesktop($, 120)
  expect((await btn(ui, 'btn-settings'))?.props.label).toBe('Settings')
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('Handoff')
  // 原生按钮: 不加 plain (终端那套方括号只在终端画)
  expect((await btn(ui, 'btn-handoff'))?.props.plain).toBeUndefined()
  // 工具栏那一行在卡片 (两张 SVG) 上面
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('btn-settings') >= 0 && tree.indexOf('btn-settings') < tree.indexOf('<svg')).toBe(true)
  expect(await svgCount(ui)).toBe(2)
  expect(await sel(ui, 'sel-lang')).toBeUndefined()
  await ui.press({ key: 'btn-settings' })
  expect((await sel(ui, 'sel-lang'))?.props.value).toBe('en')
  expect((await sel(ui, 'sel-crab'))?.props.value).toBe('on')
  expect((await sel(ui, 'sel-panel'))?.props.value).toBe('full')
  expect((await sel(ui, 'sel-lang'))?.props.options.map((o: any) => o.value)).toEqual(['en', 'zh'])
  expect((await sel(ui, 'sel-crab'))?.props.options.map((o: any) => o.value)).toEqual(['on', 'off'])
  expect((await sel(ui, 'sel-panel'))?.props.options.map((o: any) => o.value)).toEqual(['full', 'compact', 'off'])
  expect((await sel(ui, 'sel-lang'))?.props.label).toBe('Lang')
  await ui.press({ key: 'btn-settings' })
  expect(await sel(ui, 'sel-lang')).toBeUndefined()
  await ui.unmount()
})

test('desktop toolbar: the dropdowns switch the language, hide the crab and pick the compact card', async ($, on) => {
  await start($, on, WIN, EN)
  const ui = await mountDesktop($, 120)
  await ui.press({ key: 'btn-settings' })
  await ui.select({ key: 'sel-lang', value: 'zh' })
  expect((await btn(ui, 'btn-settings'))?.props.label).toBe('设置')
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('交接')
  expect((await sel(ui, 'sel-lang'))?.props.value).toBe('zh')
  // 螃蟹 关: 卡片里只剩仪表盘
  await ui.select({ key: 'sel-crab', value: 'off' })
  expect(await svgCount(ui)).toBe(1)
  expect((await sel(ui, 'sel-crab'))?.props.value).toBe('off')
  await ui.select({ key: 'sel-crab', value: 'on' })
  expect(await svgCount(ui)).toBe(2)
  // 面板 精简: 仪表盘换成一行的样子
  const full = await dashOf(ui)
  await ui.select({ key: 'sel-panel', value: 'compact' })
  expect((await sel(ui, 'sel-panel'))?.props.value).toBe('compact')
  expect((await dashOf(ui)) !== full).toBe(true)
  expect(await dashOf(ui)).toContain('height="22"')
  await ui.unmount()
})

test('desktop toolbar: at 85% context Handoff becomes the primary button', async ($, on) => {
  let pct = 60
  await start($, on, WIN, { ...EN, usage: () => ({ ...USAGE, context: { ...USAGE.context, percent: pct } }) })
  let ui = await mountDesktop($, 120)
  expect((await btn(ui, 'btn-handoff'))?.props.variant).toBeUndefined()
  await ui.unmount()
  pct = 86
  ui = await mountDesktop($, 120)
  expect((await btn(ui, 'btn-handoff'))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('desktop handoff: "Writing handoff…" without seconds, then saved; the toast says the app cannot copy yet, and Open handoff file opens it', async ($, on) => {
  let clk: any
  const calls = await start($, on, WIN, { ...EN, mockClock: T0, copyOk: false, fork: async () => (await clk.sleep(20_000), { isAnswered: true, text: 'BODY', usage: {} }) })
  clk = calls.clock
  let ui = await mountDesktop($, 120)
  expect(await btn(ui, 'btn-handoff-open')).toBeUndefined()
  await ui.press({ key: 'btn-handoff' })
  await ui.unmount()
  await clk.advance(8000)
  ui = await mountDesktop($, 120)
  // 客户端里面板大约 15 秒才刷新一次: 不显示秒数
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('Writing handoff…')
  await ui.unmount()
  await clk.advance(12_000)
  await clk.settle()
  expect(calls.writes.length).toBe(1)
  const toast = calls.toasts.find(t => t.startsWith('Handoff saved to'))
  expect(toast).toBeDefined()
  expect(toast).toMatch(/can't copy yet/)
  ui = await mountDesktop($, 120)
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('Handoff')
  expect((await btn(ui, 'btn-handoff-open'))?.props.label).toBe('Open handoff file')
  const before = calls.run.length
  await ui.press({ key: 'btn-handoff-open' })
  const opened = calls.run.slice(before).find(a => /\.md$/.test(String(a[a.length - 1])))
  expect(opened?.slice(0, 5)).toEqual(['cmd.exe', '/d', '/c', 'start', 'cc-hud'])
  // 测试引擎会把写文件的 C:\ 路径规整成本机写法: 打开的是原来的 Windows 路径, 只比结尾
  const target = String(opened?.[opened.length - 1])
  expect(target).toMatch(/^C:\\Users\\me\\\.claude\\handoffs\\my-app\\\d{4}-\d\d-\d\d-\d{4}\.md$/)
  expect(String(calls.writes[0]?.path).endsWith(target)).toBe(true)
  await ui.unmount()
  // 终端的工具栏不加这个按钮 (终端复制得了)
  const term = await mountHint($, 'terminal', 140)
  expect(await btn(term, 'btn-handoff-open')).toBeUndefined()
  await term.unmount()
})

// ================= v1.1: the one-line (compact) panel can be switched back =================
test('compact panel: the one line starts with [settings]; it opens the options on the line below, and Panel full brings the full panel back', async ($, on) => {
  await start($, on, WIN, EN)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-settings' })
  await ui.press({ key: 'opt-panel-compact' })
  // 精简: 一行, 最前面是 [settings] [handoff]; 设置还开着, 选项排在下一行
  const grid = async () => (await ui.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))
  expect((await btn(ui, 'btn-settings'))?.props.label).toBe('settings')
  expect((await btn(ui, 'btn-handoff'))?.props.label).toBe('handoff')
  expect(await grid()).toBe(false)
  expect(await btn(ui, 'opt-panel-full')).toBeDefined()
  expect(await btn(ui, 'opt-lang-zh')).toBeDefined()
  await ui.press({ key: 'btn-settings' })
  expect(await btn(ui, 'opt-panel-full')).toBeUndefined()
  await ui.press({ key: 'btn-settings' })
  await ui.press({ key: 'opt-panel-full' })
  // 回到完整版: 三行网格回来了
  expect(await grid()).toBe(true)
  expect(await btn(ui, 'btn-handoff')).toBeDefined()
  await ui.unmount()
})

test('compact panel: [settings] fits even in a 45-column terminal, and its options wrap inside the panel width', async ($, on) => {
  await start($, on, WIN, EN)
  const ui = await mountHint($, 'terminal', 45)
  await ui.press({ key: 'btn-settings' })
  for (const key of ['opt-lang-en', 'opt-lang-zh', 'opt-crab-on', 'opt-crab-off', 'opt-panel-full', 'opt-panel-compact', 'opt-panel-off']) expect((await btn(ui, key)) ? 'ok' : 'missing ' + key).toBe('ok')
  // 一行版那一行 + 选项排出来的几行, 每行都不超过面板里面的宽度 (45 列终端: 面板 43 列, 左右各空 2 列)
  const hud: any = await ui.find({ type: 'Box', key: 'hud' })
  const flat = (n: any): string => (typeof n === 'string' ? n : n?.props?.label ?? (n?.children ?? []).map(flat).join(''))
  const rows = hud.children.filter((c: any) => /^(hud-line|cg\d)$/.test(c.props?.key ?? ''))
  expect(rows.length >= 2).toBe(true)
  for (const row of rows) expect(dwT(flat(row)) <= 39 ? 'ok' : 'too wide: ' + flat(row)).toBe('ok')
  await ui.unmount()
})

test('/hud full, /hud compact and /hud hide (also 完整 / 精简 / 隐藏) switch the panel directly; /hud alone still cycles', async ($, on) => {
  await start($, on, WIN, EN)
  const run = async (args: string) => String(((await $.command.run({ command: 'hud', args } as any)) as any)?.text ?? '')
  const shape = async () => {
    const ui = await mountHint($, 'terminal', 140)
    const grid = (await ui.findAll({ type: 'Box' })).some((b: any) => /^r\dc\d$/.test(b.key ?? ''))
    const r = grid ? 'full' : (await btn(ui, 'btn-settings')) ? 'compact' : 'off'
    await ui.unmount()
    return r
  }
  expect(await run('compact')).toMatch(/compact/)
  expect(await shape()).toBe('compact')
  expect(await run('full')).toMatch(/full/)
  expect(await shape()).toBe('full')
  await run('隐藏')
  expect(await shape()).toBe('off')
  await run('完整')
  expect(await shape()).toBe('full')
  await run('精简')
  expect(await shape()).toBe('compact')
  await run('hide')
  expect(await shape()).toBe('off')
  // 不带参数: 照旧按 完整 -> 精简 -> 隐藏 循环
  await run('')
  expect(await shape()).toBe('full')
  await run('')
  expect(await shape()).toBe('compact')
})

// ================= v1.2: the next session fills in the handoff by itself =================
// 写完交接后: 同一个项目里新开的会话 (或 /clear) 输入框自动填一行 "@<交接文件> 按这份交接继续"; 2 小时内、只填一次
const HANDOFF_LINE = /^@C:\\Users\\me\\\.claude\\handoffs\\my-app\\\d{4}-\d\d-\d\d-\d{4}\.md Continue from this handoff$/
const handoffNow = async ($: any, calls: Calls) => {
  await $.command.run({ command: 'hud', args: 'handoff' } as any)
  await calls.clock.settle()
}
const newSession = async ($: any, calls: Calls, source: string) => {
  await $.classic.SessionStart({ source, transcript_path: '' } as any)
  await calls.clock.settle()
}

test('handoff auto-fill: the next new session in the same project gets "@<file> Continue from this handoff" in the prompt, once', async ($, on) => {
  const calls = await start($, on, WIN, { ...EN, mockClock: T0 })
  await handoffNow($, calls)
  expect(calls.writes.length).toBe(1)
  // 写交接的那个会话自己不填
  expect(calls.fills.length).toBe(0)
  // 提示条告诉你可以这样接着干
  expect(calls.toasts.find(t => t.startsWith('Handoff copied'))).toMatch(/new session or \/clear/)
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(1)
  expect(calls.fills[0]?.text).toMatch(HANDOFF_LINE)
  expect(calls.fills[0]?.mode).toBe('replace')
  expect(calls.toasts.some(t => /^Filled in the handoff from \d\d:\d\d/.test(t))).toBe(true)
  // 只填一次
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(1)
})

test('handoff auto-fill: /clear fills it too; resume, fork and compact do not; another project does not', async ($, on) => {
  const sys: Sys = { ...WIN }
  const calls = await start($, on, sys, { ...EN, mockClock: T0 })
  await handoffNow($, calls)
  for (const src of ['resume', 'fork', 'compact']) await newSession($, calls, src)
  expect(calls.fills.length).toBe(0)
  // 别的项目: 不填, 也不动这一份
  sys.cwd = 'D:\\work\\other-app'
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(0)
  sys.cwd = WIN.cwd
  await newSession($, calls, 'clear')
  expect(calls.fills.length).toBe(1)
  expect(calls.fills[0]?.text).toMatch(HANDOFF_LINE)
})

// (不拨 2 小时的时钟: 面板的帧钟会跑几万次; 直接在存储里放一份写好多久的交接)
test('handoff auto-fill: a handoff written more than 2 hours ago is not filled in, not even after /clear', async ($, on) => {
  const root = 'D:\\work\\my-app'
  const old = (ms: number) => ({ handoffNext: { [root]: { path: 'C:\\Users\\me\\.claude\\handoffs\\my-app\\old.md', at: T0 - ms } } })
  const calls = await start($, on, WIN, { ...EN, mockClock: T0, store: old(2 * 3600_000 + 1000) })
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(0)
  await newSession($, calls, 'clear')
  expect(calls.fills.length).toBe(0)
})

test('handoff auto-fill: one written just under 2 hours ago is still filled in', async ($, on) => {
  const root = 'D:\\work\\my-app'
  const calls = await start($, on, WIN, {
    ...EN,
    mockClock: T0,
    store: { handoffNext: { [root]: { path: 'C:\\Users\\me\\.claude\\handoffs\\my-app\\old.md', at: T0 - 2 * 3600_000 + 60_000 } } },
  })
  await newSession($, calls, 'startup')
  expect(calls.fills.map(f => f.text)).toEqual(['@C:\\Users\\me\\.claude\\handoffs\\my-app\\old.md Continue from this handoff'])
})

test('handoff auto-fill: a dialog in the way is retried shortly; a surface with no prompt box keeps the handoff for the next session', async ($, on) => {
  let answer: any = { isFilled: false, refusal: 'dialog' }
  const calls = await start($, on, WIN, { ...EN, mockClock: T0, fillResult: () => answer })
  await handoffNow($, calls)
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(0)
  answer = { isFilled: true }
  await calls.clock.advance(2000)
  await calls.clock.settle()
  expect(calls.fills.length).toBe(1)
  // 没有输入框 (比如桌面客户端自己画输入框): 不重试, 这一份留给下一个会话
  await handoffNow($, calls)
  answer = { isFilled: false, refusal: 'no_composer' }
  await newSession($, calls, 'startup')
  await calls.clock.advance(20_000)
  await calls.clock.settle()
  expect(calls.fills.length).toBe(1)
  answer = { isFilled: true }
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(2)
})

test('handoff auto-fill: when the file path has a space (an @ mention would break there), the handoff text itself is filled in', async ($, on) => {
  const sys: Sys = { cwd: CWD, env: { USERPROFILE: 'C:\\Users\\Jo Smith' } }
  const calls = await start($, on, sys, { ...EN, mockClock: T0 })
  await handoffNow($, calls)
  await newSession($, calls, 'startup')
  expect(calls.fills.length).toBe(1)
  expect(calls.fills[0]?.text.startsWith('# Handoff: my-app')).toBe(true)
  expect(calls.fills[0]?.text).toContain('HANDOFF BODY')
})

// ================= v1.3: handoff history (/hud history, [history], desktop "Handoff history") =================
// 这个项目存过的交接 (<配置目录>/handoffs/<项目>/) 列在一个面板里: 最新的在上面, 最多 9 份 (数字键 1-9 填入)
const p2 = (n: number) => String(n).padStart(2, '0')
const hname = (ms: number) => {
  const d = new Date(ms)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.md'
}
const hm = (ms: number) => p2(new Date(ms).getHours()) + ':' + p2(new Date(ms).getMinutes())
const DAY0 = (() => {
  const d = new Date(T0)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()
const H_TODAY = DAY0 + 60_000 // 今天 00:01
const H_YDAY = DAY0 - 5.5 * 3600_000 // 昨天 18:30
const H_OLD = DAY0 - 10 * 86400_000 + 9 * 3600_000 + 12 * 60_000 // 10 天前 09:12
const HDIR = 'C:\\Users\\me\\.claude\\handoffs\\my-app\\'
const HFILES: HandoffFile[] = [
  { name: hname(H_YDAY), text: '# 交接：my-app（feature/pay）· x\n\n## Goal\n做支付\n\n## Next steps\n1. Start by 修好退款按钮\n2. 再说\n' },
  { name: 'notes.txt', text: 'not a handoff' },
  { name: 'old', kind: 'dir' },
  {
    name: hname(H_TODAY),
    text: '# Handoff: my-app (main) · x\n(To reopen the original session instead: claude --resume abc)\n\n## Goal (what the user wants)\nShip the coupon field\n\n## Next steps (concrete and in order)\n1. Start by adding the coupon input to checkout\n2. Then run the tests\n',
  },
  { name: hname(H_OLD), text: '# Handoff: my-app · x\n\n## Goal\n- Clean up the logs\n' },
]
const HIST = { ...EN, mockClock: T0, handoffs: () => HFILES }
async function mountHist($: any, surface: 'terminal' | 'desktop', cols: number) {
  return $.ui.mount({
    plugin: 'cc-hud',
    surface,
    component: 'Pane',
    requestId: 'hud-handoffs',
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: 'Handoffs', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { top: 0, bodyRows: 30, totalRows: 10 }, view: {} },
  } as any)
}
const texts = async (ui: any) => ((await ui.findAll({ type: 'Text' })) as any[]).map(t => String(t.text))
// 一行画出来有多宽: 里面的字 + 终端按钮 (画成 "[ label ]", 比文字多 4 格)
const histW = (n: any): number =>
  typeof n === 'string' ? dwT(n) : !n ? 0 : n.type === 'Button' ? dwT(String(n.props?.label ?? '')) + 4 : ((n.children ?? []) as any[]).reduce((w: number, c: any) => w + histW(c), 0)
const lineW = async (ui: any, key: string) => histW(await ui.find({ key }))

test('handoffBrief: the branch from the title line and the first next step without "Start by"; falls back to the goal', () => {
  expect(handoffBrief(HFILES[3]!.text!)).toEqual({ branch: 'main', next: 'adding the coupon input to checkout' })
  expect(handoffBrief(HFILES[0]!.text!)).toEqual({ branch: 'feature/pay', next: '修好退款按钮' })
  expect(handoffBrief(HFILES[4]!.text!)).toEqual({ branch: '', next: 'Clean up the logs' })
  expect(handoffBrief('## 下一步\n- **先** 跑测试')).toEqual({ branch: '', next: '先 跑测试' })
  expect(handoffBrief('')).toEqual({ branch: '', next: '' })
})

test('/hud history opens the handoff history pane (also 历史 / 交接历史); it never starts writing a new handoff', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  for (const args of ['history', '历史', '交接历史']) {
    const r: any = await $.command.run({ command: 'hud', args } as any)
    expect(String(r?.text ?? '')).toMatch(/handoff history/i)
  }
  await calls.clock.settle()
  expect(calls.forks.length).toBe(0)
  const opened = calls.opens.filter((o: any) => o.id === 'hud-handoffs')
  expect(opened.length).toBe(3)
  expect(opened[0]).toMatchObject({ id: 'hud-handoffs', focus: true, closeOnEscape: true })
  // /hud handoff 还是写交接
  await $.command.run({ command: 'hud', args: 'handoff' } as any)
  await calls.clock.settle()
  expect(calls.forks.length).toBe(1)
})

test('handoff history: newest first, only .md files; each row has its time, branch and first next step, a numbered fill button and an open button', async ($, on) => {
  await start($, on, WIN, HIST)
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('3 saved, newest first')
  const fills = ((await ui.findAll({ type: 'Button' })) as any[]).filter(b => /^hist-fill-/.test(b.key ?? ''))
  expect(fills.map(b => b.key)).toEqual(['hist-fill-0', 'hist-fill-1', 'hist-fill-2'])
  expect(fills.map(b => b.props.hotkey)).toEqual(['1', '2', '3'])
  expect(fills.map(b => b.props.label)).toEqual(['1 fill in', '2 fill in', '3 fill in'])
  expect(await btn(ui, 'hist-open-0')).toBeDefined()
  const rows = ((await ui.findAll({ type: 'Box' })) as any[]).filter(b => /^hist-row-\d$/.test(b.key ?? ''))
  expect(rows.length).toBe(3)
  for (const b of rows) expect(await lineW(ui, b.key)).toBeLessThanOrEqual(120)
  // 每行: 时间、分支、下一步 (宽面板一行放下)
  expect(all).toContain('today ' + hm(H_TODAY))
  expect(all).toContain('yesterday ' + hm(H_YDAY))
  expect(all).toContain(hname(H_OLD).slice(5, 10) + ' ' + hm(H_OLD))
  expect(all).toContain('adding the coupon input to checkout')
  expect(all).toContain('修好退款按钮')
  expect(all).toContain('feature/pay')
  expect(all.indexOf('today ' + hm(H_TODAY)) < all.indexOf('yesterday ' + hm(H_YDAY))).toBe(true)
  expect(all).not.toContain('not a handoff')
  expect(await btn(ui, 'hist-folder')).toBeDefined()
  await ui.unmount()
})

test('handoff history: pressing fill puts "@<file> Continue from this handoff" in the prompt, closes the pane and says which one', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  await ui.press({ key: 'hist-fill-1' })
  expect(calls.fills).toEqual([{ text: '@' + HDIR + hname(H_YDAY) + ' Continue from this handoff', mode: 'replace' }])
  expect(calls.closes).toContain('hud-handoffs')
  expect(calls.toasts.some(t => t.startsWith('Filled in the handoff from yesterday ' + hm(H_YDAY)))).toBe(true)
  await ui.unmount()
})

test('handoff history: text already in the prompt is kept (the handoff line goes first)', async ($, on) => {
  const calls = await start($, on, WIN, { ...HIST, draft: 'also check the refunds' })
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  await ui.press({ key: 'hist-fill-0' })
  expect(calls.fills[0]?.text).toBe('@' + HDIR + hname(H_TODAY) + ' Continue from this handoff\nalso check the refunds')
  await ui.unmount()
})

test('handoff history: picking the handoff that was waiting for the next session uses it up, so /clear does not fill it again', async ($, on) => {
  const root = 'D:\\work\\my-app'
  const calls = await start($, on, WIN, { ...HIST, store: { handoffNext: { [root]: { path: HDIR + hname(H_TODAY), at: T0 - 60_000 } } } })
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  await ui.press({ key: 'hist-fill-0' })
  await ui.unmount()
  expect(calls.fills.length).toBe(1)
  await newSession($, calls, 'clear')
  expect(calls.fills.length).toBe(1)
})

test('handoff history: when the prompt box refuses (a dialog, or the desktop app), the pane stays open and says to press open', async ($, on) => {
  const calls = await start($, on, WIN, { ...HIST, fillResult: () => ({ isFilled: false, refusal: 'no_composer' }) })
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'desktop', 120)
  await ui.press({ key: 'hist-fill-0' })
  expect(calls.fills.length).toBe(0)
  expect(calls.closes).not.toContain('hud-handoffs')
  expect(calls.toasts.some(t => /Couldn't fill in the prompt/.test(t))).toBe(true)
  await ui.unmount()
})

test('handoff history: open opens the file, open folder opens the folder (cmd start on Windows)', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  await ui.press({ key: 'hist-open-2' })
  await ui.press({ key: 'hist-folder' })
  const starts = calls.run.filter(a => a[0] === 'cmd.exe')
  expect(starts).toEqual([
    ['cmd.exe', '/d', '/c', 'start', 'cc-hud', HDIR + hname(H_OLD)],
    ['cmd.exe', '/d', '/c', 'start', 'cc-hud', HDIR.slice(0, -1)],
  ])
  await ui.unmount()
})

test('handoff history: at most the 9 newest (digits 1-9); the header says how many there are', async ($, on) => {
  const many: HandoffFile[] = Array.from({ length: 12 }, (_, i) => ({ name: hname(DAY0 - i * 3600_000 - 60_000), text: '## Next steps\n1. Start by step ' + i + '\n' }))
  await start($, on, WIN, { ...HIST, handoffs: () => many })
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  const fills = ((await ui.findAll({ type: 'Button' })) as any[]).filter(b => /^hist-fill-/.test(b.key ?? ''))
  expect(fills.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('12 saved, newest 9 shown')
  expect(all).toContain('step 0')
  expect(all).toContain('step 8')
  expect(all).not.toContain('step 9')
  await ui.unmount()
})

test('handoff history: no folder yet / an empty folder says how to write one', async ($, on) => {
  let folder: HandoffFile[] | undefined
  await start($, on, WIN, { ...EN, mockClock: T0, handoffs: () => folder })
  for (const now of [undefined, [] as HandoffFile[]]) {
    folder = now
    await $.command.run({ command: 'hud', args: 'history' } as any)
    const ui = await mountHist($, 'terminal', 120)
    expect((await texts(ui)).join('\n')).toContain('No handoffs for this project yet')
    expect(((await ui.findAll({ type: 'Button' })) as any[]).filter(b => /^hist-fill-/.test(b.key ?? '')).length).toBe(0)
    await ui.unmount()
  }
})

test('handoff history: a path with a space fills in the handoff text itself', async ($, on) => {
  const sys: Sys = { cwd: CWD, env: { USERPROFILE: 'C:\\Users\\Jo Smith' } }
  const calls = await start($, on, sys, HIST)
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const ui = await mountHist($, 'terminal', 120)
  await ui.press({ key: 'hist-fill-0' })
  expect(calls.fills[0]?.text).toBe(HFILES[3]!.text!)
  await ui.unmount()
})

test('handoff history: a narrow pane puts the next step on a second line; no line is wider than the pane; Chinese labels', async ($, on) => {
  await start($, on, WIN, { ...HIST, lang: 'zh' })
  await $.command.run({ command: 'hud', args: '历史' } as any)
  for (const cols of [40, 56, 71]) {
    const ui = await mountHist($, 'terminal', cols)
    const rows = ((await ui.findAll({ type: 'Box' })) as any[]).filter(b => /^hist-(row-\d+(-2)?|head|foot)$/.test(b.key ?? ''))
    expect(rows.filter(b => /^hist-row-\d+-2$/.test(b.key)).length).toBe(3)
    for (const b of rows) expect([b.key, await lineW(ui, b.key)]).toEqual([b.key, Math.min(cols, await lineW(ui, b.key))])
    const all = (await texts(ui)).join('\n')
    expect(all).toContain('今天 ' + hm(H_TODAY))
    expect(all).toContain('昨天 ' + hm(H_YDAY))
    expect(all).toContain('共 3 份')
    expect((await btn(ui, 'hist-fill-0'))?.props.label).toBe('1 填入')
    expect((await btn(ui, 'hist-open-0'))?.props.label).toBe('打开')
    await ui.unmount()
  }
})

test('toolbar: [history] sits after [handoff] in the full panel (not in the one-line panel); pressing it opens the handoff history', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  const ui = await mountHint($, 'terminal', 140)
  expect((await btn(ui, 'btn-history'))?.props.label).toBe('history')
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('btn-handoff') < tree.indexOf('btn-history')).toBe(true)
  await ui.press({ key: 'btn-history' })
  expect(calls.opens.filter((o: any) => o.id === 'hud-handoffs').length).toBe(1)
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'compact' } as any)
  const one = await mountHint($, 'terminal', 140)
  expect(await btn(one, 'btn-settings')).toBeDefined()
  expect(await btn(one, 'btn-history')).toBeUndefined()
  await one.unmount()
})

test('desktop toolbar: a native "Handoff history" button right after Handoff opens the same pane', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  const ui = await mountDesktop($, 120)
  const b = await btn(ui, 'btn-history')
  expect(b?.props.label).toBe('Handoff history')
  expect(b?.props.plain).toBeUndefined()
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('btn-handoff') < tree.indexOf('btn-history')).toBe(true)
  await ui.press({ key: 'btn-history' })
  expect(calls.opens.filter((o: any) => o.id === 'hud-handoffs').length).toBe(1)
  await ui.unmount()
  const pane = await mountHist($, 'desktop', 100)
  expect((await btn(pane, 'hist-fill-0'))?.props.label).toBe('Fill in')
  expect((await btn(pane, 'hist-open-0'))?.props.label).toBe('Open')
  await pane.unmount()
})

// ================= v1.3: [clear & continue] after a handoff =================
// 这个会话写过交接之后, [交接] 后面多一个 [清空并继续]: 点了就跑 /clear, 清空后的会话照常自动填好交接 (只在终端)
test('clear & continue: shows up after a handoff is written (toolbar and one-line panel); pressing it runs /clear and the cleared session gets the handoff line', async ($, on) => {
  const calls = await start($, on, WIN, { ...EN, mockClock: T0 })
  let ui = await mountHint($, 'terminal', 140)
  expect(await btn(ui, 'btn-clear-go')).toBeUndefined()
  await ui.unmount()
  await handoffNow($, calls)
  expect(calls.toasts.find(t => t.startsWith('Handoff copied'))).toMatch(/\[clear & continue\]/)
  ui = await mountHint($, 'terminal', 140)
  expect((await btn(ui, 'btn-clear-go'))?.props.label).toBe('clear & continue')
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('btn-handoff') < tree.indexOf('btn-clear-go') && tree.indexOf('btn-clear-go') < tree.indexOf('btn-history')).toBe(true)
  await ui.unmount()
  await $.command.run({ command: 'hud', args: 'compact' } as any)
  ui = await mountHint($, 'terminal', 140)
  expect(await btn(ui, 'btn-clear-go')).toBeDefined()
  await ui.press({ key: 'btn-clear-go' })
  await ui.unmount()
  expect(calls.cmd).toContain('clear')
  // 引擎跑 /clear 时会发 SessionStart (source: clear): 输入框填好交接那一行; 按钮不再出现
  await newSession($, calls, 'clear')
  expect(calls.fills.map(f => f.text)).toEqual([expect.stringMatching(HANDOFF_LINE)])
  ui = await mountHint($, 'terminal', 140)
  expect(await btn(ui, 'btn-clear-go')).toBeUndefined()
  await ui.unmount()
})

test('clear & continue: even when that handoff was already filled in once (from the history), the cleared session still gets it', async ($, on) => {
  let calls: Calls | undefined
  const written = () => (calls?.writes ?? []).map(w => ({ name: String(w.path).split(/[\\/]/).pop() ?? '', text: w.text }))
  calls = await start($, on, WIN, { ...EN, mockClock: T0, handoffs: written })
  await handoffNow($, calls)
  await $.command.run({ command: 'hud', args: 'history' } as any)
  const pane = await mountHist($, 'terminal', 120)
  await pane.press({ key: 'hist-fill-0' })
  await pane.unmount()
  expect(calls.fills.length).toBe(1)
  const ui = await mountHint($, 'terminal', 140)
  await ui.press({ key: 'btn-clear-go' })
  await ui.unmount()
  await newSession($, calls, 'clear')
  expect(calls.fills.length).toBe(2)
  expect(calls.fills[1]?.text).toMatch(HANDOFF_LINE)
})

test('clear & continue: not on the desktop (the app cannot fill the prompt); gone in a new or resumed session', async ($, on) => {
  const calls = await start($, on, WIN, { ...EN, mockClock: T0 })
  await handoffNow($, calls)
  const d = await mountDesktop($, 120)
  expect(await btn(d, 'btn-clear-go')).toBeUndefined()
  await d.unmount()
  for (const src of ['startup', 'resume']) {
    await handoffNow($, calls)
    await newSession($, calls, src)
    const ui = await mountHint($, 'terminal', 140)
    expect([src, await btn(ui, 'btn-clear-go')]).toEqual([src, undefined])
    await ui.unmount()
  }
})

// ================= v1.3: panic while working = sweat flung into the sky row too (option A); no red bar beside the head =================
test('panic while working, in the crab strip: no red bar and no sweat beside the head; sweat is flung up into the sky row, outside the head', () => {
  for (const tool of ['bash', 'read', 'think'] as const) {
    const r = previewLane({ w: 80, sky: true, frames: 60, working: true, tool, fine: true, mood: 'panic' })
    for (const fr of r.frames) expect(fr.px.flat().includes(ALARM) ? `${tool}: red in the strip` : 'ok').toBe('ok')
    // 螃蟹那几行里、螃蟹自己的 12 列 (右边的道具不算: 读文件那张纸的扫描线也是这个蓝色)
    for (const fr of r.frames) expect(fr.px.slice(2).some(row => row.slice(fr.bx, fr.bx + 12).includes(SWEAT)) ? `${tool}: sweat beside the head` : 'ok').toBe('ok')
    const flung = r.frames.flatMap(fr => fr.px.slice(0, 2).flatMap(row => row.map((c, x) => (c === SWEAT ? x - fr.bx : -99)).filter(x => x > -99)))
    expect([tool, flung.length > 0]).toEqual([tool, true])
    expect([tool, flung.every(x => x <= 2 || x >= 9)]).toEqual([tool, true])
  }
})

test('panic while working: no sweat is flung while the crab is up in the sky row (the send-a-message jump)', () => {
  const r = previewLane({ w: 80, sky: true, frames: 40, working: true, tool: 'bash', fine: true, mood: 'panic', jumpAt: 8 })
  const lifted = r.frames.filter(fr => fr.px.slice(0, 2).flat().includes(BODY))
  expect(lifted.length > 0).toBe(true)
  for (const fr of lifted) expect(fr.px.slice(0, 2).flat().includes(SWEAT) ? 'sweat on the jumping crab' : 'ok').toBe('ok')
})

test('panic while working, on the desktop: no red dot; the sweat is flung into the headroom instead of sliding down beside the head', () => {
  for (const kind of ['bash', 'think']) {
    const svg = deskCrab({ mood: 'panic', mode: 'work', kind })
    expect(svg).not.toContain('#ef4444')
    expect(svg).not.toMatch(/attributeName="y" values="0;2"/)
    expect(svg).toMatch(/fill="#60a5fa"[^>]*>(<animate[^>]*>)*<animate attributeName="y" values="-1;-2;-2/)
  }
  // 负路径: 只是冒汗 (不慌张) 时, 头边那颗汗滴还在
  expect(deskCrab({ mood: 'sweat', mode: 'work', kind: 'bash' })).toMatch(/attributeName="y" values="0;2"/)
})

// ================= v1.3.1: a pane opened by a button must open while the press is still being handled =================
// 引擎只在按钮的处理函数还没结束时, 才把打开面板算作「用户点的」(任何宽度都放). 1.3.0 的 [历史] 写成 () => void openHistory(...):
//   处理函数马上返回, 等完时钟 (防连点) 才打开 -> 算没人要, 102 列的终端里弹「unasked below 144 columns」
test('buttons that open a pane keep the press going until the pane is open (else the engine treats it as unasked below 144 columns)', async ($, on) => {
  const calls = await start($, on, WIN, HIST)
  const term = await mountHint($, 'terminal', 140)
  await term.press({ key: 'btn-history' })
  await term.unmount()
  await calls.clock.advance(2000) // 防连点: 两次按之间隔开
  const desk = await mountDesktop($, 120)
  await desk.press({ key: 'btn-history' })
  await desk.unmount()
  const opens = calls.opens.filter((o: any) => o.id === 'hud-handoffs')
  expect(opens.map((o: any) => o.duringPress)).toEqual([true, true])
})

// ================= v1.4: the crab-moves spec (2026-10-09) — start, loop and ending of each tool =================
const walkProps = async (ui: any) => ((await ui.find({ type: 'Client' })) as any)?.props?.props ?? {}

test('WebSearch and WebFetch reach the crab strip as two kinds, search and fetch; each main-thread tool call gets its own number and its result (ok or not)', async ($, on) => {
  let open: () => void = () => {}
  const calls = await start($, on, WIN, { mockClock: T0, toolError: e => e.tool === 'Bash', toolGate: () => new Promise<void>(r => (open = r)) })
  const band = await mountBand($, 140)
  const seen: any[] = []
  for (const [tool, kind] of [
    ['WebSearch', 'search'],
    ['WebFetch', 'fetch'],
    ['Bash', 'bash'],
  ]) {
    const call = $.tool.call({ tool, query: 'x', url: 'https://a.b', command: 'ls' } as any)
    await calls.clock.settle()
    const during = await walkProps(band)
    expect([tool, during.tool]).toEqual([tool, kind])
    open()
    await call
    await calls.clock.settle()
    const after = await walkProps(band)
    seen.push([during.toolSeq, after.tool, after.toolEnd])
  }
  expect(seen).toEqual([
    [1, '', { seq: 1, ok: true, hits: 0 }], // 搜索的收尾还带搜到几条 (这里没有结果)
    [2, '', { seq: 2, ok: true }],
    [3, '', { seq: 3, ok: false }],
  ])
  // 子代理的工具不算主会话的调用
  const sub = $.tool.call({ tool: 'Read', file_path: 'a', agentId: 'k1' } as any)
  await calls.clock.settle()
  open()
  await sub
  await calls.clock.settle()
  expect((await walkProps(band)).toolSeq).toBe(3)
  await band.unmount()
})

// 终端屏幕在螃蟹右边 (12-14 列, 第 1-4 行); 散步道的像素行 = 螃蟹的行 + 2 (天空行)
const CURSOR = 0x4ade80
const PAPER = 0xd4d4d8
const GREY = 0xa1a1aa
const scr = (fr: any, y: number): number[] => fr.px[2 + y].slice(fr.bx + 12, fr.bx + 15)
test('running a command (B): types the command with both claws, then watches the output scroll; when it finishes OK the last line turns green until the crab walks on', () => {
  const S0 = 10
  const END = 70
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 92, working: true, tool: f => (f >= S0 && f < END ? 'bash' : '') })
  const at = (age: number) => r.frames[S0 + age]!
  expect(scr(at(1), 4)[0]).toBe(CURSOR) // 提示符
  expect(scr(at(7), 4)[1]).toBe(PAPER) // 打出第一个字
  expect(scr(at(13), 4).slice(1)).toEqual([PAPER, PAPER])
  const typing = r.frames.slice(S0 + 1, S0 + 17)
  expect(typing.some(fr => armOf(fr, 'L') === 'up') && typing.some(fr => armOf(fr, 'R') === 'up')).toBe(true)
  // 盯着输出: 钳子放下, 灰色的输出一行行往上滚, 身体不晃
  const watch = r.frames.slice(S0 + 20, END)
  expect(watch.every(fr => armOf(fr, 'L') === 'out' && armOf(fr, 'R') === 'out')).toBe(true)
  expect(watch.every(fr => [1, 2, 3, 4].some(y => scr(fr, y).includes(GREY)))).toBe(true)
  expect(new Set(watch.map(fr => JSON.stringify([1, 2, 3, 4].map(y => scr(fr, y))))).size > 5).toBe(true)
  expect(new Set(watch.map(fr => bodySpan(fr).join())).size).toBe(1)
  // 跑完 (成功): 停在原地, 最后一行整行变绿, 撑到收尾结束
  const after = r.frames.slice(END, END + 6)
  expect(after.every(fr => fr.pose === 'tool' && scr(fr, 4).every(c => c === CURSOR))).toBe(true)
  expect(r.frames.slice(END + 12).some(fr => fr.pose === 'walk')).toBe(true)
})

test('running a command (B): a command that fails turns the last line red (the user chose red); a short one that ends while being typed still gets its ending', () => {
  const failed = previewLane({ w: 80, sky: true, fine: true, frames: 60, working: true, ok: false, tool: f => (f >= 10 && f < 40 ? 'bash' : '') })
  expect(failed.frames.slice(40, 46).every(fr => fr.pose === 'tool' && scr(fr, 4).every(c => c === ALARM))).toBe(true)
  const quick = previewLane({ w: 80, sky: true, fine: true, frames: 30, working: true, tool: f => (f >= 10 && f < 14 ? 'bash' : '') })
  expect(quick.frames.slice(14, 19).every(fr => fr.pose === 'tool' && scr(fr, 4).every(c => c === CURSOR))).toBe(true)
})

test('two commands back to back are two calls: the second one starts typing again', () => {
  // 中间没有空档 (call 号变了), 第二条从敲命令开始: 又打出提示符, 钳子又在敲
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 80, working: true, tool: f => (f >= 10 && f < 70 ? 'bash' : ''), call: f => (f < 40 ? 1 : 2) })
  expect(r.frames.slice(32, 40).every(fr => armOf(fr, 'L') === 'out')).toBe(true)
  expect(r.frames.slice(41, 56).some(fr => armOf(fr, 'L') === 'up')).toBe(true)
})

// 改文件 B: 纸在螃蟹右边 (12-14 列, 第 1-4 行); 墨点按 [3, 2, 3, 2] 一行行写, 新点先蓝 2 帧
const INK = 0x52525b
const PAGE_ROWS = [1, 2, 3, 4]
const page = (fr: any, sky = 2) => PAGE_ROWS.flatMap(y => fr.px[sky + y].slice(fr.bx + 12, fr.bx + 15))
const inked = (fr: any, sky = 2) => page(fr, sky).filter((c: number) => c === INK || c === SWEAT).length
test('editing a file (B): the right claw taps and each tap leaves one ink dot (blue first, then ink), body still', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 60, working: true, tool: f => (f >= 10 && f < 40 ? 'edit' : '') })
  const at = (age: number) => r.frames[10 + age]!
  expect([1, 5, 9, 29].map(a => inked(at(a)))).toEqual([1, 2, 3, 8])
  expect(page(at(4)).includes(SWEAT)).toBe(true) // 刚写的那一点是蓝的
  expect(page(at(6)).includes(SWEAT)).toBe(false)
  const run = r.frames.slice(10, 40)
  expect(new Set(run.map(fr => armOf(fr, 'R')))).toEqual(new Set(['out', 'mid', 'up']))
  expect(run.every(fr => armOf(fr, 'L') === 'out')).toBe(true)
  expect(new Set(run.map(fr => bodySpan(fr).join())).size).toBe(1)
})

test('editing a file (B): when the edit finishes, the written page flies up into the sky row, a blank page takes its place, two specks of dust rise, then the crab walks on', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 70, working: true, tool: f => (f >= 10 && f < 40 ? 'edit' : '') })
  const sky = (fr: any) => [0, 1].flatMap(y => fr.px[y].slice(fr.bx + 12, fr.bx + 15))
  const inSky = (fr: any) => sky(fr).some((c: number) => c === PAPER || c === INK)
  expect(inSky(r.frames[39]!)).toBe(false)
  expect(inSky(r.frames[41]!)).toBe(true) // 写过的那页飞进天空行
  expect(inSky(r.frames[47]!)).toBe(false) // 飞出去了, 不停在天空行里
  expect(page(r.frames[45]!).every((c: number) => c === PAPER)).toBe(true) // 下面换上一张白纸
  expect(r.frames.slice(43, 47).some(fr => fr.pt.some((p: any) => p.y < 0 && p.x >= fr.hx + 20))).toBe(true) // 扬起两点灰
  expect(r.frames.slice(40, 46).every(fr => fr.pose === 'tool')).toBe(true)
  expect(r.frames.slice(52).some(fr => fr.pose === 'walk')).toBe(true)
  // 一次很快的修改: 写了一点就翻页
  const quick = previewLane({ w: 80, sky: true, fine: true, frames: 30, working: true, tool: f => (f >= 10 && f < 12 ? 'edit' : '') })
  expect(inSky(quick.frames[13]!)).toBe(true)
})

test('editing a file (B): a long write fills the page, pauses, flips and starts a new one by itself; without a sky row the old page just disappears', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 80, working: true, tool: f => (f >= 10 ? 'edit' : '') })
  const at = (age: number) => r.frames[10 + age]!
  expect(inked(at(44))).toBe(10) // 写满, 停一拍
  expect([0, 1].some(y => at(50).px[y]!.slice(at(50).bx + 12, at(50).bx + 15).includes(PAPER))).toBe(true) // 自己翻页
  expect(inked(at(55))).toBe(1) // 新的一页
  const flat = previewLane({ w: 80, sky: false, fine: true, frames: 30, working: true, tool: f => (f >= 10 && f < 20 ? 'edit' : '') })
  expect(page(flat.frames[23]!, 0).every((c: number) => c === PAPER)).toBe(true)
  expect(page(flat.frames[20]!, 0).some((c: number) => c === INK || c === SWEAT)).toBe(false)
})

// 跑命令 C: 同一条命令跑了约 15 秒 (200 帧) 以后等得不耐烦: 敲桌面、跺脚, 机器冒热气; 眼睛一直盯着屏幕 (用户 2026-10-10: 不回头看你)
test('running a command (C): after about 15 s on the same command the crab taps the desk and stamps, steam rises from the screen, and it never looks away from the screen', () => {
  const S0 = 10
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 300, working: true, tool: f => (f >= S0 ? 'bash' : '') })
  const at = (age: number) => r.frames[S0 + age]!
  // 15 秒以前还是 B: 钳子放下盯着输出
  expect(r.frames.slice(S0 + 30, S0 + 195).every(fr => armOf(fr, 'R') === 'out')).toBe(true)
  const tap = r.frames.slice(S0 + 205, S0 + 230) // C 的前半段: 右钳每 2 帧在 半举 / 平伸 之间敲桌面
  expect(new Set(tap.map(fr => armOf(fr, 'R')))).toEqual(new Set(['mid', 'out']))
  // 后半段跺脚: 腿的样子会变
  const stomp = r.frames.slice(S0 + 233, S0 + 262)
  const legs = (fr: any) => JSON.stringify(fr.px[2 + 4].slice(fr.bx, fr.bx + 12).map((c: number) => (c === BODY ? 1 : 0)))
  expect(new Set(stomp.map(legs)).size > 1).toBe(true)
  // 眼睛一直往屏幕那边看 (look = 1: 眼睛在第 5、8 列), 不回头
  const C = r.frames.slice(S0 + 200, S0 + 290)
  expect(C.every(fr => fr.px[3]![fr.bx + 4] !== EYE)).toBe(true)
  // 屏幕: 最下面一行一个绿色的进度点来回跳
  expect(new Set(C.map(fr => scr(fr, 4).indexOf(CURSOR))).size).toBe(3)
  // 热气: 屏幕上方的天空行里冒灰点
  expect(C.some(fr => fr.pt.some((p: any) => p.y < 0 && p.x - fr.hx >= 24 && p.x - fr.hx <= 30))).toBe(true)
  // 15 秒以前没有热气
  expect(r.frames.slice(S0, S0 + 195).some(fr => fr.pt.some((p: any) => p.y < 0 && p.x - fr.hx >= 24 && p.x - fr.hx <= 30))).toBe(false)
  expect(at(0).pose).toBe('tool')
})

// 抓网页 D+: 带蓝条的网页从右边飞进来, 一行行加载; 抓完 (工具结束) 收进去、冒两点亮光; 天空行写真网址, 抓完变紫
const SEA = 0x3b82f6
const SEA_HI = 0x93c5fd
const VISITED = 0xa78bfa
const SPARK = 0xfacc15
// 某一帧螃蟹右边 (相对 bx 的第 x0..x1 列, 第 1-4 行) 里纸和蓝条的列
const pageCols = (fr: any, x0 = 12, x1 = 30) => {
  const cols = new Set<number>()
  for (const y of [1, 2, 3, 4]) fr.px[2 + y].forEach((c: number, x: number) => {
    const dx = x - fr.bx
    if (dx >= x0 && dx <= x1 && (c === PAPER || c === SEA)) cols.add(dx)
  })
  return [...cols].sort((a, b) => a - b)
}
test('fetching a page (D+): the page flies in from the right, the crab catches it, the content loads line by line', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 60, working: true, arg: 'code.claude.com/docs', tool: f => (f < 40 ? 'fetch' : '') })
  expect(Math.min(...pageCols(r.frames[0]!))).toBeGreaterThan(18) // 从右边飞进来
  expect(pageCols(r.frames[6]!)).toEqual([12, 13, 14]) // 停在道具区
  expect([5, 6, 7].every(a => armOf(r.frames[a]!, 'R') === 'up')).toBe(true) // 接住
  const ink = (fr: any) => [2, 3, 4].flatMap(y => fr.px[2 + y].slice(fr.bx + 12, fr.bx + 15)).filter((c: number) => c === INK).length
  expect([10, 14, 20, 30].map(a => ink(r.frames[a]!))).toEqual([0, 3, 5, 8])
  expect(page(r.frames[30]!).includes(SEA)).toBe(true) // 顶上一条蓝
})

test('fetching a page (D+): the real URL sits above the crab, underlined; when the fetch finishes the page folds away, two sparkles rise and the URL turns visited purple', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 60, working: true, arg: 'code.claude.com/docs', tool: f => (f < 40 ? 'fetch' : '') })
  const cap = r.frames[20]!.caption
  expect(cap.map((c: any) => [c.x - r.frames[20]!.bx, c.text, c.color])).toEqual([[16, 'code.claude.com/docs', SEA_HI]])
  const under = r.frames[20]!.px[2]!.slice(r.frames[20]!.bx + 16, r.frames[20]!.bx + 36)
  expect(under.every((c: number) => c >= 0 && c !== SEA_HI)).toBe(true) // 下划线: 暗一点的蓝, 和字一样长
  expect(r.frames[20]!.px[2]![r.frames[20]!.bx + 36]).toBe(-1)
  expect(pageCols(r.frames[44]!)).toEqual([]) // 收进去了
  expect(r.frames.slice(44, 48).some(fr => fr.pt.some((p: any) => p.y < 0 && p.color !== undefined))).toBe(true)
  expect(r.frames[42]!.caption[0]!.color).toBe(VISITED)
  // 抓失败: 网址不变紫
  const bad = previewLane({ w: 80, sky: true, fine: true, frames: 50, working: true, ok: false, arg: 'x.com', tool: f => (f < 40 ? 'fetch' : '') })
  expect(bad.frames[42]!.caption[0]!.color).toBe(SEA_HI)
})

test('fetching a page (D+): near the right end the page appears in place without flying, and the URL is cut to fit or left out; without a sky row there is no URL', () => {
  const tight = previewLane({ w: 34, sky: true, fine: true, frames: 10, working: true, arg: 'code.claude.com/docs/en/plugins', tool: 'fetch' })
  expect(pageCols(tight.frames[0]!)).toEqual([12, 13, 14])
  for (const fr of tight.frames) for (const c of fr.caption) expect(c.x + dwT(c.text) <= 34).toBe(true)
  const flat = previewLane({ w: 80, sky: false, fine: true, frames: 10, working: true, arg: 'code.claude.com', tool: 'fetch' })
  expect(flat.frames.every(fr => fr.caption.length === 0)).toBe(true)
})

test('while a wide prop is out on the right (fetch / search), a bubble goes to the left of the crab', () => {
  const L = newLane(80, 3, true)
  expect(bubbleSpot(L, 'Your call')!.x).toBeGreaterThan(L.bx)
  expect(bubbleSpot(L, 'Your call', true)!.x).toBeLessThan(L.bx)
})

test('WebFetch passes its URL (without the protocol) and WebSearch its query to the crab strip; a search passes back its first link and how many results it found', async ($, on) => {
  const calls = await start($, on, WIN, {
    mockClock: T0,
    toolResult: e => (e.tool === 'WebSearch' ? { query: 'claude mods', results: [{ tool_use_id: 'x', content: [{ title: 'A', url: 'https://claude.com/mods' }, { title: 'B', url: 'https://b.dev' }] }, 'some text', { tool_use_id: 'y', content: [{ title: 'C', url: 'https://c.io' }] }], durationSeconds: 1 } : {}),
  })
  const band = await mountBand($, 140)
  await $.tool.call({ tool: 'WebFetch', url: 'https://code.claude.com/docs', prompt: 'x' } as any)
  await calls.clock.settle()
  expect((await walkProps(band)).toolArg).toBe('code.claude.com/docs')
  await $.tool.call({ tool: 'WebSearch', query: 'claude mods' } as any)
  await calls.clock.settle()
  const p = await walkProps(band)
  expect(p.toolArg).toBe('claude mods')
  expect(p.toolEnd).toMatchObject({ ok: true, link: 'claude.com/mods', hits: 3 })
  await band.unmount()
})

// 上网 S2 雷达 (用户 2026-10-10 选的): 5 行的绿圈 (只画圈), 扫描线 16 帧转一圈, 天空行打出搜索词;
//   搜到了亮起光点 (结果条数, 最多 5 个), 搜索词换成第一条结果链接和「+还有几条」; 「找到了」撑 1.8 秒
const RING = 0x15803d
const SWEEP = 0x4ade80
const radarAt = (fr: any, c: number) => {
  const out: string[] = []
  fr.hpx.forEach((row: number[], y: number) => row.forEach((v, hx) => { if (v === c) out.push(hx - fr.hx + ',' + (y - 2)) }))
  return out.sort()
}
test('searching (S2 radar): a green ring right of the crab with a sweep line turning once every 16 frames; the query is typed in the sky row', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 60, working: true, arg: 'claude mods', word: '搜', tool: f => (f < 50 ? 'search' : '') })
  const ring = radarAt(r.frames[20]!, RING)
  expect(ring.length > 10).toBe(true)
  expect(ring.every(p => { const [hx, y] = p.split(',').map(Number); return hx! >= 26 && hx! <= 35 && y! >= 0 && y! <= 4 })).toBe(true)
  const sweep = (f: number) => radarAt(r.frames[f]!, SWEEP).join(' ')
  expect(sweep(20)).not.toBe(sweep(24)) // 在转
  expect(sweep(20)).toBe(sweep(36)) // 16 帧一圈
  const text = (f: number) => r.frames[f]!.caption.map((c: any) => c.text).join('')
  expect(r.frames[10]!.caption[0]!.x - r.frames[10]!.bx).toBe(20)
  expect(text(6)).toBe('搜 c') // 每 2 帧一个字
  expect(text(40).startsWith('搜 claude mods.')).toBe(true) // 打完了, 后面点点
})

test('searching (S2 radar): when results come back, blips light up (one per result, at most 5), the link and "+N more" replace the query, the crab raises a claw, and it stays like that for about 1.8 s', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 80, working: true, arg: 'claude mods', word: '搜', link: 'claude.com/mods', hits: 8, tool: f => (f < 30 ? 'search' : '') })
  const blips = (f: number) => r.frames[f]!.hpx.flat().filter((c: number) => c === SPARK || c === 0xfafafa).length
  expect(blips(28)).toBe(0)
  expect(blips(34)).toBe(5)
  const cap = r.frames[34]!.caption
  expect(cap.map((c: any) => [c.text, c.color, c.under])).toEqual([
    ['claude.com/mods', SEA_HI, true],
    ['+7', 0x71717a, false],
  ])
  expect(armOf(r.frames[33]!, 'R')).toBe('up')
  expect(r.frames.slice(30, 52).every(fr => fr.pose === 'tool')).toBe(true) // 「找到了」撑约 1.8 秒
  expect(r.frames.slice(60).some(fr => fr.pose === 'walk')).toBe(true)
  // 搜失败: 不亮光点, 也没有链接
  const bad = previewLane({ w: 80, sky: true, fine: true, frames: 40, working: true, ok: false, arg: 'x', word: '搜', link: 'a.com', hits: 3, tool: f => (f < 20 ? 'search' : '') })
  expect(bad.frames[24]!.hpx.flat().filter((c: number) => c === SPARK || c === 0xfafafa).length).toBe(0)
  expect(bad.frames[24]!.caption.some((c: any) => c.text.includes('a.com'))).toBe(false)
})

test('the crab strip gets the word in front of the query in the panel language (搜 / search)', async ($, on) => {
  await start($, on, WIN, { mockClock: T0, lang: 'zh' })
  const zh = await mountBand($, 140)
  expect((await walkProps(zh)).searchWord).toBe('搜')
  await zh.unmount()
  await $.command.run({ command: 'hud', args: 'lang en' } as any)
  const en = await mountBand($, 140)
  expect((await walkProps(en)).searchWord).toBe('search')
  await en.unmount()
})

// 睡觉组合 (定稿 G + H + I): 闲 4 分钟打瞌睡 -> 5 分钟睁着眼钻进沙里 -> 闭成一字眼 -> 睡帽掉下来 -> 戴着睡帽睡;
//   一来活就蹦出来 (0.6 秒内), 睡帽弹飞、沙子炸开在背景里接着播 (用户 2026-10-10)
const DOZE = 3200 // 4 分钟 (75ms 一帧)
const SLEEP = 4000 // 5 分钟
const SAND = 0xc8a96a
const CAP = 0x4f46e5
const BRIM = 0xe4e4e7
const crabRows = (fr: any) => fr.px.slice(2)
const has = (fr: any, c: number) => fr.px.flat().includes(c)
// 一字眼: 眼睛那一行连着两格眼睛色 (左眼 3-4 / 右眼 7-8, 看前面时)
const lineEyes = (fr: any) => crabRows(fr).some((row: number[]) => row[fr.bx + 3] === EYE && row[fr.bx + 4] === EYE && row[fr.bx + 7] === EYE && row[fr.bx + 8] === EYE)
test('sleep (G): after 4 idle minutes the crab dozes — its eyes close into lines, its head drops and its claws hang down, it jolts awake once and nods off again', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 80, working: false, idle: f => DOZE + f })
  expect(r.frames.every(fr => fr.pose === 'doze')).toBe(true)
  expect(lineEyes(r.frames[3]!)).toBe(false) // 刚开始还醒着
  expect(lineEyes(r.frames[18]!)).toBe(true) // 眼皮合上: 一字眼
  const hang = (fr: any) => fr.px[bodySpan(fr)[0] + 4]?.[fr.bx] === BODY && fr.px[bodySpan(fr)[0] + 3]?.[fr.bx + 1] === BODY
  expect(hang(r.frames[18]!)).toBe(true) // 钳子耷拉 (往下)
  expect(bodySpan(r.frames[18]!)[0]).toBe(bodySpan(r.frames[3]!)[0] + 1) // 头往下一点
  expect(armOf(r.frames[24]!, 'L')).toBe('mid') // 猛地醒一下
  expect(has(r.frames[40]!, SAND) || has(r.frames[40]!, CAP)).toBe(false) // 打瞌睡时还没有沙子和睡帽
})

test('sleep (H): at 5 minutes it digs into the sand with its eyes open, then its eyes close into lines; the nightcap drops on; then it sleeps in the cap, breathing, with bubbles and an occasional one-eyed peek', () => {
  const r = previewLane({ w: 80, sky: true, fine: true, frames: 340, working: false, idle: f => SLEEP + f })
  expect(r.frames.every(fr => fr.pose === 'sleep')).toBe(true)
  expect(crabRows(r.frames[2]!)[5].slice(r.frames[2]!.bx, r.frames[2]!.bx + 12).every((c: number) => c === SAND)).toBe(true) // 沙堆
  expect(lineEyes(r.frames[4]!)).toBe(false) // 钻的时候睁着眼
  expect(bodySpan(r.frames[20]!)[0]).toBeGreaterThan(bodySpan(r.frames[0]!)[0]) // 往沙里沉
  expect(r.frames.slice(0, 18).some(fr => fr.pt.some((p: any) => p.color === SAND))).toBe(true) // 刨出来的沙粒
  expect(lineEyes(r.frames[22]!)).toBe(true) // 钻好了才闭眼
  expect(has(r.frames[22]!, CAP)).toBe(false)
  expect(has(r.frames[26]!, CAP)).toBe(true) // 睡帽从上面掉下来
  expect(has(r.frames[60]!, CAP) && has(r.frames[60]!, BRIM)).toBe(true) // 戴着睡帽睡
  const tops = new Set(r.frames.slice(40, 120).map(fr => bodySpan(fr)[0]))
  expect(tops.size).toBe(2) // 一浮一沉
  expect(r.frames.slice(40, 200).some(fr => fr.pt.length > 0)).toBe(true) // 泡泡
  expect(r.frames.slice(32, 340).some(fr => !lineEyes(fr))).toBe(true) // 中间睁一只眼看看
})

test('sleep (I): any activity wakes it at once — it pops out of the sand into the sky row within 0.6 s, the cap flies off and sand bursts in the background, then it does what is next (types, greets, works)', () => {
  const W = 60
  for (const [what, opt, want] of [
    ['typing', { typing: (f: number) => f >= W }, 'type'],
    ['hover', { hold: (f: number) => f >= W }, 'greet'],
    ['work', { working: (f: number) => f >= W }, 'walk'],
  ] as const) {
    const r = previewLane({ w: 80, sky: true, fine: true, frames: W + 30, working: false, idle: (f: number) => (f < W ? SLEEP + 100 + f : 0), ...(opt as any) })
    const pop = r.frames.slice(W, W + 8)
    expect([what, pop.every(fr => fr.pose === 'wake')]).toEqual([what, true])
    expect([what, pop.some(fr => bodySpan(fr)[0] < 2)]).toEqual([what, true]) // 蹦进天空行
    expect([what, r.frames[W + 8]!.pose]).toEqual([what, want])
    expect([what, r.frames.slice(W + 1, W + 10).some(fr => fr.pt.some((p: any) => p.color === SAND))]).toEqual([what, true]) // 沙子炸开
    const capCols = (fr: any) => fr.hpx.flatMap((row: number[]) => row.map((c, hx) => (c === CAP ? hx - fr.hx : -999)).filter(x => x > -999))
    expect([what, capCols(r.frames[W + 3]!).length > 0 && Math.max(...capCols(r.frames[W + 3]!)) > 20]).toEqual([what, true]) // 睡帽往右上弹飞
    expect([what, has(r.frames[W + 16]!, CAP)]).toEqual([what, false])
  }
})

test('sleep: a panicking crab never dozes off; normal blinks stay the old half-closed style (the line eyes are only for sleeping and dozing); the sunglasses get a white glint', () => {
  const panic = previewLane({ w: 80, sky: true, fine: true, frames: 40, working: false, mood: 'panic', idle: f => SLEEP + 500 + f })
  expect(panic.frames.every(fr => fr.pose === 'idle' && !has(fr, SAND) && !has(fr, CAP))).toBe(true)
  const awake = previewLane({ w: 80, sky: true, fine: true, frames: 130, working: false })
  expect(awake.frames.some(lineEyes)).toBe(false)
  const chill = previewLane({ w: 80, sky: true, fine: true, frames: 10, working: false, mood: 'chill' })
  expect(chill.frames.every(fr => fr.hpx.flat().includes(0xfafafa))).toBe(true)
})

test('in the real crab strip: a fetch writes its URL in the sky row (purple once fetched), a bubble during it sits left of the crab; a search types its query, then shows the link and +N', { timeoutMs: 60_000 }, async ($, on) => {
  let open: () => void = () => {}
  const T = 1_900_000_300_000
  const { clock } = await start($, on, WIN, {
    mockClock: T,
    usage: lowUsage,
    agents: () => [],
    lang: 'zh',
    toolGate: () => new Promise<void>(r => (open = r)),
    toolResult: e => (e.tool === 'WebSearch' ? { query: 'claude mods', results: [{ tool_use_id: 'x', content: [{ title: 'A', url: 'https://claude.com/mods' }, { title: 'B', url: 'https://b.dev' }, { title: 'C', url: 'https://c.io' }] }], durationSeconds: 1 } : {}),
  })
  const ui = await mountAbove($, 110, 4, { working: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10)
  await ui.advance(1500)
  const colOf = (w: any, row: number, ch: string) => w.rows[row].findIndex((c: any) => c.ch === ch)
  // 抓网页: 天空行写网址; 这时来一个气泡 (等你点头), 放在螃蟹左边
  let call = $.tool.call({ tool: 'WebFetch', url: 'https://code.claude.com/docs', prompt: 'x' } as any)
  await clock.settle()
  await ui.advance(1200)
  let w = await walkOf(ui)
  expect(w.text[0]).toContain('code.claude.com/docs')
  await $.classic.PermissionRequest({ tool_name: 'WebFetch' } as any)
  await clock.advance(400) // 气泡跟着面板的帧钟送过去
  await ui.advance(300)
  w = await walkOf(ui)
  const bubbleAt = colOf(w, 1, '等')
  expect(bubbleAt >= 0 && bubbleAt < (w.bx ?? -1)).toBe(true)
  open()
  await call
  await clock.settle()
  await ui.advance(300)
  w = await walkOf(ui)
  expect(w.rows[0]![colOf(w, 0, 'd')]!.fg).toBe(0xa78bfa) // 抓完变紫
  await ui.advance(1500)
  // 搜索: 一个字一个字打出「搜 claude mods」, 搜到了换成第一条链接和「+2」
  call = $.tool.call({ tool: 'WebSearch', query: 'claude mods' } as any)
  await clock.settle()
  await ui.advance(2500)
  w = await walkOf(ui)
  expect(w.text[0]).toContain('搜 claude mods')
  open()
  await call
  await clock.settle()
  await ui.advance(300)
  w = await walkOf(ui)
  expect(w.text[0]).toContain('claude.com/mods')
  expect(w.text[0]).toContain('+2')
  await ui.unmount()
})
