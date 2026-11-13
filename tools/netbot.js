/* 联机无头测试：N 个机器人玩家连同一房间，自动打完整局，
   并校验每个客户端用本地引擎重放出的结果完全一致。
   用法：node tools/netbot.js [服务器=http://127.0.0.1:8787] [真人数=3] [总人数=5] [房间码]
   也可以只开 2 个机器人，再用浏览器加入同一房间码一起玩。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Math, Date, JSON, Map, Set, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['engine.js', 'data.js', 'util.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
const OO = ctx.OO;

const SERVER = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const HUMANS = +process.argv[3] || 3, SEATS = +process.argv[4] || 5;
const CODE = process.argv[5] || ('T' + Math.random().toString(36).slice(2, 6).toUpperCase());
const sleep = ms => new Promise(r => setTimeout(r, ms));

function bot(i) {
  return new Promise((resolve, reject) => {
    const host = i === 0;
    const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws/' + CODE + (host ? '?create=1' : ''));
    const me = { i, pid: null, char: null, sys: new OO.GameSystem(), out: [], turns: 0, fx: {}, acts: {}, result: null, lobby: null };
    const send = o => ws.send(JSON.stringify(o));
    ws.onopen = () => send({ t: 'hello', name: 'Bot' + i });
    ws.onerror = e => reject(e);
    ws.onmessage = async ev => {
      const m = JSON.parse(ev.data);
      switch (m.t) {
        case 'err': reject(new Error(m.msg)); break;
        case 'round': if (host && process.env.V) console.log('  第', m.round, '轮'); break;
        case 'welcome': me.pid = m.pid; if (host) globalThis.__hostReady = true; break;
        case 'lobby': {
          me.lobby = m;
          if (m.phase !== 'lobby') break;
          const p = m.players.find(x => x.pid === me.pid);
          if (host && p) {
            if (m.seats !== SEATS && m.players.length <= SEATS) send({ t: 'seats', n: SEATS });
            else if (m.players.length === (+process.env.WAIT || HUMANS) && m.players.every(x => x.char) && !me.started) { me.started = true; await sleep(200); send({ t: 'start' }); }
          }
          break;
        }
        case 'start': me.char = m.roster.find(r => r.pid === me.pid).char; me.roster = m.roster; break;
        case 'batch':
          for (const c of m.cmds) me.out.push(...me.sys.execute(c).lines);
          // LAG=1：1 号机器人像“切到后台的旧客户端”一样，从不回报演出完成
          if (!(process.env.LAG && i === 1)) send({ t: 'idle', seq: m.seq });
          break;
        case 'fx': me.fx[m.kind] = (me.fx[m.kind] || 0) + 1; break;
        case 'turn':
          if (host && process.env.V) process.stdout.write(' ' + m.who + (m.ai ? '(AI)' : ''));
          if (m.who === me.char) {
            me.turns++;
            if (process.env.AFK && i === 1) break; // AFK=1：1 号机器人挂机不操作
            if (process.env.THINK) await sleep(3000 + Math.random() * 9000); // THINK=1：模拟真人思考 3–12 秒
            await sleep(30);
            const P = me.sys.findPlayer(me.char);
            const foes = me.sys.playerList.filter(p => p !== P && !p.isDead());
            const r = Math.random();
            let kind, arg = {};
            if (r < 0.08 && foes.length) { kind = 'pact'; arg = { target: OO.U.pick(foes).name }; }
            else if (r < 0.15) { kind = 'slot'; arg = { slot: OO.U.randi(0, 8) }; send({ t: 'act', kind, arg }); kind = 'wait'; }
            else if (r < 0.3) {
              const it = OO.ai.items(P).find(x => x.it.isUsable());
              if (it) { kind = 'useSlot'; arg = { slot: it.slot, target: it.it.getType() === 'DamagePotion' && foes.length ? OO.U.pick(foes).name : me.char }; }
              else kind = 'wait';
            } else if (foes.length) { kind = 'attack'; arg = { target: foes.sort((a, b) => a.getHitPoint() - b.getHitPoint())[0].name }; }
            else kind = 'wait';
            me.acts[kind] = (me.acts[kind] || 0) + 1;
            send({ t: 'act', kind, arg });
          }
          break;
        case 'loot': await sleep(process.env.LOOTDELAY ? 3000 + Math.random() * 3000 : 50); send({ t: 'lootPick', i: OO.U.randi(0, 2) }); break; // LOOTDELAY=1：像真人一样想 3–6 秒再选
        case 'pactAsk': send({ t: 'pactReply', ok: Math.random() < 0.6 }); break;
        case 'over': me.result = m; if (!process.env.WAIT) ws.close(); resolve(me); break;
      }
    };
  });
}

(async () => {
  console.log(`房间 ${CODE}：${HUMANS} 个机器人玩家，共 ${SEATS} 个座位`);
  const t0 = Date.now();
  const first = bot(0);
  for (let t = 0; t < 600 && !globalThis.__hostReady; t++) await sleep(100); // 等房间真正建好
  const rest = [];
  for (let i = 1; i < HUMANS; i++) { rest.push(bot(i)); await sleep(150); }
  const bots = await Promise.race([Promise.all([first, ...rest]), sleep(420000).then(() => { throw new Error('超时：4 分钟内没打完'); })]);
  const ref = bots[0].out.join('\n');
  const same = bots.every(b => b.out.join('\n') === ref);
  console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，共 ${bots[0].result.rounds} 轮，输出 ${bots[0].out.length} 行`);
  console.log('排名', bots[0].result.ranking.map(r => `${r.place}.${r.char}${r.human ? '(人)' : ''}`).join('  '));
  bots.forEach(b => console.log(`  Bot${b.i} 操作 ${b.char}：回合 ${b.turns}，动作 ${JSON.stringify(b.acts)}，提示 ${JSON.stringify(b.fx)}`));
  let h = 0; for (const ch of ref) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  console.log('输出指纹', bots[0].out.length, h);
  console.log(same ? '✔ 所有客户端重放结果完全一致' : '✘ 客户端状态不一致！');
  process.exit(same ? 0 : 1);
})().catch(e => { console.error('失败：', e.message || e); process.exit(1); });
