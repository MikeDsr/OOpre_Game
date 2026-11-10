# 誓约竞技场 · Oath Arena

基于2026年北航OOpre（面向对象先导）作业引擎的 2.5D 回合制混战网页游戏。零依赖、零外部素材：画面由 Canvas 程序化绘制，音效与配乐由 Web Audio 实时合成。



## 与作业代码的关系

- `js/engine.js` 是 `src/*.java` 的逐类移植（Item / Potion / Equipment / Inventory / Player / Lexer / Parser / GameSystem），规则与输出格式完全一致，只额外发出“事件”给画面层使用。
- 游戏里的每个动作都会变成一条作业指令（`attack`、`use_item`、`swap`、`add_subscribe`、`load_subscribe` 等）交给引擎执行。右侧终端实时显示指令和输出，可以“导出为作业输入”，直接喂给 Java 版运行。
- 对拍：`node tools/difftest.js [轮数] [每轮指令数]` 随机生成合法指令，分别交给 Java 版和 JS 引擎执行并逐字比较输出（需要本机有 `javac` / `java`）。

## 联机对战（3–6 人）

标题界面点“联机对战”即可创建房间，把邀请链接发给朋友，或者告诉他们房间码让他们输入加入。空位会由 AI 补齐。

- **服务器权威**：每个房间是一个 Cloudflare Durable Object，里面运行同一份 `engine.js` 和 `ai.js`，由它决定回合顺序、AI 行动和战利品，再按顺序广播作业指令。客户端用本地引擎重放同一串指令，所以每个人看到的状态完全一致。
- 每回合限时 40 秒；掉线的玩家由 AI 接管，重新打开链接即可回到对局（会重放全部指令恢复局面）；对局中途进入的人会以观战身份加入。
- 一局联机打完同样可以“导出整局指令”，作为作业输入喂给 Java 版。

### 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:8787 。开几个浏览器窗口就能互相加入房间。

### 部署到 Cloudflare（免费计划即可）

```bash
npx wrangler login
npm run deploy
```

部署完成后会输出 `https://oath-arena.<你的子域>.workers.dev`。这个地址同时托管网页和联机服务。如果国内访问 `workers.dev` 不稳定，可以在 `wrangler.jsonc` 里给 Worker 绑定你自己在 Cloudflare 上托管的域名。

如果还想从 GitHub Pages 打开网页，把 `js/data.js` 里的 `net.server` 改成上面的 Worker 地址即可。

### 联机测试工具

- `node tools/netbot.js [服务器] [机器人数] [总人数]`：多个无头机器人玩家打完整局，并校验各客户端的重放结果是否一致。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `server/worker.js` | 联机服务器：Worker 入口 + 房间 Durable Object |
| `js/net.js` / `js/online.js` | 联机连接层 / 大厅与联机对局控制 |
| `js/engine.js` | 作业引擎（移植自 Java） |
| `js/data.js` | 全部数值与文案 |
| `js/world.js` | 2.5D 渲染：透视相机、浮空竞技台、立牌角色、粒子特效 |
| `js/director.js` | 把引擎事件编排成动画、镜头和音效 |
| `js/audio.js` | 合成音效 + 程序化配乐 |
| `js/game.js` | 回合流程、结盟、战利品、胜负 |
| `js/ai.js` | 对手 AI（只读引擎状态，输出指令） |
| `js/ui.js` | HUD、背包、战利品、终端 |
| `js/tutorial.js` | 新手引导 |
| `tools/sim.js` | 无头平衡模拟：`node tools/sim.js [局数] [对手数]` |

## 操作

| 按键 | 作用 |
| --- | --- |
| 点击角色 / Tab | 选择目标 |
| 1–9 | 切换主手（免费） |
| A | 攻击 |
| S | 对自己使用主手物品 |
| D | 对目标使用主手物品 |
| F | 缔结誓约 / 解除守护 |
| B / E | 背包（拖动交换，免费） |
| W | 待机 |
| T | 终端 |
| 拖动画面 / 滚轮 / 双击 | 旋转视角 / 缩放 / 复位 |

设置（右上角 ☰）里可以调整音量、画质（自动/高/中/低），以及开启帧率显示。
