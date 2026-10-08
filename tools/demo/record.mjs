// 动图的录制器: 在 Node 里用假引擎跑真的 cc-hud 代码 (register.tsx / walkway.tsx / sprites.ts / desktop.ts / strings.ts),
// 按剧本 (scenes/<场景>.story.js) 的时间喂事件: 打字、发送、工具调用、子代理、点按钮; 每一帧录下真代码画出来的东西:
//   终端版 (cc-hud): 面板 (PromptHint)、散步道 (AbovePrompt 里的 Client 模块)、子代理看板 (Pane)、收据 (TurnDuration), 排成终端格子
//   客户端版 (client):  AbovePrompt 在桌面界面画的两张 SVG (螃蟹 crabSvg、仪表盘 dashSvg), 和每张图换上的时刻 (SMIL 动画从那一刻播)
// 写进 out/rec/<场景>.<lang>.json; 场景页只负责把这些画出来, 再加上窗口、引擎自己的界面、鼠标和标题
// 用法: node tools/demo/record.mjs <cc-hud|client> <en|zh>   (render.mjs 会自动调用; 每次一个进程, 模块状态互不影响)
// 依赖: 在 tools/demo 里 npm install 装的 typescript (只用来把 .tsx 转成 JS)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const HOOKS = join(REPO, 'cc-hud', 'hooks')
const OUT = join(HERE, 'out')
const scene = process.argv[2] === 'client' ? 'client' : 'cc-hud'
const lang = process.argv[3] === 'zh' ? 'zh' : 'en'
const S = await import(pathToFileURL(join(HERE, 'scenes', scene + '.story.js')).href)
const T = S.TEXT[lang]
const DESKTOP = S.SURFACE === 'desktop'

// ---------------- 把 hooks 目录转成能直接 import 的 JS (每种语言一份, 模块状态互不影响) ----------------
const MOD = join(OUT, 'mod-' + scene + '-' + lang)
rmSync(MOD, { recursive: true, force: true })
mkdirSync(MOD, { recursive: true })
for (const f of readdirSync(HOOKS)) {
  if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f) || f.endsWith('.d.ts')) continue
  const out = ts.transpileModule(readFileSync(join(HOOKS, f), 'utf8'), {
    fileName: f,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
      isolatedModules: true,
    },
  }).outputText
  // 源码里相对路径的 import 不写扩展名: 补上 .mjs
  const js = out.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, p, b) => a + p.replace(/\.(tsx?|m?js)$/, '') + '.mjs' + b)
  writeFileSync(join(MOD, f.replace(/\.tsx?$/, '.mjs')), js)
}

// ---------------- 假时钟 (new Date() 也跟着走: 交接文件名、深夜提示用它) ----------------
// 剧本的第 0 秒 = 本地时间 2026-10-08 14:42; 录制从 PRE 秒之前开始 (之前的子代理、上一轮), 第 0 秒起才存帧
const RealDate = Date
const BASE = new RealDate(2026, 9, 8, 14, 42, 0).getTime()
const PRE = 1920
let NOW = BASE - PRE * 1000
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (a.length) super(...a)
    else super(NOW)
  }
  static now() {
    return NOW
  }
}
const at = s => BASE + Math.round(s * 1000)

let seq = 0
const timers = [] // { at, fn, every, dead, seq }
function addTimer(ms, fn, every) {
  const t = { at: NOW + Math.max(1, ms), fn, every: every ? Math.max(1, ms) : 0, dead: false, seq: seq++ }
  timers.push(t)
  return { cancel: () => (t.dead = true) }
}
const schedule = (s, fn) => timers.push({ at: at(s), fn, every: 0, dead: false, seq: seq++ })
const waitUntil = s => new Promise(ok => schedule(s, ok))
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r))
}
const errors = []
process.on('unhandledRejection', err => errors.push(String(err?.stack ?? err)))
// 推进到 target: 按时间顺序跑到期的定时器 / 剧本动作 (都不等它们做完: 有的要等以后的时间, 比如工具调用)
async function advanceTo(target) {
  for (;;) {
    let due
    for (const t of timers) if (!t.dead && t.at <= target && (!due || t.at < due.at || (t.at === due.at && t.seq < due.seq))) due = t
    if (!due) break
    NOW = due.at
    if (due.every) due.at += due.every
    else due.dead = true
    try {
      const r = due.fn()
      if (r && typeof r.catch === 'function') r.catch(err => errors.push(String(err?.stack ?? err)))
    } catch (err) {
      errors.push(String(err?.stack ?? err))
    }
    await flush()
  }
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].dead) timers.splice(i, 1)
  NOW = target
  await flush()
}

