// 让浏览器端的脚本（engine / data / util / ai / game）能在 Worker 里直接运行：
// 它们都挂在 window.OO 上。必须在其它 import 之前执行。
globalThis.window = globalThis;
