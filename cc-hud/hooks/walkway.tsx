// cc-hud: 螃蟹散步道 (v0.16 起是一个 Client 模块, 跑在终端的绘制线程上)
//
// hooks (register.tsx) 只把处境当 props 传进来: 忙不忙、心情、当前工具、上下文 %、运行中的子代理、事件气泡、
//   打字 / 发送 / 庆祝的序号、多久没动静了、悬停时的用量摘要和小贴士; 以及宽度、行数、有没有天空行
// 模块自己用帧钟 (surface.every, 75ms 一帧; v0.19 起走路半格一步) 推进: 走路、排队、粒子、气泡几秒后消失、5 分钟睡着、工具刚结束再撑 4 帧
//   (v1.4.1: 戴着睡帽睡熟以后每 6 帧才画一次, 中间的帧照样算; 一有动静马上回到每帧画)
// 鼠标停在大螃蟹上 (只有全屏模式有指针事件): 大螃蟹立刻停下举钳, 队伍也停; 气泡在停下那一刻定好位置和全文;
//   指针离开约 0.5 秒后接着走; 指针在横栏别处时, 闲着的螃蟹眼睛看过去. 点击不做任何事 (点一下 Client 会拿走键盘焦点)
// 终端的 Client 里没有 Raster: 半格像素画成 Text (上像素当 color, 下像素当 backgroundColor), 同色的连续格子合成一段
//   像素本身 (大螃蟹 / 小螃蟹 / 粒子) 和以前一样由 sprites.ts 生成

import {
  LANE_MS,
  laneFrames,
  SAY_FRAMES,
  TYPE_FRAMES,
  newToolTrack,
  trackTool,
  toolAct,
  DEF,
  DIM,
  VALUE,
  newLane,
  laneFit,
  laneStep,
  lanePose,
  napOf,
  lanePx,
  laneCells,
  bubbleSpot,
  captionOf,
  tipFit,
  isWide,
  type Lane,
  type LaneAct,
  type Mood,
  type ToolKind,
  type ToolTrack,
  type Rows,
} from './sprites'

export type WalkProps = {
  w: number // 宽度 (格)
  rows: Rows // 螃蟹区几行 (不含天空行)
  sky: boolean // 最上面有没有天空行
  working: boolean // 主会话一轮在跑
  agents: string[] // 运行中的子代理 (按开始时间)
  mood: Mood
  pct: number // 上下文 %
  tool: ToolKind | '' // 主会话正在用的工具 ('' = 没有: 在想 / 在回复)
  toolSeq: number // v1.4: 主会话第几次工具调用 (变了 = 新的一次, 两次之间没空档也认得出)
  toolEnd: { seq: number; ok: boolean; link?: string; hits?: number } // v1.4: 最近结束的那次调用和成没成功 (收尾: 跑完变绿之类); 搜索还带第一条结果和条数
  toolArg: string // v1.4: 最近一次工具的主要参数 (抓网页的网址、搜索词), 写在天空行
  searchWord: string // v1.4: 搜索词前面那个字 (界面语言)
  typeSeq: number // 打字的序号 (变了 = 刚按了键)
  jumpSeq: number // 发出消息的序号
  celebSeq: number // 一轮结束的序号
  celebFrames: number // 这次庆祝多少帧
  say?: { seq: number; text: string; color: string } // 最近一条事件气泡
  idleMs: number // 多久没动静了 (hooks 记的)
  tip: { v: string[]; tipMin: number } // 悬停气泡: 从长到短 4 种写法 + 小贴士最少要留的宽度
}

