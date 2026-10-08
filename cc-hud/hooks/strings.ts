// cc-hud 的界面文字: 英文 (默认) 和中文两套, 键一模一样 (测试会核对)
// 纯数据 + 纯函数, 不碰 $: register.tsx 和 desktop.ts 都直接 import
//
// 终端里只用 ASCII、中文、`│ ─ ━ ✓` 和方块字符; 「」！？ 只用在散步道的气泡和 toast 里
// 宽度有讲究的地方 (面板标签、"40m用完" 这种附加文字) 改动时要对一下 register.tsx 里的列宽

export type Lang = 'en' | 'zh'

const zh = {
  // 面板标签 (网格第一列; 标签列宽 = 当前语言里最宽的那个)
  label: {
    model: '模型',
    project: '项目',
    session: '本会话',
    context: '上下文',
    h5: '5小时',
    week: '本周',
    status: '状态',
    tools: '工具',
    token: 'token',
  },
  compact: '压缩',
  // 用量条后面那段: 预计用完 / 重置倒计时
  runOut: (d: string) => d + '用完',
  resetIn: (d: string) => d + ' 重置',
  // 状态
  thinking: '思考中',
  tool: {
    Read: '读文件',
    Grep: '搜内容',
    Glob: '找文件',
    Edit: '改文件',
    MultiEdit: '改文件',
    Write: '写文件',
    NotebookEdit: '改笔记本',
    Bash: '跑命令',
    PowerShell: '跑命令',
    WebSearch: '搜网页',
    WebFetch: '读网页',
    Agent: '派子代理',
    Task: '派子代理',
    SendMessage: '发消息',
    TodoWrite: '记待办',
    Skill: '用技能',
    ToolSearch: '找工具',
  } as Record<string, string>,
  ready: '✓ 待命',
  lastTurn: (d: string, n: string) => '✓ 上一轮 ' + d + '，' + n + ' 次工具',
  kidsBusy: '子代理在跑',
  kidsChip: (n: string) => '+' + n + '代理',
  noTools: '还没有',
  counting: '统计中..',
  sinceLaunch: ' 本次启动',
  // 客户端卡片
  desk: {
    runOut: (d: string) => d + ' 用完',
    kidsTail: (n: string) => '  +' + n + ' 个子代理',
    kidsRunning: (n: string) => n + ' 个子代理在跑',
    crabAlt: '用量面板的小螃蟹',
    dashAlt: (c: string, f: string, w: string) => '上下文 ' + c + '%，5小时 ' + f + '%，本周 ' + w + '%',
  },
  // 设置栏
  bar: {
    settings: '设置',
    handoff: '交接',
    writing: (s: string) => '正在写交接 ' + s,
    // 客户端 (桌面 app) 的工具栏: 原生按钮; 面板约 15 秒才刷新一次, 所以不写秒数
    writingDesk: '正在写交接…',
    openHandoff: '打开交接文件',
    lang: '语言',
    crab: '螃蟹',
    panel: '面板',
    on: '开',
    off: '关',
    full: '完整',
    compact: '精简',
    hide: '隐藏',
    // 不是全屏时终端不把鼠标点击交给 Claude Code: 工具栏旁边提示怎么办 (放不下就用短的, 再放不下就不放)
    clickHint: '点击需要 /tui fullscreen，也可以输入 /hud handoff',
    clickHintShort: '点击需要 /tui fullscreen',
  },
  // 散步道气泡 (外面会套上「」)
  say: {
    done: (d: string) => '搞定 ' + d,
    quotaBack: '额度刷新了',
    slowDown: (d: string) => '慢点！' + d + '用完',
    ctxFull: '上下文快满了',
    compacted: '压缩完了',
    yourCall: '等你点头',
    handoff: '要交接吗？',
  },
  // 悬停气泡
  tipWord: ' · 小贴士 ',
  tips: ['/hud agents 打开子代理看板', '/hud crab 关掉或打开散步的螃蟹', '/hud 切换 完整 / 精简 / 隐藏', '/hud handoff 写一份交接提示词', '/hud lang en 切换成英文'],
  // 每轮收据
  receipt: {
    files: (n: string) => '改 ' + n + ' 个文件',
    tools: (n: string) => '工具 ' + n + ' 次',
  },
  // toast
  toast: {
    projectOpened: '已打开项目文件夹',
    openFailed: (err: string) => '打开失败: ' + err,
    triedOpen: (list: string) => '没能打开, 试过: ' + list,
    cmdFailed: (cmd: string, err: string) => '/' + cmd + ' 运行失败: ' + err,
    quotaBack: (name: string) => name + '额度已恢复，可以继续了',
    costMilestone: (usd: string) => '本会话已花 $' + usd + '，螃蟹替你记着账',
    ctxWarn: (pct: string) => '上下文已用 ' + pct + '%，螃蟹开始冒汗了，可以考虑 /compact',
    tokScopeAll: '本会话（含子代理）',
    tokScopeLaunch: '本次启动以来',
    tokDetail: (scope: string, total: string, cr: string, cw: string, inp: string, out: string) =>
      scope + '共 ' + total + ' token：读缓存 ' + cr + '，写缓存 ' + cw + '，新输入 ' + inp + '，输出 ' + out + '。读缓存最便宜，单价约为新输入的十分之一。',
    lateNight: (h: string) => '已经凌晨 ' + h + ' 点了，螃蟹陪你干活，也记得早点休息',
    toolMilestone: (n: string) => '本会话第 ' + n + ' 次工具调用，螃蟹给你鼓掌',
    agentsNarrow: (reason: string) => '子代理看板等终端再宽一点才能显示: ' + reason,
    agentsFailed: (err: string) => '子代理看板打不开: ' + err,
    panelHidden: '用量面板已隐藏（输入 /hud 再打开）',
  },
  window: { five_hour: '5 小时', seven_day: '本周' } as Record<string, string>,
  // 子代理看板
  kids: {
    title: '子代理',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    killed: '已停止',
    stuck: '可能卡住',
    ended: '已结束',
    ago: (d: string) => d + ' 前',
    runDetail: (ran: string, idle: string, doing: string, n: string) => doing + ' · ' + idle + ' · 已跑 ' + ran + ' · ' + n + ' 次',
    endDetail: (ran: string, n: string) => '用时 ' + ran + ' · ' + n + ' 次工具',
    head: { status: '状态', desc: '描述', ran: '时长', idle: '最后动静', doing: '在做什么', n: '工具' },
    group: (name: string, r: string, d: string) => name + ' · ' + r + ' 个在跑 · ' + d + ' 个完成',
    others: '其他子代理',
    summary: (r: string, e: string) => '  运行中 ' + r + ' · 已结束 ' + e,
    none: '这个会话还没有子代理，Esc 关闭',
    endedHead: (n: string) => '已结束 (最近 ' + n + ' 个)',
    stuckTip: '运行中超过 5 分钟没有工具动作的会标红，Esc 关闭',
  },
  // /hud 命令
  cmd: {
    description: '用量面板 (输入框下方)：完整 → 精简 → 隐藏 循环；/hud agents 子代理看板，/hud crab 开关螃蟹，/hud lang en|zh|auto 切换语言，/hud handoff 写交接提示词',
    registerFailed: (err: string) => 'cc-hud: /hud 注册失败 ' + err,
    agentsOpened: '已打开子代理看板（Esc 关闭）',
    crabOn: '螃蟹散步道已打开（输入框正上方）',
    crabOff: '螃蟹散步道已关闭（/hud crab 再打开）',
    fixed: '终端版面板固定在输入框下方，螃蟹在上方',
    layout: (name: string) => '用量面板：' + name,
    layoutName: { full: '完整', compact: '精简', off: '已隐藏（再输入 /hud 打开）' } as Record<string, string>,
    lang: (name: string) => '用量面板语言：' + name + '（/hud lang en 切回英文）',
    langAuto: (name: string) => '用量面板语言：自动（现在是' + name + '，跟随 Claude Code 的 language 设置）',
    langName: { en: '英文', zh: '中文' } as Record<string, string>,
  },
  // 交接
  handoff: {
    started: '正在写交接提示词，写好会复制到剪贴板并存成文件',
    busy: '交接提示词正在写，稍等',
    title: (project: string, branch: string, date: string) => '# 交接：' + project + (branch ? '（' + branch + '）' : '') + ' · ' + date,
    resume: (id: string) => '（想回到原来的会话：claude --resume ' + id + '）',
    done: (chars: string, path: string) => '交接提示词已复制（' + chars + ' 字）· 已存到 ' + path + ' · 开新会话或 /clear 会自动填好',
    noCopy: (path: string) => '没能复制到剪贴板 · 交接提示词已存到 ' + path + ' · 开新会话或 /clear 会自动填好',
    // 新会话 / /clear 自动填进输入框的那一行 (@交接文件 + 这句)
    fillLine: '按这份交接继续',
    filled: (time: string) => '已填入 ' + time + ' 的交接提示词，按回车发送；不需要就删掉',
    savedDesk: (path: string) => '交接提示词已存到 ' + path + '（客户端暂时不能复制，点「打开交接文件」看全文）',
    noSave: (chars: string, err: string) => '交接提示词已复制（' + chars + ' 字）· 存文件失败：' + err,
    lost: (err: string) => '交接提示词写好了，但复制和存文件都失败了：' + err,
    nothing: '还没有可交接的内容：先和 Claude 来回至少一轮',
    apiError: (status: string) => '交接失败：API 出错' + (status ? ' ' + status : '') + '，再试一次',
    empty: '交接失败：Claude 没有写出内容，再试一次',
    aborted: '交接已取消',
  },
}

