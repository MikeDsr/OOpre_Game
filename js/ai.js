/* ============================================================
   誓约竞技场 · ai.js —— 对手 AI：只读引擎状态，输出“指令序列”
   每个回合返回 { steps:[cmd...], label } ；免费动作（换槽、交换）在主动作前执行。
   ============================================================ */
'use strict';
OO.ai = (() => {
  const U = OO.U, D = OO.data;

  function items(p) {
    const out = [];
    for (let i = 0; i < 36; i++) { const it = p.inventory.getItem(i); if (it) out.push({ slot: i, it }); }
    return out;
  }
  const ofType = (p, type) => items(p).filter(x => x.it.getType() === type);
  const best = (arr, key) => arr.reduce((b, x) => (!b || key(x) > key(b) ? x : b), null);

  /* 让 slot 上的物品进入主手：返回指令列表与“结束后恢复”的指令 */
  function toHand(p, slot) {
    const n = p.name, cur = p.slotId;
    if (slot === cur) return { pre: [], post: [] };
    if (slot <= 8) return { pre: [`change_slot ${n} ${slot}`], post: [`change_slot ${n} ${cur}`] };
    return { pre: [`swap ${n} ${slot} ${cur}`], post: [`swap ${n} ${slot} ${cur}`] };
  }
  function useOn(p, slot, targetName) {
    const h = toHand(p, slot);
    return [...h.pre, `use_item ${p.name} ${targetName}`, ...h.post];
  }
  /* 预测：若主手换成 sword，对 target 的物理伤害（与引擎公式一致） */
  function predict(p, target, swordVal) {
    const a = p.getBaseAttackDamage(), d = swordVal, v = target.getArmorValue();
    const reduce = Math.min(800, Math.max(8 * v, 40 * v - 20 * d));
    return Math.floor(((a + d) * (1000 - reduce) + 999) / 1000);
  }
  function bestSword(p) {
    const s = best(ofType(p, 'Sword'), x => x.it.getEquipmentValue() * 3 + Math.min(x.it.getDurability(), 600) / 200);
    return s;
  }

  function decide(sys, me, game) {
    const def = game.defOf(me.name);
    const prof = def.ai || { aggro: 0.6, potionLove: 0.5, loyalty: 0.5, heal: 0.5 };
    const hpR = me.getHitPoint() / me.getMaxHitPoint();
    const n = me.name;
    const free = [];

    // 0. 背誓：被主角背叛或攻击 → 先解除自己对主角的守护
    const hero = sys.findPlayer(game.heroId);
    if (hero && game.betrayedBy(n) && me.getSubscribingPlayers().includes(hero)) free.push(`remove_subscribe ${n} ${hero.name}`);

    // 1. 保命
    if (hpR < 0.38 + prof.heal * 0.15) {
      const h = best(ofType(me, 'HealPotion'), x => x.it.getAmplifier());
      if (h && me.getMaxHitPoint() - me.getHitPoint() > h.it.getAmplifier() * 0.5) return { steps: [...free, ...useOn(me, h.slot, n)], label: '治疗自己' };
      const ab = best(ofType(me, 'AbsorptionPotion'), x => x.it.getAmplifier());
      if (ab && me.getExtraHitPoint() < 80) return { steps: [...free, ...useOn(me, ab.slot, n)], label: '为自己加护盾' };
    }
    // 2. 穿戴更好的护甲
    if (Math.random() < 0.85) {
      for (const type of D.armorTypes) {
        const cur = me.inventory.getItem(D.armorSlot[type]);
        const curV = cur ? cur.getEquipmentValue() : -1;
        const cand = best(ofType(me, type), x => x.it.getEquipmentValue());
        if (cand && cand.it.getEquipmentValue() > curV) return { steps: [...free, ...useOn(me, cand.slot, n)], label: '穿戴护甲' };
      }
    }
    // 3. 力量
    const st = ofType(me, 'StrengthPotion')[0];
    if (st && Math.random() < 0.55) return { steps: [...free, ...useOn(me, st.slot, n)], label: '饮下狂战药剂' };
    // 4. 护盾（较健康时也会预防性使用）
    const ab2 = best(ofType(me, 'AbsorptionPotion'), x => x.it.getAmplifier());
    if (ab2 && me.getExtraHitPoint() === 0 && hpR < 0.75 && Math.random() < 0.4) return { steps: [...free, ...useOn(me, ab2.slot, n)], label: '为自己加护盾' };

    // 5. 选目标
    const enemies = sys.playerList.filter(p => p !== me && !p.isDead() && !game.aiFriendly(me, p));
    if (!enemies.length) return { steps: free, label: '观望' };
    const sw = bestSword(me), swVal = sw ? sw.it.getEquipmentValue() : 0;
    let tgt = null, ts = -1e9;
    for (const e of enemies) {
      const eh = e.getHitPoint() + e.getExtraHitPoint();
      const dmg = predict(me, e, swVal);
      let s = (1 - e.getHitPoint() / e.getMaxHitPoint()) * 1.1 + dmg / Math.max(eh, 1) * 1.6;
      if (dmg >= eh) s += 2;
      if (e.name === game.heroId) s += 0.12 * prof.aggro;
      s += (game.grudge(n, e.name) || 0) * 0.7;
      s += Math.random() * 0.5;
      if (s > ts) { ts = s; tgt = e; }
    }
    // 6. 毒瓶
    const dp = best(ofType(me, 'DamagePotion'), x => x.it.getAmplifier());
    if (dp) {
      const eh = tgt.getHitPoint() + tgt.getExtraHitPoint();
      const phys = predict(me, tgt, swVal);
      const amp = dp.it.getAmplifier();
      if (amp >= eh || amp > phys * 1.4 || Math.random() < prof.potionLove * 0.35) {
        return { steps: [...free, ...useOn(me, dp.slot, tgt.name)], label: '投掷噬魂毒瓶', target: tgt.name };
      }
    }
    // 7. 物理攻击（先把最好的剑握在手里）
    const pre = [];
    if (sw && me.getMainHandItem() !== sw.it) {
      if (sw.slot <= 8) pre.push(`change_slot ${n} ${sw.slot}`);
      else pre.push(`swap ${n} ${sw.slot} ${me.slotId}`);
    } else if (!sw) {
      // 没有剑：别把护甲 / 药水拿在手上浪费耐久，换到空格
      const hand = me.getMainHandItem();
      if (hand) { for (let i = 0; i < 9; i++) if (!me.inventory.getItem(i)) { pre.push(`change_slot ${n} ${i}`); break; } }
    }
    return { steps: [...free, ...pre, `attack ${n} ${tgt.name}`], label: '发起攻击', target: tgt.name };
  }

  /* 主角请求结盟时，AI 是否接受；返回概率 */
  function pactChance(sys, me, hero, game) {
    const def = game.defOf(me.name), prof = def.ai || { loyalty: 0.5 };
    if (game.grudge(me.name, hero.name) > 0.5 || game.betrayedBy(me.name)) return 0.05;
    let p = 0.25 + prof.loyalty * 0.35;
    const mine = me.getHitPoint() / me.getMaxHitPoint(), his = hero.getHitPoint() / hero.getMaxHitPoint();
    p += (his - mine) * 0.35;                  // 你比它强，它更愿意依附
    const alive = sys.playerList.filter(p2 => !p2.isDead()).length;
    if (alive <= 3) p -= 0.25;                 // 残局谁都不信
    p -= me.getSubscribingCount() * 0.08;
    return U.clamp(p, 0.05, 0.92);
  }

  return { decide, pactChance, predict, bestSword, items };
})();