type St = {
  L: Lane
  f: number // 帧号
  typeSeq: number
  typeUntil: number // 打字低头到哪一帧
  jumpSeq: number
  jumpAt: number // 跳的那一帧
  celebSeq: number
  celebUntil: number
  saySeq: number
  sayUntil: number // 事件气泡显示到哪一帧
  lastBusyF: number // 最后一次有动静的帧 (5 分钟 = 2000 帧没动静就睡)
  track: ToolTrack // 这次工具调用的进度 (开始 / 结束 / 成没成功; 结束后再撑 TOOL_HOLD_FRAMES)
  hover: boolean // 指针正停在大螃蟹上
  holdUntil: number // 指针离开后再停到哪一帧
  spot?: { x: number; text: string } // 悬停气泡 (停下那一刻定好的位置和全文)
  ptrX?: number // 指针在横栏里的列 (不在就 undefined)
  sig: string // 上一次画出来的样子 (没变就不重画)
}

const SLEEP_FRAMES = laneFrames(5 * 60_000)
const HOLD_FRAMES = laneFrames(450) // 指针离开后约 0.5 秒接着走
const live = new WeakMap<object, WalkProps>() // 帧钟回调里拿最新的 props (回调是第一次画的时候建的)

const hexOf = (c: number) => (c === DEF || c < 0 ? undefined : '#' + c.toString(16).padStart(6, '0'))

function actOf(st: St, p: WalkProps): LaneAct {
  const hold = st.hover || st.f < st.holdUntil
  return {
    working: p.working,
    agents: p.agents.length,
    typing: st.f < st.typeUntil,
    celebrating: st.f < st.celebUntil,
    sleeping: st.f - st.lastBusyF > SLEEP_FRAMES,
    idleF: st.f - st.lastBusyF,
    jumpAge: st.f - st.jumpAt,
    md: p.mood,
    ...toolAct(st.track, st.f),
    arg: p.toolArg,
    word: p.searchWord,
    ...(p.toolEnd.seq === st.track.seq && p.toolEnd.link ? { link: p.toolEnd.link } : {}),
    ...(p.toolEnd.seq === st.track.seq && p.toolEnd.hits !== undefined ? { hits: p.toolEnd.hits } : {}),
    hold,
    lookAt: hold ? undefined : st.ptrX,
    pct: p.pct,
  }
}

type Cell = { ch: string; fg?: string; bg?: string }
// 这一帧的样子: 每行一串格子 (含天空行、事件气泡、+N、悬停气泡)
function view(st: St, p: WalkProps): Cell[][] {
  const L = st.L
  const a = actOf(st, p)
  L.pose = lanePose(L, a)
  const top = L.sky ? 1 : 0
  const total = L.rows + top
  // 半格像素 (宽 2 x 格数), 含天空行 (平时空着; 大螃蟹跳起来时会进去)
  const hp = lanePx(L, st.f, a, p.pct)
  const words = laneCells(hp, L.w, total, L.pt, top * 4)
  const grid: Cell[][] = []
  for (let r = 0; r < total; r++) {
    const row: Cell[] = []
    for (let c = 0; c < L.w; c++) {
      const i = (r * L.w + c) * 3
      const cp = words[i]
      row.push(cp === 32 ? { ch: ' ' } : { ch: String.fromCodePoint(cp), fg: hexOf(words[i + 1]), bg: hexOf(words[i + 2]) })
    }
    grid.push(row)
  }
  // 盖在像素上面的字: 放不下的子代理 +N (最下面一行左端) / 事件气泡 / 悬停气泡 (都在螃蟹区第一行, 不进天空行)
  const write = (r: number, x0: number, text: string, color: string) => {
    let x = x0
    for (const ch of text) {
      const w = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
      if (x < 0 || x + w > L.w) break
      grid[r][x] = { ch, fg: color }
      if (w === 2) grid[r][x + 1] = { ch: '' }
      x += w
    }
  }
  if (L.hidden) write(total - 1, 0, '+' + L.hidden, DIM)
  // v1.4 天空行的字 (网址 / 搜索词 / 结果链接); 右边摆着大道具时气泡放左边
  const caps = captionOf(L, a)
  for (const c of caps) write(0, c.x, c.text, hexOf(c.color) ?? VALUE)
  const wide = L.pose === 'tool' && (a.tool === 'fetch' || a.tool === 'search')
  if (p.say && st.f < st.sayUntil && !(a.hold && st.spot)) {
    const s = bubbleSpot(L, p.say.text, wide)
    if (s) write(top, s.x, s.text, p.say.color)
  }
  if (a.hold && st.spot) write(top, st.spot.x, st.spot.text, VALUE)
  return grid
}

