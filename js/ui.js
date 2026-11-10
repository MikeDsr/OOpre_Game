/* ============================================================
   誓约竞技场 · ui.js —— DOM 界面：HUD / 快捷栏 / 背包 / 战利品 / 终端 / 弹窗
   ============================================================ */
'use strict';
OO.ui = (() => {
  const U = OO.U, D = OO.data;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const G = () => OO.game;
  const hero = () => G().sys && G().sys.findPlayer(G().heroId);
  const A = (n, o) => OO.audio.play(n, o);

  /* ---------- 线条图标（SVG） ---------- */
  const ICON = {
    attack: '<path d="M4 20 L14 10 M14 10 L19 5 L20 4 L20 9 L15 14 M10 14 L6 18 M5 13 L11 19" />',
    self: '<path d="M9 3h6M10 3v4l-4 7a4 4 0 0 0 3.5 6h5A4 4 0 0 0 18 14l-4-7V3" /><path d="M7.5 13h9"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    pact: '<path d="M8 12a4 4 0 1 1 0-1M16 12a4 4 0 1 0 0 1" /><path d="M8 11.5h8"/>',
    bag: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    wait: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>',
    term: '<path d="M4 6l5 5-5 5M11 17h9"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    speed: '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  };
  const svg = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

  /* ---------- 物品文字 ---------- */
  function itemTitle(it) { return D.items[it.getType ? it.getType() : it.type].name; }
  function itemInfoObj(it) { return it.getType ? OO.itemInfo(it) : it; }
  function itemStatHTML(info) {
    const meta = D.items[info.type];
    if (info.amp != null) return `<b style="color:${meta.color}">${meta.stat} ${info.amp}</b>${meta.unit ? ' <span class="mut">' + meta.unit + '</span>' : ''}`;
    if (info.type === 'Sword') return `<b style="color:#9fd0ff">增伤 +${info.value}</b> · <span class="mut">耐久 ${info.dur}</span>`;
    return `<b style="color:#cfe8ff">护甲 ${info.value}</b> · <span class="mut">耐久 ${info.dur}</span>`;
  }
  function badge(info) {
    if (info.amp != null) return info.amp;
    return info.type === 'Sword' ? '+' + info.value : info.value;
  }

  /* ---------- 初始化 ---------- */
  let termOpen = U.store.get('termOpen', true);
  function fitScale() {
    const k = U.clamp(Math.min(window.innerWidth / 1600, window.innerHeight / 900), 0.55, 1.2);
    document.documentElement.style.setProperty('--s', k.toFixed(3));
  }
  function init() {
    fitScale(); window.addEventListener('resize', fitScale);
    // 动作按钮
    const acts = [
      ['attack', '攻击', 'A', 'attack'], ['useSelf', '对自己用', 'S', 'self'], ['useTarget', '对目标用', 'D', 'target'],
      ['pact', '缔结誓约', 'F', 'pact'], ['bag', '背包', 'B', 'bag'], ['wait', '待机', 'W', 'wait'],
    ];
    const box = $('#actions');
    for (const [k, label, key, ic] of acts) {
      const b = el('button', 'act act-' + k, `${svg(ic)}<span>${label}</span><kbd>${key}</kbd>`);
      b.dataset.act = k;
      b.addEventListener('click', () => doAct(k));
      b.addEventListener('mouseenter', () => { A('hover'); actTip(k, b); });
      b.addEventListener('mouseleave', hideTip);
      box.appendChild(b);
    }
    // 快捷栏
    const hb = $('#hotbar');
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot', `<kbd>${i + 1}</kbd>`);
      s.dataset.slot = i;
      s.addEventListener('click', () => { if (canFree()) G().heroAct('slot', { slot: i }); });
      s.addEventListener('mouseenter', () => slotTip(i, s));
      s.addEventListener('mouseleave', hideTip);
      hb.appendChild(s);
    }
    $('#btnTerm').innerHTML = svg('term') + '<span>终端</span>';
    $('#btnTerm').onclick = () => toggleTerm();
    $('#btnSpeed').onclick = () => cycleSpeed();
    $('#btnSound').onclick = () => toggleMute();
    $('#btnMenu').innerHTML = svg('menu');
    $('#btnMenu').onclick = () => openSettings();
    $('#termCopy').innerHTML = svg('copy') + '<span>导出为作业输入</span>';
    $('#termCopy').onclick = exportInput;
    $('#termClose').innerHTML = svg('close');
    $('#termClose').onclick = () => toggleTerm(false);
    setSpeedLabel(); setMuteLabel();
    $('#terminal').classList.toggle('closed', !termOpen);
    document.querySelectorAll('button').forEach(b => b.addEventListener('pointerdown', () => A('click')));
    buildBag();
    setInterval(updatePortraits, 120);
    $('#fps').classList.toggle('hidden', !U.store.get('showFps', false));
    setInterval(() => { const f = $('#fps'); if (!f.classList.contains('hidden')) f.textContent = `${Math.round(OO.world.fps)} FPS · 渲染 ${Math.round(OO.world.quality * 100)}%`; }, 500);
  }

  /* ---------- 状态 ---------- */
  let heroTurn = false, busy = false;
  function canFree() { return heroTurn && !busy; }
  function setHeroTurn(v) { heroTurn = v; document.body.classList.toggle('my-turn', v); refreshActions(); }
  function setBusy(v) { busy = v; document.body.classList.toggle('busy', v); refreshActions(); }
  function showHUD(v) { $('#hud').classList.toggle('hidden', !v); }

  function doAct(k) {
    if (k === 'bag') { toggleBag(); return; }
    if (!heroTurn || busy) { A('error'); return; }
    const sel = OO.world.selected;
    const h = hero(); if (!h) return;
    switch (k) {
      case 'attack':
        if (!sel || sel === G().heroId) { toast('先点击一名对手作为目标', 'red'); A('error'); return; }
        G().heroAct('attack', { target: sel }); break;
      case 'useSelf': G().heroAct('use', { target: G().heroId }); break;
      case 'useTarget':
        if (!sel) { toast('先点击选择一个目标', 'red'); A('error'); return; }
        G().heroAct('use', { target: sel }); break;
      case 'pact':
        if (!sel || sel === G().heroId) { toast('先点击一名对手', 'red'); A('error'); return; }
        if (G().relation(sel) === 'ally') { // 已结盟 → 解除自己的守护（免费）
          G().heroAct('unsub', { target: sel }); return;
        }
        G().heroAct('pact', { target: sel }); break;
      case 'wait': G().heroAct('wait'); break;
    }
  }

  function refreshActions() {
    const h = hero(); const sel = OO.world.selected;
    const hand = h && h.getMainHandItem();
    const usable = hand && hand.isUsable();
    const set = (k, ok, label) => {
      const b = document.querySelector(`.act-${k}`); if (!b) return;
      b.classList.toggle('disabled', !ok || !heroTurn || busy);
      if (label) b.querySelector('span').textContent = label;
    };
    set('attack', sel && sel !== G().heroId && OO.world.chars.get(sel)?.disp.alive);
    set('useSelf', usable);
    set('useTarget', usable && sel);
    const rel = sel && G().sys ? G().relation(sel) : 'enemy';
    set('pact', sel && sel !== G().heroId, rel === 'ally' ? '解除守护' : '缔结誓约');
    set('wait', true);
    const bb = document.querySelector('.act-bag'); if (bb) bb.classList.remove('disabled');
  }

  /* ---------- 主角面板 ---------- */
  function refreshHero() {
    const c = OO.world.chars.get(G().heroId); if (!c) return;
    const d = c.disp;
    $('#hpFill').style.width = U.clamp(d.hp / d.max * 100, 0, 100) + '%';
    $('#hpLag').style.width = U.clamp(c.hpLag / d.max * 100, 0, 100) + '%';
    $('#hpText').textContent = `${d.hp} / ${d.max}`;
    $('#shFill').style.width = U.clamp(d.shield / d.max * 100, 0, 100) + '%';
    $('#shText').textContent = d.shield > 0 ? `护盾 +${d.shield}` : '无护盾';
    $('#heroPanel').classList.toggle('low', d.hp / d.max <= 0.5 && d.alive);
    const sword = d.hand && d.hand.type === 'Sword' ? d.hand.value : 0;
    $('#stAtk').innerHTML = `${d.atk}${sword ? `<em>+${sword}</em>` : ''}`;
    $('#stArm').textContent = d.armorValue;
    const h = hero();
    $('#stItems').textContent = h ? `${h.getItemCount()}/36` : '0';
    const armorBox = $('#heroArmor');
    const akey = JSON.stringify(d.armor || []);
    if (armorBox.dataset.key !== akey) { armorBox.dataset.key = akey; armorBox.innerHTML = '';
    ['Helmet', 'Chestplate', 'Leggings', 'Boots'].forEach((t, i) => {
      const a = d.armor && d.armor[i];
      const s = el('div', 'mini' + (a ? '' : ' empty'), a ? `<img src="${OO.icons.url(t)}"><i>${a.value}</i>` : `<img src="${OO.icons.url(t)}">`);
      s.title = a ? `${D.items[t].name} · 护甲 ${a.value} · 耐久 ${a.dur}` : `${D.items[t].name}栏（空）`;
      armorBox.appendChild(s);
    }); }
    refreshHotbar();
  }
  function refreshHotbar() {
    const h = hero(); if (!h) return;
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((s, i) => {
      const it = h.inventory.getItem(i);
      s.classList.toggle('sel', i === h.slotId);
      const key = it ? `${it.getId()}|${it.getType()}|${it.durability ?? ''}|${it.amplifier ?? ''}` : '-';
      if (s.dataset.key === key) return;
      s.dataset.key = key;
      let html = `<kbd>${i + 1}</kbd>`;
      if (it) {
        const info = OO.itemInfo(it);
        html += `<img src="${OO.icons.url(info.type)}" draggable="false"><b>${badge(info)}</b>`;
        if (info.dur != null) html += `<div class="dur"><i style="width:${U.clamp(info.dur / 2500 * 100, 4, 100)}%"></i></div>`;
      }
      s.innerHTML = html;
      s.classList.toggle('empty', !it);
    });
    const hand = h.getMainHandItem();
    $('#handLabel').innerHTML = hand ? `主手 · ${itemTitle(hand)} ${itemStatHTML(OO.itemInfo(hand))}` : '主手 · <span class="mut">空</span>';
  }
  function heroHit(power) {
    const p = $('#heroPanel');
    p.classList.remove('hit'); void p.offsetWidth; p.classList.add('hit');
  }
  function flashSlot(slot) {
    const s = document.querySelector(`#hotbar .slot[data-slot="${slot}"]`) || document.querySelector(`#bag .slot[data-slot="${slot}"]`);
    if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
    if (slot > 8) { const b = document.querySelector('.act-bag'); if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } }
  }

  /* ---------- 目标检视 ---------- */
  function refreshInspect() {
    const box = $('#inspect');
    const sel = OO.world.selected;
    const c = sel && OO.world.chars.get(sel);
    if (!c || !G().sys) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const d = c.disp, p = G().sys.findPlayer(sel), h = hero();
    const rel = G().relation(sel);
    const relTxt = { self: '你自己', ally: '誓约同盟', guard: '守护着你', ward: '你在守护它', enemy: '敌对' }[rel];
    const relCls = { self: 'gold', ally: 'green', guard: 'green', ward: 'blue', enemy: 'red' }[rel];
    let calc = '';
    if (h && !h.isDead() && sel !== G().heroId && d.alive) {
      const hand = h.getMainHandItem();
      const a = h.getBaseAttackDamage(), dd = h.getMainHandDamage(), v = p.getArmorValue();
      const reduce = Math.min(800, Math.max(8 * v, 40 * v - 20 * dd));
      const dmg = h.attackDamage(p);
      calc = `<div class="calc">
        <div class="row"><span>预计物理伤害</span><b class="big">${dmg}</b></div>
        <div class="formula">⌈(${a} + ${dd}) × (1 − ${(reduce / 10).toFixed(1)}%)⌉</div>
        <div class="formula mut">a=基础攻击 · d=主手剑增伤 · v=${v} 护甲 → 减免 min(80%, max(0.8%·v, 4%·v − 2%·d))</div>`;
      if (hand && hand.getType() === 'DamagePotion') calc += `<div class="row"><span>噬魂毒瓶</span><b class="big purple">${hand.getAmplifier()}</b></div><div class="formula mut">魔法伤害无视护甲</div>`;
      if (rel !== 'ally' && G().mode !== 'tutorial') calc += G().mode === 'online' && G().isHuman(sel)
        ? `<div class="row"><span>誓约</span><b>需对方同意</b></div>`
        : `<div class="row"><span>誓约成功率</span><b>${Math.round(OO.ai.pactChance(G().sys, p, h, G()) * 100)}%</b></div>`;
      const kill = dmg >= d.hp + d.shield;
      if (kill) calc += `<div class="killable">⚑ 一击可斩</div>`;
      calc += '</div>';
    }
    const subs = (d.subs || []).map(n => OO.world.chars.get(n)?.display).filter(Boolean);
    const guards = [...OO.world.chars.values()].filter(x => x.disp.alive && (x.disp.subs || []).includes(sel)).map(x => x.display);
    box.innerHTML = `
      <div class="ihead"><canvas class="portrait" data-p="${sel}" width="72" height="72"></canvas>
        <div><div class="iname">${c.display}<small>${c.title}</small></div><div class="tag ${relCls}">${d.alive ? relTxt : '已阵亡'}</div></div></div>
      <div class="bar hp"><i style="width:${d.hp / d.max * 100}%"></i><span>${d.hp} / ${d.max}</span></div>
      ${d.shield > 0 ? `<div class="bar sh"><i style="width:${Math.min(100, d.shield / d.max * 100)}%"></i><span>护盾 +${d.shield}</span></div>` : ''}
      <div class="stats"><div><label>攻击</label><b>${d.atk}${d.hand && d.hand.type === 'Sword' ? `<em>+${d.hand.value}</em>` : ''}</b></div><div><label>护甲</label><b>${d.armorValue}</b></div><div><label>物品</label><b>${d.items}</b></div></div>
      <div class="hand">主手：${d.hand ? `<img src="${OO.icons.url(d.hand.type)}">${D.items[d.hand.type].name} ${itemStatHTML(d.hand)}` : '<span class="mut">空</span>'}</div>
      <div class="links">${subs.length ? `<div>守护 → ${subs.join('、')}</div>` : ''}${guards.length ? `<div>受 ${guards.join('、')} 守护</div>` : ''}${!subs.length && !guards.length ? '<div class="mut">没有任何誓约关系</div>' : ''}</div>
      ${calc}`;
    drawPortrait(box.querySelector('canvas'), sel);
    refreshActions();
  }

  /* ---------- 头像（从角色立牌实时截取） ---------- */
  function drawPortrait(cv, name) {
    const c = OO.world.chars.get(name); if (!c || !cv) return;
    const g = cv.getContext('2d'); const S = cv.width;
    g.clearRect(0, 0, S, S);
    const bgc = g.createRadialGradient(S / 2, S * 0.4, 2, S / 2, S / 2, S * 0.7);
    bgc.addColorStop(0, U.hexA(c.palette.accent, 0.5)); bgc.addColorStop(1, U.hexA(c.palette.cloak2, 0.9));
    g.fillStyle = bgc; g.fillRect(0, 0, S, S);
    const k = OO.world.SPR, sp = c.sprite, cx = sp.width / 2, cy = sp.height - 15 * k - 128 * k;
    g.drawImage(sp, cx - 35 * k, cy - 32 * k, 70 * k, 70 * k, 0, 0, S, S);
    if (!c.disp.alive) { g.fillStyle = 'rgba(20,10,20,.65)'; g.fillRect(0, 0, S, S); }
  }
  function updatePortraits() {
    document.querySelectorAll('canvas.portrait').forEach(cv => drawPortrait(cv, cv.dataset.p));
    const c = G() && OO.world.chars.get(G().heroId);
    if (c) { const lag = $('#hpLag'); if (lag) lag.style.width = U.clamp(c.hpLag / c.disp.max * 100, 0, 100) + '%'; }
  }

  /* ---------- 回合条 ---------- */
  function buildTurnBar(names) {
    const tb = $('#turnbar'); tb.innerHTML = '';
    names.forEach((n, i) => {
      const c = OO.world.chars.get(n);
      const it = el('div', 'tb', `<canvas class="portrait" data-p="${n}" width="56" height="56"></canvas><span>${c.display}</span><i class="order">${i + 1}</i>`);
      it.dataset.n = n;
      it.addEventListener('click', () => select(n));
      it.addEventListener('mouseenter', () => OO.world.setHover(n));
      it.addEventListener('mouseleave', () => OO.world.setHover(null));
      tb.appendChild(it);
    });
    $('#heroPortrait').dataset.p = G().heroId;
    $('#heroName').textContent = OO.world.chars.get(G().heroId).display;
    $('#heroTitle').textContent = OO.world.chars.get(G().heroId).title;
    refreshTurnBar();
  }
  function refreshTurnBar() {
    document.querySelectorAll('#turnbar .tb').forEach(t => {
      const c = OO.world.chars.get(t.dataset.n); if (!c) return;
      t.classList.toggle('dead', !c.disp.alive);
      t.classList.toggle('ally', c.relation === 'ally');
      t.classList.toggle('hero', c.isHero);
    });
  }
  function setTurn(n) { document.querySelectorAll('#turnbar .tb').forEach(t => t.classList.toggle('now', t.dataset.n === n)); }
  function markDead(n) { refreshTurnBar(); }
  function setRound(r) { $('#roundNum').textContent = r; }
  function setThinking(n, label) {
    const t = $('#thinking');
    if (!n) { t.classList.add('hidden'); return; }
    const c = OO.world.chars.get(n);
    t.innerHTML = `<canvas class="portrait" data-p="${n}" width="40" height="40"></canvas><div><b>${c.display}</b> 的回合<small>${label || ''}</small></div>`;
    drawPortrait(t.querySelector('canvas'), n);
    t.classList.remove('hidden');
  }

  function select(n) {
    if (!G().sys) return;
    const c = OO.world.chars.get(n);
    if (!c || !c.disp.alive) n = null;
    if (n && OO.world.selected !== n) A('select');
    OO.world.setSelected(n);
    refreshInspect(); refreshActions();
    if (G().hook && G().hook.onSelect) G().hook.onSelect(n);
  }

  function refreshAll() { refreshHero(); refreshInspect(); refreshTurnBar(); refreshActions(); if (!$('#bag').classList.contains('hidden')) renderBag(); }

  /* ---------- 终端 ---------- */
  const cmdHistory = [];
  function log(line, kind, actor) {
    const box = $('#termBody');
    if (kind === 'cmd') cmdHistory.push(line);
    const row = el('div', 'tl ' + kind);
    if (kind === 'cmd') {
      const nm = line.split(/\s+/)[1];
      const c = OO.world.chars.get(nm);
      const col = c ? (c.isHero ? '#ffd36b' : c.palette.accent) : '#9fd0ff';
      const parts = line.split(/\s+/);
      row.innerHTML = `<span class="pr">›</span><span class="op">${parts[0]}</span> ${parts.slice(1).map((p, i) => `<span style="${i === 0 ? 'color:' + col : ''}">${escapeHTML(p)}</span>`).join(' ')}`;
    } else row.textContent = line;
    box.appendChild(row);
    while (box.children.length > 600) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    $('#termCount').textContent = cmdHistory.length;
  }
  function clearLog() { $('#termBody').innerHTML = ''; cmdHistory.length = 0; }
  function escapeHTML(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function toggleTerm(v) { termOpen = v == null ? !termOpen : v; U.store.set('termOpen', termOpen); $('#terminal').classList.toggle('closed', !termOpen); }
  function exportInput() {
    const text = cmdHistory.length + '\n' + cmdHistory.join('\n') + '\n';
    const done = () => toast(`已复制 ${cmdHistory.length} 条指令，可直接作为 Java 版输入`, 'gold');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败', 'red'); }
    ta.remove();
  }

  /* ---------- 横幅 / 提示 ---------- */
  let bannerTimer = null;
  function banner(title, sub, kind = '') {
    const b = $('#banner');
    b.className = 'show ' + kind;
    b.innerHTML = `<div class="bt">${title}</div>${sub ? `<div class="bs">${escapeHTML(sub)}</div>` : ''}`;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.className = kind, 2100);
  }
  function toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, msg);
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2400);
    setTimeout(() => t.remove(), 3000);
  }

  /* ---------- 提示框 ---------- */
  const tip = () => $('#tooltip');
  function showTip(html, anchor) {
    const t = tip(); t.innerHTML = html; t.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 12;
    if (y < 8) y = r.bottom + 12;
    x = U.clamp(x, 8, window.innerWidth - tw - 8);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { tip().classList.remove('show'); }
  function itemTipHTML(info, slot) {
    const meta = D.items[info.type];
    const kind = info.amp != null ? 'Potion · Usable' : info.type === 'Sword' ? 'Equipment · 不可使用' : 'Equipment · Usable';
    return `<div class="tt-h"><img src="${OO.icons.url(info.type)}"><div><b>${meta.name}</b><small>${info.type} · ${kind}</small></div></div>
      <div class="tt-s">${itemStatHTML(info)}</div><div class="tt-d">${meta.desc}</div>
      <div class="tt-c">id: ${info.id}${slot != null ? ' · 槽位 ' + slot : ''}</div>`;
  }
  function slotTip(i, anchor) {
    const h = hero(); if (!h) return;
    const it = h.inventory.getItem(i);
    if (!it) { showTip(`<div class="tt-d">快捷栏 ${i}（空）<br><span class="mut">按 ${i + 1} 或点击：change_slot</span></div>`, anchor); return; }
    showTip(itemTipHTML(OO.itemInfo(it), i) + `<div class="tt-k">点击 / 按 ${i + 1} 握到主手（免费）</div>`, anchor);
  }
  function actTip(k, anchor) {
    const tips = {
      attack: ['攻击', '对选中的对手发动物理攻击（attack）。伤害受你的基础攻击、主手剑、对方护甲影响。消耗回合。'],
      useSelf: ['对自己使用', '对自己使用主手物品（use_item 你 你）。药水生效后消耗；护甲会穿戴到对应装备栏。消耗回合。'],
      useTarget: ['对目标使用', '对选中目标使用主手物品。投掷噬魂毒瓶造成魔法伤害；也可以给盟友喝药。消耗回合。'],
      pact: ['缔结誓约', '与目标互相关注（add_subscribe ×2）。誓约方跌破半血时会自动用药水援助对方，且不再互相攻击。已结盟时变为“解除守护”（免费）。'],
      bag: ['背包', '查看 40 个槽位：快捷栏 0-8、背包 9-35、装备栏 36-39。拖动交换（swap，免费）。'],
      wait: ['待机', '什么也不做，结束本回合。'],
    };
    const [t, d] = tips[k];
    showTip(`<div class="tt-h"><div><b>${t}</b></div></div><div class="tt-d">${d}</div>`, anchor);
  }

  /* ---------- 背包 ---------- */
  let bagSel = null, drag = null;
  function buildBag() {
    const grid = $('#bagGrid'), hot = $('#bagHot'), arm = $('#bagArmor');
    const mk = (i, parent) => {
      const s = el('div', 'slot'); s.dataset.slot = i; parent.appendChild(s);
      s.addEventListener('pointerdown', e => startDrag(e, i));
      s.addEventListener('mouseenter', () => { const h = hero(); const it = h && h.inventory.getItem(i); if (it && !drag) showTip(itemTipHTML(OO.itemInfo(it), i), s); });
      s.addEventListener('mouseleave', hideTip);
      return s;
    };
    for (let i = 9; i < 36; i++) mk(i, grid);
    for (let i = 0; i < 9; i++) mk(i, hot);
    const names = ['头盔栏 36', '胸甲栏 37', '护腿栏 38', '靴子栏 39'];
    for (let i = 36; i < 40; i++) { const w = el('div', 'aslot'); const s = mk(i, w); s.classList.add('armor'); w.appendChild(el('label', '', names[i - 36])); arm.appendChild(w); }
    $('#bagClose').innerHTML = svg('close');
    $('#bagClose').onclick = () => toggleBag(false);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
  }
  function toggleBag(v) {
    const b = $('#bag'); const show = v == null ? b.classList.contains('hidden') : v;
    b.classList.toggle('hidden', !show);
    if (show) { A('swap'); renderBag(); }
    hideTip();
    if (G().hook && G().hook.onBag) G().hook.onBag(show);
  }
  function renderBag() {
    const h = hero(); if (!h) return;
    document.querySelectorAll('#bag .slot').forEach(s => {
      const i = +s.dataset.slot, it = h.inventory.getItem(i);
      s.classList.toggle('sel', i === h.slotId);
      s.classList.toggle('picked', i === bagSel);
      s.classList.toggle('empty', !it);
      if (it) {
        const info = OO.itemInfo(it);
        s.innerHTML = `<img src="${OO.icons.url(info.type)}" draggable="false"><b>${badge(info)}</b>${info.dur != null ? `<div class="dur"><i style="width:${U.clamp(info.dur / 2500 * 100, 4, 100)}%"></i></div>` : ''}<em>${i}</em>`;
      } else s.innerHTML = `<em>${i}</em>`;
    });
    $('#bagCount').textContent = `${h.inventory.getItemCount()} 件物品 · ${h.inventory.getTypeCount()} 种类型`;
    renderBagDetail();
  }
  function renderBagDetail() {
    const box = $('#bagDetail'), h = hero();
    const it = bagSel != null && h ? h.inventory.getItem(bagSel) : null;
    if (!it) { box.innerHTML = `<div class="mut hint">点击物品查看详情<br>拖动物品到其它格子即可交换（swap，免费）<br><br>装备栏 36–39 只能通过“对自己使用护甲”穿戴，题面中 swap 只作用于 0–35。</div>`; return; }
    const info = OO.itemInfo(it), t = info.type;
    const sel = OO.world.selected && OO.world.selected !== G().heroId ? OO.world.selected : null;
    let btns = '';
    const turn = heroTurn && !busy;
    if (bagSel < 36) {
      if (bagSel !== h.slotId) btns += `<button data-b="hand" ${canFree() ? '' : 'disabled'}>握到主手 <small>免费</small></button>`;
      if (D.armorTypes.includes(t)) btns += `<button class="gold" data-b="equip" ${turn ? '' : 'disabled'}>穿戴 <small>消耗回合</small></button>`;
      else if (D.potionTypes.includes(t)) {
        if (t !== 'DamagePotion') btns += `<button class="gold" data-b="self" ${turn ? '' : 'disabled'}>对自己使用 <small>消耗回合</small></button>`;
        if (sel) btns += `<button class="${t === 'DamagePotion' ? 'red' : ''}" data-b="target" ${turn ? '' : 'disabled'}>对 ${OO.world.chars.get(sel).display} 使用 <small>消耗回合</small></button>`;
        else if (t === 'DamagePotion') btns += `<div class="mut">先在场上选中一个目标再投掷</div>`;
      }
      btns += `<button class="ghost" data-b="drop" ${canFree() ? '' : 'disabled'}>丢弃 <small>remove_item</small></button>`;
    } else btns = '<div class="mut">已穿戴。每次被攻击都会扣除等同伤害值的耐久。</div>';
    box.innerHTML = itemTipHTML(info, bagSel) + `<div class="bd-btns">${btns}</div>`;
    box.querySelectorAll('button').forEach(b => b.onclick = () => bagAction(b.dataset.b, bagSel));
  }
  async function bagAction(k, slot) {
    const h = hero(); if (!h) return;
    const it = h.inventory.getItem(slot); if (!it) return;
    const sel = OO.world.selected && OO.world.selected !== G().heroId ? OO.world.selected : null;
    if (k === 'hand') {
      if (slot <= 8) await G().heroAct('slot', { slot });
      else await G().heroAct('swap', { a: slot, b: h.slotId });
      bagSel = h.slotId;
    } else if (k === 'drop') { await G().heroAct('discard', { id: it.getId() }); bagSel = null; }
    else if (k === 'equip' || k === 'self') { toggleBag(false); await G().heroAct('useSlot', { slot, target: G().heroId }); bagSel = null; }
    else if (k === 'target') { toggleBag(false); await G().heroAct('useSlot', { slot, target: sel }); bagSel = null; }
    renderBag();
  }
  function startDrag(e, i) {
    const h = hero(); if (!h) return;
    const it = h.inventory.getItem(i);
    bagSel = i; renderBag();
    if (!it || i >= 36) return;
    drag = { from: i, x0: e.clientX, y0: e.clientY, ghost: null, moved: false };
  }
  function moveDrag(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true; hideTip();
      const h = hero(); const it = h.inventory.getItem(drag.from);
      drag.ghost = el('div', 'drag-ghost', `<img src="${OO.icons.url(it.getType())}">`);
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    document.querySelectorAll('#bag .slot').forEach(s => s.classList.remove('over'));
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#bag .slot');
    if (over && +over.dataset.slot < 36) over.classList.add('over');
  }
  async function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    document.querySelectorAll('#bag .slot').forEach(s => s.classList.remove('over'));
    if (!d.moved) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('#bag .slot');
    if (!over) return;
    const to = +over.dataset.slot;
    if (to >= 36 || to === d.from) return;
    if (!canFree()) { toast('只能在你的回合整理背包', 'red'); A('error'); return; }
    await G().heroAct('swap', { a: d.from, b: to });
    bagSel = to; renderBag();
  }

  /* ---------- 战利品 ---------- */
  let lootRes = null;
  function closeLoot() { const m = $('#loot'); if (!m.classList.contains('hidden')) { m.classList.add('hidden'); if (lootRes) { const r = lootRes; lootRes = null; r(null); } } }
  function showLoot(cards, count, ms) {
    return new Promise(resolve => {
      let done = false;
      const res = v => { if (done) return; done = true; lootRes = null; resolve(v); };
      lootRes = res;
      const m = $('#loot');
      m.classList.remove('hidden');
      const full = count >= 36;
      m.innerHTML = `<div class="loot-in"><div class="lh"><div class="lt">战利品</div><div class="ls">第 ${G().round} 轮结束 · 选择一件收入背包 <span class="mut">（${count}/36${full ? ' · 背包已满，将无法获得' : ''}）</span></div>${ms ? '<div class="ltimer"><i></i></div>' : ''}</div><div class="cards"></div><button class="ghost skip">放弃</button></div>`;
      if (ms) { const bar = m.querySelector('.ltimer i'); bar.style.transition = 'none'; bar.style.width = '100%'; requestAnimationFrame(() => { bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%'; }); }
      const box = m.querySelector('.cards');
      cards.forEach((c, i) => {
        const info = { type: c.type };
        if (c.spec[0] === 'potion') info.amp = c.spec[3]; else { info.value = c.spec[3]; info.dur = c.spec[4]; }
        const meta = D.items[c.type];
        const card = el('div', 'card r-' + c.rarity.key, `
          <div class="cf"><div class="rar" style="color:${c.rarity.color}">${c.rarity.name}</div>
          <div class="cimg"><img src="${OO.icons.url(c.type)}"></div>
          <div class="cn">${meta.name}</div><div class="cs">${itemStatHTML(info)}</div>
          <div class="cd">${meta.desc}</div>
          <code>${escapeHTML(c.preview)}</code></div>`);
        card.style.setProperty('--rc', c.rarity.color);
        card.style.animationDelay = (i * 0.12) + 's';
        setTimeout(() => A('cardFlip'), i * 120);
        card.onclick = () => {
          A('cardPick');
          card.classList.add('chosen'); box.classList.add('done');
          setTimeout(() => { m.classList.add('hidden'); res(i); }, 650);
        };
        card.onmouseenter = () => A('hover');
        box.appendChild(card);
      });
      m.querySelector('.skip').onclick = () => { m.classList.add('hidden'); res(null); };
      if (G().hook && G().hook.onLoot) G().hook.onLoot();
    });
  }

  /* ---------- 确认框 ---------- */
  let confirmRes = null;
  function closeConfirm() { const m = $('#confirm'); if (!m.classList.contains('hidden')) { m.classList.add('hidden'); if (confirmRes) { const r = confirmRes; confirmRes = null; r(false); } } }
  function confirm(title, body, yes = '确定', no = '取消') {
    return new Promise(resolve => {
      let done = false;
      const res = v => { if (done) return; done = true; confirmRes = null; resolve(v); };
      confirmRes = res;
      const m = $('#confirm');
      m.innerHTML = `<div class="dlg"><div class="dt">${title}</div><div class="dbody">${body}</div><div class="dbtn"><button class="gold y">${yes}</button><button class="ghost n">${no}</button></div></div>`;
      m.classList.remove('hidden');
      A('pact');
      m.querySelector('.y').onclick = () => { m.classList.add('hidden'); res(true); };
      m.querySelector('.n').onclick = () => { m.classList.add('hidden'); res(false); };
    });
  }

  /* ---------- 设置 / 速度 / 静音 ---------- */
  let speedIdx = U.store.get('speed', 0);
  function setSpeedLabel() { U.time.speed = D.speeds[speedIdx]; $('#btnSpeed').innerHTML = svg('speed') + `<span>${D.speeds[speedIdx]}×</span>`; }
  function cycleSpeed() { speedIdx = (speedIdx + 1) % D.speeds.length; U.store.set('speed', speedIdx); setSpeedLabel(); }
  let muted = U.store.get('muted', false);
  function setMuteLabel() { $('#btnSound').innerHTML = svg(muted ? 'mute' : 'sound'); }
  function toggleMute() { muted = !muted; U.store.set('muted', muted); OO.audio.setVolume('master', muted ? 0 : (U.store.get('masterVol', 0.85))); setMuteLabel(); }
  function applyMute() { if (muted) OO.audio.setVolume('master', 0); }
  function openSettings() {
    const m = $('#settings'); m.classList.remove('hidden');
    const v = OO.audio.vol;
    m.innerHTML = `<div class="dlg"><div class="dt">设置</div>
      <label class="rng">主音量<input type="range" min="0" max="1" step="0.01" data-k="master" value="${muted ? 0 : v.master}"></label>
      <label class="rng">配乐<input type="range" min="0" max="1" step="0.01" data-k="music" value="${v.music}"></label>
      <label class="rng">音效<input type="range" min="0" max="1" step="0.01" data-k="sfx" value="${v.sfx}"></label>
      <div class="rng">画质<div class="seg" id="qSeg">${[['auto', '自动'], ['high', '高'], ['mid', '中'], ['low', '低']].map(([k, n]) => `<button data-q="${k}" class="${OO.world.qualityMode === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <label class="rng chk">显示帧率<input type="checkbox" id="fpsChk" ${U.store.get('showFps', false) ? 'checked' : ''}></label>
      <div class="dbtn col"><button class="ghost" data-x="resume">继续</button><button class="ghost" data-x="tutorial">重新观看新手引导</button><button class="ghost" data-x="restart">重新开局</button><button class="ghost" data-x="title">返回标题</button></div></div>`;
    m.querySelectorAll('input').forEach(inp => inp.oninput = () => { OO.audio.setVolume(inp.dataset.k, +inp.value); if (inp.dataset.k === 'master') { U.store.set('masterVol', +inp.value); muted = +inp.value === 0; U.store.set('muted', muted); setMuteLabel(); } });
    m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { OO.world.setQuality(b.dataset.q); m.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelector('#fpsChk').onchange = e => { U.store.set('showFps', e.target.checked); $('#fps').classList.toggle('hidden', !e.target.checked); };
    m.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { m.classList.add('hidden'); OO.main.menu(b.dataset.x); });
    m.onclick = e => { if (e.target === m) m.classList.add('hidden'); };
  }

  /* ---------- 结算 ---------- */
  function showEnd(win, st) {
    const e = $('#end');
    e.className = win ? 'win' : 'lose';
    e.innerHTML = `<div class="end-in">
      <div class="et">${win ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="es">${win ? '你是竞技场最后的站立者' : '你倒在了誓约之地'}</div>
      <div class="place">第 <b>${st.place}</b> 名 / ${st.total}</div>
      <div class="egrid">
        <div><label>坚持轮数</label><b>${st.rounds}</b></div><div><label>造成伤害</label><b>${st.dealt}</b></div>
        <div><label>承受伤害</label><b>${st.taken}</b></div><div><label>击杀</label><b>${st.kills}</b></div><div><label>被援助</label><b>${st.aided}</b></div>
        <div><label>执行指令</label><b>${cmdHistory.length}</b></div>
      </div>
      <div class="dbtn"><button class="gold" data-x="restart">再战一局</button><button class="ghost" data-x="export">导出整局指令</button><button class="ghost" data-x="title">返回标题</button></div></div>`;
    e.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { if (b.dataset.x === 'export') { exportInput(); return; } e.className = 'hidden'; OO.main.menu(b.dataset.x); });
  }

  function hideEnd() { $('#end').className = 'hidden'; }
  function showEndOnline(r, me, host) {
    const e = $('#end');
    const mine = me ? r.ranking.find(x => x.char === me) : null;
    const win = mine && mine.place === 1;
    e.className = win ? 'win' : 'lose';
    const medal = p => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : p;
    e.innerHTML = `<div class="end-in">
      <div class="et">${!me ? 'FINISH' : win ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="es">${r.winner ? `最后的站立者：${escapeHTML(OO.world.chars.get(r.winner)?.display || r.winner)}` : '所有真人玩家都已倒下'}</div>
      <div class="rank">${r.ranking.map(x => `<div class="rk ${x.char === me ? 'me' : ''}"><span class="rp">${medal(x.place)}</span><canvas class="portrait" data-p="${x.char}" width="40" height="40"></canvas><b>${escapeHTML(OO.world.chars.get(x.char)?.display || x.name)}</b><small>${x.human ? '玩家' : 'AI'} · ${D.characters.find(c => c.id === x.char)?.title || ''}</small></div>`).join('')}</div>
      <div class="place">共 ${r.rounds} 轮 · 执行指令 ${cmdHistory.length} 条</div>
      <div class="dbtn">${host ? '<button class="gold" data-x="again">再来一局</button>' : '<span class="mut">等待房主发起再来一局…</span>'}<button class="ghost" data-x="export">导出整局指令</button><button class="ghost" data-x="leave">离开房间</button></div></div>`;
    e.querySelectorAll('canvas.portrait').forEach(cv => drawPortrait(cv, cv.dataset.p));
    e.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
      if (b.dataset.x === 'export') exportInput();
      else if (b.dataset.x === 'again') OO.online.again();
      else if (b.dataset.x === 'leave') { hideEnd(); OO.online.leave(); }
    });
  }

  /* ---------- 联机回合倒计时 ---------- */
  let timerInfo = null;
  function setTurnTimer(info) { timerInfo = info; tickTimer(); }
  function tickTimer() {
    const t = $('#turnTimer'); if (!t) return;
    if (!timerInfo) { t.classList.add('hidden'); return; }
    const left = Math.max(0, Math.ceil((timerInfo.ends - Date.now()) / 1000));
    t.classList.remove('hidden');
    t.classList.toggle('mine', !!timerInfo.mine);
    t.classList.toggle('urgent', left <= 8);
    t.innerHTML = `<b>${left}</b><span>${timerInfo.mine ? '你的回合' : escapeHTML(timerInfo.name)}</span>`;
  }
  setInterval(tickTimer, 250);

  return {
    hideEnd, showEndOnline, setTurnTimer, closeLoot, closeConfirm,
    init, showHUD, setHeroTurn, setBusy, refreshHero, refreshHotbar, refreshInspect, refreshAll, refreshActions,
    buildTurnBar, setTurn, markDead, setRound, setThinking, select, log, clearLog, banner, toast, heroHit, flashSlot,
    showLoot, confirm, showEnd, toggleBag, toggleTerm, doAct, applyMute, hideTip, drawPortrait,
    get bagOpen() { return !$('#bag').classList.contains('hidden'); },
    get heroTurn() { return heroTurn; }, svg,
  };
})();