export type Table = typeof zh

const en: Table = {
  label: {
    model: 'Model',
    project: 'Project',
    session: 'Session',
    context: 'Context',
    h5: '5h',
    week: 'Week',
    status: 'Status',
    tools: 'Tools',
    token: 'Tokens',
  },
  compact: 'compact',
  runOut: (d: string) => 'out ' + d,
  resetIn: (d: string) => 'reset ' + d,
  thinking: 'Thinking',
  tool: {
    Read: 'Reading',
    Grep: 'Searching',
    Glob: 'Finding files',
    Edit: 'Editing',
    MultiEdit: 'Editing',
    Write: 'Writing',
    NotebookEdit: 'Notebook',
    Bash: 'Running',
    PowerShell: 'Running',
    WebSearch: 'Web search',
    WebFetch: 'Web fetch',
    Agent: 'Agents',
    Task: 'Agents',
    SendMessage: 'Messaging',
    TodoWrite: 'Todos',
    Skill: 'Skill',
    ToolSearch: 'Tool search',
  } as Record<string, string>,
  ready: '✓ Ready',
  lastTurn: (d: string, n: string) => '✓ last turn ' + d + ', ' + n + (n === '1' ? ' tool' : ' tools'),
  kidsBusy: 'subagents running',
  kidsChip: (n: string) => '+' + n + (n === '1' ? ' agent' : ' agents'),
  noTools: 'none yet',
  counting: 'counting..',
  sinceLaunch: ' since launch',
  desk: {
    runOut: (d: string) => 'out ' + d,
    kidsTail: (n: string) => '  +' + n + (n === '1' ? ' subagent' : ' subagents'),
    kidsRunning: (n: string) => n + (n === '1' ? ' subagent running' : ' subagents running'),
    crabAlt: 'Usage panel crab',
    dashAlt: (c: string, f: string, w: string) => 'Context ' + c + '%, 5h ' + f + '%, week ' + w + '%',
  },
  bar: {
    settings: 'settings',
    handoff: 'handoff',
    writing: (s: string) => 'writing handoff... ' + s,
    writingDesk: 'Writing handoff…',
    openHandoff: 'Open handoff file',
    lang: 'Lang',
    crab: 'Crab',
    panel: 'Panel',
    on: 'on',
    off: 'off',
    full: 'full',
    compact: 'compact',
    hide: 'hide',
    clickHint: 'clicks need /tui fullscreen, or type /hud handoff',
    clickHintShort: 'clicks need /tui fullscreen',
  },
  say: {
    done: (d: string) => 'Done ' + d,
    quotaBack: "Quota's back",
    slowDown: (d: string) => 'Slow down! out in ' + d,
    ctxFull: 'Context almost full',
    compacted: 'Compacted',
    yourCall: 'Your call',
    handoff: 'Handoff?',
  },
  tipWord: ' · tip: ',
  tips: ['/hud agents opens the subagent board', '/hud crab hides or shows the crab', '/hud cycles full / compact / hidden', '/hud handoff writes a handoff prompt', '/hud lang zh switches to Chinese'],
  receipt: {
    files: (n: string) => n + (n === '1' ? ' file changed' : ' files changed'),
    tools: (n: string) => n + (n === '1' ? ' tool call' : ' tool calls'),
  },
  toast: {
    projectOpened: 'Opened the project folder',
    openFailed: (err: string) => "Couldn't open: " + err,
    triedOpen: (list: string) => "Couldn't open it, tried: " + list,
    cmdFailed: (cmd: string, err: string) => '/' + cmd + ' failed: ' + err,
    quotaBack: (name: string) => 'Your ' + name + ' quota has reset. Carry on',
    costMilestone: (usd: string) => 'This session has spent $' + usd + '. The crab is keeping count',
    ctxWarn: (pct: string) => 'Context is ' + pct + '% full and the crab is sweating. Consider /compact or a handoff',
    tokScopeAll: 'This session (incl. subagents)',
    tokScopeLaunch: 'Since launch',
    tokDetail: (scope: string, total: string, cr: string, cw: string, inp: string, out: string) =>
      scope + ': ' + total + ' tokens. Cache reads ' + cr + ', cache writes ' + cw + ', fresh input ' + inp + ', output ' + out + '. Cache reads are the cheapest, about a tenth of fresh input.',
    lateNight: (h: string) => "It's " + h + " AM. The crab's keeping you company, but get some rest",
    toolMilestone: (n: string) => 'Tool call #' + n + ' this session. The crab applauds',
    agentsNarrow: (reason: string) => 'The subagent board needs a wider terminal: ' + reason,
    agentsFailed: (err: string) => "Couldn't open the subagent board: " + err,
    panelHidden: 'Usage panel hidden. Type /hud to bring it back',
  },
  window: { five_hour: '5-hour', seven_day: 'weekly' } as Record<string, string>,
  kids: {
    title: 'Subagents',
    running: 'running',
    completed: 'done',
    failed: 'failed',
    killed: 'stopped',
    stuck: 'stuck?',
    ended: 'ended',
    ago: (d: string) => d + ' ago',
    runDetail: (ran: string, idle: string, doing: string, n: string) => doing + ' · ' + idle + ' · ran ' + ran + ' · ' + n + ' calls',
    endDetail: (ran: string, n: string) => 'took ' + ran + ' · ' + n + ' tool calls',
    head: { status: 'Status', desc: 'Task', ran: 'Time', idle: 'Last seen', doing: 'Doing', n: 'Tools' },
    group: (name: string, r: string, d: string) => name + ' · ' + r + ' running · ' + d + ' done',
    others: 'Other subagents',
    summary: (r: string, e: string) => '  running ' + r + ' · ended ' + e,
    none: 'No subagents in this session yet. Esc to close',
    endedHead: (n: string) => 'Ended (last ' + n + ')',
    stuckTip: 'Running with no tool activity for 5+ minutes is flagged red. Esc to close',
  },
  cmd: {
    description: 'Usage panel (under the prompt): cycles full -> compact -> hidden; /hud agents subagent board, /hud crab toggles the crab, /hud lang en|zh|auto language, /hud handoff writes a handoff prompt',
    registerFailed: (err: string) => 'cc-hud: /hud registration failed ' + err,
    agentsOpened: 'Opened the subagent board (Esc to close)',
    crabOn: 'Crab strip on (just above the prompt)',
    crabOff: 'Crab strip off (/hud crab turns it back on)',
    fixed: 'The terminal panel stays under the prompt, the crab above it',
    layout: (name: string) => 'Usage panel: ' + name,
    layoutName: { full: 'full', compact: 'compact', off: 'hidden (type /hud to bring it back)' } as Record<string, string>,
    lang: (name: string) => 'Usage panel language: ' + name + ' (/hud lang zh for Chinese)',
    langAuto: (name: string) => "Usage panel language: auto (now " + name + ", following Claude Code's language setting)",
    langName: { en: 'English', zh: 'Chinese' } as Record<string, string>,
  },
  handoff: {
    started: 'Writing a handoff prompt. It will be copied to your clipboard and saved to a file',
    busy: 'A handoff prompt is already being written',
    title: (project: string, branch: string, date: string) => '# Handoff: ' + project + (branch ? ' (' + branch + ')' : '') + ' · ' + date,
    resume: (id: string) => '(To reopen the original session instead: claude --resume ' + id + ')',
    done: (chars: string, path: string) => 'Handoff copied (' + chars + ' chars) · saved to ' + path + ' · a new session or /clear fills it in for you',
    noCopy: (path: string) => "Couldn't copy to the clipboard · handoff saved to " + path + ' · a new session or /clear fills it in for you',
    fillLine: 'Continue from this handoff',
    filled: (time: string) => 'Filled in the handoff from ' + time + '. Press Enter to send, or delete it',
    savedDesk: (path: string) => 'Handoff saved to ' + path + " (the desktop app can't copy yet; click Open handoff file to read it)",
    noSave: (chars: string, err: string) => 'Handoff copied (' + chars + " chars) · couldn't save the file: " + err,
    lost: (err: string) => "The handoff was written but couldn't be copied or saved: " + err,
    nothing: 'Nothing to hand off yet. Have at least one exchange with Claude first',
    apiError: (status: string) => 'Handoff failed: API error' + (status ? ' ' + status : '') + '. Try again',
    empty: 'Handoff failed: Claude returned an empty reply. Try again',
    aborted: 'Handoff cancelled',
  },
}