// 一行格子 -> 同色连续的几段 Text
// (Client 的一棵树最多 20,000 个节点: 最坏每格一段, 512 宽 x 4 行也只有约 2,050 个, 离上限很远)
function segments(row: Cell[]): Cell[] {
  const out: Cell[] = []
  for (const c of row) {
    const last = out[out.length - 1]
    if (c.ch === '') {
      if (last) last.ch += ''
      continue
    }
    if (last && last.fg === c.fg && last.bg === c.bg) last.ch += c.ch
    else out.push({ ...c })
  }
  return out
}

function start(p: WalkProps): St {
  return {
    L: newLane(p.w, p.rows, p.sky),
    f: 0,
    typeSeq: p.typeSeq,
    typeUntil: -1,
    jumpSeq: p.jumpSeq,
    jumpAt: -999,
    celebSeq: p.celebSeq,
    celebUntil: -1,
    saySeq: p.say?.seq ?? 0,
    sayUntil: -1,
    lastBusyF: -Math.round(p.idleMs / LANE_MS),
    track: newToolTrack(),
    hover: false,
    holdUntil: -1,
    sig: '',
  }
}

// v1.4.1 睡熟了 (戴着睡帽睡、没有气泡、鼠标不在、没有子代理): 每 NAP_EVERY 帧才画一次.
//   中间的帧照样一帧帧算 (泡泡、呼吸、偷看的时间不变), 只是少画几次; 一有动静 (新 props、鼠标) 马上回到每帧画
const NAP_EVERY = 6
type Pace = { every: number; stop: () => void; key: string }
const paces = new WeakMap<object, Pace>()
// 新 props 里会叫醒螃蟹的东西 (变了就马上回到每帧画, 不等慢帧钟)
const wakeKey = (p: WalkProps) => [p.typeSeq, p.jumpSeq, p.celebSeq, p.toolSeq, p.toolEnd.seq, p.say?.seq ?? 0, p.working, p.agents.length, p.mood, p.tool].join()

function deepAsleep(st: St, p: WalkProps): boolean {
  if (p.working || p.agents.length || st.hover || st.f < st.holdUntil || st.f < st.sayUntil) return false
  if (st.L.pose !== 'sleep' || st.L.kids.length || st.L.gone.length) return false
  return napOf(st.f - st.lastBusyF)?.stage === 'sleep'
}

// 一帧 (75ms) 的推进: 认新事件、跟工具、走一步; 不画
function advance(st: St, p: WalkProps) {
  st.f += 1
  // 新事件 (按序号认): 打字 -> 低头 1.5 秒; 发送 -> 跳; 一轮结束 -> 庆祝; 新气泡 -> 显示约 5 秒
  if (p.typeSeq !== st.typeSeq) {
    st.typeSeq = p.typeSeq
    st.typeUntil = st.f + TYPE_FRAMES
    st.lastBusyF = st.f
  }
  if (p.jumpSeq !== st.jumpSeq) {
    st.jumpSeq = p.jumpSeq
    st.jumpAt = st.f
    st.lastBusyF = st.f
  }
  if (p.celebSeq !== st.celebSeq) {
    st.celebSeq = p.celebSeq
    st.celebUntil = st.f + p.celebFrames
  }
  if (p.say && p.say.seq !== st.saySeq) {
    st.saySeq = p.say.seq
    st.sayUntil = st.f + SAY_FRAMES
  }
  if (p.working || p.agents.length) st.lastBusyF = st.f
  trackTool(st.track, st.f, p.tool, p.toolSeq, p.toolEnd.seq === p.toolSeq ? p.toolEnd.ok : true)
  if (!st.hover && st.f >= st.holdUntil) st.spot = undefined
  laneFit(st.L, p.w, p.rows, p.sky)
  laneStep(st.L, st.f, st.f * LANE_MS, actOf(st, p), p.agents)
}

