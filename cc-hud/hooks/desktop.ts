// cc-hud 客户端 (桌面 app) 专用画面: 全部画成 SVG, 不依赖客户端的比例字体排版
//   - crabSvg: 像素螃蟹, 动作用 SVG 自带的 SMIL 动画循环播放 (只在状态变化时换图, 动画不会被打断)
//   - dashSvg: 3 行 x 3 列的仪表盘, 自带深色底板, 浅色/深色主题下都看得清
// 纯函数, 不调用 $; 文字取当前界面语言 (./strings)
import { S } from './strings'

export type CrabMode = 'idle' | 'work' | 'celebrate' | 'sleep'
export type CrabKind = 'think' | 'read' | 'edit' | 'bash' | 'web' | 'agent' | 'other'
export type CrabMood = 'chill' | 'normal' | 'sweat' | 'panic'
export type CrabState = {
  mode: CrabMode
  kind: CrabKind
  heat: 'ok' | 'hot' | 'crit'
  agents: number
  mood?: CrabMood
  // v0.21 (桌面版也平滑): 都是 "从多久以前开始" 的毫秒数. 换图时动画接着已经过去的时间往下播, 不会从头来; 过了就不给, 图片保持不变
  jumpMs?: number // 发出消息后过了多久 (< 750 时画那一跳)
  celebMs?: number // 庆祝开始后过了多久 (< 1200 时连跳两下; 不给 = 刚开始)
  heatFrom?: 'ok' | 'hot' // 身体颜色刚变: 从这个颜色渐变过来 (1 秒)
  heatMs?: number // 颜色变了多久
}

// warn: 预计重置前用完, 百分比和说明文字画成红色
// tick: 窗口已过的比例 (0-1), 条上画一根亮色细竖线 (时间刻度); 不给就不画 (上下文那根没有)
export type Meter = { pct?: number; extra: string; warn?: boolean; tick?: number }
export type DashData = {
  model: string
  effort: string
  project: string
  branch: string
  session: string
  cost: string
  ctx: Meter
  five: Meter
  week: Meter
  status: { text: string; tone: 'work' | 'agents' | 'idle' }
  tools: string
  tokenTotal: string
  tokenOutput: string
}