// ---------------- 元素: JSX 编译成 h(类型, 属性, ...子元素) ----------------
globalThis.Fragment = Symbol('Fragment')
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true)
  if (type === globalThis.Fragment) return kids
  const p = { ...(props ?? {}), children: kids }
  return typeof type === 'function' ? type(p) : { type: String(type), props: p }
}
const ELS = new Proxy({}, { get: (_, type) => (p = {}) => ({ type: String(type), props: { ...p, children: [p.children ?? []].flat(Infinity) } }) })

// ---------------- 假引擎 ($) ----------------
const store = { lang, crab: true, layout: 'full' }
const toasts = [] // { at, text, ms }
const pane = { open: false }
const PLUGIN_ROOT = '/home/me/.claude/plugins/cache/cc-hud/cc-hud/' + JSON.parse(readFileSync(join(REPO, 'cc-hud', '.claude-plugin', 'plugin.json'), 'utf8')).version
const HANDOFF_BODY = handoffBody()
const missing = new Set()

const stepIdx = ms => S.STEPS.filter(s => ms >= at(s.at)).length
function usageAt(ms) {
  const k = stepIdx(ms)
  return {
    startedAt: BASE - (72 * 60 + 5) * 1000, // 这个会话已经开了 1h12m
    context: { tokens: S.CTX_TOK[k], window: S.CTX_WIN, percent: Math.round((S.CTX_TOK[k] / S.CTX_WIN) * 100) },
    rateLimits: [
      // 5 小时窗口刚开始 12 分钟 (4h48m 后重置); 本周还有 2 天 20 小时重置
      { kind: 'five_hour', percentUsed: S.FIVE[k], resetsAt: new RealDate(BASE + (4 * 60 + 48) * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: S.WEEK[k], resetsAt: new RealDate(BASE + (2 * 86400 + 20 * 3600) * 1000).toISOString() },
    ],
    cost: { usd: S.COST[k] },
  }
}
// 子代理列表: 这一轮派出的还在跑的 (更早的已经结束, 不在列表里)
const agentList = () =>
  S.KIDS.flatMap((k, i) => (NOW >= at(k.spawn) && NOW < at(k.stop) ? [{ id: k.id, description: T.kids[i], type: k.type, status: 'running' }] : []))
const firstEdit = S.TOOLS.find(x => x.tool === 'Edit' || x.tool === 'Write')

function procRun(argv) {
  const ok = stdout => ({ exitCode: 0, stdout, stderr: '' })
  if (argv[0] === 'git' && argv[1] === 'branch') return ok('main\n')
  if (argv[0] === 'git' && argv[1] === 'status') return ok(firstEdit && NOW >= at(firstEdit.end) ? ' M ' + firstEdit.args + '\n' : '')
  // 历史 token (count-tokens.js): 和一个用了一阵的会话同量级
  if (argv[0] === 'node') return ok(JSON.stringify({ found: true, input: 18_420, output: 91_200, cacheRead: 17_950_000, cacheWrite: 412_000 }))
  return { exitCode: 1, stdout: '', stderr: '' }
}

const H = {
  'clock.now': () => NOW,
  'clock.every': (ms, fn) => addTimer(ms, fn, true),
  'clock.after': (ms, fn) => addTimer(ms, fn, false),
  'store.get': k => store[k],
  'store.set': (k, v) => void (store[k] = v),
  'store.delete': k => void delete store[k],
  'session.usage': () => usageAt(NOW),
  'session.model': () => 'claude-opus-5-5',
  'session.cwd': () => S.CWD,
  'session.root': () => S.CWD,
  'session.id': () => '5d0c1a2e-8f7b-4c1d-9e3a-1b2c3d4e5f60',
  'settings.read': () => ({ effortLevel: 'high' }),
  'agent.list': () => agentList(),
  'env.get': name => ({ HOME: '/home/me' })[name],
  'fs.exists': () => false,
  'fs.read': p => {
    if (String(p).endsWith('plugin.json')) return readFileSync(join(REPO, 'cc-hud', '.claude-plugin', 'plugin.json'), 'utf8')
    throw new Error('ENOENT: ' + p)
  },
  'fs.write': () => undefined,
  'process.run': argv => procRun(argv),
  'command.register': o => ({ command: o?.name }),
  'command.run': () => ({}),
  'model.fork': () => waitUntil(S.HANDOFF?.forkDoneAt ?? 3).then(() => ({ isAnswered: true, text: HANDOFF_BODY, usage: {} })),
  'ui.toast': (text, o) => void toasts.push({ at: NOW, text: String(text), ms: o?.timeoutMs ?? 6000 }),
  'ui.open': o => {
    if (o?.id === 'hud-agents') pane.open = true
    return { isPlaced: true }
  },
  'ui.close': () => void (pane.open = false),
  // 客户端 (远程界面) 目前还不能让 mod 复制到剪贴板 (接口文档: "a remote surface has no path yet"); 终端照常能复制
  'ui.copy': o => ({ isCopied: o?.surface !== 'desktop' }),
  'ui.invalidate': () => undefined,
  'ui.log': () => undefined,
  'ui.status': () => undefined,
  'ui.notice': () => undefined,
}
const noun = name =>
  new Proxy(
    {},
    {
      get(_, method) {
        if (typeof method !== 'string' || method === 'then') return undefined
        const key = name + '.' + method
        if (key === 'ui.resolve') return () => ELS
        return (...args) => {
          const fn = H[key]
          if (!fn) {
            missing.add(key)
            return Promise.resolve(undefined)
          }
          try {
            return Promise.resolve(fn(...args))
          } catch (err) {
            return Promise.reject(err)
          }
        }
      },
    },
  )
const $ = new Proxy(
  {},
  {
    get(_, name) {
      if (typeof name !== 'string' || name === 'then') return undefined
      if (name === 'plugin') return { root: PLUGIN_ROOT }
      return noun(name)
    },
  },
)

// ---------------- 载入真的 hooks, 收集 on(...) ----------------
const reg = []
const on = (event, a, b) => reg.push(typeof a === 'function' ? { event, match: undefined, hook: a } : { event, match: a, hook: b })
const { register } = await import(pathToFileURL(join(MOD, 'register.mjs')).href)
const { default: Walkway } = await import(pathToFileURL(join(MOD, 'walkway.mjs')).href)
const { isWide } = await import(pathToFileURL(join(MOD, 'sprites.mjs')).href)
register(on, {})

const matches = (m, e) => !m || Object.entries(m).every(([k, v]) => (Array.isArray(v) ? v.includes(e[k]) : e[k] === v))
function fire(event, e, base = async () => ({})) {
  const hs = reg.filter(r => r.event === event && matches(r.match, e))
  const run = (k, ev) => (k < hs.length ? hs[k].hook($, ev, ev2 => run(k + 1, ev2 ?? ev)) : base(ev))
  return Promise.resolve(run(0, e))
}
// turn.step 的钩子是 async generator: next 返回一个只 return 结果的 generator
async function fireStep(e, usage) {
  const hs = reg.filter(r => r.event === 'turn.step')
  const run = (k, ev) =>
    k < hs.length
      ? hs[k].hook($, ev, ev2 => run(k + 1, ev2 ?? ev))
      : (async function* () {
          return { usage }
        })()
  const gen = run(0, e)
  let r
  do r = await gen.next()
  while (!r.done)
  return r.value
}

// ---------------- 排版: 元素树 -> 终端格子 (只认面板用到的 Box / Text / Button / Client) ----------------
// 格子 = { ch, w, fg, bg, b, d } (d = dimColor); null = 空格; { cont: true } = 宽字符的后半格
const EMPTY = () => ({ w: 0, h: 0, rows: [], btns: [] })
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.props?.children ?? []).map(textOf).join('')
}
function styleOf(p, inh) {
  return {
    fg: p.color ?? inh.fg,
    bg: p.backgroundColor ?? inh.bg,
    b: p.bold ?? inh.b,
    d: p.dimColor ?? inh.d,
  }
}
// 一段文字 (可以嵌套 Text) -> 一行格子; maxW 之外截掉 (宽字符放不下整个丢掉)
function runsOf(node, st, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push([String(node), st])
    return out
  }
  if (Array.isArray(node)) {
    for (const k of node) runsOf(k, st, out)
    return out
  }
  if (node.type === 'Text') {
    const s2 = styleOf(node.props, st)
    for (const k of node.props.children ?? []) runsOf(k, s2, out)
    return out
  }
  out.push([textOf(node), st])
  return out
}
function lineBlock(runs, maxW) {
  const row = []
  for (const [s, st] of runs) {
    for (const ch of s) {
      if (ch === '\n') continue
      const w = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
      if (row.length + w > maxW) return { w: row.length, h: 1, rows: [row], btns: [] }
      row.push({ ch, w, fg: st.fg, bg: st.bg, b: !!st.b, d: !!st.d })
      if (w === 2) row.push({ cont: true })
    }
  }
  return { w: row.length, h: 1, rows: [row], btns: [] }
}
function place(dst, src, x, y) {
  src.rows.forEach((row, r) => {
    const d = (dst.rows[y + r] ??= [])
    row.forEach((c, k) => {
      if (c) d[x + k] = c
    })
  })
  for (const b of src.btns) dst.btns.push({ ...b, r: b.r + y, c: b.c + x })
}
function clipTo(block, w) {
  if (block.w <= w) return block
  block.rows = block.rows.map(row => {
    const r = row.slice(0, w)
    // 截在宽字符中间: 前半格也去掉
    if (r.length && r[r.length - 1] && !r[r.length - 1].cont && r[r.length - 1].w === 2) r.pop()
    return r
  })
  block.btns = block.btns.filter(b => b.c < w)
  block.w = w
  return block
}
let walk // 散步道 Client 的实例 (第一次画的时候建)
function layout(node, maxW, inh = {}) {
  if (node === null || node === undefined || node === false || node === true) return EMPTY()
  if (Array.isArray(node)) return layoutBox({ flexDirection: 'row', children: node }, maxW, inh)
  if (typeof node === 'string' || typeof node === 'number') return lineBlock([[String(node), inh]], maxW)
  const p = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return lineBlock(runsOf(node, inh, []), maxW)
    case 'Button': {
      // plain 按钮: 只画文字 (dimColor 时是暗色); 位置记下来给鼠标和反色用
      const b = lineBlock([[String(p.label ?? textOf(node)), { ...inh, d: !!p.dimColor }]], maxW)
      b.btns.push({ key: String(p.key ?? ''), r: 0, c: 0, w: b.w, onPress: p.onPress })
      return b
    }
    case 'Client':
      return layoutClient(p, maxW)
    case 'Box':
      return layoutBox(p, maxW, inh)
    default:
      return layoutBox({ flexDirection: 'row', children: p.children ?? [] }, maxW, inh)
  }
}
function layoutBox(p, maxW, inh) {
  const padL = p.paddingLeft ?? p.paddingX ?? p.padding ?? 0
  const padR = p.paddingRight ?? p.paddingX ?? p.padding ?? 0
  const W = p.width !== undefined ? Math.min(p.width, maxW) : maxW
  const inner = Math.max(0, W - padL - padR)
  const kids = p.children ?? []
  const out = { w: 0, h: 0, rows: [], btns: [] }
  if (p.flexDirection === 'column') {
    let y = 0
    let w = 0
    for (const k of kids) {
      const b = layout(k, inner, inh)
      place(out, b, padL, y)
      y += b.h
      w = Math.max(w, b.w)
    }
    out.h = p.height ?? y
    out.w = p.width !== undefined ? W : Math.min(maxW, padL + w + padR)
  } else {
    const gap = p.columnGap ?? p.gap ?? 0
    let x = padL
    let h = 0
    kids.forEach((k, i) => {
      if (i) x += gap
      const b = layout(k, Math.max(0, padL + inner - x), inh)
      place(out, b, x, 0)
      x += b.w
      h = Math.max(h, b.h)
    })
    out.h = p.height ?? h
    out.w = p.width !== undefined ? W : Math.min(maxW, x + padR)
  }
  out.rows.length = Math.min(out.rows.length, out.h)
  return clipTo(out, out.w)
}
function layoutClient(p, maxW) {
  if (!String(p.module ?? '').includes('walkway')) return EMPTY()
  if (!walk) {
    walk = {
      elements: ELS,
      state: undefined,
      setState(v) {
        walk.state = v
      },
      every(ms, fn) {
        return addTimer(ms, fn, true)
      },
      onPointer() {},
    }
  }
  return layout(Walkway(p.props, walk), Math.min(maxW, p.width ?? maxW))
}