function tick(surface: any) {
  const st: St = surface.state
  const p = live.get(surface)
  if (!st || !p) return
  const n = paces.get(surface)?.every ?? 1
  for (let i = 0; i < n; i++) advance(st, p)
  // 画面没变就不重画 (闲着、没有子代理、也没有气泡时, 只在眨眼之类的时候画)
  const sig = JSON.stringify(view(st, p).map(segments))
  if (sig !== st.sig) {
    st.sig = sig
    surface.setState({ ...st })
  }
  pace(surface, deepAsleep(st, p) ? NAP_EVERY : 1, wakeKey(p))
}

// 帧钟的快慢: 每 every 帧跳一次 (换快慢时换一个钟)
function pace(surface: any, every: number, key: string) {
  const c = paces.get(surface)
  if (c && c.every === every) {
    c.key = key
    return
  }
  c?.stop()
  paces.set(surface, { every, key, stop: surface.every(LANE_MS * every, () => tick(surface)) })
}

export default function Walkway(props: WalkProps, surface: any) {
  const { Box, Text } = surface.elements
  live.set(surface, props)
  if (surface.state === undefined) {
    surface.setState(start(props))
    pace(surface, 1, wakeKey(props))
    // 鼠标: 停在大螃蟹的格子上 -> 停下举钳 + 气泡; 离开 -> 约 0.5 秒后接着走; 按下 / 松开不理 (不做点击)
    surface.onPointer((e: any) => {
      const st: St = surface.state
      const p = live.get(surface)
      if (!st || !p || e.type === 'down' || e.type === 'up') return
      const L = st.L
      const top = L.sky ? 1 : 0
      if (e.type === 'leave') {
        if (st.hover) st.holdUntil = st.f + HOLD_FRAMES
        st.hover = false
        st.ptrX = undefined
      } else {
        const hit = e.x >= L.bx && e.x < L.bx + L.cw && e.y >= top && e.y < top + L.rows
        if (hit && !st.hover) {
          st.hover = true
          st.lastBusyF = st.f // v1.4: 鼠标停上来 = 你在: 睡着的蹦出来, 再过 4 分钟才打瞌睡
          L.pose = 'greet'
          st.spot = bubbleSpot(L, tipFit(p.tip.v, p.tip.tipMin))
        } else if (!hit && st.hover) {
          st.hover = false
          st.holdUntil = st.f + HOLD_FRAMES
        }
        st.ptrX = e.x
      }
      pace(surface, 1, wakeKey(p)) // v1.4.1: 睡熟时少画的帧钟马上回到每帧
      surface.setState({ ...st })
    })
  } else {
    // v1.4.1: 新 props 带来了动静 (打字、发消息、来活、新气泡、心情变了): 睡熟时少画的帧钟马上回到每帧
    const c = paces.get(surface)
    const key = wakeKey(props)
    if (c && c.every > 1 && c.key !== key) pace(surface, 1, key)
  }
  const st: St = surface.state ?? start(props)
  laneFit(st.L, props.w, props.rows, props.sky)
  const rows = view(st, props).map(segments)
  return (
    <Box key="walk" flexDirection="column" width={props.w} height={rows.length}>
      {rows.map((segs, r) => (
        <Box key={'walk-r' + r} flexDirection="row" height={1}>
          {segs.map(s => (
            <Text color={s.fg} backgroundColor={s.bg}>
              {s.ch}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
