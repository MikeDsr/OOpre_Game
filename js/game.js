/* ============================================================
   誓约竞技场 · game.js —— 对局流程
   所有改变状态的行为都通过 sys.execute(指令) 交给引擎，
   然后把返回的事件交给导演演出。玩法规则（回合、结盟、掉落、胜负）只在这一层。
   ============================================================ */
'use strict';
OO.game = (() => {
  const U = OO.U, D = OO.data;
  const G = {
    sys: null, heroId: 'Hero', defs: new Map(), round: 0, phase: 'idle', over: false,
    busy: false, idc: 0, grudges: new Map(), betrayals: new Set(), stats: null, mode: 'match',
    heroResolve: null, hook: null, opponents: 4, deathOrder: [], session: 0,
  };

  /* ---------------- 指令执行 ---------------- */
  async function exec(cmd, o = {}) {
    const r = G.sys.execute(cmd);
    await OO.director.play(r.events, o);
    afterExec(r.events);
    return r;
  }
  function afterExec(events) {
    for (const e of events) {
      if (e.type === 'attack') { addGrudge(e.target, e.attacker, 1); if (e.attacker === G.heroId) G.stats.dealt += e.damage; if (e.target === G.heroId) G.stats.taken += e.damage; }
      if (e.type === 'damage' && e.target !== G.heroId && G.lastActor === G.heroId && !events.some(x => x.type === 'attack')) G.stats.dealt += e.amount;
      if (e.type === 'aid' && e.target === G.heroId && e.helper !== G.heroId) G.stats.aided++;
      if (e.type === 'death') { G.deathOrder.push(e.player); if (G.lastActor === G.heroId && e.player !== G.heroId) G.stats.kills++; }
      if (e.type === 'use' && e.target !== e.user && e.item.type === 'DamagePotion') addGrudge(e.target, e.user, 1);
    }
    refreshRelations();
    OO.ui.refreshAll();
  }
  function addGrudge(who, against, v) { const k = who + '>' + against; G.grudges.set(k, (G.grudges.get(k) || 0) + v); }

  /* ---------------- 关系 ---------------- */
  const P = n => G.sys.findPlayer(n);
  function subs(a, b) { const pa = P(a), pb = P(b); return !!(pa && pb && pa.getSubscribingPlayers().includes(pb)); }
  function relation(n) {
    if (n === G.heroId) return 'self';
    const m = subs(G.heroId, n), t = subs(n, G.heroId);
    return m && t ? 'ally' : t ? 'guard' : m ? 'ward' : 'enemy';
  }
  function refreshRelations() {
    if (!G.sys) return;
    for (const ch of OO.world.chars.values()) {
      const r = relation(ch.name);
      ch.relation = r === 'ally' || r === 'guard' ? 'ally' : r === 'self' ? 'self' : 'enemy';
    }
  }

  /* ---------------- 开局 ---------------- */
  function itemCmd(owner, spec) {
    // spec: ['potion', type, tag, amp] | ['equipment', type, tag, value, dur]
    const id = `${spec[2]}_${++G.idc}`;
    return spec[0] === 'potion' ? `add_potion ${owner} ${id} ${spec[1]} ${spec[3]}` : `add_equipment ${owner} ${id} ${spec[1]} ${spec[3]} ${spec[4]}`;
  }

  async function setup(opts = {}) {
    G.session++;
    const pend = G.heroResolve; G.heroResolve = null; if (pend) pend();
    G.busy = false;
    G.sys = new OO.GameSystem();
    G.mode = opts.mode || 'match';
    G.round = 0; G.over = false; G.heroActed = null; G.idc = 0; G.grudges.clear(); G.betrayals.clear(); G.defs.clear(); G.deathOrder = [];
    G.stats = { dealt: 0, taken: 0, kills: 0, aided: 0, rounds: 0 };
    G.hook = opts.hook || null;
    OO.world.clearChars();
    OO.ui.clearLog();
    const heroName = (opts.heroName || 'Hero').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || 'Hero';
    G.heroId = heroName;
    const heroDef = Object.assign({}, D.hero, { id: heroName, name: opts.heroDisplay || heroName, isHero: true });
    let roster;
    if (G.mode === 'tutorial') roster = [heroDef, D.tutorial.mentor, D.tutorial.golem];
    else roster = [heroDef, ...U.shuffle(D.rivals.slice()).slice(0, G.opponents)];
    // 站位：主角在正前方，其余均匀分布
    const n = roster.length;
    roster.forEach((def, i) => {
      G.defs.set(def.id, def);
      const angle = Math.PI / 2 + i / n * U.TAU;
      const cmd = `add_player ${def.id} ${def.hp} ${def.max} ${def.shield} ${def.atk}`;
      const r = G.sys.execute(cmd);
      OO.world.addChar(def, G.sys.findPlayer(def.id).snap(), angle);
      OO.director.play(r.events, { quiet: true });
    });
    OO.ui.buildTurnBar(roster.map(d => d.id));
    // 初始装备（静默执行，终端可见完整指令）
    for (const def of roster) {
      const kit = G.mode === 'tutorial' && def.id === heroName ? D.hero.kit : def.kit || [];
      for (const spec of kit) await exec(itemCmd(def.id, spec), { quiet: true });
      for (const type of def.equip || []) {
        const p = P(def.id);
        const it = OO.ai.items(p).find(x => x.it.getType() === type);
        if (it) for (const c of [`change_slot ${def.id} ${it.slot}`, `use_item ${def.id} ${def.id}`, `change_slot ${def.id} 0`]) await exec(c, { quiet: true });
      }
    }
    refreshRelations();
    OO.ui.refreshAll();
    OO.ui.showHUD(true);
  }

  async function start(opts = {}) {
    await setup(opts);
    OO.audio.music.setMode('battle');
    OO.audio.music.setIntensity(0.2);
    if (G.mode === 'tutorial') return; // 教程自行驱动
    await U.wait(0.6);
    // 命运之线：开局盟约
    const pacts = D.openingPacts[G.opponents] || [];
    const alive = new Set(G.sys.playerList.map(p => p.name));
    const usable = pacts.filter(s => (s.match(/[A-Za-z_]+/g) || []).every(nm => alive.has(nm)));
    if (usable.length) {
      const s = U.pick(usable);
      await exec('load_subscribe ' + s, { quietLoad: false });
      await U.wait(1.2);
    }
    loop();
  }

  /* ---------------- 回合循环 ---------------- */
  async function loop() {
    const sess = G.session, gone = () => sess !== G.session;
    while (!G.over && !gone()) {
      G.round++; G.stats.rounds = G.round;
      OO.ui.setRound(G.round);
      OO.audio.play('roundStart');
      OO.ui.banner(`第 ${G.round} 轮`, '按加入顺序依次行动', 'round');
      updateIntensity();
      await U.wait(0.8);
      for (const p of G.sys.playerList.slice()) {
        if (G.over || gone()) return;
        if (p.isDead()) continue;
        await checkFinalDuel();
        G.lastActor = p.name;
        OO.world.setActive(p.name); OO.ui.setTurn(p.name);
        if (p.name === G.heroId) await heroTurn();
        else await aiTurn(p);
        if (gone()) return;
        if (checkEnd()) break;
        await U.wait(0.1);
      }
      OO.world.setActive(null);
      if (G.over || gone()) break;
      await lootPhase();
      if (gone()) return;
      await maybeProposals();
    }
  }

  function updateIntensity() {
    const alive = G.sys.playerList.filter(p => !p.isDead()).length;
    const h = P(G.heroId);
    const low = h && !h.isDead() ? 1 - h.getHitPoint() / h.getMaxHitPoint() : 0.5;
    OO.audio.music.setIntensity(U.clamp(0.25 + G.round * 0.04 + (5 - alive) * 0.12 + low * 0.35, 0, 1));
    OO.world.redVignette = h && !h.isDead() && h.getHitPoint() / h.getMaxHitPoint() < 0.3 ? 0.35 : 0;
  }

  function heroTurn() {
    OO.audio.play('yourTurn');
    OO.ui.setHeroTurn(true);
    OO.ui.toast('你的回合 · 选择目标并行动', 'gold');
    return new Promise(res => { G.heroResolve = res; });
  }
  function endHeroTurn() {
    OO.ui.setHeroTurn(false);
    const r = G.heroResolve; G.heroResolve = null;
    if (r) r();
  }

  async function aiTurn(p) {
    OO.audio.play('enemyTurn');
    await U.wait(0.22);
    let plan = G.hook && G.hook.aiTurn ? G.hook.aiTurn(p) : null;
    if (!plan) plan = OO.ai.decide(G.sys, p, api);
    const sess = G.session;
    OO.ui.setThinking(p.name, plan.label);
    if (plan.target) { OO.world.setSelected(null); }
    for (const cmd of plan.steps) {
      if (sess !== G.session) return;
      const isFree = /^(change_slot|swap|remove_subscribe)/.test(cmd);
      await exec(cmd, { actor: p.name, quiet: false });
      if (isFree) await U.wait(0.08);
      if (G.over) break;
    }
    OO.ui.setThinking(null);
    updateIntensity();
  }

  function checkEnd() {
    const h = P(G.heroId);
    const alive = G.sys.playerList.filter(p => !p.isDead());
    if (G.mode === 'tutorial') return false;
    if (!h || h.isDead()) { finish(false); return true; }
    if (alive.length === 1) { finish(true); return true; }
    return false;
  }

  /* 所有存活 AI 都无人可打 → 誓约失效，进入最终决战 */
  async function checkFinalDuel() {
    const alive = G.sys.playerList.filter(p => !p.isDead());
    const ais = alive.filter(p => p.name !== G.heroId);
    if (alive.length < 2 || !ais.length) return;
    const stuck = ais.every(a => alive.every(x => x === a || aiFriendly(a, x)));
    if (!stuck) return;
    OO.ui.banner('最终决战', '残存者之间的誓约全部失效', 'fate');
    OO.audio.play('pactBreak');
    await U.wait(1);
    for (const a of alive) for (const b of a.getSubscribingPlayers().slice()) if (!b.isDead()) await exec(`remove_subscribe ${a.name} ${b.name}`);
  }

  async function finish(win) {
    if (G.over) return;
    G.over = true;
    const sess = G.session;
    OO.ui.setHeroTurn(false);
    OO.world.setActive(null);
    await U.wait(1.2);
    if (sess !== G.session) return;
    OO.audio.music.setMode('silent');
    OO.audio.play(win ? 'victory' : 'defeat');
    if (win) { OO.world.letterbox = 1; OO.world.focusOn([G.heroId], 1.3); const c = OO.world.chars.get(G.heroId); OO.world.fx.beam(G.heroId, '#ffd36b', { life: 3, w: 60, h: 800 }); OO.world.fx.embers(c.pos.x, 0, c.pos.z, '#ffd36b', 120, { h: 200, vy: 300, life: 3 }); }
    const place = win ? 1 : G.sys.playerList.length - G.deathOrder.indexOf(G.heroId);
    OO.ui.showEnd(win, Object.assign({ place, total: G.sys.playerList.length }, G.stats));
  }

  /* ---------------- 主角行动 ---------------- */
  async function heroAct(kind, arg) {
    if (!G.heroResolve || G.busy || G.over) return false;
    const h = P(G.heroId), hn = G.heroId;
    if (!h || h.isDead()) return false;
    if (G.hook && G.hook.gate && !G.hook.gate(kind, arg)) return false;
    const tgt = arg && arg.target;
    G.busy = true; OO.ui.setBusy(true);
    let endTurn = true;
    try {
      switch (kind) {
        case 'attack': {
          if (!tgt || tgt === hn) { endTurn = false; break; }
          if (subs(hn, tgt) || subs(tgt, hn)) await betray(tgt);
          await exec(`attack ${hn} ${tgt}`, { actor: hn });
          break;
        }
        case 'use': {
          const t = tgt || hn;
          const it = h.getMainHandItem();
          if (it && it.getType() === 'DamagePotion' && t !== hn && (subs(hn, t) || subs(t, hn))) await betray(t);
          await exec(`use_item ${hn} ${t}`, { actor: hn });
          break;
        }
        case 'useSlot': { // 背包里直接使用：临时换到主手 → 使用 → 换回
          const slot = arg.slot, cur = h.slotId, t = arg.target || hn;
          if (slot !== cur) await exec(`swap ${hn} ${slot} ${cur}`, { actor: hn });
          await exec(`use_item ${hn} ${t}`, { actor: hn });
          if (slot !== cur) await exec(`swap ${hn} ${slot} ${cur}`, { actor: hn });
          break;
        }
        case 'pact': {
          if (!tgt || tgt === hn) { endTurn = false; break; }
          const t = P(tgt);
          const chance = arg.force != null ? arg.force : OO.ai.pactChance(G.sys, t, h, api);
          OO.audio.play('select');
          OO.world.fx.text(hn, '提出誓约', { col: '#ffd36b', size: 22, kind: 'label', y: 220, sub: `→ ${OO.world.chars.get(tgt).display}` });
          await U.wait(0.9);
          if (Math.random() < chance) {
            if (!subs(hn, tgt)) await exec(`add_subscribe ${hn} ${tgt}`, { actor: hn });
            if (!subs(tgt, hn)) await exec(`add_subscribe ${tgt} ${hn}`, { actor: tgt });
            G.betrayals.delete(tgt);
          } else {
            OO.audio.play('error');
            OO.world.fx.text(tgt, '拒绝了誓约', { col: '#ff9a9a', size: 24, kind: 'label', y: 220 });
            await U.wait(0.8);
          }
          break;
        }
        case 'wait': OO.world.fx.text(hn, '蓄势待发', { col: '#cfd8ff', size: 22, kind: 'label', y: 210 }); await U.wait(0.5); break;
        // —— 免费动作 ——
        case 'slot': endTurn = false; await exec(`change_slot ${hn} ${arg.slot}`, { actor: hn }); OO.audio.play('slot'); break;
        case 'swap': endTurn = false; await exec(`swap ${hn} ${arg.a} ${arg.b}`, { actor: hn }); OO.audio.play('swap'); break;
        case 'discard': endTurn = false; await exec(`remove_item ${hn} ${arg.id}`, { actor: hn }); break;
        case 'unsub': endTurn = false; await exec(`remove_subscribe ${hn} ${tgt}`, { actor: hn }); G.betrayals.add(tgt); break;
        default: endTurn = false;
      }
    } finally {
      G.busy = false; OO.ui.setBusy(false);
    }
    OO.ui.refreshAll();
    if (G.hook && G.hook.after) G.hook.after(kind, arg);
    if (endTurn) { G.heroActed = kind; endHeroTurn(); }
    return true;
  }

  async function betray(tgt) {
    const hn = G.heroId;
    OO.ui.banner('背誓', `你向 ${OO.world.chars.get(tgt).display} 挥出了刀刃`, 'alarm');
    if (subs(hn, tgt)) await exec(`remove_subscribe ${hn} ${tgt}`, { actor: hn });
    if (subs(tgt, hn)) await exec(`remove_subscribe ${tgt} ${hn}`, { actor: tgt });
    G.betrayals.add(tgt);
    addGrudge(tgt, hn, 2);
  }

  /* ---------------- 战利品 ---------------- */
  function rollItem(round, forHero) {
    const type = U.weighted(D.loot.weights);
    const boost = Math.min(round * 0.06, 0.6);
    const rw = {}; D.rarity.forEach((r, i) => rw[i] = r.w * (i ? 1 + boost * i * 1.4 : 1 - boost * 0.5));
    const ri = +U.weighted(rw), rar = D.rarity[ri];
    const g = (1 + round * D.loot.growth) * rar.mul;
    const rng = ([a, b]) => U.randi(a, b);
    let spec;
    if (D.potionTypes.includes(type)) {
      const amp = U.clamp(Math.round(rng(D.loot.potion[type]) * (type === 'StrengthPotion' ? Math.sqrt(g) : g)), 1, 5000);
      spec = ['potion', type, { HealPotion: 'heal', AbsorptionPotion: 'shield', DamagePotion: 'venom', StrengthPotion: 'rage' }[type], amp];
    } else if (type === 'Sword') {
      spec = ['equipment', type, 'sword', U.clamp(Math.round(rng(D.loot.sword.value) * g), 0, 200000), U.clamp(Math.round(rng(D.loot.sword.dur) * Math.sqrt(g)), 1, 200000)];
    } else {
      spec = ['equipment', type, type.toLowerCase(), U.clamp(Math.round(rng(D.loot.armor.value) * g), 0, 200000), U.clamp(Math.round(rng(D.loot.armor.dur) * Math.sqrt(g)), 1, 200000)];
    }
    return { spec, rarity: rar, type };
  }

  async function lootPhase() {
    const h = P(G.heroId);
    if (h && !h.isDead()) {
      const cards = [rollItem(G.round, true), rollItem(G.round, true), rollItem(G.round, true)];
      cards.forEach(c => c.preview = itemCmd(G.heroId, c.spec)); // 预生成 ID，确保展示指令与实际一致
      const sess = G.session;
      const pick = await OO.ui.showLoot(cards, h.getItemCount());
      if (sess !== G.session) return;
      if (pick != null) await exec(cards[pick].preview, { actor: G.heroId });
    }
    // 对手同时获得补给
    const events = [];
    for (const p of G.sys.playerList) {
      if (p.isDead() || p.name === G.heroId) continue;
      const r = G.sys.execute(itemCmd(p.name, rollItem(G.round, false).spec));
      events.push(...r.events);
      OO.world.fx.beam(p.name, '#9fd0ff', { life: 0.9, w: 22 });
    }
    if (events.length) { OO.audio.play('beam'); OO.audio.play('loot', { delay: 0.35 }); }
    await OO.director.play(events, { quietItems: true });
    afterExec(events);
    await U.wait(0.6);
  }

  /* 偶尔有对手主动求盟 */
  async function maybeProposals() {
    const h = P(G.heroId); if (!h || h.isDead() || G.over) return;
    if (Math.random() > 0.35) return;
    const cands = G.sys.playerList.filter(p => !p.isDead() && p !== h && !subs(p.name, G.heroId) && !G.betrayals.has(p.name) && (G.grudges.get(p.name + '>' + G.heroId) || 0) < 1);
    if (!cands.length) return;
    const p = U.pick(cands);
    const ok = await OO.ui.confirm(`${OO.world.chars.get(p.name).display} 提议与你缔结誓约`, '接受后你们将互相关注（add_subscribe 双向），任何一方跌破半血时，另一方会自动用药水援助。它也将不再攻击你。', '缔结誓约', '拒绝');
    if (ok) {
      if (!subs(G.heroId, p.name)) await exec(`add_subscribe ${G.heroId} ${p.name}`, { actor: G.heroId });
      await exec(`add_subscribe ${p.name} ${G.heroId}`, { actor: p.name });
    } else addGrudge(p.name, G.heroId, 0.4);
  }

  function onDeathShown(n) { OO.ui.markDead(n); updateIntensity(); }

  function aiFriendly(me, other) { return me.getSubscribingPlayers().includes(other); }

  const api = {
    get sys() { return G.sys; }, get heroId() { return G.heroId; }, get round() { return G.round; },
    get busy() { return G.busy; }, get over() { return G.over; }, get isHeroTurn() { return !!G.heroResolve; },
    get mode() { return G.mode; }, set opponents(v) { G.opponents = v; }, get opponents() { return G.opponents; },
    get stats() { return G.stats; },
    defOf: n => G.defs.get(n) || {},
    grudge: (who, against) => G.grudges.get(who + '>' + against) || 0,
    betrayedBy: n => G.betrayals.has(n),
    aiFriendly, relation, subs, refreshRelations, onDeathShown,
    start, setup, exec, heroAct, endHeroTurn, heroTurn, aiTurn, lootPhase, rollItem, itemCmd, finish,
    set hook(h) { G.hook = h; }, get hook() { return G.hook; },
    set over(v) { G.over = v; },
  };
  return api;
})();