const C = {
  body: '#d97757',
  hot: '#e5484d',
  eye: '#1c1917',
  eyeShut: '#7c3f2c',
  eyeHalf: '#4b3127', // 眨眼的半闭 (身体色和眼睛色之间)
  sweat: '#60a5fa',
  spark: '#facc15',
  bubble: '#a1a1aa',
  paper: '#d4d4d8',
  ink: '#52525b',
  scan: '#60a5fa',
  term: '#3f3f46',
  cursor: '#4ade80',
  sea: '#3b82f6',
  land: '#4ade80',
  gear: '#a1a1aa',
  shades: '#09090b',
  bridge: '#52525b',
  alarm: '#ef4444',
  kid: '#f2a07b', // 小螃蟹浅一号, 和大螃蟹分得开
  kidLeg: '#a4553d',
  warn: '#f87171',
  tick: '#e5e5e5', // 时间刻度: 彩色段和暗色轨道上都看得清
}
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLOR: Record<string, string> = { low: '#a1a1aa', medium: '#60a5fa', high: '#fbbf24', xhigh: '#fb923c', max: '#f87171' }

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ---------------- 螃蟹 ----------------
const px = (x: number, y: number, fill: string, w = 1, h = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
// 离散切换的 SMIL 动画 (姿势本身要清楚的地方用: 钳子、眼睛、腿)
const steps = (attr: string, values: string[], dur: number, begin = 0) =>
  `<animate attributeName="${attr}" values="${values.join(';')}" keyTimes="${values.map((_, i) => (i / values.length).toFixed(3)).join(';')}" dur="${dur}s" begin="${begin}s" calcMode="discrete" repeatCount="indefinite"/>`
const moves = (values: string[], dur: number, begin = 0) =>
  `<animateTransform attributeName="transform" type="translate" values="${values.join(';')}" keyTimes="${values.map((_, i) => (i / values.length).toFixed(3)).join(';')}" dur="${dur}s" begin="${begin}s" calcMode="discrete" repeatCount="indefinite"/>`

// 平滑的 SMIL 动画 (v0.21): 值之间连续变化. spline = 起落有缓动, linear = 匀速; once = 只播一次, 停在最后一个值
// begin 可以是负数: 动画当作已经播了这么久 (换图时接着播)
const EASE = '0.42 0 0.58 1'
const keyTimes = (n: number) => Array.from({ length: n }, (_, i) => +(i / (n - 1)).toFixed(3)).join(';')
const sec = (s: number) => +s.toFixed(3)
type GlideOpts = { begin?: number; linear?: boolean; once?: boolean }
const glideAttrs = (values: string[], dur: number, o: GlideOpts) =>
  `values="${values.join(';')}" keyTimes="${keyTimes(values.length)}" calcMode="${o.linear ? 'linear' : 'spline'}"` +
  (o.linear ? '' : ` keySplines="${Array(values.length - 1).fill(EASE).join(';')}"`) +
  ` dur="${dur}s" begin="${sec(o.begin ?? 0)}s" ${o.once ? 'fill="freeze"' : 'repeatCount="indefinite"'}`
const glide = (attr: string, values: string[], dur: number, o: GlideOpts = {}) => `<animate attributeName="${attr}" ${glideAttrs(values, dur, o)}/>`
const glideMove = (values: string[], dur: number, o: GlideOpts = {}) => `<animateTransform attributeName="transform" type="translate" ${glideAttrs(values, dur, o)}/>`

// 钳子: 平伸 (第 2 行两格) / 半举 (斜着: 贴身那格在第 2 行, 钳尖在第 1 行) / 举起 (竖着, 第 0-1 行)
type Arm = 'out' | 'mid' | 'up'
function arm(side: 'L' | 'R', pose: Arm, fill: string): string {
  if (side === 'L') return pose === 'out' ? px(0, 2, fill, 2, 1) : pose === 'mid' ? px(1, 2, fill) + px(0, 1, fill) : px(0, 0, fill, 1, 2)
  return pose === 'out' ? px(10, 2, fill, 2, 1) : pose === 'mid' ? px(10, 2, fill) + px(11, 1, fill) : px(11, 0, fill, 1, 2)
}
// 按顺序循环的钳子 (每个姿势占 dur / seq.length 秒; 离散切换, 姿势本身清楚)
function armCycle(side: 'L' | 'R', seq: Arm[], dur: number, fill: string): string {
  return [...new Set(seq)].map(p => `<g>${steps('opacity', seq.map(q => (q === p ? '1' : '0')), dur)}${arm(side, p, fill)}</g>`).join('')
}
// 敲钳子 / 敲键盘: 平伸 -> 半举 -> 举起 -> 半举 (300ms 一个来回); 闲着挥手: 12 秒里挥两下, 举起和放下都经过半举
const TAP: Arm[] = ['out', 'mid', 'up', 'mid']
const WAVE: Arm[] = [...Array<Arm>(36).fill('out'), 'mid', 'up', 'up', 'mid', 'out', 'mid', 'up', 'up', 'mid', 'out', 'out', 'out']
// 眨眼 (4.5 秒一次): 半闭 -> 闭 -> 半闭, 每格 75ms
const BLINK = Array.from({ length: 60 }, (_, i) => (i === 58 ? 'shut' : i === 57 || i === 59 ? 'half' : 'open'))
// 跳 (发出消息, 750ms) / 庆祝连跳 (每下 600ms): 整只上下挪的轨迹, 正数往下 (蹲), 负数往上 (离地, 进顶上留出的那一行)
const JUMP_PATH = ['0 1', '0 1', '0 -1', '0 -2', '0 -2', '0 -2', '0 -1', '0 1', '0 0', '0 0', '0 0']
const HOP_PATH = ['0 0', '0 1', '0 -1', '0 -2', '0 -2', '0 -1', '0 1', '0 0']
const HOPS_MS = 1200 // 连跳两下

// tile: 客户端里给螃蟹配一块和仪表盘同色同高的深色底板, 也挡住小窗框可能的白底
// 子代理小螃蟹: 客户端可以用细像素, 画一只 6x5 的正面小螃蟹 (终端版只有 3 列宽, 画不了这么细)
//   C = 钳子和身体 (浅一号的橙色, 和大螃蟹分得开), E = 眼睛 (深色, 四周都是身体), L = 腿; 腿两帧交替 = 在走
//   1-2 只: 每个细像素 0.5 单位 (整只 3 x 2.5); 3 只: 0.4 单位 (整只 2.4 x 2), 竖着排在右侧 x 13-16
const KID_BODY = ['C....C', 'CC..CC', 'CECCEC', '.CCCC.']
const KID_LEGS = ['L.LL.L', '.L..L.']
function kidSvg(x: number, y: number, u: number, phase: number, hop: string[] | null): string {
  const paint = (rows: string[], y0: number) => {
    let out = ''
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx]
        const fill = ch === 'C' ? C.kid : ch === 'E' ? C.eye : ch === 'L' ? C.kidLeg : ''
        if (fill) out += `<rect x="${+(x + dx * u).toFixed(2)}" y="${+(y + (y0 + dy) * u).toFixed(2)}" width="${u}" height="${u}" fill="${fill}"/>`
      }
    })
    return out
  }
  const a = phase % 2 ? ['0', '1'] : ['1', '0']
  const b = a.map(v => (v === '1' ? '0' : '1'))
  const legs = `<g>${steps('opacity', a, 0.5)}${paint([KID_LEGS[0]], 4)}</g><g>${steps('opacity', b, 0.5)}${paint([KID_LEGS[1]], 4)}</g>`
  return `<g class="kid">${hop ? glideMove([...hop, hop[0] ?? '0 0'], 1, { begin: -phase * 0.17 }) : ''}${paint(KID_BODY, 0)}${legs}</g>`
}

