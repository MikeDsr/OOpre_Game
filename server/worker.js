/* ============================================================
   誓约竞技场 · 联机服务器（Cloudflare Worker + Durable Object）
   - 每个房间一个 Durable Object（Room），房间码即其名字
   - 服务器权威：在 Room 里运行与网页同一份 engine.js / ai.js，
     决定回合、AI 行动、战利品，并按顺序广播“作业指令”。
     客户端用本地引擎重放同样的指令序列 → 状态处处一致。
   ============================================================ */
import './shim.js';
import '../js/engine.js';
import '../js/data.js';
import '../js/util.js';
import '../js/ai.js';
import '../js/game.js';
import { DurableObject } from 'cloudflare:workers';

const OO = globalThis.OO;
const U = OO.U, D = OO.data, NET = D.net;
const CHARS = D.characters;
const charDef = id => CHARS.find(c => c.id === id);
const CODE_RE = /^[A-Z0-9]{4,8}$/;

const cors = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/ping') return Response.json({ ok: 'oath-arena' }, { headers: cors });
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{4,8})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket', { status: 426 });
      const code = m[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = n => { const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < n; i++) o += s[Math.floor(Math.random() * s.length)]; return o; };
const clean = (s, n = 12) => String(s || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, n);

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.code = null;
    this.conns = new Set();       // { ws, pid }
    this.players = [];            // 人类玩家 { pid, name, char, online, host }
    this.seats = 4;
    this.monitors = new Set();
    this.bornAt = Date.now();
    this.resetMatch();
    this.trace('ctor', {}); // 如果对局中途出现新的 ctor，说明房间进程被 Cloudflare 重启过
    // 心跳巡检：超过 75 秒没有任何消息的连接视为半断开，主动关闭（客户端会自动重连）
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const c of [...this.conns]) if (now - (c.last || 0) > 75000) { this.trace('stale', { name: this.nameOf(c.pid) }); try { c.ws.close(4008, 'stale'); } catch (e) { } this.onClose(c); }
    }, 15000);
  }

  resetMatch() {
    this.phase = 'lobby';
    this.sys = null; this.roster = []; this.log = []; this.seq = 0; this.round = 0;
    this.idc = 0; this.grudges = new Map(); this.betrayals = new Set(); this.deathOrder = []; this.bloodSince = 0;
    this.turn = null; this.turnEnds = 0; this.turnWaiter = null;
    this.lootPending = new Map();  // pid → { cards, resolve, ends }
    this.pactPending = null;       // { to, resolve, ends }
    this.idle = new Map();         // pid → 已演完的批次号
    this.slow = new Map();         // pid → 连续超时次数；≥2 时暂不等待它，追上进度后恢复
    this.gen = (this.gen || 0) + 1;
  }

  /* ---------------- 连接 ---------------- */
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop().toUpperCase();
    const create = url.searchParams.get('create') === '1';
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    if (!this.code) {
      if (!create || !CODE_RE.test(code)) { server.send(JSON.stringify({ t: 'err', code: 'noroom', msg: '房间不存在或已解散' })); server.close(4004, 'noroom'); return new Response(null, { status: 101, webSocket: client }); }
      this.code = code;
    }
    const conn = { ws: server, pid: null, last: Date.now() };
    if (url.searchParams.get('monitor') === '1') { // 只读监控：不占座位、不参与等待，只接收广播与黑匣子日志
      conn.monitor = true;
      this.monitors.add(conn);
      server.addEventListener('message', e => { if (e.data === 'ping') { conn.last = Date.now(); try { server.send('{"t":"pong"}'); } catch (err) { } } });
      const gone = () => { this.monitors.delete(conn); };
      server.addEventListener('close', gone); server.addEventListener('error', gone);
      this.trace('monitor', { players: this.players.map(p => ({ name: p.name, char: p.char, online: p.online, afk: !!p.afk })), phase: this.phase, uptimeSec: Math.round((Date.now() - this.bornAt) / 1000) });
      if (this.phase !== 'lobby') this.sendSync(conn);
      return new Response(null, { status: 101, webSocket: client });
    }
    this.conns.add(conn);
    server.addEventListener('message', e => this.onMessage(conn, e.data));
    const bye = () => this.onClose(conn);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* 黑匣子：关键节点打点。写入 Workers 日志，并实时推给只读监控端 */
  trace(e, data = {}) {
    const o = Object.assign({ t: 'log', at: Date.now(), room: this.code, e, round: this.round, turn: this.turn, seq: this.seq }, data);
    try { console.log(JSON.stringify(o)); } catch (err) { }
    if (this.monitors && this.monitors.size) { const s = JSON.stringify(o); for (const m of this.monitors) { try { m.ws.send(s); } catch (err) { } } }
  }
  nameOf(pid) { const p = pid && this.playerOf(pid); return p ? p.name : null; }

  send(conn, msg) { try { conn.ws.send(JSON.stringify(msg)); } catch (e) { /* 已断开 */ } }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.conns) { try { c.ws.send(s); } catch (e) { } }
    for (const m of this.monitors) { try { m.ws.send(s); } catch (e) { } }
  }
  connOf(pid) { for (const c of this.conns) if (c.pid === pid) return c; return null; }
  playerOf(pid) { return this.players.find(p => p.pid === pid); }
  seatOfChar(char) { return this.roster.find(r => r.char === char); }
  humanOnline(char) { const s = this.seatOfChar(char); if (!s || !s.pid) return false; const p = this.playerOf(s.pid); return !!(p && p.online && !p.afk); }
  setAfk(p, on) {
    if (!!p.afk === on) return;
    this.trace('afk', { name: p.name, on });
    p.afk = on; p.misses = 0;
    this.broadcast({ t: 'fx', kind: 'afk', who: p.char, on, name: p.name });
  }

  onClose(conn) {
    if (!this.conns.delete(conn)) return;
    this.trace('close', { name: this.nameOf(conn.pid), idleAck: this.idle.get(conn.pid) || 0, silentSec: Math.round((Date.now() - (conn.last || 0)) / 1000) });
    const p = conn.pid && this.playerOf(conn.pid);
    if (p && !this.connOf(p.pid)) {
      p.online = false;
      if (this.phase === 'lobby') {
        this.players = this.players.filter(x => x !== p);
        if (p.host && this.players.length) this.players[0].host = true;
      } else {
        this.broadcast({ t: 'fx', kind: 'toast', text: `${p.name} 掉线了，由 AI 暂时接管` });
        if (this.turnWaiter && this.turnWaiter.char === p.char) this.turnWaiter.resolve({ ai: true });
        const lp = this.lootPending.get(p.pid); if (lp) lp.resolve(null);
        if (this.pactPending && this.pactPending.to === p.char) this.pactPending.resolve(false);
      }
      this.pushLobby();
    }
    if (!this.conns.size && this.phase === 'lobby' && !this.players.length) this.code = null; // 空房间自动解散
  }

  onMessage(conn, raw) {
    if (typeof raw !== 'string' || raw.length > 4000) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    conn.last = Date.now();
    try {
      if (m.t === 'ping') return this.send(conn, { t: 'pong' });
      if (m.t === 'hello') return this.onHello(conn, m);
      const p = conn.pid && this.playerOf(conn.pid);
      if (m.t === 'idle') {
        if (conn.pid) { this.idle.set(conn.pid, Math.max(this.idle.get(conn.pid) || 0, m.seq | 0)); if ((m.seq | 0) >= this.seq) this.slow.delete(conn.pid); }
        this.checkIdle(); return;
      }
      if (!p) return;
      switch (m.t) {
        case 'pick': return this.onPick(p, m.char);
        case 'seats': if (p.host && this.phase === 'lobby') { this.seats = U.clamp(m.n | 0, Math.max(NET.minSeats, this.players.length), NET.maxSeats); this.pushLobby(); } return;
        case 'start': if (p.host && this.phase === 'lobby') this.startMatch(); return;
        case 'again': if (p.host && this.phase === 'over') { this.resetMatch(); this.pushLobby(); } return;
        case 'act': p.misses = 0; return this.onAct(p, m.kind, m.arg || {});
        case 'back': this.setAfk(p, false); return;
        case 'lootPick': { const lp = this.lootPending.get(p.pid); if (lp) lp.resolve(Number.isInteger(m.i) && m.i >= 0 && m.i < lp.cards.length ? m.i : null); return; }
        case 'pactReply': if (this.pactPending && this.pactPending.to === p.char) this.pactPending.resolve(!!m.ok); return;
        case 'diag': this.trace('diag', { name: p.name, d: m.d }); return;
        case 'emote': this.broadcast({ t: 'fx', kind: 'emote', who: p.char, text: clean(m.text, 16) }); return;
      }
    } catch (e) { console.error('消息处理出错', e); }
  }

  onHello(conn, m) {
    const name = clean(m.name) || '无名者';
    let p = m.pid && this.playerOf(String(m.pid));
    this.trace('hello', { name, reconnect: !!p, phase: this.phase });
    if (p) { // 重连
      const old = this.connOf(p.pid); if (old && old !== conn) { this.conns.delete(old); try { old.ws.close(4001, 'replaced'); } catch (e) { } }
      conn.pid = p.pid; p.online = true;
      if (p.afk) this.setAfk(p, false); // 重新连上 = 回来了
    } else if (this.phase === 'lobby') {
      if (this.players.length >= NET.maxSeats) { this.send(conn, { t: 'err', code: 'full', msg: '房间已满（最多 6 人）' }); return; }
      p = { pid: rid(12), name, char: null, online: true, host: !this.players.length };
      this.players.push(p);
      conn.pid = p.pid;
      if (this.seats < this.players.length) this.seats = this.players.length;
      const free = CHARS.map(c => c.id).filter(id => !this.players.some(x => x.char === id));
      p.char = free[0] || null;
    } else {
      conn.pid = null; // 对局中途加入：观战
    }
    this.send(conn, { t: 'welcome', pid: conn.pid, code: this.code, spectator: !conn.pid });
    if (this.phase !== 'lobby') this.sendSync(conn);
    if (p && this.phase !== 'lobby') this.broadcast({ t: 'fx', kind: 'toast', text: `${p.name} 重新连接` });
    this.pushLobby();
  }

  onPick(p, char) {
    if (this.phase !== 'lobby' || !charDef(char)) return;
    if (this.players.some(x => x !== p && x.char === char)) return;
    p.char = char; this.pushLobby();
  }

  pushLobby() {
    this.broadcast({
      t: 'lobby', code: this.code, phase: this.phase, seats: this.seats,
      players: this.players.map(p => ({ pid: p.pid, name: p.name, char: p.char, online: p.online, host: p.host })),
    });
  }

  /* ---------------- 对局：指令执行与同步 ---------------- */
  itemCmd(owner, spec) {
    const id = `${spec[2]}_${++this.idc}`;
    return spec[0] === 'potion' ? `add_potion ${owner} ${id} ${spec[1]} ${spec[3]}` : `add_equipment ${owner} ${id} ${spec[1]} ${spec[3]} ${spec[4]}`;
  }
  P(n) { return this.sys.findPlayer(n); }
  subs(a, b) { const pa = this.P(a), pb = this.P(b); return !!(pa && pb && pa.getSubscribingPlayers().includes(pb)); }

  /* 执行一批指令并广播；返回批次号 */
  run(cmds, actor, tag = 'act', extra = {}) {
    const ok = [];
    for (const c of cmds) {
      let r;
      try { r = this.sys.execute(c); } catch (e) { console.error('指令出错', c, e); continue; }
      ok.push(c); this.log.push(c);
      for (const e of r.events) {
        if (e.type === 'attack') this.addGrudge(e.target, e.attacker, 1);
        if (e.type === 'use' && e.target !== e.user && e.item.type === 'DamagePotion') this.addGrudge(e.target, e.user, 1);
        if (e.type === 'death') this.deathOrder.push(e.player);
      }
    }
    if (!ok.length && tag !== 'setup') return this.seq;
    this.seq++;
    this.broadcast(Object.assign({ t: 'batch', seq: this.seq, actor, cmds: ok, tag }, extra));
    return this.seq;
  }
  addGrudge(who, against, v) { const k = who + '>' + against; this.grudges.set(k, (this.grudges.get(k) || 0) + v); }

  /* 等所有在线玩家把 seq 之前的演出播完（有上限，慢的客户端不会卡住全场） */
  waitIdle(seq, cap = 8000) {
    return new Promise(resolve => {
      if (this.idleWaiter) this.finishIdle();
      this.idleWaiter = { seq, resolve };
      const t0 = Date.now();
      this.idleTimer = setTimeout(() => {
        const late = this.behind(seq);
        for (const c of late) this.slow.set(c.pid, (this.slow.get(c.pid) || 0) + 1);
        this.trace('idleCap', { batch: seq, waitedMs: Date.now() - t0, behind: late.map(c => ({ name: this.nameOf(c.pid), ack: this.idle.get(c.pid) || 0, strikes: this.slow.get(c.pid) })) });
        this.finishIdle();
      }, cap);
      this.lagTimer = setTimeout(() => {
        const w = this.idleWaiter; if (!w || w.seq !== seq) return;
        const names = this.behind(seq).filter(c => (this.slow.get(c.pid) || 0) < 2).map(c => (this.playerOf(c.pid) || {}).name).filter(Boolean);
        if (names.length) this.broadcast({ t: 'fx', kind: 'lag', names });
      }, 2500);
      this.checkIdle();
    });
  }
  behind(seq) { return [...this.conns].filter(c => c.pid && (this.idle.get(c.pid) || 0) < seq); }
  checkIdle() {
    const w = this.idleWaiter; if (!w) return;
    if (this.behind(w.seq).some(c => (this.slow.get(c.pid) || 0) < 2)) return;
    this.finishIdle();
  }
  finishIdle() { const w = this.idleWaiter; if (!w) return; this.idleWaiter = null; clearTimeout(this.idleTimer); clearTimeout(this.lagTimer); w.resolve(); }

  sendSync(conn) {
    this.send(conn, {
      t: 'sync', roster: this.roster, log: this.log, seq: this.seq, round: this.round, phase: this.phase,
      turn: this.turn, turnMs: Math.max(0, this.turnEnds - Date.now()), result: this.result || null, blood: this.bloodSince,
    });
    const lp = conn.pid && this.lootPending.get(conn.pid);
    if (lp) this.send(conn, { t: 'loot', cards: lp.cards, ms: Math.max(0, lp.ends - Date.now()), round: this.round });
  }

  /* ---------------- 开局 ---------------- */
  async startMatch() {
    const humans = this.players.filter(p => p.char);
    if (!humans.length) return;
    this.resetMatch();
    this.phase = 'playing';
    const gen = this.gen;
    const seats = Math.max(this.seats, humans.length);
    const taken = new Set(humans.map(p => p.char));
    const ais = U.shuffle(CHARS.map(c => c.id).filter(id => !taken.has(id))).slice(0, seats - humans.length);
    this.roster = [
      ...humans.map(p => ({ char: p.char, pid: p.pid, name: p.name })),
      ...ais.map(id => ({ char: id, pid: null, name: charDef(id).name })),
    ];
    this.sys = new OO.GameSystem();
    this.pushLobby();
    this.broadcast({ t: 'start', roster: this.roster });
    // 建角色、发初始装备、穿戴初始护甲
    const cmds = [];
    for (const r of this.roster) { const d = charDef(r.char); cmds.push(`add_player ${d.id} ${d.hp} ${d.max} ${d.shield} ${d.atk}`); }
    const setupSys = this.sys;
    for (const r of this.roster) {
      const d = charDef(r.char);
      for (const spec of d.kit || []) cmds.push(this.itemCmd(d.id, spec));
    }
    let seq = this.run(cmds, null, 'setup');
    const eq = [];
    for (const r of this.roster) {
      const d = charDef(r.char), p = setupSys.findPlayer(d.id);
      for (const type of d.equip || []) {
        const it = OO.ai.items(p).find(x => x.it.getType() === type);
        if (it) eq.push(`change_slot ${d.id} ${it.slot}`, `use_item ${d.id} ${d.id}`, `change_slot ${d.id} 0`);
      }
    }
    if (eq.length) seq = this.run(eq, null, 'setup');
    await this.waitIdle(seq, 8000);
    // 命运之线：两名 AI 之间随机结成同盟
    const aiIds = this.roster.filter(r => !r.pid).map(r => r.char);
    if (aiIds.length >= 2 && Math.random() < 0.7) {
      const [a, b] = U.shuffle(aiIds.slice());
      await this.waitIdle(this.run([`load_subscribe ${a}(${b}(${a}))`], null, 'fate'));
    }
    if (gen === this.gen) this.loop(gen).catch(e => console.error('回合循环异常退出', e));
  }

  /* ---------------- 回合循环 ---------------- */
  async loop(gen) {
    const alive = () => gen === this.gen && this.phase === 'playing';
    while (alive()) {
      // 所有人都离线：等 2 分钟，仍无人回来就解散对局
      if (![...this.conns].some(c => c.pid)) {
        let t = 0; while (alive() && ![...this.conns].some(c => c.pid) && t < 120) { await sleep(1000); t++; }
        if (!alive()) return;
        if (![...this.conns].some(c => c.pid)) { this.resetMatch(); this.pushLobby(); return; }
      }
      this.round++;
      this.trace('round', { alive: this.sys.playerList.filter(x => !x.isDead()).map(x => x.name), online: this.players.filter(x => x.online).map(x => x.name) });
      this.broadcast({ t: 'round', round: this.round });
      await sleep(900);
      for (const pl of this.sys.playerList.slice()) {
        if (!alive()) return;
        if (pl.isDead()) continue;
        await this.safe('最终决战', () => this.finalDuelCheck());
        await this.safe('回合 ' + pl.name, () => this.takeTurn(pl, gen));
        this.turnWaiter = null;
        if (!alive()) return;
        if (this.checkEnd()) return;
      }
      this.turn = null;
      await this.safe('血月', () => this.cursePhase(gen));
      if (!alive()) return;
      if (this.checkEnd()) return;
      await this.safe('战利品', () => this.lootPhase(gen));
    }
  }

  async safe(label, fn) {
    try { await fn(); } catch (e) { console.error(`${label} 出错，已跳过`, e); this.trace('error', { label, msg: String(e && e.stack || e).slice(0, 600) }); this.broadcast({ t: 'fx', kind: 'toast', text: `服务器跳过了一步异常（${label}）` }); }
  }

  api() {
    const self = this;
    return {
      get heroId() { return null; },
      defOf: n => charDef(n) || {},
      grudge: (a, b) => self.grudges.get(a + '>' + b) || 0,
      betrayedBy: (victim, by) => self.betrayals.has(victim + '>' + by),
      aiFriendly: (me, o) => me.getSubscribingPlayers().includes(o),
      multi: true,
      isHuman: n => !!(self.seatOfChar(n) || {}).pid,
    };
  }

  async takeTurn(pl, gen) {
    const n = pl.name;
    this.turn = n;
    const human = this.humanOnline(n);
    const ms = human ? NET.turnSec * 1000 : 0;
    this.turnEnds = Date.now() + ms;
    this.broadcast({ t: 'turn', who: n, ms, ai: !human, round: this.round });
    const t0 = Date.now();
    this.trace('turn', { who: n, ai: !human });
    if (!human) {
      await sleep(450);
      if (gen !== this.gen) return;
      const plan = OO.ai.decide(this.sys, pl, this.api());
      const seq = this.run(plan.steps, n, 'ai', { label: plan.label });
      this.trace('aiPlan', { who: n, label: plan.label, steps: plan.steps.length, batch: seq });
      await this.waitIdle(seq);
      this.trace('turnEnd', { who: n, how: 'ai', ms: Date.now() - t0 });
      return;
    }
    // 等真人行动：主动作结束回合；免费动作在 onAct 里直接执行
    const res = await new Promise(resolve => {
      this.turnWaiter = { char: n, resolve };
      this.turnTimer = setTimeout(() => resolve({ timeout: true }), ms);
    });
    clearTimeout(this.turnTimer); this.turnWaiter = null;
    this.trace('turnEnd', { who: n, how: res.timeout ? 'timeout' : res.ai ? 'disconnect→ai' : 'act', ms: Date.now() - t0 });
    if (gen !== this.gen) return;
    if (res.timeout) {
      this.broadcast({ t: 'fx', kind: 'timeout', who: n });
      const hp = this.playerOf(this.seatOfChar(n).pid);
      if (hp && (hp.misses = (hp.misses || 0) + 1) >= 2) this.setAfk(hp, true);
      await sleep(300); return;
    }
    if (res.ai) { // 中途掉线 → AI 代打
      const plan = OO.ai.decide(this.sys, pl, this.api());
      await this.waitIdle(this.run(plan.steps, n, 'ai', { label: plan.label }));
      return;
    }
    if (res.seq) await this.waitIdle(res.seq);
  }

  /* 真人的动作请求 */
  async onAct(p, kind, arg) {
    if (this.phase !== 'playing' || !p.char || this.turn !== p.char || !this.turnWaiter || this.turnWaiter.busy) {
      this.trace('actIgnored', { name: p.name, kind, why: this.phase !== 'playing' ? 'phase' : this.turn !== p.char ? 'notYourTurn' : !this.turnWaiter ? 'noWaiter' : 'busy' });
      return;
    }
    this.trace('act', { name: p.name, kind, target: arg && arg.target });
    const hn = p.char, me = this.P(hn);
    if (!me || me.isDead()) return;
    const valid = n => typeof n === 'string' && !!this.P(n) && !this.P(n).isDead();
    const tgt = arg.target;
    const w = this.turnWaiter;
    const end = seq => { w.resolve({ seq }); };
    const reject = msg => this.send(this.connOf(p.pid), { t: 'reject', msg });
    switch (kind) {
      // —— 免费动作 ——
      case 'slot': { const s = arg.slot | 0; if (s >= 0 && s <= 8) this.run([`change_slot ${hn} ${s}`], hn, 'free'); return; }
      case 'swap': { const a = arg.a | 0, b = arg.b | 0; if (a >= 0 && a <= 35 && b >= 0 && b <= 35) this.run([`swap ${hn} ${a} ${b}`], hn, 'free'); return; }
      case 'discard': { const id = String(arg.id || ''); if (/^[A-Za-z0-9_]{1,40}$/.test(id) && me.findItem(id)) this.run([`remove_item ${hn} ${id}`], hn, 'free'); return; }
      case 'unsub': if (valid(tgt) && this.subs(hn, tgt)) { this.betrayals.add(tgt + '>' + hn); this.run([`remove_subscribe ${hn} ${tgt}`], hn, 'free'); } return;
      // —— 主动作（结束回合） ——
      case 'attack': {
        if (!valid(tgt) || tgt === hn) return reject('目标无效');
        w.busy = true;
        return end(this.run([...this.betrayCmds(hn, tgt), `attack ${hn} ${tgt}`], hn));
      }
      case 'use': {
        const t = valid(tgt) ? tgt : hn;
        const it = me.getMainHandItem();
        w.busy = true;
        const pre = it && it.getType() === 'DamagePotion' && t !== hn ? this.betrayCmds(hn, t) : [];
        return end(this.run([...pre, `use_item ${hn} ${t}`], hn));
      }
      case 'useSlot': {
        const slot = arg.slot | 0, t = valid(tgt) ? tgt : hn, cur = me.slotId;
        const it = slot >= 0 && slot <= 35 && me.inventory.getItem(slot);
        if (!it) return reject('该格子是空的');
        w.busy = true;
        const pre = it.getType() === 'DamagePotion' && t !== hn ? this.betrayCmds(hn, t) : [];
        const cmds = slot !== cur ? [`swap ${hn} ${slot} ${cur}`, `use_item ${hn} ${t}`, `swap ${hn} ${slot} ${cur}`] : [`use_item ${hn} ${t}`];
        return end(this.run([...pre, ...cmds], hn));
      }
      case 'wait': w.busy = true; this.broadcast({ t: 'fx', kind: 'wait', who: hn }); return end(0);
      case 'pact': {
        if (!valid(tgt) || tgt === hn) return reject('目标无效');
        w.busy = true;
        clearTimeout(this.turnTimer); // 等待对方回应期间暂停回合计时
        this.broadcast({ t: 'fx', kind: 'propose', who: hn, to: tgt });
        let ok;
        if (this.humanOnline(tgt)) {
          const to = this.connOf(this.seatOfChar(tgt).pid);
          const ms = NET.pactSec * 1000;
          this.send(to, { t: 'pactAsk', from: hn, ms });
          ok = await new Promise(resolve => { this.pactPending = { to: tgt, resolve }; setTimeout(() => resolve(false), ms); });
          this.pactPending = null;
          this.send(to, { t: 'pactEnd' });
        } else {
          await sleep(700);
          ok = Math.random() < OO.ai.pactChance(this.sys, this.P(tgt), me, this.api());
        }
        if (this.turnWaiter !== w) return; // 期间回合已被结束（掉线等）
        if (ok) {
          this.betrayals.delete(tgt + '>' + hn); this.betrayals.delete(hn + '>' + tgt);
          const cmds = [];
          if (!this.subs(hn, tgt)) cmds.push(`add_subscribe ${hn} ${tgt}`);
          if (!this.subs(tgt, hn)) cmds.push(`add_subscribe ${tgt} ${hn}`);
          return end(this.run(cmds, hn, 'act'));
        }
        this.broadcast({ t: 'fx', kind: 'decline', who: tgt, to: hn });
        return end(0);
      }
    }
  }

  /* 攻击有关注关系的人 = 背誓：先双向解除 */
  betrayCmds(hn, tgt) {
    const c = [];
    if (this.subs(hn, tgt) || this.subs(tgt, hn)) {
      this.broadcast({ t: 'fx', kind: 'betray', who: hn, to: tgt });
      if (this.subs(hn, tgt)) c.push(`remove_subscribe ${hn} ${tgt}`);
      if (this.subs(tgt, hn)) c.push(`remove_subscribe ${tgt} ${hn}`);
      this.betrayals.add(tgt + '>' + hn);
      this.addGrudge(tgt, hn, 2);
    }
    return c;
  }

  /* 所有存活 AI 都无人可打 → 誓约失效 */
  async finalDuelCheck() {
    const alive = this.sys.playerList.filter(p => !p.isDead());
    const ais = alive.filter(p => !this.humanOnline(p.name));
    if (alive.length < 2 || !ais.length) return;
    if (!ais.every(a => alive.every(x => x === a || a.getSubscribingPlayers().includes(x)))) return;
    this.broadcast({ t: 'fx', kind: 'duel' });
    await sleep(1000);
    const cmds = [];
    for (const a of alive) for (const b of a.getSubscribingPlayers()) if (!b.isDead()) cmds.push(`remove_subscribe ${a.name} ${b.name}`);
    await this.waitIdle(this.run(cmds, null, 'duel'));
  }

  checkEnd() {
    const alive = this.sys.playerList.filter(p => !p.isDead());
    const humansAlive = this.roster.filter(r => r.pid && !this.P(r.char).isDead());
    if (alive.length > 1 && humansAlive.length > 0) return false;
    // 排名：存活者并列第一，其余按阵亡先后
    const n = this.roster.length, place = {};
    alive.forEach(p => place[p.name] = 1);
    this.deathOrder.forEach((c, i) => { if (!(c in place)) place[c] = n - i; });
    const ranking = this.roster.map(r => ({ char: r.char, name: r.name, human: !!r.pid, place: place[r.char] || n }))
      .sort((a, b) => a.place - b.place);
    this.result = { winner: alive.length === 1 ? alive[0].name : null, ranking, rounds: this.round };
    this.phase = 'over'; this.turn = null;
    this.broadcast(Object.assign({ t: 'over' }, this.result));
    this.trace('over', { winner: this.result.winner, rounds: this.round });
    this.pushLobby();
    return true;
  }

  /* ---------------- 血月：收尾机制（规则与单机共用 OO.game 里的函数） ---------------- */
  async cursePhase(gen) {
    const aliveN = this.sys.playerList.filter(p => !p.isDead()).length;
    if (!this.bloodSince && OO.game.bloodTrigger(this.round, aliveN)) {
      this.bloodSince = this.round;
      this.broadcast({ t: 'fx', kind: 'blood' });
      await sleep(1800);
    }
    if (!this.bloodSince || gen !== this.gen) return;
    const k = this.round - this.bloodSince + 1, E = D.endgame;
    this.broadcast({ t: 'fx', kind: 'curse', k, pct: Math.round((E.base + E.step * (k - 1)) * 100) });
    let seq = this.seq;
    for (const p of this.sys.playerList) {
      if (p.isDead()) continue;
      const c = OO.game.curseCmds(p, k, (o, s) => this.itemCmd(o, s));
      if (!c) continue;
      seq = this.run(c.main, p.name, 'curse');
      if (c.back && !p.isDead()) seq = this.run([c.back], p.name, 'curse');
    }
    await this.waitIdle(seq);
  }

  /* ---------------- 战利品：所有人同时三选一 ---------------- */
  async lootPhase(gen) {
    const ms = NET.lootSec * 1000;
    const picks = new Map();
    const waits = [];
    for (const r of this.roster) {
      const pl = this.P(r.char);
      if (!r.pid || pl.isDead()) continue;
      const pp = this.playerOf(r.pid);
      if (!pp || !pp.online || pp.afk) continue; // 暂离 / 离线的玩家由系统随机发放
      const cards = [0, 1, 2].map(() => { const it = OO.game.rollItem(this.round, true, !!this.bloodSince); return { type: it.type, spec: it.spec, rarity: it.rarity, preview: this.itemCmd(r.char, it.spec) }; });
      const ends = Date.now() + ms;
      waits.push(new Promise(resolve => {
        const done = i => { this.lootPending.delete(r.pid); picks.set(r.char, i == null ? null : cards[i].preview); resolve(); };
        this.lootPending.set(r.pid, { cards, ends, resolve: done });
        setTimeout(() => this.lootPending.has(r.pid) && done(null), ms);
      }));
      this.send(this.connOf(r.pid), { t: 'loot', cards, ms, round: this.round, count: pl.getItemCount() });
    }
    // 6 秒后还没选的人，告诉大家在等谁
    const nag = setTimeout(() => {
      const names = [...this.lootPending.keys()].map(pid => (this.playerOf(pid) || {}).name).filter(Boolean);
      if (names.length) this.broadcast({ t: 'fx', kind: 'lootwait', names });
    }, 6000);
    const lt0 = Date.now();
    this.trace('lootStart', { waiting: [...this.lootPending.keys()].map(pid => this.nameOf(pid)) });
    await Promise.all(waits);
    clearTimeout(nag);
    this.trace('lootPicked', { ms: Date.now() - lt0, picks: [...picks.entries()].map(([c, v]) => c + ':' + (v ? 'ok' : 'none')) });
    if (gen !== this.gen) return;
    for (const c of this.conns) this.send(c, { t: 'lootEnd' });
    const cmds = [];
    for (const r of this.roster) {
      const pl = this.P(r.char);
      if (pl.isDead()) continue;
      if (picks.has(r.char)) { const c = picks.get(r.char); if (c) cmds.push(c); }
      else cmds.push(this.itemCmd(r.char, OO.game.rollItem(this.round, false, !!this.bloodSince).spec));
    }
    await this.waitIdle(this.run(cmds, null, 'loot'));
  }
}
