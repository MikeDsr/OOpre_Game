/* 无头平衡模拟：所有角色（含主角）都由 AI 操作，跑 N 局统计。
   用法：node web/tools/sim.js [局数=300] [对手数=4] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Math, Date, JSON, Map, Set, Promise, setTimeout, localStorage: undefined };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['engine.js', 'data.js', 'util.js', 'ai.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
const OO = ctx.OO, U = OO.U, D = OO.data;

const N = +process.argv[2] || 300, OPP = +process.argv[3] || 4;
const dmg = { phys: [], magic: [] };
const agg = { blood: 0, rounds: [], heroWin: 0, heroPlace: [], aids: 0, deaths: 0, cmds: 0, duels: 0, winners: {}, errors: 0, maxRound: 0, fullInv: 0, broken: 0 };

for (let g = 0; g < N; g++) {
  const sys = new OO.GameSystem();
  const defs = new Map(), grudges = new Map();
  const hero = Object.assign({}, D.hero, { id: 'Hero', ai: { aggro: 0.6, potionLove: 0.5, loyalty: 0.5, heal: 0.5 } });
  const roster = [hero, ...U.shuffle(D.rivals.slice()).slice(0, OPP)];
  let idc = 0;
  const run = c => { agg.cmds++; const r = sys.execute(c); for (const e of r.events) {
      if (e.type === 'attack') { const t = sys.findPlayer(e.target); dmg.phys.push([e.damage, e.damage / t.getMaxHitPoint(), round]); }
      if (e.type === 'use' && e.item.type === 'DamagePotion' && !e.item.id.startsWith('curse_')) { const t = sys.findPlayer(e.target); dmg.magic.push([e.item.amp, e.item.amp / t.getMaxHitPoint(), round]); } if (e.type === 'aid') agg.aids++; if (e.type === 'death') agg.deaths++; if (e.type === 'attack') grudges.set(e.target + '>' + e.attacker, (grudges.get(e.target + '>' + e.attacker) || 0) + 1); if (e.type === 'inventoryFull') agg.fullInv++; if (e.type === 'durability' && e.broken) agg.broken++; } return r; };
  const itemCmd = (o, s) => { const id = `${s[2]}_${++idc}`; return s[0] === 'potion' ? `add_potion ${o} ${id} ${s[1]} ${s[3]}` : `add_equipment ${o} ${id} ${s[1]} ${s[3]} ${s[4]}`; };
  for (const d of roster) { defs.set(d.id, d); run(`add_player ${d.id} ${d.hp} ${d.max} ${d.shield} ${d.atk}`); }
  for (const d of roster) {
    for (const s of d.kit || []) run(itemCmd(d.id, s));
    for (const t of d.equip || []) { const p = sys.findPlayer(d.id); const it = OO.ai.items(p).find(x => x.it.getType() === t); if (it) { run(`change_slot ${d.id} ${it.slot}`); run(`use_item ${d.id} ${d.id}`); run(`change_slot ${d.id} 0`); } }
  }
  const pacts = (D.openingPacts[OPP] || []).filter(s => (s.match(/[A-Za-z_]+/g) || []).every(n => sys.findPlayer(n)));
  if (pacts.length) run('load_subscribe ' + U.pick(pacts));
  const api = {
    heroId: 'Hero', defOf: n => defs.get(n) || {}, grudge: (a, b) => grudges.get(a + '>' + b) || 0, betrayedBy: () => false,
    aiFriendly: (me, o) => me.getSubscribingPlayers().includes(o),
  };
  let round = 0, deathOrder = [], bloodSince = 0;
  try {
    while (round < 80) {
      round++;
      for (const p of sys.playerList) {
        if (p.isDead()) continue;
        const alive = sys.playerList.filter(x => !x.isDead());
        if (alive.length < 2) break;
        if (alive.every(a => alive.every(x => x === a || api.aiFriendly(a, x)))) { agg.duels++; for (const a of alive) for (const b of a.getSubscribingPlayers().slice()) run(`remove_subscribe ${a.name} ${b.name}`); }
        const plan = OO.ai.decide(sys, p, api);
        for (const c of plan.steps) { const r = run(c); for (const e of r.events) if (e.type === 'death') deathOrder.push(e.player); }
      }
      if (sys.playerList.filter(x => !x.isDead()).length < 2) break;
      // 血月
      if (!bloodSince && OO.game.bloodTrigger(round, sys.playerList.filter(x => !x.isDead()).length)) { bloodSince = round; agg.blood++; }
      if (bloodSince) {
        for (const p of sys.playerList) {
          if (p.isDead()) continue;
          const c = OO.game.curseCmds(p, round - bloodSince + 1, itemCmd);
          if (!c) continue;
          for (const x of c.main) { const r = run(x); for (const e of r.events) if (e.type === 'death') deathOrder.push(e.player); }
          if (c.back && !p.isDead()) run(c.back);
        }
      }
      const alive = sys.playerList.filter(x => !x.isDead());
      if (alive.length < 2) break;
      for (const p of alive) run(itemCmd(p.name, OO.game.rollItem(round, false, !!bloodSince).spec));
    }
  } catch (e) { agg.errors++; if (agg.errors < 3) console.error(e); }
  const alive = sys.playerList.filter(x => !x.isDead());
  agg.rounds.push(round); agg.maxRound = Math.max(agg.maxRound, round);
  const w = alive.length === 1 ? alive[0].name : 'none';
  agg.winners[w] = (agg.winners[w] || 0) + 1;
  if (w === 'Hero') agg.heroWin++;
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const sorted = agg.rounds.slice().sort((a, b) => a - b);
console.log(`局数 ${N}，对手 ${OPP}`);
console.log(`平均轮数 ${avg(agg.rounds)}（中位 ${sorted[N >> 1]}，最长 ${agg.maxRound}）`);
console.log(`主角(AI 操作)胜率 ${(agg.heroWin / N * 100).toFixed(1)}%，期望 ${(100 / (OPP + 1)).toFixed(1)}%`);
console.log('胜者分布', agg.winners);
console.log(`血月触发 ${(agg.blood / N * 100).toFixed(0)}% 的对局`);
console.log(`每局：援助 ${(agg.aids / N).toFixed(1)} 次，装备碎裂 ${(agg.broken / N).toFixed(1)} 次，背包满 ${(agg.fullInv / N).toFixed(1)} 次，指令 ${(agg.cmds / N).toFixed(0)} 条；最终决战触发 ${agg.duels} 次；异常 ${agg.errors}`);

const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
for (const k of ['phys', 'magic']) {
  const v = dmg[k].map(x => x[0]), r = dmg[k].map(x => x[1]);
  const late = dmg[k].filter(x => x[2] >= 8).map(x => x[0]);
  console.log(`${k === 'phys' ? '物理攻击' : '毒瓶'}：中位 ${pct(v, .5)}，90% ${pct(v, .9)}，99% ${pct(v, .99)}，最大 ${Math.max(...v)}；占对方最大体力 中位 ${(pct(r, .5) * 100).toFixed(0)}%，90% ${(pct(r, .9) * 100).toFixed(0)}%；≥100% 的比例 ${(r.filter(x => x >= 1).length / r.length * 100).toFixed(1)}%；第8轮后中位 ${pct(late, .5)}，90% ${pct(late, .9)}`);
}
