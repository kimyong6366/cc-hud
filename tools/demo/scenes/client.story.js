// 客户端 (桌面 App) 版动图的剧本 (录制器 record.mjs 和场景页 client.html 共用, 时间单位: 秒)
// 闲着 (悠闲, 戴墨镜) -> 发消息 (跳一下) -> 干活 -> 派出 2 个子代理 (SVG 小螃蟹) -> 用量配速变快, 冒汗 + 红字 "40m 用完" -> 庆祝 (连跳两下)
// 螃蟹和仪表盘是录制器用真代码 (buildDesktop -> crabSvg / dashSvg) 录下来的 SVG; 场景页只画聊天界面和标题

export const SURFACE = 'desktop'
export const COLS = 120 // 客户端横栏的格数 (bodyColumns)
export const FPS = 20
export const DURATION = 13.0

export const TEXT = {
  en: {
    prompt: 'Add a coupon code field to checkout, then run the tests',
    final: 'Added a coupon code field to checkout: a valid code updates the total right away, and all 14 tests pass.',
    agentDesc: 'Check the cart page and the tests in parallel',
    kids: ['Check the cart page', 'Check the tests'],
    kidNotes: ['The cart page also shows the total.', 'Added 3 test cases for coupons.'],
    earlier: ['Update the product API docs', 'Run the end-to-end tests'],
    placeholder: 'Reply to Claude…',
    title: 'cc-hud · desktop app',
    sub: 'The Code tab of the Claude desktop app: the same panel above the prompt, drawn as SVG',
  },
  zh: {
    prompt: '给结账页加一个优惠码输入框，改完跑一下测试',
    final: '结账页加上了优惠码输入框：有效的码会马上更新总价，14 个测试全部通过。',
    agentDesc: '并行检查购物车页面和测试用例',
    kids: ['检查购物车页面', '检查测试用例'],
    kidNotes: ['购物车页面也显示总价。', '给优惠码补了 3 个测试用例。'],
    earlier: ['更新商品接口文档', '跑端到端测试'],
    placeholder: '输入消息…',
    title: 'cc-hud · 客户端版',
    sub: 'Claude 桌面客户端的 Code 标签页：输入框上方的同款面板（SVG 绘制）',
  },
}

export const CWD = '/home/me/shop-web'

export const TYPE_AT = 0.25
export const TYPE_END = 1.05
export const ENTER = 1.2
export const TURN_START = 1.25

export const TOOLS = [
  { tool: 'Read', input: { file_path: CWD + '/src/checkout/Checkout.tsx' }, args: 'src/checkout/Checkout.tsx', start: 1.6, end: 2.4 },
  { tool: 'Agent', input: { subagent_type: 'general-purpose' }, args: '', start: 2.7, end: 6.4 },
  { tool: 'Write', input: { file_path: CWD + '/src/checkout/coupon.ts', content: Array.from({ length: 32 }, (_, i) => 'line ' + i).join('\n') }, args: 'src/checkout/coupon.ts', start: 6.6, end: 7.6 },
]

// Agent 工具同时派出两个子代理 (都在 Agent 那一段里跑完)
const kidTools = (start, list) => list.map(([tool, path], i) => ({ tool, input: { file_path: CWD + '/' + path }, at: start + 0.3 + i * 0.55 }))
export const KIDS = [
  {
    id: 'agent-cart',
    type: 'Explore',
    spawn: 2.8,
    stop: 6.2,
    tools: kidTools(2.8, [['Grep', 'src/pages'], ['Read', 'src/pages/Cart.tsx'], ['Read', 'src/pages/OrderSummary.tsx'], ['Glob', 'src/components'], ['Read', 'src/components/PriceTotal.tsx'], ['Read', 'src/lib/money.ts']]),
  },
  {
    id: 'agent-tests',
    type: 'Explore',
    spawn: 2.85,
    stop: 6.3,
    tools: kidTools(3.05, [['Glob', 'src/checkout'], ['Read', 'src/checkout/Checkout.test.tsx'], ['Grep', 'src/checkout'], ['Read', 'src/lib/money.test.ts'], ['Read', 'src/pages/Cart.test.tsx']]),
  },
]

export const FINAL_AT = 7.9
export const FINAL_END = 8.3
export const COMPLETE = 8.4 // turn.complete; 再等 2 秒没有新的一段 -> 庆祝 (源码的 END_WAIT_MS)
export const FADE_AT = 12.5

// 用量: 每次模型回复 (主线程和子代理) 结束时更新; 5小时窗口刚开始 12 分钟, 3% -> 23.3% (悠闲 -> 正常 -> 冒汗, 红字 "40m 用完")
export const STEPS = [
  { at: 1.6, main: true },
  { at: 2.7, main: true },
  { at: 3.3, kid: 0 },
  { at: 3.9, kid: 1 },
  { at: 4.5, kid: 0 },
  { at: 5.1, kid: 1 },
  { at: 5.7, kid: 0 },
  { at: 6.3, kid: 1 },
  { at: 6.6, main: true },
  { at: FINAL_AT, main: true },
]
export const FIVE = [3.0, 3.6, 4.4, 5.6, 7.5, 10.5, 14.0, 17.5, 20.5, 22.9, 23.3]
export const WEEK = [41.2, 41.3, 41.4, 41.5, 41.6, 41.7, 41.8, 41.9, 42.0, 42.2, 42.3]
export const CTX_TOK = [82, 86, 87, 87, 87, 87, 87, 87, 95, 99, 101].map(k => k * 1000)
export const CTX_WIN = 200_000
export const COST = [3.12, 3.17, 3.21, 3.25, 3.29, 3.33, 3.37, 3.41, 3.45, 3.5, 3.54]
