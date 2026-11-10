# 誓约竞技场 · Oath Arena

基于2026年北航OOpre（面向对象先导）作业引擎的 2.5D 回合制混战网页游戏。零依赖、零外部素材：画面由 Canvas 程序化绘制，音效与配乐由 Web Audio 实时合成。



## 与作业代码的关系

- `js/engine.js` 是 `src/*.java` 的逐类移植（Item / Potion / Equipment / Inventory / Player / Lexer / Parser / GameSystem），规则与输出格式完全一致，只额外发出“事件”给画面层使用。
- 游戏里的每个动作都会变成一条作业指令（`attack`、`use_item`、`swap`、`add_subscribe`、`load_subscribe` 等）交给引擎执行。右侧终端实时显示指令和输出，可以“导出为作业输入”，直接喂给 Java 版运行。
- 对拍：`node web/tools/difftest.js [轮数] [每轮指令数]` 随机生成合法指令，分别交给 Java 版和 JS 引擎执行并逐字比较输出（需要本机有 `javac` / `java`）。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `js/engine.js` | 作业引擎（移植自 Java） |
| `js/data.js` | 全部数值与文案 |
| `js/world.js` | 2.5D 渲染：透视相机、浮空竞技台、立牌角色、粒子特效 |
| `js/director.js` | 把引擎事件编排成动画、镜头和音效 |
| `js/audio.js` | 合成音效 + 程序化配乐 |
| `js/game.js` | 回合流程、结盟、战利品、胜负 |
| `js/ai.js` | 对手 AI（只读引擎状态，输出指令） |
| `js/ui.js` | HUD、背包、战利品、终端 |
| `js/tutorial.js` | 新手引导 |
| `tools/sim.js` | 无头平衡模拟：`node web/tools/sim.js [局数] [对手数]` |

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
