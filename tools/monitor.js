/* 只读联机监控：接入一个房间，实时记录服务器黑匣子日志与全部广播，不占座位、不参与等待。
   用法：node tools/monitor.js <房间码> [服务器=https://oath-arena.kathiedesorcy28.workers.dev]
   国内网络若直连不通：NODE_USE_ENV_PROXY=1 node tools/monitor.js ABCDE */
'use strict';
const CODE = (process.argv[2] || '').toUpperCase();
const SERVER = (process.argv[3] || 'https://oath-arena.kathiedesorcy28.workers.dev').replace(/\/$/, '');
if (!/^[A-Z0-9]{4,8}$/.test(CODE)) { console.error('用法：node tools/monitor.js <房间码> [服务器]'); process.exit(1); }

const ts = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
const say = (...a) => console.log(ts(), ...a);
let last = { at: Date.now(), what: '(尚无消息)' }, phase = 'lobby', warned = 0, ws = null, retry = 0;

function summary(m) {
  switch (m.t) {
    case 'log': {
      const { t, at, room, e, ...rest } = m;
      return `【${e}】 ` + JSON.stringify(rest);
    }
    case 'batch': return `批次#${m.seq} ${m.tag}${m.actor ? ' ' + m.actor : ''}${m.label ? '（' + m.label + '）' : ''}: ${m.cmds.join(' | ')}`;
    case 'turn': return `回合 → ${m.who}${m.ai ? '（AI）' : `（真人，${Math.round(m.ms / 1000)}s）`}`;
    case 'round': return `═══ 第 ${m.round} 轮 ═══`;
    case 'fx': return `提示 ${m.kind} ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => !['t', 'kind'].includes(k))))}`;
    case 'lobby': return `大厅 phase=${m.phase} seats=${m.seats} 玩家=${m.players.map(p => `${p.name}/${p.char}${p.online ? '' : '(离线)'}`).join(', ')}`;
    case 'start': return `开局 阵容=${m.roster.map(r => r.char + (r.pid ? '(人:' + r.name + ')' : '(AI)')).join(' ')}`;
    case 'sync': return `同步快照：已执行 ${m.log.length} 条指令，第 ${m.round} 轮，当前回合 ${m.turn}，phase=${m.phase}`;
    case 'over': return `结束 胜者=${m.winner} 排名=${m.ranking.map(r => r.place + '.' + r.char).join(' ')}`;
    default: return JSON.stringify(m).slice(0, 300);
  }
}

function open() {
  const url = SERVER.replace(/^http/, 'ws') + '/ws/' + CODE + '?monitor=1';
  say(`连接 ${url} …`);
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; say('✔ 已接入（只读）'); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'pong') return;
    if (m.t === 'err') { say('✘ 服务器：', m.msg, '（房间不存在 = 尚未创建，或房间进程已被重启/回收）'); return; }
    if (m.t === 'lobby') phase = m.phase;
    if (m.t === 'start' || m.t === 'sync') phase = m.phase || 'playing';
    if (m.t === 'over') phase = 'over';
    const s = summary(m);
    last = { at: Date.now(), what: s.slice(0, 160) }; warned = 0;
    say(s);
  };
  ws.onclose = ev => {
    say(`✘ 连接断开 code=${ev.code} ${ev.reason || ''}`);
    if (++retry > 30) { say('放弃重连'); process.exit(1); }
    setTimeout(open, Math.min(10000, 1000 * retry));
  };
  ws.onerror = () => { /* onclose 会处理 */ };
}
open();

setInterval(() => { try { ws && ws.readyState === 1 && ws.send('ping'); } catch (e) { } }, 20000);
setInterval(() => {
  if (phase !== 'playing') return;
  const quiet = Math.round((Date.now() - last.at) / 1000);
  if (quiet >= 20 && quiet >= warned + 20) { warned = quiet; say(`⚠ 已静默 ${quiet}s，最后一条：${last.what}`); }
}, 5000);
