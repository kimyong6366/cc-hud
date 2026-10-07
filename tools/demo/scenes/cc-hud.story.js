// 终端版动图的剧本 (录制器 record.mjs 和场景页 cc-hud.html 共用, 时间单位: 秒)
// 录制器按这里的时间把事件喂给真的 cc-hud 代码; 场景页按同样的时间画引擎自己的界面 (会话记录、输入框、转圈) 和鼠标
// 引擎自己的字 (工具结果、Baked for 9s) 在两种语言里都是英文, 和真的 Claude Code 一样; 只有你打的字和 Claude 的回答跟着语言变

export const SURFACE = 'terminal'
export const COLS = 128
export const ROWS = 30
export const FPS = 20
export const DURATION = 23.6

export const TEXT = {
  en: {
    prompt: 'Add a coupon code field to checkout, then run the tests',
    final:
      'Added a coupon code field to checkout: a valid code updates the total right away, an invalid one shows an error. The cart and order summary pages show the discount too; all 14 tests pass.',
    agentDesc: 'Find other pages that show the order total',
    kids: ['Find other pages that show the order total'],
    kidNotes: ['The cart and order summary pages also show the total.'],
    earlier: ['Update the product API docs', 'Run the end-to-end tests'],
    // 交接提示词的正文 (只有字数会出现在提示条里)
    handoff: [
      '## Goal',
      'Add a coupon code field to checkout; a valid code updates the total right away.',
      '',
      '## Done',
      '- src/checkout/Checkout.tsx: coupon field + validation',
      '- the cart and order summary pages show the discount',
      '- all 14 tests pass',
      '',
      '## Next',
      '- support percentage and fixed-amount coupons',
      '- add an expiry check',
    ],
    title: 'cc-hud',
    phases: [
      [0, 'A usage panel under the Claude Code prompt · the crab acts out each tool'],
      [5.9, 'Subagents walk behind it · click +1 agent to see what they are doing'],
      [10.0, 'Burning quota fast? It sweats · it celebrates when the turn is done'],
      [16.0, 'Context nearly full? One click writes a handoff prompt for a new session'],
    ],
  },
  zh: {
    prompt: '给结账页加一个优惠码输入框，改完跑一下测试',
    final: '结账页加上了优惠码输入框：有效的码会马上更新总价，无效的会提示错误；购物车和订单摘要页也会显示折扣，14 个测试全部通过。',
    agentDesc: '找出其他显示订单总价的页面',
    kids: ['找出其他显示订单总价的页面'],
    kidNotes: ['购物车和订单摘要页也显示总价。'],
    earlier: ['更新商品接口文档', '跑端到端测试'],
    handoff: [
      '## 目标',
      '结账页加优惠码输入框，有效的码马上更新总价。',
      '',
      '## 已完成',
      '- src/checkout/Checkout.tsx：输入框 + 校验',
      '- 购物车和订单摘要页显示折扣',
      '- 14 个测试全部通过',
      '',
      '## 下一步',
      '- 支持百分比和固定金额两种优惠码',
      '- 加上过期检查',
    ],
    title: 'cc-hud',
    phases: [
      [0, 'Claude Code 输入框下方的用量面板 · 螃蟹跟着每个工具做动作'],
      [5.9, '子代理跟在后面走 · 点「+1代理」看它们在做什么'],
      [10.0, '额度用得太快会冒汗 · 一轮做完会庆祝'],
      [16.0, '上下文快满了？点一下就写好交接提示词，换个新会话接着干'],
    ],
  },
}

export const CWD = '/home/me/shop-web'

// 打字 -> 回车 (跳一下) -> 一轮开始
export const TYPE_AT = 0.5
export const TYPE_END = 2.9
export const ENTER = 3.1
export const TURN_START = 3.15