// 格子 -> 每行一串 [文字, 样式] (同样式的连续格子合并; 空格子不带样式)
function encode(block, w) {
  const rows = []
  for (let r = 0; r < block.h; r++) {
    const row = block.rows[r] ?? []
    const out = []
    for (let c = 0; c < w; c++) {
      const cell = row[c]
      if (cell?.cont) continue
      const st = cell ? [cell.fg ?? '', cell.bg ?? '', cell.b ? 1 : 0, cell.d ? 1 : 0].join('|') : ''
      const ch = cell ? cell.ch : ' '
      const last = out[out.length - 1]
      if (last && last[1] === st) last[0] += ch
      else out.push([ch, st])
    }
    // 行尾的空格不要
    while (out.length && out[out.length - 1][1] === '' && !out[out.length - 1][0].trim()) out.pop()
    rows.push(out.map(([s, st]) => (st ? [s, ...st.split('|').map((v, i) => (i < 2 ? v || null : v === '1'))] : [s])))
  }
  return rows
}
const btnsOf = block => Object.fromEntries(block.btns.filter(b => b.key).map(b => [b.key, [b.r, b.c, b.w]]))

// ---------------- 剧本 -> 事件 ----------------
let lastPress = {} // 最近一次画面板时各按钮的 onPress
const press = key => {
  const fn = lastPress[key]
  if (!fn) {
    errors.push('no button ' + key)
    return
  }
  return fn({ surface: DESKTOP ? 'desktop' : 'terminal' })
}
const working = () => NOW >= at(S.TURN_START) && NOW < at(S.COMPLETE)
const tuid = i => 'toolu_' + String(i).padStart(4, '0')
let uid = 0
function toolCall(tool, input, endS, agentId) {
  return fire('tool.call', { tool, ...input, tool_use_id: tuid(++uid), ...(agentId ? { agentId } : {}) }, () =>
    waitUntil(endS).then(() => ({ result: {}, text: 'ok' })),
  )
}
const spawnKid = (id, desc, type) =>
  fire('agent.spawn', { description: desc, subagentType: type, prompt: desc }, async () => ({ agentId: id, model: 'claude-haiku-4-5' })).then(() =>
    fire('classic.SubagentStart', { agent_id: id, agent_type: type }),
  )