export const TABLES: Record<Lang, Table> = { en, zh }

let current: Lang = 'en'
export const setLang = (l: Lang) => {
  current = l
}
export const getLang = (): Lang => current
// 当前语言的整张表
export const S = (): Table => TABLES[current]

// store 里存的 'en' | 'zh' | 'auto' (没存 = auto); auto 跟随 Claude Code 的 language 设置: 是中文就中文, 其余英文
export type LangPref = Lang | 'auto'
export const prefOf = (v: unknown): LangPref => (v === 'en' || v === 'zh' ? v : 'auto')
export function resolveLang(pref: LangPref, claudeLanguage: unknown): Lang {
  if (pref !== 'auto') return pref
  const l = typeof claudeLanguage === 'string' ? claudeLanguage.trim() : ''
  return /^zh\b|^zh[-_]|chinese|mandarin|cantonese|中文|汉语|漢語|简体|繁體|繁体/i.test(l) ? 'zh' : 'en'
}

// 交接: 让 Claude (分叉, 看得到整个会话) 写的那段话; 用英文写指令, 让它用对话里用户说的语言来写
export const HANDOFF_PROMPT = [
  'Write a handoff prompt so a brand-new Claude Code session can continue this work.',
  'The reader has zero memory of this conversation. Make it fully self-contained.',
  'Write it in the language the user has been using in this conversation.',
  'Use exactly these markdown sections, in order, and nothing before or after them:',
  '## Goal (what the user is trying to achieve, in their words)',
  '## Current state (what is done, what is in progress, what is not started)',
  '## Key decisions (what was chosen and why, including options that were rejected)',
  '## Files & locations (paths that matter, with one line each on why)',
  '## Gotchas (dead ends, things that did not work, traps to avoid)',
  '## Next steps (concrete and in order; the first one starts with "Start by")',
  '## Verify (commands or tests that prove the work is correct)',
  'Stay under about 800 words. No preamble, no sign-off.',
].join('\n')