export function crabSvg(st: CrabState, scale = 6, tile?: { w: number; h: number }): string {
  // 身体色用 currentColor: 整只螃蟹 (身体、钳子、腿) 跟着外层 <g color> 一起变 (渐渐变红 / 一明一暗)
  const color = st.heat === 'ok' ? C.body : C.hot
  const body = 'currentColor'
  let colorAnim = ''
  if (st.heat === 'crit') colorAnim = glide('color', [C.hot, C.body, C.hot], 0.6) // 上下文 >=95%: 平滑地一明一暗
  else if (st.heatFrom && st.heatMs !== undefined && st.heatMs < 1000) {
    const from = st.heatFrom === 'ok' ? C.body : C.hot
    if (from !== color) colorAnim = `<animate attributeName="color" from="${from}" to="${color}" dur="1s" begin="${sec(-st.heatMs / 1000)}s" fill="freeze"/>`
  }
  const parts: string[] = []
  const fx: string[] = []
  const mood = st.mood ?? 'normal'
  const working = st.mode === 'work'
  const nKids = Math.min(3, Math.max(0, st.agents))
  const zoneFree = nKids === 0 // 右侧有子代理时让给小螃蟹 (和终端版同一套规则)
  // 闲置 (或睡着) 时慌张: 双钳举起 + 左右发抖, 睡着的也叫醒
  const panicIdle = mood === 'panic' && (st.mode === 'idle' || st.mode === 'sleep')
  const mode: CrabMode = panicIdle ? 'idle' : st.mode
  const chill = mood === 'chill' && mode === 'idle'
  const look = working && st.kind !== 'bash' && st.kind !== 'agent' ? 1 : 0

  parts.push(px(2, 0, body, 8, 4))

  // 钳子 (都经过半举)
  if (mode === 'celebrate') parts.push(arm('L', 'up', body), arm('R', 'up', body))
  // 闲着时慌张 (v0.22 甩汗): 两只钳子轮流挥, 一只举起一只半举, 每 150ms 换
  else if (panicIdle) parts.push(armCycle('L', ['up', 'mid'], 0.3, body), armCycle('R', ['mid', 'up'], 0.3, body))
  else if (working && st.kind === 'bash') parts.push(armCycle('L', ['up', 'mid', 'out', 'mid'], 0.3, body), armCycle('R', TAP, 0.3, body))
  else if (working && st.kind === 'edit') parts.push(arm('L', 'out', body), armCycle('R', TAP, 0.3, body))
  else if (mode === 'idle') parts.push(arm('L', 'out', body), armCycle('R', WAVE, 12, body))
  else parts.push(arm('L', 'out', body), arm('R', 'out', body))

  // 腿: 走路时两对腿交替抬起
  const legsA = px(2, 4, body) + px(7, 4, body)
  const legsB = px(4, 4, body) + px(9, 4, body)
  if (working || panicIdle) parts.push(`<g>${steps('opacity', ['1', '1', '1', '0'], panicIdle ? 0.4 : 0.8)}${legsA}</g><g>${steps('opacity', ['1', '0', '1', '1'], panicIdle ? 0.4 : 0.8)}${legsB}</g>`)
  else parts.push(legsA + legsB)

  // 眼睛: 睡觉闭眼; 其余时候会眨眼 (半闭 -> 闭 -> 半闭), 闲置时左右张望
  const eyes = (fill: string) => px(4 + look, 1, fill) + px(7 + look, 1, fill)
  if (mode === 'sleep') parts.push(eyes(C.eyeShut))
  else if (chill) {
    // 悠闲: 戴墨镜, 不眨眼不张望
    parts.push(px(3, 1, C.shades, 2, 1), px(5, 1, C.bridge, 2, 1), px(7, 1, C.shades, 2, 1))
  } else {
    const glance = mode === 'idle' && !panicIdle ? moves(['0 0', '0 0', '0 0', '0 0', '-1 0', '1 0', '0 0', '0 0'], 16) : ''
    const fills: Record<string, string> = { open: C.eye, half: C.eyeHalf, shut: C.eyeShut }
    const shown = ['open', 'half', 'shut'].map(k => `<g>${steps('opacity', BLINK.map(b => (b === k ? '1' : '0')), 4.5)}${eyes(fills[k] ?? C.eye)}</g>`)
    parts.push(`<g>${glance}${shown.join('')}</g>`)
  }

  // 头边汗珠 (平滑地往下掉、慢慢变淡): 上下文告急, 或额度 冒汗 / 慌张
  //   闲着时慌张不画在头边 (会夹在挥起的钳子旁边): 改成从头顶两侧往外上方甩进顶上那一行, 每 600ms 一次
  if (panicIdle) {
    const fling = (xs: string[]) =>
      `<rect width="1" height="1" fill="${C.sweat}">${steps('x', xs, 0.6)}${steps('y', ['-1', '-2', '-2', '-2', '-2', '-2', '-2', '-2'], 0.6)}${steps('opacity', ['1', '1', '1', '0', '0', '0', '0', '0'], 0.6)}</rect>`
    fx.push(fling(['2', '1', '0', '0', '0', '0', '0', '0']), fling(['9', '10', '11', '11', '11', '11', '11', '11']))
  } else if ((st.heat !== 'ok' || mood === 'sweat' || mood === 'panic') && mode !== 'celebrate')
    fx.push(`<rect x="1" y="0" width="1" height="1" fill="${C.sweat}">${glide('y', ['0', '2'], 0.9, { linear: true })}${glide('opacity', ['1', '1', '0'], 0.9, { linear: true })}</rect>`)
  // 慌张的 "!": 闲置且右侧空着 -> 右侧竖一个大 "!"; 否则头顶上方一个红点闪
  if (mood === 'panic' && mode !== 'celebrate') {
    if (panicIdle && zoneFree) fx.push(`<g>${steps('opacity', ['1', '0.35'], 0.5)}${px(14, -1, C.alarm, 1, 3)}${px(14, 3, C.alarm)}</g>`)
    else fx.push(`<rect x="1" y="-1" width="1" height="1" fill="${C.alarm}">${steps('opacity', ['1', '0'], 0.5)}</rect>`)
  }

  // 右边 3 像素宽的道具区 (x 13-15); 有子代理时让给小螃蟹. 移动的东西 (扫描线、地球、齿轮、泡泡) 平滑地滑
  if (mode === 'celebrate') {
    const spots: Array<[number, number]> = [[13, 0], [15, 1], [14, 3], [13, 6], [15, 5], [1, 0], [10, 0]]
    spots.forEach(([x, y], i) => {
      if (zoneFree || x < 13) fx.push(`<rect x="${x}" y="${y - 1}" width="1" height="1" fill="${C.spark}">${glide('opacity', ['1', '0', '1'], 0.6, { begin: -i * 0.2 })}</rect>`)
    })
  } else if (!zoneFree) {
    // 道具 / 泡泡让位
  } else if (mode === 'sleep') {
    fx.push(`<rect x="14" y="5" width="1" height="1" fill="${C.bubble}">${glide('y', ['5', '0'], 2.4, { linear: true })}</rect>`)
    fx.push(`<rect x="15" y="5" width="1" height="1" fill="${C.bubble}">${glide('y', ['5', '0'], 2.4, { linear: true, begin: -1.2 })}</rect>`)
  } else if (working) {
    switch (st.kind) {
      case 'think':
        fx.push(`<rect x="13" y="4" width="1" height="1" fill="${C.bubble}">${glide('opacity', ['0', '1', '1', '1'], 1.6, { linear: true })}</rect>`)
        fx.push(`<rect x="14" y="2" width="1" height="1" fill="${C.bubble}">${glide('opacity', ['0', '0', '1', '1'], 1.6, { linear: true })}</rect>`)
        fx.push(`<rect x="15" y="0" width="1" height="1" fill="${C.bubble}">${glide('opacity', ['0', '0', '0', '1'], 1.6, { linear: true })}</rect>`)
        break
      case 'read':
        fx.push(px(13, 0, C.paper, 3, 4), `<rect x="13" y="0" width="3" height="1" fill="${C.scan}">${glide('y', ['0', '3'], 1.2, { linear: true })}</rect>`)
        break
      case 'edit': {
        fx.push(px(13, 0, C.paper, 3, 4))
        for (let i = 0; i < 12; i++) {
          const on = Array.from({ length: 13 }, (_, k) => (k > i ? '1' : '0'))
          fx.push(`<rect x="${13 + (i % 3)}" y="${Math.floor(i / 3)}" width="1" height="1" fill="${C.ink}">${steps('opacity', on, 2.6)}</rect>`)
        }
        break
      }
      case 'bash':
        fx.push(px(13, 0, C.term, 3, 4), px(13, 1, C.cursor), `<rect x="14" y="3" width="1" height="1" fill="${C.cursor}">${steps('opacity', ['1', '0'], 0.8)}</rect>`)
        break
      case 'web':
        fx.push(px(14, 0, C.sea), px(15, 1, C.sea), px(14, 2, C.sea), px(13, 1, C.sea), px(14, 1, C.sea))
        fx.push(`<rect width="1" height="1" fill="${C.land}">${glide('x', ['14', '15', '14', '13', '14'], 1.2, { linear: true })}${glide('y', ['0', '1', '2', '1', '0'], 1.2, { linear: true })}</rect>`)
        break
      case 'agent':
        break
      default: {
        fx.push(px(14, 1, C.gear))
        const orbit: Array<[number, number]> = [[13, 0], [14, 0], [15, 0], [15, 1], [15, 2], [14, 2], [13, 2], [13, 1], [13, 0]]
        fx.push(`<rect width="1" height="1" fill="${C.gear}">${glide('x', orbit.map(o => String(o[0])), 1.2, { linear: true })}${glide('y', orbit.map(o => String(o[1])), 1.2, { linear: true })}</rect>`)
      }
    }
  }
  // 子代理小螃蟹: 任何状态下都画, 盖在最上面; 1 只上下跳着走, 2-3 只排成一列走
  if (nKids === 1) fx.push(kidSvg(13, 1.5, 0.5, 0, ['0 0', '0 -0.5', '0 0', '0 0.5']))
  else if (nKids === 2) fx.push(kidSvg(13, -0.5, 0.5, 0, ['0 0', '0 0.5']), kidSvg(13, 2.75, 0.5, 1, ['0 0', '0 0.5']))
  else if (nKids >= 3) for (let i = 0; i < 3; i++) fx.push(kidSvg(13.3, -0.9 + i * 2.3, 0.4, i, null))

  // 整只上下挪 (平滑): 走路时颠; 睡觉时慢慢呼吸 (2 秒一下); 庆祝时先连跳两下 (真的离地, 进顶上那一行), 再原地颠
  let bob = ''
  if (working) bob = glideMove(['0 0', '0 1', '0 0'], 0.4)
  else if (mode === 'sleep') bob = glideMove(['0 0', '0 1', '0 0'], 4)
  else if (mode === 'celebrate') {
    const c = Math.max(0, st.celebMs ?? 0)
    if (c < HOPS_MS) bob += glideMove([...HOP_PATH, ...HOP_PATH.slice(1)], HOPS_MS / 1000, { begin: -c / 1000, once: true })
    bob += glideMove(['0 0', '0 -1', '0 0'], 0.4, { begin: Math.max(0, HOPS_MS - c) / 1000 })
  }
  // 发出消息那一跳 (蹲 -> 跳起 -> 最高 -> 落下 -> 落地 -> 站好), 叠在外层, 和走路的颠一起
  const jump = st.jumpMs !== undefined && st.jumpMs >= 0 && st.jumpMs < 750 ? glideMove(JUMP_PATH, 0.75, { begin: -st.jumpMs / 1000, once: true }) : ''
  const crab = `<g>${bob}${parts.join('')}</g>`
  const W = 16
  const H = 8 // 第 -2..-1 行留给跳 (和闪光 / "!"), 第 0-4 行是螃蟹, 第 5 行给往下颠
  const art = `<g color="${color}">${colorAnim}${jump ? `<g>${jump}${crab}</g>` : crab}${fx.join('')}</g>`
  // color-scheme: 让小窗框跟随客户端的深/浅色主题, 不再垫白底
  const cs = ` style="color-scheme:light dark;background:transparent"`
  if (!tile) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 -2 ${W} ${H}" shape-rendering="crispEdges"${cs}>${art}</svg>`
  }
  const ox = (tile.w - W * scale) / 2
  const oy = (tile.h - H * scale) / 2 + 2 * scale // viewBox 从 y=-2 开始, 往下补两格
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}" viewBox="0 0 ${tile.w} ${tile.h}"${cs}>` +
    `<rect x="0.5" y="0.5" width="${tile.w - 1}" height="${tile.h - 1}" rx="10" fill="${T.panel}" stroke="${T.border}"/>` +
    `<g transform="translate(${ox} ${oy}) scale(${scale})" shape-rendering="crispEdges">${art}</g></svg>`
  )
}