const stopKid = (id, type, note) => fire('classic.SubagentStop', { agent_id: id, agent_type: type, last_assistant_message: note })
const submit = text => fire('prompt.submit', { text, origin: { kind: 'composer' } }, async e => ({ text: e.text }))
const typeKey = () => fire('prompt.edit', { text: '', start: 0, end: 0, inputText: 'x' }, async () => ({ text: '', cursor: 0 }))
const STEP_USAGE = { input_tokens: 2_100, output_tokens: 420, cache_read_input_tokens: 118_000, cache_creation_input_tokens: 3_200 }
const KID_USAGE = { input_tokens: 1_200, output_tokens: 260, cache_read_input_tokens: 21_000, cache_creation_input_tokens: 1_800 }

// 开场之前: 本会话更早的两个子代理 (看板里 "已结束" 那两行) 和上一轮 (状态格 "上一轮 47s · 7 个工具", 工具格的排行)
const earlier = [
  { id: 'agent-docs', desc: T.earlier[0], type: 'general-purpose', start: -1905, stop: -1618, tools: ['Read', 'Read', 'Grep', 'Write', 'Write', 'Read', 'Edit', 'Write', 'Read', 'Write', 'Write'], note: 'Docs updated.' },
  { id: 'agent-e2e', desc: T.earlier[1], type: 'general-purpose', start: -540, stop: -492, tools: ['Bash', 'Read', 'Bash'], note: '2 tests failed.' },
]
for (const k of earlier) {
  schedule(k.start, () => spawnKid(k.id, k.desc, k.type))
  k.tools.forEach((tool, i) => {
    const s = k.start + 5 + i * ((k.stop - k.start - 10) / k.tools.length)
    schedule(s, () => toolCall(tool, { file_path: S.CWD + '/docs/api.md' }, s + 2, k.id))
  })
  schedule(k.stop, () => stopKid(k.id, k.type, k.note))
}
const PREV = { submit: -75, start: -74.9, end: -28 }
const prevTools = ['Read', 'Read', 'Grep', 'Read', 'Bash', 'Edit', 'Bash']
schedule(PREV.submit, () => submit('fix the flaky cart test'))
schedule(PREV.start, () => fire('turn.start', { text: 'fix the flaky cart test', turnId: 't0' }, async e => ({ turnId: e.turnId })))
prevTools.forEach((tool, i) => {
  const s = -72 + i * 6
  schedule(s, () => toolCall(tool, tool === 'Bash' ? { command: 'npm test' } : { file_path: S.CWD + '/src/pages/Cart.tsx' }, s + 3))
})
schedule(PREV.end, () => fire('turn.complete', { turnId: 't0', durationMs: (PREV.end - PREV.start) * 1000 }, async () => ({ text: '' })))

