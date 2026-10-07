// 不开客户端, 直接看 cc-hud 客户端面板长什么样 (螃蟹的动画在浏览器里照样会动)
// 用法: node tools/preview-client.mjs   (Node 22.6 起都行: 不能直接跑 .ts 的版本会自己带上 --experimental-strip-types 再跑一次)
// 输出: tools/out/client.html, 用浏览器打开; 卡片底色仿客户端, 宽度算法和 register.tsx 的 buildDesktop 一致
import { mkdirSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 这个 Node 不能直接跑 .ts: 带上 --experimental-strip-types 重新跑自己
if (!process.features?.typescript && !process.execArgv.includes('--experimental-strip-types')) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
// hooks 里的 import 不写扩展名 ('./strings'): 找不到时补上 .ts
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e } }",
    ),
)

const { crabSvg, dashSvg } = await import(new URL('../cc-hud/hooks/desktop.ts', import.meta.url).href)
const enc = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)

const idle = {
  model: 'Opus 5.5',
  effort: 'medium',
  project: 'my-app',
  branch: '',
  session: '1h19m',
  cost: '$64.93',
  ctx: { pct: 34, extra: '340k / 1.0M' },
  five: { pct: 34, extra: '1h52m' },
  week: { pct: 48, extra: '1d18h' },
  status: { text: '✓ Ready', tone: 'idle' },
  tools: '',
  tokenTotal: '0',
  tokenOutput: '0',
}
const busy = {
  ...idle,
  project: 'my-app',
  branch: 'main *2',
  status: { text: 'Reading  +1 subagent', tone: 'work' },
  tools: 'Bash 78  WebFetch 43  Read 34',
  tokenTotal: '345.4M',
  tokenOutput: '717k',
}

// 每种状态一张图 (循环播放的动画会一直动; 跳和连跳只播一次, 刷新页面再看)
function gallery() {
  const cases = [
    ['闲着 (眨眼、挥手)', { mode: 'idle', kind: 'think', heat: 'ok', agents: 0 }],
    ['在想 (走路颠)', { mode: 'work', kind: 'think', heat: 'ok', agents: 0 }],
    ['改文件 (钳子经过半举)', { mode: 'work', kind: 'edit', heat: 'ok', agents: 0 }],
    ['跑命令 (双钳交替)', { mode: 'work', kind: 'bash', heat: 'ok', agents: 0 }],
    ['读文件 (扫描线)', { mode: 'work', kind: 'read', heat: 'ok', agents: 0 }],
    ['上网 (地球转)', { mode: 'work', kind: 'web', heat: 'ok', agents: 0 }],
    ['睡觉 (2 秒一呼吸)', { mode: 'sleep', kind: 'think', heat: 'ok', agents: 0 }],
    ['一轮结束 (连跳两下)', { mode: 'celebrate', kind: 'think', heat: 'ok', agents: 0, celebMs: 0 }],
    ['发出消息 (跳一下)', { mode: 'work', kind: 'think', heat: 'ok', agents: 0, jumpMs: 0 }],
    ['上下文 80% (1 秒变红)', { mode: 'idle', kind: 'think', heat: 'hot', agents: 0, heatFrom: 'ok', heatMs: 0 }],
    ['上下文 95% (一明一暗)', { mode: 'idle', kind: 'think', heat: 'crit', agents: 0 }],
    ['慌张', { mode: 'idle', kind: 'think', heat: 'ok', agents: 0, mood: 'panic' }],
    ['2 个子代理', { mode: 'work', kind: 'think', heat: 'ok', agents: 2 }],
  ]
  return cases
    .map(([label, st]) => `<div style="background:#2b2b2b;border-radius:10px;padding:10px 12px;text-align:center"><img src="${enc(crabSvg(st, 6))}" width="96" height="48" style="display:block;margin:auto"><div style="margin-top:6px;font-size:12px">${label}</div></div>`)
    .join('')
}

function card(cols, data, crabState) {
  const crabW = 80
  const est = Math.round(cols * 7.35) - crabW - 15
  const dashW = Math.max(340, Math.min(1040, Math.round(est * 1.05) + 20))
  const compact = est < 380
  const crab = crabSvg(crabState, compact ? 3 : 5)
  const cw = compact ? 48 : 80
  const ch = compact ? 24 : 40
  const contentW = Math.round(cols * 7.35)
  return `<div style="width:${contentW}px;background:#2b2b2b;border-radius:14px;padding:16px 18px;margin:10px 0">
  <div style="display:flex;align-items:center;gap:15px">
    <div style="flex:0 0 auto"><img src="${enc(crab)}" width="${cw}" height="${ch}" style="display:block"></div>
    <div style="flex:1 1 auto;min-width:0;overflow:hidden"><img src="${enc(dashSvg(data, { compact, width: dashW }))}" style="max-width:100%;display:block"></div>
  </div></div>
  <div style="width:${contentW}px;border:1px solid #444;border-radius:12px;padding:10px 14px;color:#777;margin-bottom:22px;font:14px Segoe UI,Microsoft YaHei UI">(输入框)</div>`
}

const html = `<!doctype html><html style="color-scheme:dark"><meta charset="utf-8"><title>cc-hud 客户端预览</title>
<body style="margin:0;padding:14px;background:#1f1f1e;color:#bbb;font:13px Segoe UI,Microsoft YaHei UI">
<div>窄窗口 (81 格 ≈ 596px) — 闲置</div>${card(81, idle, { mode: 'idle', kind: 'think', heat: 'ok', agents: 0 })}
<div>宽窗口 (120 格 ≈ 880px) — 工作中</div>${card(120, busy, { mode: 'work', kind: 'read', heat: 'ok', agents: 1 })}
<div>很窄 (55 格) — 自动只放一行</div>${card(55, idle, { mode: 'idle', kind: 'think', heat: 'ok', agents: 0 })}
<div style="margin-top:18px">螃蟹的各种动作 (v0.21: 平滑移动、半举的钳子、半闭眨眼、真的跳; 每格是一张会动的图)</div>
<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px">${gallery()}</div>
</body></html>`
const out = new URL('./out/', import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL('client.html', out), html)
console.log('已生成 ' + new URL('client.html', out).pathname)
