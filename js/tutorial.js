/* ============================================================
   誓约竞技场 · tutorial.js —— 新手引导（训练场剧本）
   场景：你 + 引导者艾琳（关注你）+ 试炼石像。逐步讲解攻击、伤害公式、
   半血援助、护盾、护甲耐久、毒瓶魔法伤害、誓约、战利品与指令终端。
   ============================================================ */
'use strict';
OO.tutorial = (() => {
  const U = OO.U;
  const $ = s => document.querySelector(s);
  let active = false, spotTarget = null, expect = null, waiter = null, raf = 0, skipped = false;

  /* ---------- 聚光灯 ---------- */
  function rectOf(t) {
    if (!t) return null;
    if (typeof t === 'string' && t.startsWith('@')) { // 世界中的角色
      const b = OO.world.bboxScreen(t.slice(1)); if (!b) return null;
      return { x: b.x - 20, y: b.y - 50, w: b.w + 40, h: b.h + 60 };
    }
    const e = typeof t === 'string' ? $(t) : t; if (!e) return null;
    const r = e.getBoundingClientRect(); if (!r.width) return null;
    return { x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 };
  }
  function tick() {
    if (!active) return;
    const spot = $('#tutSpot'), r = rectOf(spotTarget);
    if (r) { spot.style.opacity = 1; Object.assign(spot.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }
    else { spot.style.opacity = 0; }
    $('#tut').classList.toggle('nospot', !r);
    // 对话框避开聚光区域
    const box = $('#tutBox');
    if (r) {
      const below = r.y + r.h + box.offsetHeight + 30 < window.innerHeight;
      const above = r.y - box.offsetHeight - 30 > 0;
      box.style.top = (r.y + r.h / 2 > window.innerHeight / 2 ? (above ? r.y - box.offsetHeight - 22 : 20) : (below ? r.y + r.h + 22 : window.innerHeight - box.offsetHeight - 20)) + 'px';
      const cx = U.clamp(r.x + r.w / 2 - box.offsetWidth / 2, 16, window.innerWidth - box.offsetWidth - 16);
      box.style.left = cx + 'px';
    } else { box.style.top = Math.round(window.innerHeight * 0.58) + 'px'; box.style.left = Math.round(window.innerWidth / 2 - box.offsetWidth / 2) + 'px'; }
    raf = requestAnimationFrame(tick);
  }

  /* say：显示一段讲解；next=true 显示“下一步”并等待点击；wait=Promise 等待条件 */
  function say(title, html, o = {}) {
    if (skipped) return Promise.resolve();
    spotTarget = o.spot || null;
    const box = $('#tutBox');
    box.innerHTML = `<canvas class="portrait" data-p="Elin" width="64" height="64"></canvas>
      <div class="tb-main"><div class="tb-t">${title}<span class="tb-step">${o.step || ''}</span></div><div class="tb-x">${html}</div>
      <div class="tb-b">${o.next !== false ? '<button class="gold tnext">继续</button>' : `<span class="tb-wait">${o.hint || '请按提示操作'}</span>`}<button class="ghost tskip">跳过引导</button></div></div>`;
    OO.ui.drawPortrait(box.querySelector('canvas'), 'Elin');
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    OO.audio.play('cardFlip');
    box.querySelector('.tskip').onclick = skip;
    return new Promise(res => {
      waiter = res;
      if (o.next !== false) box.querySelector('.tnext').onclick = () => { OO.audio.play('click'); res(); };
    });
  }
  function hideBox() { $('#tutBox').innerHTML = ''; spotTarget = null; }
  function until(kind, check) { // 等待某个玩家动作完成
    return new Promise(res => { expect = { kind, check, res }; });
  }

  const hook = {
    gate(kind, arg) {
      if (skipped) return true;
      if (expect && expect.kind.includes(kind) && (!expect.check || expect.check(kind, arg))) return true;
      OO.audio.play('error');
      OO.ui.toast('引导中：请先按提示操作', 'red');
      return false;
    },
    after(kind, arg) { if (expect && expect.kind.includes(kind)) { const e = expect; expect = null; e.res(arg); } },
    onSelect(n) { if (expect && expect.kind.includes('select') && (!expect.check || expect.check('select', n))) { const e = expect; expect = null; e.res(n); } },
    onBag(open) { if (expect && expect.kind.includes('bag') && open) { const e = expect; expect = null; e.res(); } },
    aiTurn: null,
  };

  async function heroStep() { const G = OO.game; OO.world.setActive(G.heroId); OO.ui.setTurn(G.heroId); await G.heroTurn(); }
  async function golemStep(steps, label) {
    const G = OO.game;
    hook.aiTurn = () => ({ steps, label });
    OO.world.setActive('Golem'); OO.ui.setTurn('Golem');
    await G.aiTurn(G.sys.findPlayer('Golem'));
    hook.aiTurn = null;
    OO.world.setActive(null);
  }

  async function run() {
    const G = OO.game, H = () => G.heroId;
    active = true; skipped = false;
    // 场景：主角初始装备 / 艾琳带两瓶生命药剂 / 石像带一瓶重型毒瓶
    OO.data.tutorial.mentor.kit = [['potion', 'HealPotion', 'mercy', 300], ['potion', 'HealPotion', 'mercy', 260]];
    OO.data.tutorial.golem.kit = [['potion', 'DamagePotion', 'quake', 620]];
    OO.data.tutorial.golem.hp = 358;
    await G.setup({ mode: 'tutorial', hook, heroName: 'Hero', heroDisplay: '你' });
    $('#tut').classList.remove('hidden');
    raf = requestAnimationFrame(tick);
    G.over = false;
    OO.ui.setRound(0);
    OO.audio.music.setIntensity(0.15);

    await say('欢迎来到誓约竞技场', '我是引导者<b>艾琳</b>。这座竞技场的每一条规则——体力、背包、伤害公式、半血援助、关注关系——都来自你的 <b>OOpre 作业代码</b>。<br>你在这里做的每个动作，都会变成一条作业指令交给引擎执行。', { step: '1/14' });
    await say('你的状态', '左上角是你：<b>体力</b> / 最大体力、金色的<b>护盾</b>（附加体力，受伤时最先扣除）、<b>攻击</b>（基础攻击 + 主手剑的增伤）和<b>护甲</b>（四个装备栏护甲值之和）。', { spot: '#heroPanel', step: '2/14' });
    await say('快捷栏与主手', '底部是快捷栏（槽位 0–8）。<b>高亮的那格就是主手</b>（slotId）。你现在握着长剑，攻击时它会提供增伤。<br>按数字键 1–9 或点击格子即可切换主手——这一步是免费的 <code>change_slot</code>。', { spot: '#hotbar', step: '3/14' });

    await G.exec('load_subscribe Elin(Hero)');
    await say('关注关系', '刚才执行了 <code>load_subscribe Elin(Hero)</code>：艾琳<b>关注</b>了你。金色光丝由她流向你，表示<b>她能援助你</b>。<br>关注关系是有向图，援助具有传递性。', { spot: '@Elin', step: '4/14' });

    say('选择目标', '点击场上的<b>试炼石像</b>，把它设为目标。', { spot: '@Golem', next: false, hint: '点击试炼石像', step: '5/14' });
    await until(['select'], (k, n) => n === 'Golem');
    await say('伤害预测', `右侧显示目标的详情，以及按题面公式算出的<b>预计物理伤害</b>：<br><code>⌈(a + d) × min(1, 1 − min(0.8, max(0.008v, 0.04v − 0.02d)))⌉</code><br>石像没有护甲，所以伤害就是 a + d = ${OO.data.hero.atk} + ${OO.data.hero.kit[0][3]} = ${OO.data.hero.atk + OO.data.hero.kit[0][3]}。`, { spot: '#inspect', step: '6/14' });

    say('发起攻击', '点击<b>攻击</b>（或按 A）。攻击会结束你的回合。', { spot: '.act-attack', next: false, hint: '点击攻击', step: '7/14' });
    let turn = heroStep();
    await until(['attack'], (k, a) => a && a.target === 'Golem'); await turn;
    hideBox();
    await U.wait(0.4);
    await golemStep(['use_item Golem Hero'], '投掷重型毒瓶');
    await U.wait(0.3);
    await say('半血援助！', '石像的毒瓶让你的体力从一半以上跌到了一半以下，触发了<b>援助事件</b>。<br>所有能援助你的人按<b>加入顺序</b>依次出手：先是<b>你自己</b>（玩家总能援助自己），再是关注你的艾琳。体力未满时优先用<b>生命药剂</b>（效果最大的那瓶），否则用金盾药剂。', { spot: '@Hero', step: '8/14' });

    turn = heroStep();
    say('护盾', '按 <b>3</b> 把<b>金盾药剂</b>握到主手。', { spot: '#hotbar', next: false, hint: '按 3', step: '9/14' });
    await until(['slot'], (k, a) => a.slot === 2);
    say('护盾', '现在点击<b>对自己用</b>（S），喝下金盾药剂。', { spot: '.act-useSelf', next: false, hint: '按 S', step: '9/14' });
    await until(['use'], (k, a) => a.target === H()); await turn;
    hideBox();
    await U.wait(0.3);
    await golemStep(['attack Golem Hero'], '挥拳');
    await say('护盾先扣', '石像的攻击先被<b>护盾</b>吸收，护盾不够时才扣体力。护盾没有上限，可以叠加。', { spot: '#heroPanel', step: '10/14' });

    turn = heroStep();
    say('穿戴护甲', '按 <b>B</b> 打开背包。', { spot: '.act-bag', next: false, hint: '按 B 打开背包', step: '11/14' });
    await until(['bag']);
    say('穿戴护甲', '背包共 40 格：快捷栏 0–8、背包 9–35、<b>装备栏 36–39</b>。<br>点击 4 号格的<b>头盔</b>，再点<b>穿戴</b>：它会被临时换到主手，对自己 <code>use_item</code>，与头盔栏交换。', { spot: '#bag .bag-in', next: false, hint: '选中头盔 → 穿戴', step: '11/14' });
    await until(['useSlot'], (k, a) => a.target === H() && G.sys.findPlayer(H()).inventory.getItem(a.slot)?.getType() === 'Helmet'); await turn;
    hideBox();
    await U.wait(0.3);
    await golemStep(['attack Golem Hero'], '挥拳');
    await say('护甲与耐久', '护甲值 v 会削减物理伤害（最多 80%），但每次挨打，<b>每件护甲都扣除等同伤害值的耐久</b>，耐久归零就会碎裂。剑也一样：每次攻击消耗耐久。<br>手持<b>剑</b>能削弱对方护甲的减免效果（公式里的 −0.02d）。', { spot: '#heroPanel', step: '12/14' });

    turn = heroStep();
    say('魔法伤害', '按 <b>4</b> 握住<b>噬魂毒瓶</b>。', { spot: '#hotbar', next: false, hint: '按 4', step: '13/14' });
    await until(['slot'], (k, a) => a.slot === 3);
    say('魔法伤害', '选中石像，点击<b>对目标用</b>（D）。毒瓶造成的魔法伤害<b>无视护甲和攻击力</b>。', { spot: '@Golem', next: false, hint: '选中石像 → 按 D', step: '13/14' });
    await until(['use'], (k, a) => a.target === 'Golem'); await turn;
    hideBox();
    await U.wait(0.8);

    await say('誓约与战利品', '对局中，你可以对选中的对手<b>缔结誓约</b>（F）：双方互相关注，彼此成为对方的援助者，且不再互相攻击。背誓会让对方记仇。<br>每轮结束时，你可以从三张<b>战利品</b>中选一件。', { spot: '.act-pact', step: '14/14' });
    await say('指令终端', '右侧终端实时显示每个动作对应的<b>作业指令</b>和引擎输出——和你的 Java 版<b>逐字一致</b>。点击“导出为作业输入”就能拿去跑你的作业代码。', { spot: '#terminal', step: '14/14' });
    await say('准备好了', '真正的竞技场里有 4 名对手，最后站着的人获胜。<br>记住：<b>谁在守护你</b>，往往比谁在攻击你更重要。', { next: true, step: '' });
    finish();
    OO.main.menu('restart');
  }

  function finish() {
    active = false; expect = null; spotTarget = null;
    cancelAnimationFrame(raf);
    $('#tut').classList.add('hidden');
    OO.game.hook = null;
    U.store.set('tutDone', true);
  }
  function skip() {
    skipped = true;
    if (waiter) waiter();
    if (expect) { const e = expect; expect = null; e.res(); }
    finish();
    OO.game.endHeroTurn();
    OO.main.menu('restart');
  }
  return { run, get active() { return active; } };
})();