// 正片
const chars = [...T.prompt]
chars.forEach((_, i) => schedule(S.TYPE_AT + (i * (S.TYPE_END - S.TYPE_AT)) / chars.length, typeKey))
schedule(S.ENTER, () => submit(T.prompt))
schedule(S.TURN_START, () => fire('turn.start', { text: T.prompt, turnId: 't1' }, async e => ({ turnId: e.turnId })))
for (const s of S.STEPS)
  schedule(s.at - 0.02, () =>
    fireStep(s.main ? { model: 'claude-opus-5-5', effort: 'high' } : { agentId: S.KIDS[s.kid ?? 0].id, model: 'claude-haiku-4-5' }, s.main ? STEP_USAGE : KID_USAGE),
  )
for (const x of S.TOOLS) {
  const input = x.tool === 'Agent' ? { description: T.agentDesc, subagent_type: S.KIDS[0]?.type, prompt: T.agentDesc } : x.input
  schedule(x.start, () => toolCall(x.tool, input, x.end))
}
S.KIDS.forEach((k, i) => {
  schedule(k.spawn, () => spawnKid(k.id, T.kids[i], k.type))
  for (const x of k.tools) schedule(x.at, () => toolCall(x.tool, x.input, x.at + 0.35, k.id))
  schedule(k.stop, () => stopKid(k.id, k.type, T.kidNotes[i]))
})
schedule(S.COMPLETE, () => fire('turn.complete', { turnId: 't1', durationMs: Math.round((S.COMPLETE - S.TURN_START) * 1000) }, async () => ({ text: '' })))
if (S.AGENTS) {
  schedule(S.AGENTS.clickAt, () => press('btn-agents'))
  schedule(S.AGENTS.closeAt, () => void (pane.open = false))
}
if (S.HANDOFF?.clickAt !== undefined) schedule(S.HANDOFF.clickAt, () => press('btn-handoff'))
// 客户端版的鼠标: 每一趟在 clicks 这几个时刻按下这个按钮
for (const trip of S.TRIPS ?? []) for (const c of trip.clicks) schedule(c, () => press(trip.key))

