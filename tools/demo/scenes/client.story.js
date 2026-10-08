// 客户端 (桌面 App) 版动图的剧本 (录制器 record.mjs 和场景页 client.html 共用, 时间单位: 秒)
// 点 Settings 看三个下拉框 -> 发消息 (跳一下) -> 干活 -> 派出 2 个子代理 (SVG 小螃蟹) -> 用量配速变快, 冒汗 + 红字 "40m 用完"
//   -> 一轮做完连跳两下 -> 上下文 86%: Handoff 变成主按钮 -> 点它: 正在写交接… -> 存好了 (客户端还不能复制) + "打开交接文件"
// 螃蟹、仪表盘 (SVG) 和工具栏 (原生按钮 / 下拉框) 都是录制器用真代码 (buildDesktop) 录下来的; 场景页只画聊天界面、按钮外观和标题

export const SURFACE = 'desktop'
export const COLS = 120 // 客户端横栏的格数 (bodyColumns)
export const FPS = 20
export const DURATION = 19.6

export const TEXT = {
  en: {
    prompt: 'Add a coupon code field to checkout, then run the tests',
    final: 'Added a coupon code field to checkout: a valid code updates the total right away, and all 14 tests pass.',
    agentDesc: 'Check the cart page and the tests in parallel',
    kids: ['Check the cart page', 'Check the tests'],
    kidNotes: ['The cart page also shows the total.', 'Added 3 test cases for coupons.'],
    earlier: ['Update the product API docs', 'Run the end-to-end tests'],
    handoff: ['## Goal', 'Add a coupon code field to checkout; a valid code updates the total right away.', '', '## Done', '- src/checkout/coupon.ts: validation', '- all 14 tests pass', '', '## Next', '- add an expiry check'],
    placeholder: 'Reply to Claude…',
    title: 'cc-hud · desktop app',
    sub: 'The Code tab of the Claude desktop app: the same panel above the prompt, with native Settings and Handoff buttons',
  },
  zh: {
    prompt: '给结账页加一个优惠码输入框，改完跑一下测试',
    final: '结账页加上了优惠码输入框：有效的码会马上更新总价，14 个测试全部通过。',
    agentDesc: '并行检查购物车页面和测试用例',
    kids: ['检查购物车页面', '检查测试用例'],
    kidNotes: ['购物车页面也显示总价。', '给优惠码补了 3 个测试用例。'],
    earlier: ['更新商品接口文档', '跑端到端测试'],
    handoff: ['## 目标', '结账页加优惠码输入框，有效的码马上更新总价。', '', '## 已完成', '- src/checkout/coupon.ts：校验', '- 14 个测试全部通过', '', '## 下一步', '- 加上过期检查'],
    placeholder: '输入消息…',
    title: 'cc-hud · 客户端版',
    sub: 'Claude 桌面客户端的 Code 标签页：输入框上方的同款面板，带原生的设置 / 交接按钮',
  },
}

export const CWD = '/home/me/shop-web'

// 鼠标: 先点 Settings (展开三个下拉框, 停一会儿再点一次收起); 一轮做完后点 Handoff
//   clicks = 在这几个时刻按下; 录制器按这些时刻按按钮, 场景页按同样的时刻画指针
export const TRIPS = [
  { key: 'btn-settings', inAt: 0.2, arriveAt: 0.7, clicks: [0.9, 2.3], leaveAt: 2.5, goneAt: 3.0 },
  { key: 'btn-handoff', inAt: 14.6, arriveAt: 15.1, clicks: [15.3], leaveAt: 15.7, goneAt: 16.2 },
]
export const HANDOFF = { forkDoneAt: 16.8 } // Claude 写好交接提示词的时刻

export const TYPE_AT = 3.0
export const TYPE_END = 3.8
export const ENTER = 4.0
export const TURN_START = 4.05

export const TOOLS = [
  { tool: 'Read', input: { file_path: CWD + '/src/checkout/Checkout.tsx' }, args: 'src/checkout/Checkout.tsx', start: 4.4, end: 5.2 },
  { tool: 'Agent', input: { subagent_type: 'general-purpose' }, args: '', start: 5.5, end: 9.2 },
  { tool: 'Write', input: { file_path: CWD + '/src/checkout/coupon.ts', content: Array.from({ length: 32 }, (_, i) => 'line ' + i).join('\n') }, args: 'src/checkout/coupon.ts', start: 9.4, end: 10.4 },
]

// Agent 工具同时派出两个子代理 (都在 Agent 那一段里跑完)
const kidTools = (start, list) => list.map(([tool, path], i) => ({ tool, input: { file_path: CWD + '/' + path }, at: start + 0.3 + i * 0.55 }))
export const KIDS = [
  {
    id: 'agent-cart',
    type: 'Explore',
    spawn: 5.6,
    stop: 9.0,
    tools: kidTools(5.6, [['Grep', 'src/pages'], ['Read', 'src/pages/Cart.tsx'], ['Read', 'src/pages/OrderSummary.tsx'], ['Glob', 'src/components'], ['Read', 'src/components/PriceTotal.tsx'], ['Read', 'src/lib/money.ts']]),
  },
  {
    id: 'agent-tests',
    type: 'Explore',
    spawn: 5.65,
    stop: 9.1,
    tools: kidTools(5.85, [['Glob', 'src/checkout'], ['Read', 'src/checkout/Checkout.test.tsx'], ['Grep', 'src/checkout'], ['Read', 'src/lib/money.test.ts'], ['Read', 'src/pages/Cart.test.tsx']]),
  },
]

export const FINAL_AT = 10.7
export const FINAL_END = 11.1
export const COMPLETE = 11.2 // turn.complete; 再等 2 秒没有新的一段 -> 庆祝 (源码的 END_WAIT_MS)
export const FADE_AT = 19.1

// 用量: 每次模型回复 (主线程和子代理) 结束时更新; 5小时窗口刚开始 12 分钟, 3% -> 23.3% (悠闲 -> 正常 -> 冒汗, 红字 "40m 用完")
//   上下文 48% -> 75% -> 86% (螃蟹 1 秒内变红; Handoff 变成主按钮)
export const STEPS = [
  { at: 4.4, main: true },
  { at: 5.5, main: true },
  { at: 6.1, kid: 0 },
  { at: 6.7, kid: 1 },
  { at: 7.3, kid: 0 },
  { at: 7.9, kid: 1 },
  { at: 8.5, kid: 0 },
  { at: 9.1, kid: 1 },
  { at: 9.4, main: true },
  { at: FINAL_AT, main: true },
]
export const FIVE = [3.0, 3.6, 4.4, 5.6, 7.5, 10.5, 14.0, 17.5, 20.5, 22.9, 23.3]
export const WEEK = [41.2, 41.3, 41.4, 41.5, 41.6, 41.7, 41.8, 41.9, 42.0, 42.2, 42.3]
export const CTX_TOK = [96, 104, 112, 112, 112, 112, 112, 112, 112, 150, 172].map(k => k * 1000)
export const CTX_WIN = 200_000
export const COST = [3.12, 3.17, 3.21, 3.25, 3.29, 3.33, 3.37, 3.41, 3.45, 3.5, 3.54]
