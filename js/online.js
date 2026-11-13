/* ============================================================
   誓约竞技场 · online.js —— 联机客户端
   服务器按顺序下发“指令批次”，这里用本地引擎逐条重放并交给导演演出；
   演完一批就回报 idle，服务器等所有人演完才推进下一步，保证大家看到的节奏一致。
   ============================================================ */
'use strict';
OO.online = (() => {
  const U = OO.U, D = OO.data, net = OO.net;
  const $ = s => document.querySelector(s);
  const A = (n, o) => OO.audio.play(n, o);
  const charDef = id => D.characters.find(c => c.id === id);
  const st = {
    active: false, phase: 'none', pid: null, me: null, spectator: false, code: null,
    lobby: null, roster: null, myTurn: false, busy: false, turn: null, deadline: 0,
    queue: [], running: false, round: 0, result: null,
  };
  const isMe = c => c && c === st.me;
  const nameOf = c => { const ch = OO.world.chars.get(c); return ch ? ch.display : (charDef(c) || {}).name || c; };

  /* ================= 大厅 ================= */
  function openLobby(joinCode) {
    st.active = true;
    const box = $('#lobby');
    box.classList.remove('hidden');
    renderEntry(joinCode);
    if (joinCode) join(joinCode);
  }
  function closeLobby() { $('#lobby').classList.add('hidden'); }

  function renderEntry(code) {
    const nm = U.store.get('name', '') || '';
    $('#lobby').innerHTML = `<div class="lb-in panel">
      <div class="lb-h"><div><b>联机对战</b><small>3–6 人 · 空位由 AI 补齐 · 服务器运行同一份作业引擎</small></div><button class="iconbtn lb-x">${OO.ui.svg('close')}</button></div>
      <div class="lb-entry">
        <label class="namef"><span>你的名字</span><input id="lbName" maxlength="12" value="${esc(nm)}" placeholder="誓约者"></label>
        <div class="lb-two">
          <div class="lb-card"><div class="lb-t">创建房间</div><div class="mut">成为房主，把邀请链接发给朋友</div><button class="gold" id="lbCreate">创建房间</button></div>
          <div class="lb-card"><div class="lb-t">加入房间</div><input id="lbCode" maxlength="6" placeholder="房间码" value="${esc(code || '')}" autocomplete="off"><button class="ghost" id="lbJoin">加入</button></div>
        </div>
        <div class="lb-status" id="lbStatus"></div>
      </div></div>`;
    $('#lobby .lb-x').onclick = leave;
    $('#lbCreate').onclick = () => { OO.audio.unlock(); saveName(); connect(net.newCode(), true); };
    $('#lbJoin').onclick = () => { OO.audio.unlock(); saveName(); const c = $('#lbCode').value.trim().toUpperCase(); if (!/^[A-Z0-9]{4,8}$/.test(c)) { status('房间码格式不对', true); return; } connect(c, false); };
    $('#lbCode').onkeydown = e => { if (e.key === 'Enter') $('#lbJoin').click(); };
  }
  function saveName() { const v = ($('#lbName') ? $('#lbName').value : '').trim(); U.store.set('name', v); return v; }
  function status(msg, bad) { const s = $('#lbStatus'); if (s) { s.textContent = msg; s.classList.toggle('bad', !!bad); } }
  function join(code) { saveName(); connect(code.toUpperCase(), false); }
  function connect(code, create) {
    st.code = code; st.phase = 'lobby';
    status(create ? '正在创建房间…' : '正在加入房间…');
    net.connect(code, U.store.get('name', '') || '无名者', create);
  }

  function renderRoom() {
    const L = st.lobby; if (!L) return;
    const me = L.players.find(p => p.pid === st.pid) || {};
    const host = !!me.host;
    const taken = new Map(L.players.filter(p => p.char).map(p => [p.char, p]));
    const box = $('#lobby');
    let room = box.querySelector('.lb-room');
    if (!room) {
      box.innerHTML = `<div class="lb-in panel lb-room">
        <div class="lb-h"><div><b>房间 <span class="lb-code"></span></b><small>把邀请链接发给朋友，最多 6 人</small></div><button class="iconbtn lb-x">${OO.ui.svg('close')}</button></div>
        <div class="lb-bar"><button class="ghost small" id="lbCopy">${OO.ui.svg('copy')}<span>复制邀请链接</span></button><div class="seg" id="lbSeats"></div><div class="lb-count"></div></div>
        <div class="lb-chars"></div>
        <div class="lb-foot"><div class="lb-hint"></div><div class="lb-btns"><button class="gold" id="lbStart">开始对局</button><button class="ghost" id="lbLeave">离开房间</button></div></div>
      </div>`;
      room = box.querySelector('.lb-room');
      box.querySelector('.lb-x').onclick = leave;
      $('#lbLeave').onclick = leave;
      $('#lbCopy').onclick = copyInvite;
      $('#lbStart').onclick = () => { A('click'); net.send({ t: 'start' }); };
      const cl = room.querySelector('.lb-chars');
      for (const d of D.characters) {
        const c = document.createElement('div');
        c.className = 'lc'; c.dataset.char = d.id;
        c.innerHTML = `<canvas width="180" height="210"></canvas><div class="lc-n">${d.name}<small>${d.title}</small></div>
          <div class="lc-s"><span>体力 <b>${d.hp}</b></span><span>攻击 <b>${d.atk}</b></span>${d.shield ? `<span>护盾 <b>${d.shield}</b></span>` : ''}</div>
          <div class="lc-k">${(d.kit || []).map(k => `<img src="${OO.icons.url(k[1])}" title="${D.items[k[1]].name}">`).join('')}</div>
          <div class="lc-o"></div>`;
        c.onclick = () => { if (st.lobby && st.lobby.phase === 'lobby') { A('select'); net.send({ t: 'pick', char: d.id }); } };
        c.onmouseenter = () => A('hover');
        cl.appendChild(c);
        OO.world.portrait(d, c.querySelector('canvas'), true);
      }
    }
    room.querySelector('.lb-code').textContent = L.code;
    const seg = $('#lbSeats');
    seg.innerHTML = `<span class="mut">总人数</span>` + [3, 4, 5, 6].map(n => `<button data-n="${n}" class="${L.seats === n ? 'on' : ''}" ${host && n >= L.players.length ? '' : 'disabled'}>${n}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.onclick = () => net.send({ t: 'seats', n: +b.dataset.n }));
    room.querySelector('.lb-count').textContent = `${L.players.length} 名玩家 · ${Math.max(0, L.seats - L.players.length)} 个 AI 补位`;
    room.querySelectorAll('.lc').forEach(c => {
      const p = taken.get(c.dataset.char);
      c.classList.toggle('mine', !!p && p.pid === st.pid);
      c.classList.toggle('taken', !!p && p.pid !== st.pid);
      c.querySelector('.lc-o').innerHTML = p ? `<i class="dot ${p.online ? 'on' : ''}"></i>${esc(p.name)}${p.host ? ' · 房主' : ''}${p.pid === st.pid ? '（你）' : ''}` : '<span class="mut">空位 · 可选</span>';
    });
    const ready = L.players.every(p => p.char);
    const sb = $('#lbStart');
    sb.style.display = host ? '' : 'none';
    sb.disabled = !ready || L.phase !== 'lobby';
    room.querySelector('.lb-hint').textContent = L.phase === 'playing' ? '对局进行中…' : host ? (ready ? '人到齐了就开始吧。不足的位置由 AI 补上。' : '等待所有玩家选好角色') : '等待房主开始对局';
  }

  function copyInvite() {
    const url = location.origin + location.pathname + '?room=' + st.code;
    const done = () => OO.ui.toast('邀请链接已复制：' + url, 'gold');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('复制这个链接发给朋友', url));
    else prompt('复制这个链接发给朋友', url);
  }

  function leave() {
    net.close();
    st.active = false; st.phase = 'none'; st.queue.length = 0; st.myTurn = false; st.lobby = null; st.roster = null;
    closeLobby();
    OO.ui.setTurnTimer(null);
    if (OO.game.mode === 'online' || $('#title').classList.contains('hidden')) OO.main.menu('title');
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
  }

  /* ================= 网络事件 ================= */
  net.on('status', s => {
    if (!st.active) return;
    if (s.state === 'error') { status(s.msg, true); OO.ui.toast(s.msg, 'red'); }
    else if (s.state === 'reconnecting' && st.phase !== 'lobby') OO.ui.toast('连接中断，正在重连…', 'red');
  });
  net.on('err', m => {
    status(m.msg, true);
    if (st.phase === 'playing' || st.phase === 'lobby' && st.lobby) {
      OO.ui.closeLoot(); OO.ui.closeConfirm();
      OO.ui.confirm('房间已失效', `${m.msg}。<br><span class="mut">服务器更新或长时间无人时房间会被回收，请回到标题重新创建房间。</span>`, '返回标题', '留在此处')
        .then(ok => { if (ok) leave(); });
    } else OO.ui.toast(m.msg, 'red');
  });
  net.on('welcome', m => {
    st.pid = m.pid; st.spectator = !!m.spectator; st.code = m.code;
    try { history.replaceState(null, '', location.pathname + '?room=' + m.code); } catch (e) { }
    if (st.spectator) OO.ui.toast('对局已开始，你正在观战', 'gold');
  });
  net.on('lobby', m => {
    st.lobby = m;
    if (m.phase === 'lobby') {
      if (st.phase === 'playing') { // 房主点了“再来一局”：全员回到大厅
        st.queue.length = 0; st.myTurn = false; st.roster = null;
        OO.ui.hideEnd(); OO.ui.setTurnTimer(null);
        OO.main.lobbyScene();
      }
      st.phase = 'lobby';
      $('#lobby').classList.remove('hidden');
      renderRoom();
    } else if (!$('#lobby').classList.contains('hidden')) renderRoom();
  });
  ['start', 'sync', 'batch', 'turn', 'round', 'over'].forEach(t => net.on(t, m => push(m)));
  net.on('fx', m => {
    if (m.kind === 'toast') OO.ui.toast(m.text, 'gold');
    else if (m.kind === 'emote') emote(m);
    else if (m.kind === 'lag') OO.ui.toast(`等待 ${m.names.join('、')} 同步画面…`, '');
    else if (m.kind === 'lootwait') OO.ui.toast(`等待 ${m.names.join('、')} 选择战利品…`, '');
    else if (m.kind === 'afk') onAfk(m);
    else push(m);
  });
  net.on('loot', m => push(m));
  net.on('lootEnd', () => OO.ui.closeLoot());
  net.on('pactAsk', m => {
    A('pact');
    OO.ui.confirm(`${nameOf(m.from)} 提议与你缔结誓约`, `接受后你们将互相关注（add_subscribe 双向）：任何一方跌破半血时，另一方会自动用药水援助。<br><span class="mut">${Math.round(m.ms / 1000)} 秒内不回应视为拒绝</span>`, '缔结誓约', '拒绝')
      .then(ok => net.send({ t: 'pactReply', ok }));
  });
  net.on('pactEnd', () => OO.ui.closeConfirm());
  net.on('reject', m => { OO.ui.toast(m.msg || '操作无效', 'red'); A('error'); st.busy = false; if (st.turn === st.me) { st.myTurn = true; OO.ui.setHeroTurn(true); } });

  /* ================= 顺序播放队列 ================= */
  function push(m) { st.queue.push(m); if (!st.running) pump(); }
  async function pump() {
    st.running = true;
    while (st.queue.length) {
      const m = st.queue.shift();
      st.cur = { t: m.t, seq: m.seq, tag: m.tag, actor: m.actor || m.who, cmds: m.cmds ? m.cmds.length : 0, since: Date.now() };
      try { await handle(m); } catch (e) { console.error('联机演出出错', m, e); diag('handleError', { item: st.cur, msg: String(e && e.stack || e).slice(0, 400) }); }
      st.cur = null;
    }
    st.running = false;
  }

  /* 自检：某条消息处理超过 12 秒，或页面报错，就把当时的状态上报给服务器（写进黑匣子） */
  let diagCount = 0;
  function diag(kind, extra = {}) {
    if (diagCount++ > 30) return;
    net.send({ t: 'diag', d: Object.assign({
      kind, q: st.queue.length, myTurn: st.myTurn, busy: st.busy, turn: st.turn, round: st.round,
      hidden: document.hidden, instant: OO.U.instant, fps: Math.round(OO.world.fps || 0),
      slowmo: OO.U.time.slowmo, freeze: +OO.U.time.freeze.toFixed(3), speed: OO.U.time.speed,
    }, extra) });
  }
  setInterval(() => {
    if (st.phase !== 'playing' || !st.cur || st.cur.reported) return;
    if (Date.now() - st.cur.since > 12000) { st.cur.reported = true; diag('slowItem', { item: st.cur, ms: Date.now() - st.cur.since }); }
  }, 3000);
  window.addEventListener('error', e => { if (st.phase === 'playing') diag('jsError', { msg: String(e.message).slice(0, 300), src: (e.filename || '').split('/').pop() + ':' + e.lineno }); });
  window.addEventListener('unhandledrejection', e => { if (st.phase === 'playing') diag('promiseError', { msg: String(e.reason && e.reason.stack || e.reason).slice(0, 300) }); });

  async function handle(m) {
    switch (m.t) {
      case 'start': return begin(m.roster, null);
      case 'sync': return begin(m.roster, m);
      case 'batch': return playBatch(m);
      case 'round':
        st.round = m.round; OO.game.round = m.round;
        OO.ui.setRound(m.round); A('roundStart');
        OO.ui.banner(`第 ${m.round} 轮`, '按加入顺序依次行动', 'round');
        OO.game.updateIntensity();
        await U.wait(0.6);
        return;
      case 'turn': return onTurn(m);
      case 'fx': return onFx(m);
      case 'loot':
        OO.ui.showLoot(m.cards, m.count, m.ms).then(i => net.send({ t: 'lootPick', i }));
        return;
      case 'over': return onOver(m);
    }
  }

  async function begin(roster, sync) {
    st.roster = roster; st.phase = 'playing'; st.result = null;
    const mine = roster.find(r => r.pid && r.pid === st.pid);
    st.me = mine ? mine.char : null;
    st.spectator = !st.me;
    closeLobby();
    OO.main.enterOnline();
    OO.game.setupOnline(roster, st.me);
    if (sync) {
      for (const c of sync.log) await OO.game.execQuiet(c);
      OO.ui.refreshAll();
      st.round = sync.round; OO.game.round = sync.round; OO.ui.setRound(sync.round);
      if (sync.blood) OO.world.bloodMoon = 1;
      net.send({ t: 'idle', seq: sync.seq });
      if (sync.phase === 'over' && sync.result) return onOver(sync.result);
      if (sync.turn) onTurn({ who: sync.turn, ms: sync.turnMs, ai: !roster.find(r => r.char === sync.turn && r.pid) });
    } else {
      OO.audio.music.setMode('battle'); OO.audio.music.setIntensity(0.2);
      OO.ui.banner('对局开始', roster.map(r => r.name).join(' · '), 'fate');
    }
  }

  async function playBatch(m) {
    try { await playBatchInner(m); } catch (e) { console.error('批次演出出错', e); }
    finally {
      if (isMe(m.actor) && m.tag !== 'free') st.busy = false;
      net.send({ t: 'idle', seq: m.seq });
    }
  }
  async function playBatchInner(m) {
    const actor = m.actor;
    if (m.tag === 'setup') {
      for (const c of m.cmds) await OO.game.execQuiet(c);
      OO.ui.refreshAll();
    } else if (m.tag === 'loot') {
      const owners = m.cmds.map(c => c.split(/\s+/)[1]);
      owners.forEach(o => OO.world.fx.beam(o, isMe(o) ? '#ffd36b' : '#9fd0ff', { life: 0.9, w: 22 }));
      A('beam'); A('loot', { delay: 0.35 });
      for (const c of m.cmds) await OO.game.exec(c, { quietItems: true });
      if (st.me && owners.includes(st.me)) OO.ui.toast('战利品已收入背包', 'gold');
      await U.wait(0.5);
    } else {
      if (m.tag === 'ai' && actor) OO.ui.setThinking(actor, m.label || '');
      for (const c of m.cmds) {
        await OO.game.exec(c, { actor });
        if (/^(change_slot|swap)/.test(c) && m.tag !== 'free') await U.wait(0.06);
      }
      if (m.tag === 'ai') OO.ui.setThinking(null);
    }
  }

  function onTurn(m) {
    st.turn = m.who; st.busy = false;
    OO.world.setActive(m.who); OO.ui.setTurn(m.who);
    const mine = isMe(m.who) && !st.spectator;
    st.myTurn = mine;
    OO.ui.setHeroTurn(mine);
    st.deadline = m.ms ? Date.now() + m.ms : 0;
    OO.ui.setTurnTimer(st.deadline ? { ends: st.deadline, mine, name: nameOf(m.who) } : null);
    if (mine) { A('yourTurn'); OO.ui.toast('你的回合 · 选择目标并行动', 'gold'); OO.ui.setThinking(null); }
    else { A('enemyTurn'); if (!m.ai) OO.ui.setThinking(m.who, '玩家思考中…'); }
  }

  async function onFx(m) {
    const W = OO.world;
    switch (m.kind) {
      case 'propose': A('select'); W.fx.text(m.who, '提出誓约', { col: '#ffd36b', size: 22, kind: 'label', y: 220, sub: `→ ${nameOf(m.to)}` }); await U.wait(0.6); break;
      case 'decline': A('error'); W.fx.text(m.who, '拒绝了誓约', { col: '#ff9a9a', size: 24, kind: 'label', y: 220 }); await U.wait(0.7); break;
      case 'betray': OO.ui.banner('背誓', `${nameOf(m.who)} 向 ${nameOf(m.to)} 挥出了刀刃`, 'alarm'); break;
      case 'duel': OO.ui.banner('最终决战', '残存者之间的誓约全部失效', 'fate'); A('pactBreak'); await U.wait(0.8); break;
      case 'wait': W.fx.text(m.who, '蓄势待发', { col: '#cfd8ff', size: 22, kind: 'label', y: 210 }); await U.wait(0.4); break;
      case 'blood':
        OO.world.bloodMoon = 1; A('death', { vol: 0.6 }); A('alarm');
        OO.ui.banner('血月降临', '补给中不再有治疗与护盾药剂 · 每轮结束所有人遭受侵蚀', 'alarm');
        await U.wait(1.6); break;
      case 'curse': OO.ui.banner('血月侵蚀', `第 ${m.k} 轮 · 每人受到最大体力 ${m.pct}% 的魔法伤害`, 'alarm'); await U.wait(0.6); break;
      case 'timeout': W.fx.text(m.who, '超时', { col: '#ff9a9a', size: 22, kind: 'label', y: 210, sub: '本回合跳过' }); if (isMe(m.who)) { st.myTurn = false; OO.ui.setHeroTurn(false); } await U.wait(0.4); break;
    }
  }
  function onAfk(m) {
    if (isMe(m.who)) {
      if (m.on) {
        st.myTurn = false; OO.ui.setHeroTurn(false);
        OO.ui.confirm('你已暂离', '连续两次回合超时，AI 正在替你行动。<br><span class="mut">点“我回来了”立即恢复操作。</span>', '我回来了', '继续托管')
          .then(ok => { if (ok) net.send({ t: 'back' }); });
      } else OO.ui.toast('欢迎回来，已恢复你的操作', 'gold');
    } else OO.ui.toast(m.on ? `${m.name} 暂离，由 AI 托管` : `${m.name} 回来了`, m.on ? '' : 'gold');
  }
  function emote(m) { OO.world.fx.text(m.who, m.text, { col: '#ffffff', size: 22, kind: 'label', y: 240, rise: 30, life: 2.2 }); A('hover'); }

  async function onOver(r) {
    st.myTurn = false; st.turn = null; st.result = r;
    OO.ui.setHeroTurn(false); OO.ui.setTurnTimer(null); OO.ui.setThinking(null);
    OO.world.setActive(null);
    await U.wait(1);
    const myPlace = st.me ? (r.ranking.find(x => x.char === st.me) || {}).place : null;
    const win = myPlace === 1;
    OO.audio.music.setMode('silent');
    OO.audio.play(win ? 'victory' : 'defeat');
    if (r.winner) { OO.world.focusOn([r.winner], 1.3); OO.world.fx.beam(r.winner, '#ffd36b', { life: 3, w: 60, h: 800 }); }
    const host = st.lobby && (st.lobby.players.find(p => p.pid === st.pid) || {}).host;
    OO.ui.showEndOnline(r, st.me, host);
  }

  /* ================= 玩家动作 → 服务器 ================= */
  const FREE = new Set(['slot', 'swap', 'discard', 'unsub']);
  function act(kind, arg = {}) {
    if (!st.myTurn || st.busy) { A('error'); return false; }
    if (FREE.has(kind)) { net.send({ t: 'act', kind, arg }); A(kind === 'slot' ? 'slot' : 'swap'); return true; }
    if (!net.send({ t: 'act', kind, arg })) { OO.ui.toast('连接中断，正在重连…', 'red'); A('error'); return false; }
    st.busy = true; st.myTurn = false;
    OO.ui.setHeroTurn(false);
    OO.ui.setTurnTimer(null);
    return true;
  }
  function again() { net.send({ t: 'again' }); }

  document.addEventListener('visibilitychange', () => {
    const bg = document.hidden && st.active && st.phase === 'playing';
    OO.U.instant = bg;
    if (bg) { OO.U.clearTweens(); OO.world.flushFX(); OO.U.time.freeze = 0; OO.U.time.slowmo = 1; }
  });

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  return {
    openLobby, leave, act, again, emote: text => net.send({ t: 'emote', text }),
    get active() { return st.active; }, get myTurn() { return st.myTurn; }, get busy() { return st.busy; },
    get me() { return st.me; }, get spectator() { return st.spectator; }, get phase() { return st.phase; },
    isHuman: c => !!(st.roster || []).find(r => r.char === c && r.pid),
  };
})();