// ---------------- 仪表盘 ----------------
// 估算文字宽度 (px): 中文按 1 个字号, 西文按 0.56 个字号
export function textW(s: string, size: number): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x2e80) w += size
    else if (ch === ' ') w += size * 0.3
    else if (/[A-Z0-9%$]/.test(ch)) w += size * 0.62
    else w += size * 0.52
  }
  return w
}
function heat(t: number): string {
  const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k))
  const g = [74, 222, 128]
  const y = [251, 191, 36]
  const r = [248, 113, 113]
  const c = t < 0.6 ? lerp(g, y, t / 0.6) : lerp(y, r, Math.min(1, (t - 0.6) / 0.4))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

const FONT = `'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI','PingFang SC','Noto Sans CJK SC',sans-serif`
// 直接画在客户端的深灰卡片上: 不再自带底板和边框 (panel/border 只给可选的螃蟹底板用)
const T = { value: '#e6e6e8', muted: '#8e8e96', sep: '#5c5c63', accent: '#e08a68', violet: '#b49cfc', track: '#3a3a40', panel: '#17171a', border: '#2a2a2f' }

function text(x: number, y: number, s: string, fill: string, size = 13, weight = 400, extra = ''): string {
  return `<text x="${x.toFixed(1)}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}"${extra}>${esc(s)}</text>`
}

