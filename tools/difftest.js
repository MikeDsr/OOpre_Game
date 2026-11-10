/* 对拍：随机生成合法指令序列，分别交给原 Java 程序与 JS 引擎执行，逐字比较输出。
   用法：node web/tools/difftest.js [轮数=300] [每轮指令数=400]
   需要本机 javac/java。Java 源码取自 ../../src，编译到系统临时目录。 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const OO = require('../js/engine.js');

const ROUNDS = +process.argv[2] || 300, N = +process.argv[3] || 400;
const SRC = path.resolve(__dirname, '../../src');
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'oopre-bin-'));
execFileSync('javac', ['-encoding', 'UTF-8', '-d', BIN, ...fs.readdirSync(SRC).filter(f => f.endsWith('.java')).map(f => path.join(SRC, f))]);

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const POT = ['HealPotion', 'AbsorptionPotion', 'DamagePotion', 'StrengthPotion'];
const EQ = ['Helmet', 'Chestplate', 'Leggings', 'Boots', 'Sword'];

function gen() {
  // 用 JS 引擎同步跟踪状态，仅用于保证生成的指令满足题面约束
  const sys = new OO.GameSystem();
  const cmds = []; let idc = 0;
  const run = c => { cmds.push(c); sys.execute(c); };
  const names = [];
  const np = ri(3, 8);
  for (let i = 0; i < np; i++) {
    const n = 'P' + i + '_' + ri(0, 99);
    names.push(n);
    const max = ri(1, 5000);
    run(`add_player ${n} ${ri(1, max)} ${max} ${ri(0, 3000)} ${ri(1, rnd() < .5 ? 300 : 3000)}`);
  }
  while (cmds.length < N) {
    const r = rnd();
    const A = pick(names), P = sys.findPlayer(A);
    if (r < 0.14) run(`add_potion ${A} it${idc++} ${pick(POT)} ${ri(1, rnd() < .7 ? 800 : 5000)}`);
    else if (r < 0.28) run(`add_equipment ${A} it${idc++} ${pick(EQ)} ${ri(0, rnd() < .7 ? 30 : 2000)} ${ri(1, rnd() < .5 ? 3000 : 200000)}`);
    else if (r < 0.33) {
      const ids = P.inventory.slots.filter(Boolean).map(x => x.id);
      run(`remove_item ${A} ${ids.length && rnd() < .9 ? pick(ids) : 'it' + ri(0, idc + 3)}`);
    } else if (r < 0.50) run(`use_item ${A} ${rnd() < .4 ? A : pick(names)}`);
    else if (r < 0.62) { let B = pick(names); if (B === A) continue; run(`attack ${A} ${B}`); }
    else if (r < 0.70) run(`change_slot ${A} ${ri(0, 8)}`);
    else if (r < 0.80) run(`swap ${A} ${ri(0, 35)} ${rnd() < .5 ? ri(0, 8) : ri(0, 35)}`);
    else if (r < 0.83) run(`query ${A}`);
    else if (r < 0.90) { const B = pick(names); if (B === A) continue; run(`add_subscribe ${A} ${B}`); }
    else if (r < 0.94) { const B = pick(names); if (B === A) continue; run(`remove_subscribe ${A} ${B}`); }
    else {
      // load_subscribe：存活玩家组成的随机树，边不与现有关注重复
      const alive = names.filter(n => !sys.findPlayer(n).isDead());
      if (alive.length < 2) continue;
      const nodes = alive.slice().sort(() => rnd() - .5).slice(0, ri(2, alive.length));
      const kids = new Map(nodes.map(n => [n, []]));
      let ok = true;
      for (let i = 1; i < nodes.length; i++) {
        const par = nodes[ri(0, i - 1)];
        if (sys.findPlayer(par).subscribingPlayers.some(p => p.name === nodes[i])) { ok = false; break; }
        kids.get(par).push(nodes[i]);
      }
      if (!ok) continue;
      const ws = () => pick(['', ' ', '  ', '\t']);
      const build = n => n + (kids.get(n).length ? ws() + '(' + ws() + kids.get(n).map(build).join(ws() + ',' + ws()) + ws() + ')' : '');
      run('load_subscribe ' + build(nodes[0]));
    }
  }
  return cmds;
}

let fail = 0, lines = 0;
for (let r = 0; r < ROUNDS; r++) {
  const cmds = gen();
  const input = cmds.length + '\n' + cmds.join('\n') + '\n';
  const javaOut = execFileSync('java', ['-cp', BIN, 'MainClass'], { input, maxBuffer: 1 << 26 }).toString().replace(/\r/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
  const jsOut = new OO.GameSystem().run((input).split('\n'));
  lines += javaOut.length;
  const len = Math.max(javaOut.length, jsOut.length);
  for (let i = 0; i < len; i++) {
    if (javaOut[i] !== jsOut[i]) {
      fail++;
      console.log(`[第${r}轮] 第${i}行不一致\n  java: ${javaOut[i]}\n  js  : ${jsOut[i]}`);
      fs.writeFileSync(path.join(os.tmpdir(), `oopre-fail-${r}.txt`), input);
      break;
    }
  }
  if (fail >= 3) break;
}
console.log(fail ? `失败 ${fail} 轮` : `全部一致：${ROUNDS} 轮，共比较 ${lines} 行输出`);
process.exit(fail ? 1 : 0);