// 主线程的工具调用 (Agent 那一个是前台子代理: 子代理跑完它才结束)
export const TOOLS = [
  { tool: 'Read', input: { file_path: CWD + '/src/checkout/Checkout.tsx' }, args: 'src/checkout/Checkout.tsx', start: 3.5, end: 4.2, result: 'Read 112 lines' },
  {
    tool: 'Edit',
    input: { file_path: CWD + '/src/checkout/Checkout.tsx', old_string: 'a\nb\nc', new_string: Array.from({ length: 18 }, (_, i) => 'line ' + i).join('\n') },
    args: 'src/checkout/Checkout.tsx',
    start: 4.5,
    end: 5.6,
    result: 'Updated src/checkout/Checkout.tsx with 18 additions and 3 removals',
  },
  { tool: 'Agent', input: { subagent_type: 'Explore' }, args: '', start: 5.9, end: 9.9, result: 'Done (5 tool uses · 41.2k tokens · 3.9s)' },
  { tool: 'Bash', input: { command: 'npm test' }, args: 'npm test', start: 10.2, end: 11.4, result: 'Tests: 14 passed, 14 total' },
]

// 子代理 (Agent 工具派出去的) 和它在后台调的工具
export const KIDS = [
  {
    id: 'agent-total-1',
    type: 'Explore',
    spawn: 5.95,
    stop: 9.8,
    tools: [
      { tool: 'Grep', input: { pattern: 'total', path: CWD + '/src/pages' }, at: 6.3 },
      { tool: 'Read', input: { file_path: CWD + '/src/pages/Cart.tsx' }, at: 6.9 },
      { tool: 'Read', input: { file_path: CWD + '/src/pages/OrderSummary.tsx' }, at: 7.5 },
      { tool: 'Glob', input: { pattern: 'src/**/*Total*.tsx' }, at: 8.1 },
      { tool: 'Read', input: { file_path: CWD + '/src/components/PriceTotal.tsx' }, at: 8.7 },
    ],
  },
]

export const FINAL_AT = 11.6
export const FINAL_END = 12.2
export const COMPLETE = 12.5 // turn.complete; 再等 2 秒没有新的一段 -> 庆祝 (源码的 END_WAIT_MS)

// 鼠标: 点 "+1代理" 打开子代理看板, 按 Esc 关掉; 再点 [交接]
export const AGENTS = { inAt: 6.0, arriveAt: 6.6, clickAt: 6.8, closeAt: 9.0, leaveAt: 9.1, goneAt: 9.6 }
export const HANDOFF = { inAt: 16.2, arriveAt: 16.8, clickAt: 17.0, leaveAt: 17.4, goneAt: 18.0, forkDoneAt: 19.6 }
export const FADE_AT = 23.1

// 每次模型回复 (主线程每个工具之前、子代理每次请求、最后那段文字) 用量数据更新一次
//   5小时窗口刚开始 12 分钟: 用量 3% -> 23.3% (配速越来越快: 悠闲 -> 正常 -> 冒汗, 红字 "41m用完")
//   上下文只跟主线程走: 54% -> 76% (出现 [压缩]) -> 86% ([交接] 变橙, 螃蟹问要不要交接)
export const STEPS = [
  { at: 3.5, main: true },
  { at: 4.5, main: true },
  { at: 5.9, main: true },
  { at: 6.3, kid: 0 },
  { at: 6.9, kid: 0 },
  { at: 7.5, kid: 0 },
  { at: 8.1, kid: 0 },
  { at: 8.7, kid: 0 },
  { at: 10.2, main: true },
  { at: FINAL_AT, main: true },
]
export const FIVE = [3.0, 3.6, 4.4, 5.6, 7.5, 10.5, 14.0, 17.5, 20.5, 22.4, 23.3]
export const WEEK = [41.2, 41.3, 41.4, 41.5, 41.6, 41.7, 41.8, 41.9, 42.0, 42.1, 42.3]
export const CTX_TOK = [108, 114, 121, 128, 128, 128, 128, 128, 128, 152, 172].map(k => k * 1000)
export const CTX_WIN = 200_000
export const COST = [3.12, 3.17, 3.22, 3.27, 3.31, 3.34, 3.37, 3.4, 3.43, 3.48, 3.54]