// 一段连续的文字: 各段由浏览器自己排, 不用估宽度, 也就不会叠在一起
// anchor='end' 时整段右对齐到 x (用于最右一列, 让三行的右边缘对齐)
type Run = [string, string, number?, number?] | null // 文字, 颜色, 字重, 字号
function flow(x: number, y: number, runs: Run[], size = 13, anchor: 'start' | 'end' = 'start'): string {
  const spans = runs
    .filter((r): r is [string, string, number?, number?] => !!r && r[0] !== '')
    .map(([s, fill, w, fs]) => `<tspan fill="${fill}"${w ? ` font-weight="${w}"` : ''}${fs ? ` font-size="${fs}"` : ''}>${esc(s)}</tspan>`)
    .join('')
  return `<text x="${x.toFixed(1)}" y="${y}" font-size="${size}" text-anchor="${anchor}" xml:space="preserve" style="white-space:pre">${spans}</text>`
}
const SEP: Run = ['  ·  ', T.sep]

// "2h12m" -> "2h", "1d18h" -> "1d", "240k / 1.0M" -> "240k"; 会用完的说明缩短时留着 "用完": "4d12h 用完" -> "4d 用完"
// (只剩一个时间会被看成重置倒计时); 旧写法 "约 40m 后用完" / "2h12m 后重置" 也认; 英文 "out 4d12h" -> "out 4d"
function shortExtra(s: string): string {
  const t = s.replace(/^约\s*/, '').trim()
  const out = t.match(/^(\S+?)\s*后?用完$/)
  if (out) return coarseDur(out[1]) + ' 用完'
  const outEn = t.match(/^out\s+(\S+)$/)
  if (outEn) return 'out ' + coarseDur(outEn[1] ?? '')
  return coarseDur(t.replace(/\s*后?重置$/, '').split('/')[0].trim())
}
function coarseDur(t: string): string {
  const hm = t.match(/^(\d+)h\d+m$/)
  if (hm) return hm[1] + 'h'
  const dh = t.match(/^(\d+)d\d+h$/)
  if (dh) return dh[1] + 'd'
  return t
}

