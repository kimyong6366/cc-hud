# 演示动图生成脚本

`assets/` 里的动图都由这里的脚本生成，中英文各一套：

| 文件 | 内容 | 用在 |
|---|---|---|
| `cc-hud.gif` / `cc-hud.zh-CN.gif` | 终端版 | 英文 / 中文 README 开头 |
| `client.gif` / `client.zh-CN.gif` | 桌面客户端版 | 英文 / 中文 README 的客户端一节 |

画面全部来自真代码，不是照着画的：

1. `record.mjs` 在 Node 里给 mod 一个假引擎（时钟、用量、子代理列表、git 分支……），按剧本 `scenes/<场景>.story.js` 的时间喂事件：打字、发送、工具调用、派子代理、点按钮。
2. 每一帧录下真代码画出来的东西，写进 `out/rec/<场景>.<语言>.json`：
   - 终端版：面板（PromptHint）、散步道（`walkway.tsx`）、子代理看板、收据，排成终端格子
   - 客户端版：螃蟹和仪表盘的 SVG（`buildDesktop` → `crabSvg` / `dashSvg`），以及每张图换上的时刻（SMIL 动画从那一刻播）
3. 场景页 `scenes/<场景>.html?lang=en|zh` 只画窗口、引擎自己的界面（会话记录、输入框、转圈、提示条，是近似画法）、鼠标和标题。
4. `render.mjs` 用无头 Chrome 按 2 倍像素逐帧截图，再用 ffmpeg（`palettegen` / `paletteuse`）缩回 1 倍合成 GIF。

所以改了 mod 的界面，重新运行一次就是新的动图。

```bash
npm install --prefix tools/demo                 # 第一次: 装 typescript (只用来把 .tsx 转成 JS)
node tools/demo/render.mjs                      # 全部重新生成 (约 10 分钟)
node tools/demo/render.mjs cc-hud --lang=zh     # 只做一张
node tools/demo/render.mjs --gif-only           # 用已有的帧重新合成
node tools/demo/record.mjs cc-hud en            # 只录数据不出图 (几秒), 看真代码画出来的是什么
node tools/demo/check-strings.mjs               # 校验脚本里没有本机路径和内部名字
```

**改剧本**：时间线、两种语言的对话文字、用量数字都在 `scenes/cc-hud.story.js`（终端版）和 `scenes/client.story.js`（客户端版）里，录制器和场景页共用。

**需要**：
- Node 22.13 以上
- Chrome、Edge 或 Chromium
- ffmpeg

找不到程序时，用环境变量 `CHROME_PATH` / `FFMPEG_PATH` 指定。

字体用 Cascadia Mono 和 Microsoft YaHei。在 WSL 或 Linux 里没装这两个字体时，可以只为这次渲染加载：
1. 把字体文件放进一个文件夹。
2. 写一个 fontconfig 配置：先 `<include>` `/etc/fonts/fonts.conf`，再加一行 `<dir>` 指向那个文件夹。
3. 运行时用 `FONTCONFIG_FILE` 指向这个配置。

`scenes/_smoke.html` 是管线冒烟场景（`node tools/demo/render.mjs _smoke`）。名字以 `_` 开头的场景，输出只留在 `out/`，不进 `assets/`。

中间文件都在 `out/`，不进仓库：帧、录制数据、转好的模块、抽查帧（`out/check/`）、尺寸清单（`out/manifest.json`）。