// ---------------- 跑 ----------------
const VIEW = { columns: S.COLS, rows: S.ROWS ?? 30, isFullscreen: true }
const STRIP_W = S.COLS - 5 // AbovePrompt 的 bodyColumns: 引擎在右端留了 5 格
const PANE_COLS = 74 // 看板正文的宽度 (>= 72 = 宽看板, 一行一个子代理)
const RENDER_FROM = -12 // 散步道从开场前 12 秒开始画 (螃蟹已经醒着在溜达)
const engineText = (s, color) => ELS.Text({ color, children: [s] })
// 引擎自己的提示行 (? for shortcuts) 和输入框里的字对齐: 左边空 2 格
const engineHint = () => ELS.Box({ paddingLeft: 2, children: [engineText('? for shortcuts', '#999999')] })

await fire('session.start', { cwd: S.CWD }, async e => ({ cwd: e.cwd }))
await flush()

const frames = []
// 客户端版: SVG 去重存一张表, 每帧只存编号; 记下每张图换上的时刻 (客户端换图 = SMIL 动画从头播)
const svgs = []
const svgIdx = new Map()
const idOf = s => {
  if (!svgIdx.has(s)) {
    svgIdx.set(s, svgs.length)
    svgs.push(s)
  }
  return svgIdx.get(s)
}
const shown = { crab: { id: -1, since: 0 }, dash: { id: -1, since: 0 } }
// 客户端的工具栏: 按顺序记下原生按钮 (key / 文字 / 主按钮) 和下拉框 (key / 标签 / 选中的那项), 顺便收集按钮的 onPress
function deskBar(tree) {
  const items = []
  const onPress = {}
  const walk = n => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const p = n.props ?? {}
    if (n.type === 'Button') {
      items.push({ t: 'b', k: p.key, l: String(p.label ?? ''), ...(p.variant ? { v: p.variant } : {}) })
      if (p.onPress) onPress[p.key] = p.onPress
    } else if (n.type === 'Select') {
      const o = (p.options ?? []).find(o => o.value === p.value)
      items.push({ t: 's', k: p.key, l: String(p.label ?? ''), val: String(o?.label ?? p.value ?? '') })
    } else walk(p.children ?? [])
  }
  walk(tree)
  return { items, onPress }
}
const findSvg = (n, key) => {
  if (!n || typeof n !== 'object') return undefined
  if (Array.isArray(n)) {
    for (const k of n) {
      const r = findSvg(k, key)
      if (r) return r
    }
    return undefined
  }
  if (n.type === 'Svg' && n.props?.key === key) return n.props
  return findSvg(n.props?.children ?? [], key)
}
const n = Math.round(S.DURATION * S.FPS)
for (let i = Math.round(RENDER_FROM * S.FPS); i < n; i++) {
  const t = i / S.FPS
  await advanceTo(at(t))
  const isWorking = working()
  const toastNow = () => {
    const x = toasts.filter(x => NOW >= x.at && NOW < x.at + x.ms).pop()
    return x ? { text: x.text, at: (x.at - BASE) / 1000, ms: x.ms } : null
  }
  if (DESKTOP) {
    const tree = await fire(
      'ui.render',
      { component: 'AbovePrompt', surface: 'desktop', requestId: 'above', props: { bodyColumns: S.COLS, maxRows: 4, isWorking, hasSurvey: false }, viewport: VIEW },
      async () => null,
    )
    const crab = findSvg(tree, 'crab-svg')
    const dash = findSvg(tree, 'dash-svg')
    const c = idOf(crab?.source ?? '')
    const d = idOf(dash?.source ?? '')
    if (c !== shown.crab.id) shown.crab = { id: c, since: t }
    if (d !== shown.dash.id) shown.dash = { id: d, since: t }
    const bar = deskBar(tree)
    lastPress = bar.onPress
    if (i >= 0) frames.push({ c, cs: shown.crab.since, cw: crab?.width, ch: crab?.height, d, ds: shown.dash.since, toast: toastNow(), bar: bar.items, crab: !!crab })
    continue
  }
  const above = await fire(
    'ui.render',
    { component: 'AbovePrompt', surface: 'terminal', requestId: 'above', props: { bodyColumns: STRIP_W, maxRows: 4, isWorking, hasSurvey: false }, viewport: VIEW },
    async () => null,
  )
  const hint = await fire(
    'ui.render',
    { component: 'PromptHint', surface: 'terminal', requestId: 'hint', props: { isDraft: false, isWorking, hint: '? for shortcuts' }, viewport: VIEW },
    async () => engineHint(),
  )
  const strip = layout(above, STRIP_W)
  const panel = layout(hint, S.COLS - 2)
  lastPress = Object.fromEntries(panel.btns.filter(b => b.key && b.onPress).map(b => [b.key, b.onPress]))
  if (i < 0) continue
  let paneRows = null
  if (pane.open) {
    const tree = await fire('ui.render', { component: 'Pane', surface: 'terminal', requestId: 'hud-agents', props: { bodyColumns: PANE_COLS } }, async () => null)
    paneRows = encode(layout(tree, PANE_COLS), PANE_COLS)
  }
  let turnRow = null
  if (t >= S.COMPLETE) {
    const durationMs = Math.round((S.COMPLETE - S.TURN_START) * 1000)
    const tree = await fire(
      'ui.render',
      { component: 'TurnDuration', surface: 'terminal', requestId: 'turn-t1', props: { durationMs } },
      async () => engineText('✻ Baked for ' + Math.round(durationMs / 1000) + 's', '#999999'),
    )
    turnRow = encode(layout(tree, S.COLS), S.COLS)[0] ?? null
  }
  const L = walk?.state?.L
  frames.push({
    strip: encode(strip, STRIP_W),
    panel: encode(panel, S.COLS - 2),
    btns: btnsOf(panel),
    pane: paneRows,
    turn: turnRow,
    crab: L ? { bx: L.bx, cw: L.cw } : null,
    toast: toastNow(),
  })
}

mkdirSync(join(OUT, 'rec'), { recursive: true })
const file = join(OUT, 'rec', scene + '.' + lang + '.json')
writeFileSync(file, JSON.stringify({ scene, lang, cols: S.COLS, stripW: STRIP_W, paneCols: PANE_COLS, fps: S.FPS, ...(DESKTOP ? { svgs } : {}), frames }))
const kb = Math.round(readFileSync(file).length / 1024)
console.log(`  record ${lang}: ${frames.length} 帧 -> ${file.slice(REPO.length + 1)} (${kb} KB)`)
if (missing.size) console.log('  假引擎没接的调用: ' + [...missing].join(', '))
if (errors.length) {
  console.error('  出错 ' + errors.length + ' 次, 第一次:\n' + errors[0])
  process.exitCode = 1
}

// 交接提示词的正文 (剧本里写; 只有字数会出现在提示条里)
function handoffBody() {
  const lines = T.handoff ?? ['## Goal', T.prompt]
  return Array.from({ length: 6 }, () => lines.join('\n')).join('\n\n')
}