// 一根用量条, 正好撑满一列: 标签贴列的左边, 百分比和说明贴列的右边, 中间的细条吃掉剩下的宽度
// 说明按这一列的宽度给全文 / 缩写 / 不给; id 带尺寸前缀, 同一页面有几张图时不会互相引用错
function meterSvg(id: string, x0: number, y: number, cw: number, label: string, m: Meter, labelW = 0): string {
  // labelW: 固定的标签宽度, 让细条和上下两行的值从同一个位置开始 (和终端版一样)
  const lw = labelW || textW(label, 12) + 8
  const p = m.pct === undefined ? 0 : Math.max(0, Math.min(100, m.pct)) / 100
  const pctText = m.pct === undefined ? '--' : Math.round(m.pct) + '%'
  // 右边那段 (百分比 + 说明) 的估计宽度, 留一点余量, 防止压到细条
  const tail = (e: string) => (textW(pctText, 12.5) + (e ? 6 + textW(e, 11) : 0)) * 1.08 + 4
  const options = m.extra ? [m.extra, shortExtra(m.extra), ''] : ['']
  const extra = options.find(e => cw - lw - tail(e) - 10 >= 40) ?? ''
  const bx = x0 + lw
  const bw = Math.max(16, cw - lw - tail(extra) - 10)
  const out = [text(x0, y, label, T.muted, 12), `<rect x="${bx.toFixed(1)}" y="${y - 6}" width="${bw.toFixed(1)}" height="5" rx="2.5" fill="${T.track}"/>`]
  if (p > 0) {
    out.push(
      `<linearGradient id="g${id}" gradientUnits="userSpaceOnUse" x1="${bx.toFixed(1)}" y1="0" x2="${(bx + bw).toFixed(1)}" y2="0"><stop offset="0" stop-color="${heat(0)}"/><stop offset="0.6" stop-color="${heat(0.6)}"/><stop offset="1" stop-color="${heat(1)}"/></linearGradient>`,
      `<rect x="${bx.toFixed(1)}" y="${y - 6}" width="${Math.max(5, bw * p).toFixed(1)}" height="5" rx="2.5" fill="url(#g${id})"/>`,
    )
  }
  // 时间刻度: 1.5 像素宽的亮色细竖线, 上下各比条高出 1.5 像素, 夹在条的两端之内
  if (m.tick !== undefined && isFinite(m.tick)) {
    const tw = 1.5
    const tx = Math.max(bx, Math.min(bx + bw - tw, bx + bw * Math.max(0, Math.min(1, m.tick)) - tw / 2))
    out.push(`<rect class="tick" x="${tx.toFixed(1)}" y="${y - 7.5}" width="${tw}" height="8" fill="${C.tick}"/>`)
  }
  // 会用完: 百分比和说明都画成红色
  const pctFill = m.pct === undefined ? T.muted : m.warn ? C.warn : heat(p)
  out.push(flow(x0 + cw, y, [[pctText, pctFill, 700, 12.5], extra ? ['  ' + extra, m.warn ? C.warn : T.muted, m.warn ? 700 : 0, 11] : null], 12.5, 'end'))
  return out.join('')
}

