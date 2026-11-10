/* ============================================================
   誓约竞技场 · director.js —— 把引擎事件编排成演出
   引擎同步执行完一条指令后得到事件序列；导演按序播放：
   镜头、角色动作、特效、音效、飘字，并在恰当时机把“显示状态”同步为事件快照。
   ============================================================ */
'use strict';
OO.director = (() => {
  const U = OO.U, D = OO.data;
  const W = () => OO.world, A = (n, o) => OO.audio.play(n, o);
  const ch = n => OO.world.chars.get(n);
  const wait = s => U.wait(s);
  const name = n => { const c = ch(n); return c ? c.display : n; };
  const itemName = it => D.items[it.type].name;

  function panOf(n) { const c = ch(n); if (!c) return 0; const p = W().project(c.pos.x, 0, c.pos.z); return U.clamp((p.x / W().W) * 2 - 1, -1, 1) * 0.7; }
  function setSnap(n, snap) {
    const c = ch(n); if (!c || !snap) return;
    c.disp = snap;
    if (OO.ui && OO.game && OO.game.heroId === n) OO.ui.refreshHero();
    if (OO.ui) OO.ui.refreshInspect();
  }
  function face(a, b) {
    const ca = ch(a), cb = ch(b); if (!ca || !cb || a === b) return;
    const pa = W().project(ca.pos.x, 0, ca.pos.z), pb = W().project(cb.pos.x, 0, cb.pos.z);
    ca.a.lockFacing = true; ca.a.facing = pb.x >= pa.x ? 1 : -1;
  }
  function release(n) { const c = ch(n); if (c) c.a.lockFacing = false; }
  function chest(n, h = 95) { const c = ch(n); return { x: c.pos.x, y: h, z: c.pos.z }; }

  function hitFeedback(dmgEv, o = {}) {
    const c = ch(dmgEv.target); if (!c) return;
    const ratio = dmgEv.amount / Math.max(1, c.disp.max);
    const power = U.clamp(ratio * 4, 0.25, 1.4);
    const pan = panOf(dmgEv.target);
    const pos = chest(dmgEv.target);
    setSnap(dmgEv.target, dmgEv.snap);
    c.a.hurt = 1; c.a.squash = 1;
    if (dmgEv.shieldLoss > 0) {
      c.a.shieldHit = 1.2;
      A('shieldHit', { pan, power: U.clamp(dmgEv.shieldLoss / 200, 0.4, 1.2) });
      W().fx.spark(pos.x, pos.y, pos.z, { col: '#ffd76b', n: 26, max: 380 });
    }
    if (dmgEv.hpLoss > 0 || dmgEv.died) {
      if (!o.magic) A('impact', { pan, power });
      W().fx.spark(pos.x, pos.y, pos.z, { col: o.magic ? '#c77dff' : '#ff8a5c', n: 18 + Math.round(power * 30), max: 300 + power * 300 });
      W().fx.spark(pos.x, pos.y, pos.z, { col: '#ffffff', n: 8, max: 500, size: 2 });
    }
    if (!o.magic && c.disp.armorValue > 0) A('clang', { pan, power: 0.5, delay: 0.01 });
    // 数字
    const big = ratio >= 0.16;
    const sub = dmgEv.shieldLoss > 0 && dmgEv.hpLoss > 0 ? `护盾吸收 ${dmgEv.shieldLoss}` : dmgEv.shieldLoss > 0 ? '护盾吸收' : (o.sub || '');
    W().fx.text(dmgEv.target, String(dmgEv.amount), { col: o.magic ? '#d49bff' : big ? '#ffb02e' : '#ffe6d0', size: big ? 50 : 36, kind: big ? 'crit' : 'num', sub, y: 105, rise: 90 });
    W().shake(4 + power * 14);
    W().punch(power);
    U.time.freeze = Math.max(U.time.freeze, 0.04 + power * 0.07);
    W().fx.ring(c.pos.x, c.pos.z, o.magic ? '#b06bff' : '#ffb070', { r1: 100 + power * 120, w: 6 + power * 6, life: 0.5 });
    if (big) W().flash(o.magic ? '#a64dff' : '#ffffff', 0.18 + power * 0.1);
    // 击退
    const home = c.home;
    const atk = o.from ? ch(o.from) : null;
    if (atk) {
      const dx = c.pos.x - atk.pos.x, dz = c.pos.z - atk.pos.z, L = Math.hypot(dx, dz) || 1;
      const kb = 16 + power * 22;
      U.tween(0.08, k => { c.pos.x = home.x + dx / L * kb * k; c.pos.z = home.z + dz / L * kb * k; }, U.ease.outQuad)
        .then(() => U.tween(0.35, k => { c.pos.x = home.x + dx / L * kb * (1 - k); c.pos.z = home.z + dz / L * kb * (1 - k); }, U.ease.inOutQuad));
    }
    if (OO.game && dmgEv.target === OO.game.heroId) OO.ui.heroHit(power);
  }

  async function effectOn(target, type, before, after, o = {}) {
    const c = ch(target); if (!c) return;
    const pan = panOf(target);
    if (type === 'HealPotion') {
      A(o.aid ? 'aidArrive' : 'heal', { pan });
      W().fx.beam(target, '#5dff8f', { w: 40 });
      W().fx.embers(c.pos.x, 0, c.pos.z, '#7dffa6', 34, { h: 120, vy: 140 });
      W().fx.ring(c.pos.x, c.pos.z, '#5dff8f', { r1: 120, w: 5 });
      c.a.glowCol = '#7dffa6'; c.a.glow = 0.8;
      setSnap(target, after);
      W().fx.text(target, '+' + (after.hp - before.hp), { col: '#7dff9a', size: 36, sub: o.sub || '体力' });
    } else if (type === 'AbsorptionPotion') {
      A(o.aid ? 'aidArrive' : 'shieldUp', { pan });
      W().fx.beam(target, '#ffd36b', { w: 36 });
      W().fx.ring(c.pos.x, c.pos.z, '#ffd36b', { r1: 140, w: 6 });
      c.a.shieldHit = 1.4; c.a.glowCol = '#ffd36b'; c.a.glow = 0.6;
      setSnap(target, after);
      W().fx.text(target, '+' + (after.shield - before.shield), { col: '#ffd36b', size: 36, sub: o.sub || '护盾' });
    } else if (type === 'StrengthPotion') {
      A('strength', { pan });
      W().fx.embers(c.pos.x, 0, c.pos.z, '#ff6a2a', 46, { h: 160, vy: 220, size: 5 });
      W().fx.ring(c.pos.x, c.pos.z, '#ff6a2a', { r1: 170, w: 10 });
      c.a.glowCol = '#ff5a1a'; c.a.glow = 1; c.a.squash = 0.8;
      W().shake(8);
      setSnap(target, after);
      W().fx.text(target, '+' + (after.atk - before.atk), { col: '#ff8a3d', size: 38, sub: '基础攻击' });
    }
    await wait(0.5);
  }

  /* ---------------- 各事件演出 ---------------- */
  async function doAttack(ev, q) {
    const a = ch(ev.attacker), b = ch(ev.target); if (!a || !b) return;
    const follow = q.takeUntil(e => e.type === 'damage' && e.target === ev.target);
    const dmg = follow.find(e => e.type === 'damage');
    const durs = follow.filter(e => e.type === 'durability');
    W().focusOn([ev.attacker, ev.target], 1.14);
    face(ev.attacker, ev.target);
    const pan = panOf(ev.attacker);
    // 蓄力
    A('dash', { pan });
    await U.tween(0.16, k => { a.a.raise = k; a.a.squash = k * 0.4; }, U.ease.outQuad);
    // 冲刺
    const h = a.home, dx = b.pos.x - h.x, dz = b.pos.z - h.z, L = Math.hypot(dx, dz) || 1;
    const tx = b.pos.x - dx / L * 72, tz = b.pos.z - dz / L * 72;
    A('whoosh', { pan: panOf(ev.target), power: U.clamp(ev.damage / 200, 0.4, 1.2), delay: 0.1 });
    await U.tween(0.22, k => { a.pos.x = U.lerp(h.x, tx, k); a.pos.z = U.lerp(h.z, tz, k); a.pos.y = Math.sin(k * Math.PI) * 26; a.a.lean = 0.18 * k * a.a.facing; }, U.ease.inQuad);
    // 挥砍
    W().fx.slash(ev.target, ev.hand && ev.hand.type === 'Sword' ? '#9fd0ff' : '#ffd0a0', a.a.facing, U.clamp(ev.damage / 200, 0.5, 1.5));
    await U.tween(0.07, k => { a.a.raise = 1 - k * 1.6; a.a.spin = -k * 0.8; }, U.ease.inQuad);
    if (dmg) hitFeedback(dmg, { from: ev.attacker });
    // 伤害公式飘字（小）
    const red = Math.min(800, Math.max(8 * ev.v, 40 * ev.v - 20 * ev.d)) / 10;
    if (ev.v > 0 || ev.d > 0) W().fx.text(ev.target, `(${ev.a}+${ev.d})×${(100 - red).toFixed(1)}%`, { col: '#cfd8ff', size: 15, kind: 'label', y: 205, rise: 30, life: 1.6 });
    // 耐久
    let armorLoss = 0;
    for (const d of durs) {
      if (d.player === ev.target) armorLoss = Math.max(armorLoss, d.before - d.after);
      if (d.broken) {
        const who = d.player, c = ch(who), p = chest(who, d.slot >= 36 ? [140, 100, 55, 12][d.slot - 36] : 90);
        A('armorBreak', { pan: panOf(who), delay: 0.08 });
        W().fx.shards(p.x, p.y, p.z, '#c9d3e0', 18);
        W().fx.spark(p.x, p.y, p.z, { col: '#e6eef8', n: 20 });
        W().fx.text(who, `${itemName(d.item)} 碎裂！`, { col: '#ff6b6b', size: 22, kind: 'label', y: 230, life: 1.8 });
        setSnap(who, d.snap);
        if (c) c.a.hurt = 0.6;
      }
    }
    if (armorLoss > 0) W().fx.text(ev.target, `护甲耐久 -${armorLoss}`, { col: '#a8c8e8', size: 14, kind: 'label', y: 60, rise: 20, life: 1.3 });
    await wait(0.22);
    // 返回
    await U.tween(0.3, k => { a.pos.x = U.lerp(tx, h.x, k); a.pos.z = U.lerp(tz, h.z, k); a.pos.y = Math.sin(k * Math.PI) * 14; a.a.raise = U.lerp(-0.6, 0, k); a.a.spin = U.lerp(-0.8, 0, k); a.a.lean = U.lerp(0.18 * a.a.facing, 0, k); }, U.ease.inOutQuad);
    a.pos.y = 0; a.a.spin = 0; a.a.raise = 0;
    release(ev.attacker);
    // 攻击者手持物（耐久已扣）同步
    const handDur = durs.find(d => d.player === ev.attacker);
    if (handDur) setSnap(ev.attacker, handDur.snap);
  }

  async function doCurse(ev, q) {
    const c = ch(ev.target); if (!c) return;
    const follow = q.takeUntil(e => e.type === 'damage' && e.target === ev.target);
    const dmg = follow.find(e => e.type === 'damage');
    W().focusOn([ev.target], 1.08);
    const p = chest(ev.target, 100);
    A('throwP', { pan: panOf(ev.target) });
    W().fx.beam(ev.target, '#ff2a3a', { life: 0.9, w: 34, h: 900 });
    W().fx.bolt({ x: p.x + 40, y: 900, z: p.z }, p, '#ff4050');
    await U.wait(0.18);
    A('magic', { pan: panOf(ev.target) }); A('impact', { pan: panOf(ev.target), power: 0.7 });
    W().fx.spark(p.x, p.y, p.z, { col: '#ff3040', n: 40, max: 380 });
    W().fx.ring(c.pos.x, c.pos.z, '#ff2a3a', { r1: 180, w: 10 });
    if (dmg) hitFeedback(dmg, { magic: true, sub: '血月侵蚀' });
    await U.wait(0.5);
    const rest = q.takeUntil(e => e.type === 'used');
    const used = rest.find(e => e.type === 'used');
    if (used) { setSnap(ev.target, used.snap); setSnap(ev.user, used.userSnap); }
    q.unshift(rest.filter(e => e.type !== 'used'));
  }

  async function doUse(ev, q) {
    if (ev.item.id.startsWith('curse_')) return doCurse(ev, q);
    const user = ch(ev.user), tgt = ch(ev.target); if (!user || !tgt) return;
    const type = ev.item.type, self = ev.user === ev.target;
    const pan = panOf(ev.user);
    W().focusOn(self ? [ev.user] : [ev.user, ev.target], 1.1);
    face(ev.user, ev.target);
    const before = Object.assign({}, tgt.disp);
    if (type === 'DamagePotion') {
      const follow = q.takeUntil(e => e.type === 'damage' && e.target === ev.target);
      const dmg = follow.find(e => e.type === 'damage');
      await U.tween(0.18, k => { user.a.raise = k * 1.1; }, U.ease.outQuad);
      A('throwP', { pan });
      const from = { x: user.pos.x, y: 150, z: user.pos.z };
      user.a.raise = 0;
      user.disp = Object.assign({}, user.disp, { hand: null });
      await W().fx.projectile({ from, to: chest(ev.target, 100), dur: 0.55, arc: self ? 220 : 140, kind: 'flask', type, col: '#b06bff' });
      const p = chest(ev.target, 100);
      A('glass', { pan: panOf(ev.target) }); A('magic', { pan: panOf(ev.target) });
      W().fx.shards(p.x, p.y, p.z, 'rgba(210,180,255,.85)', 12);
      W().fx.spark(p.x, p.y, p.z, { col: '#b06bff', n: 50, max: 420 });
      W().fx.smoke(p.x, 20, p.z, '#7a2bd6', 14);
      W().fx.ring(tgt.pos.x, tgt.pos.z, '#b06bff', { r1: 200, w: 12 });
      if (dmg) hitFeedback(dmg, { magic: true, sub: '魔法伤害' });
      await wait(0.45);
    } else if (OO.data.potionTypes.includes(type)) {
      if (self) {
        A('drink', { pan });
        await U.tween(0.25, k => { user.a.drink = k; }, U.ease.outQuad);
        await wait(0.35);
        await U.tween(0.2, k => { user.a.drink = 1 - k; }, U.ease.inQuad);
      } else {
        await U.tween(0.16, k => { user.a.raise = k * 1.1; }, U.ease.outQuad);
        A('throwP', { pan }); user.a.raise = 0;
        await W().fx.projectile({ from: { x: user.pos.x, y: 150, z: user.pos.z }, to: chest(ev.target, 110), dur: 0.5, arc: 120, kind: 'flask', type, col: D.items[type].color });
        const p = chest(ev.target, 110);
        A('glass', { pan: panOf(ev.target), vol: 0.6 });
        W().fx.shards(p.x, p.y, p.z, 'rgba(230,240,255,.8)', 8);
      }
      const used = q.takeUntil(e => e.type === 'used').find(e => e.type === 'used');
      if (used) { await effectOn(ev.target, type, before, used.snap); setSnap(ev.user, used.userSnap); }
    } else {
      // 护甲：对自己“使用” = 穿戴（与对应装备栏交换）
      const used = q.takeUntil(e => e.type === 'used').find(e => e.type === 'used');
      await U.tween(0.2, k => { user.a.raise = k * 0.8; }, U.ease.outQuad);
      A('equip', { pan });
      if (used) {
        const changed = JSON.stringify(used.snap.armor) !== JSON.stringify(before.armor);
        setSnap(ev.target, used.snap); setSnap(ev.user, used.userSnap);
        if (changed) {
          tgt.a.glowCol = '#cfe8ff'; tgt.a.glow = 0.9;
          W().fx.spark(tgt.pos.x, 110, tgt.pos.z, { col: '#e6f2ff', n: 30, max: 260 });
          W().fx.ring(tgt.pos.x, tgt.pos.z, '#cfe8ff', { r1: 120, w: 5 });
          W().fx.text(ev.target, `穿戴${itemName(ev.item)}`, { col: '#cfe8ff', size: 24, kind: 'label', sub: `护甲 ${before.armorValue} → ${used.snap.armorValue}` });
        } else {
          W().fx.text(ev.user, '未生效', { col: '#aab', size: 22, kind: 'label', sub: '护甲只能给自己穿戴' });
        }
      }
      await U.tween(0.2, k => { user.a.raise = 0.8 * (1 - k); }, U.ease.inQuad);
      await wait(0.25);
    }
    release(ev.user);
    const rest = q.takeUntil(e => e.type === 'used');
    const used = rest.find(e => e.type === 'used');
    if (used) { setSnap(ev.target, used.snap); setSnap(ev.user, used.userSnap); }
    // takeUntil 已把 used 之前的 death/aid 事件取走——需要放回去播放
    q.unshift(rest.filter(e => e.type !== 'used'));
  }

  async function doAidAlert(ev) {
    const c = ch(ev.target); if (!c) return;
    W().focusOn([ev.target], 1.18);
    A('alarm', { pan: panOf(ev.target) });
    c.a.glowCol = '#ff2a3a'; c.a.glow = 1;
    W().fx.ring(c.pos.x, c.pos.z, '#ff3040', { r1: 220, w: 10, life: 0.8 });
    W().fx.ring(c.pos.x, c.pos.z, '#ff3040', { r1: 160, w: 6, life: 0.6 });
    W().fx.text(ev.target, '半血告急！', { col: '#ff5a64', size: 30, kind: 'label', y: 240, life: 1.6, sub: ev.helpers.length > 1 ? `${ev.helpers.length - 1} 名守护者响应` : '只能自救' });
    W().pulseChainTo(ev.target, ev.helpers);
    OO.ui.banner('援助事件', `${name(ev.target)} 体力跌破一半 · 按加入顺序依次援助`, 'alarm');
    await wait(0.9);
  }

  async function doAid(ev) {
    const h = ch(ev.helper), t = ch(ev.target); if (!h || !t) return;
    const before = Object.assign({}, t.disp);
    W().focusOn([ev.helper, ev.target], 1.08);
    A('aidCast', { pan: panOf(ev.helper) });
    h.a.glowCol = D.items[ev.item.type].color; h.a.glow = 0.9;
    W().fx.beam(ev.helper, D.items[ev.item.type].color, { life: 0.8, w: 30 });
    if (ev.helper !== ev.target) {
      W().pulseLink(ev.helper, ev.target, 1);
      face(ev.helper, ev.target);
      await U.tween(0.15, k => { h.a.raise = k; });
      await W().fx.projectile({ from: chest(ev.helper, 140), to: chest(ev.target, 110), dur: 0.6, arc: 90, kind: 'orb', type: ev.item.type, col: D.items[ev.item.type].color, ease: U.ease.inOutQuad });
      h.a.raise = 0; release(ev.helper);
    } else {
      await U.tween(0.25, k => { h.a.drink = k; }); await U.tween(0.2, k => { h.a.drink = 1 - k; });
    }
    setSnap(ev.helper, ev.helperSnap);
    await effectOn(ev.target, ev.item.type, before, ev.snap, { aid: true, sub: '援助 · ' + name(ev.helper) });
  }

  async function doDeath(ev) {
    const c = ch(ev.player); if (!c) return;
    W().focusOn([ev.player], 1.25);
    W().letterbox = 1;
    U.time.slowmo = 0.35;
    A('deathSwell', { pan: panOf(ev.player) });
    await wait(0.35);
    A('death', { pan: panOf(ev.player) });
    W().flash('#ffffff', 0.55); W().shake(26);
    setSnap(ev.player, ev.snap);
    for (const f of ev.lostFollowers || []) { const fc = ch(f); if (fc) W().fx.spark((fc.pos.x + c.pos.x) / 2, 140, (fc.pos.z + c.pos.z) / 2, { col: '#ffd36b', n: 16 }); }
    // 物品四散
    const pal = c.palette;
    W().fx.embers(c.pos.x, 0, c.pos.z, pal.accent, 70, { h: 170, vy: 260, size: 4.5, life: 2.6 });
    W().fx.embers(c.pos.x, 0, c.pos.z, pal.cloak, 40, { h: 150, vy: 200, size: 3.5 });
    W().fx.shards(c.pos.x, 90, c.pos.z, pal.cloak, 16);
    W().fx.ring(c.pos.x, c.pos.z, pal.accent, { r1: 300, w: 14, life: 1.2 });
    c.grave = true;
    W().fx.text(ev.player, '阵亡', { col: '#ff6b6b', size: 44, kind: 'label', y: 200, life: 2.2, sub: '背包物品全部遗失' });
    await U.tween(1.4, k => { c.a.dissolve = k; }, U.ease.inQuad);
    U.time.slowmo = 1;
    W().letterbox = 0;
    if (OO.game) OO.game.onDeathShown(ev.player);
  }

  async function doSubscribe(ev, quiet) {
    W().pulseLink(ev.from, ev.to, 1);
    const a = ch(ev.from), b = ch(ev.to);
    // 显示状态：从 a 的关注列表加入 b
    if (a) a.disp = Object.assign({}, a.disp, { subs: (a.disp.subs || []).concat([ev.to]) });
    if (quiet) return;
    const mutual = b && (b.disp.subs || []).includes(ev.from);
    A(mutual ? 'pact' : 'select', { pan: panOf(ev.to) });
    if (b) W().fx.spark(b.pos.x, 120, b.pos.z, { col: '#ffd36b', n: 16, max: 200 });
    if (mutual) {
      W().fx.ring(a.pos.x, a.pos.z, '#ffd36b', { r1: 140, w: 6 }); W().fx.ring(b.pos.x, b.pos.z, '#ffd36b', { r1: 140, w: 6 });
      W().fx.text(ev.from, '誓约缔结', { col: '#ffd36b', size: 26, kind: 'label', y: 230, sub: `与 ${name(ev.to)} 互为守护` });
    }
    if (OO.game) OO.game.refreshRelations();
    await wait(mutual ? 0.9 : 0.4);
  }
  async function doUnsubscribe(ev) {
    const a = ch(ev.from), b = ch(ev.to);
    if (a) { const s = (a.disp.subs || []).slice(); const i = s.indexOf(ev.to); if (i >= 0) s.splice(i, 1); a.disp = Object.assign({}, a.disp, { subs: s }); }
    A('pactBreak', { pan: panOf(ev.from) });
    if (a && b) W().fx.spark((a.pos.x + b.pos.x) / 2, 140, (a.pos.z + b.pos.z) / 2, { col: '#ffd36b', n: 30, max: 300 });
    if (a) W().fx.text(ev.from, '解除守护', { col: '#ffb0a0', size: 20, kind: 'label', y: 230, sub: `不再守护 ${name(ev.to)}` });
    if (OO.game) OO.game.refreshRelations();
    await wait(0.45);
  }

  async function doItemAdded(ev, quiet) {
    setSnap(ev.player, ev.snap);
    if (quiet || ev.item.id.startsWith('curse_')) return;
    const c = ch(ev.player); if (!c) return;
    A('beam', { pan: panOf(ev.player) });
    W().fx.beam(ev.player, D.items[ev.item.type].glow, { life: 0.9, w: 26 });
    await W().fx.projectile({ from: { x: c.pos.x, y: 520, z: c.pos.z }, to: { x: c.pos.x, y: 120, z: c.pos.z }, dur: 0.45, arc: 0, kind: 'flask', type: ev.item.type, col: D.items[ev.item.type].glow, ease: U.ease.inQuad });
    A('loot', { pan: panOf(ev.player) });
    W().fx.spark(c.pos.x, 120, c.pos.z, { col: D.items[ev.item.type].glow, n: 18, max: 200 });
    W().fx.text(ev.player, '+ ' + itemName(ev.item), { col: D.items[ev.item.type].glow, size: 20, kind: 'label', y: 200, sub: '槽位 ' + ev.slot });
    if (OO.game && ev.player === OO.game.heroId) OO.ui.flashSlot(ev.slot);
  }

  /* ---------------- 播放队列 ---------------- */
  function makeQueue(list) {
    const q = {
      list: list.slice(),
      next() { return q.list.shift(); },
      takeUntil(pred) { const out = []; while (q.list.length) { const e = q.list.shift(); out.push(e); if (pred(e)) break; } return out; },
      unshift(arr) { q.list.unshift(...arr); },
    };
    return q;
  }

  async function play(events, o = {}) {
    const q = makeQueue(events);
    const quiet = !!o.quiet;
    let ev;
    while ((ev = q.next())) {
      try {
        switch (ev.type) {
          case 'command': OO.ui.log(ev.line, 'cmd', o.actor); break;
          case 'print': OO.ui.log(ev.line, 'out'); break;
          case 'attack': if (!quiet) await doAttack(ev, q); break;
          case 'use': if (!quiet) await doUse(ev, q); break;
          case 'used': setSnap(ev.target, ev.snap); setSnap(ev.user, ev.userSnap); break;
          case 'damage': if (quiet) setSnap(ev.target, ev.snap); else hitFeedback(ev, { magic: true }); break;
          case 'aidAlert': if (!quiet) await doAidAlert(ev); break;
          case 'aid': if (quiet) { setSnap(ev.target, ev.snap); setSnap(ev.helper, ev.helperSnap); } else await doAid(ev); break;
          case 'death': if (quiet) { setSnap(ev.player, ev.snap); ch(ev.player).grave = true; ch(ev.player).a.dissolve = 1; } else await doDeath(ev); break;
          case 'durability': setSnap(ev.player, ev.snap); break;
          case 'subscribe': await doSubscribe(ev, quiet || ev.viaLoad && o.quietLoad); break;
          case 'unsubscribe': await doUnsubscribe(ev); break;
          case 'loadSubscribe': if (!quiet) OO.ui.banner('命运之线', 'load_subscribe ' + ev.structure, 'fate'); break;
          case 'itemAdded': await doItemAdded(ev, quiet || o.quietItems); break;
          case 'inventoryFull':
            if (!quiet) { A('full', { pan: panOf(ev.player) }); W().fx.text(ev.player, '背包已满', { col: '#ff7a7a', size: 22, kind: 'label', y: 200, sub: itemName(ev.item) + ' 未能获得' }); await wait(0.5); }
            break;
          case 'itemRemoved':
            setSnap(ev.player, ev.snap);
            if (!quiet) { A('swap', { pan: panOf(ev.player) }); W().fx.text(ev.player, '丢弃 ' + itemName(ev.item), { col: '#c0c4d0', size: 18, kind: 'label', y: 190 }); }
            break;
          case 'notUsable':
            A('error', { pan: panOf(ev.user) });
            W().fx.text(ev.user, '无法使用', { col: '#ff9a9a', size: 22, kind: 'label', y: 200, sub: itemName(ev.item) + ' 不是 Usable' });
            await wait(0.6);
            break;
          case 'slot': case 'swap':
            setSnap(ev.player, ev.snap);
            break;
          default: break;
        }
      } catch (e) { console.error('演出错误', ev, e); }
    }
    W().focusOn(null);
  }

  return { play, setSnap, hitFeedback };
})();