// 和终端版同一种排法: 3 行 x 3 列, 每列的标签在同一条竖线上, 值和用量条都从标签后同一个位置开始
//   模型   Opus 5.5 ▁▂▄ medium    项目   my-app main           本会话 1h19m  $64.93
//   上下文 ━━━━━━━━━━ 34% 340k    5小时  ━━━━━━━━━ 34% 1h52m    本周   ━━━━━━━━━ 48% 1d18h
//   状态   ✓ 待命                 工具   Bash 12  Read 4       token  79.7M  out 212k
// 用量条撑满所在列, 第三列的条正好到右边缘; 一列放不下的文字在右端渐隐, 不会压到旁边一列
export function dashSvg(d: DashData, opts: { width?: number; compact?: boolean } = {}): string {
  const W = Math.round(opts.width ?? 640)
  const uid = `uhud${W}${opts.compact ? 'c' : 'f'}`
  const lh = 22
  const y = (i: number) => 15 + i * lh
  const H = opts.compact ? 22 : lh * 3
  const gap = 24
  const cw = (W - gap * 2) / 3
  const cx = [0, cw + gap, (cw + gap) * 2]
  const L = S().label
  // 标签列宽: 最宽的标签 + 间距 (中文三个汉字 = 52, 英文 "Context" / "Session" 也差不多)
  const LW = opts.compact ? 0 : Math.max(52, Math.ceil(Math.max(...Object.values(L).map(t => textW(t, 12)))) + 16)
  const meters = (row: number) =>
    meterSvg(uid + 'a', cx[0], y(row), cw, L.context, d.ctx, LW) +
    meterSvg(uid + 'b', cx[1], y(row), cw, L.h5, d.five, LW) +
    meterSvg(uid + 'c', cx[2], y(row), cw, L.week, d.week, LW)

  // 每列一个遮罩: 在列的右端渐隐
  const fade = 18 / cw
  const defs = [0, 1, 2]
    .map(
      c =>
        `<linearGradient id="${uid}f${c}" gradientUnits="userSpaceOnUse" x1="${cx[c].toFixed(1)}" y1="0" x2="${(cx[c] + cw).toFixed(1)}" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="${(1 - fade).toFixed(3)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
        `<mask id="${uid}m${c}" maskUnits="userSpaceOnUse" x="${cx[c].toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${H}"><rect x="${cx[c].toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${H}" fill="url(#${uid}f${c})"/></mask>`,
    )
    .join('')
  // 一格: 标签 + 从标签后开始的值
  const cell = (c: number, row: number, label: string, runs: Run[]) =>
    `<g mask="url(#${uid}m${c})">${text(cx[c], y(row), label, T.muted, 12)}${flow(cx[c] + LW, y(row), runs)}</g>`

  let body = ''
  if (opts.compact) {
    body = meters(0)
  } else {
    const effortIdx = EFFORTS.indexOf(d.effort)
    const effortColor = EFFORT_COLOR[d.effort] ?? T.muted
    const pips: Run[] = '▁▂▄▆█'.split('').map((ch, k) => [ch, k <= effortIdx ? effortColor : T.track])
    const tone = d.status.tone === 'work' ? T.accent : d.status.tone === 'agents' ? T.violet : T.muted
    // 第 1 行: 模型 | 项目 | 本会话
    body += cell(0, 0, L.model, [[d.model, T.accent, 600], [' ', T.sep], ...pips, [' ' + (d.effort || '--'), effortColor, 600]])
    body += cell(1, 0, L.project, [[d.project, T.value, 600], d.branch ? ['  ' + d.branch, T.violet] : null])
    body += cell(2, 0, L.session, [[d.session, T.value, 600], d.cost ? ['   ' + d.cost, T.muted] : null])
    // 第 2 行: 三根用量条
    body += meters(1)
    // 第 3 行: 状态 | 工具 | token
    body += cell(0, 2, L.status, [d.status.tone === 'idle' ? null : ['● ', tone], [d.status.text, tone, d.status.tone === 'idle' ? 0 : 600]])
    body += cell(1, 2, L.tools, [[d.tools || S().noTools, d.tools ? T.value : T.muted]])
    body += cell(2, 2, L.token, [[d.tokenTotal, T.value, 600], d.tokenOutput ? ['   out ', T.muted] : null, d.tokenOutput ? [d.tokenOutput, T.value] : null])
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" style="color-scheme:light dark">` +
    `<defs>${defs}</defs>${body}</svg>`
  )
}
