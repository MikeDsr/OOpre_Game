/* ============================================================
   誓约竞技场 · main.js —— 启动、主循环、输入、标题与菜单
   ============================================================ */
'use strict';
OO.main = (() => {
  const U = OO.U;
  const $ = s => document.querySelector(s);
  let last = 0, titleMode = true, errCount = 0;

  function boot() {
    OO.world.init($('#world'));
    OO.ui.init();
    bindInput();
    bindTitle();
    showTitle();
    requestAnimationFrame(frame);
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[A-Za-z0-9]{4,8}$/.test(room)) OO.online.openLobby(room.toUpperCase());
  }

  function frame(t) {
    const real = ((t - last) / 1000) || 0.016, raw = Math.min(real, 0.05); last = t;
    try {
      let dt = raw * U.time.speed * U.time.slowmo;
      if (U.time.freeze > 0) { U.time.freeze -= raw; dt *= 0.04; }
      U.tick(dt);
      OO.world.update(dt);
      if (titleMode) OO.world.cam.userYaw += raw * 0.035;
      OO.world.render();
      if (real < 0.25) OO.world.perf(real); // 切后台造成的长间隔不计入
    } catch (e) { if (errCount++ < 5) console.error(e); }
    requestAnimationFrame(frame);
  }

  /* ---------------- 输入 ---------------- */
  function bindInput() {
    const cv = $('#world');
    let down = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      OO.audio.unlock();
      down = { x: e.clientX, y: e.clientY, yaw: OO.world.cam.userYaw, moved: false, btn: e.button };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (down) {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 6) down.moved = true;
        if (down.moved && !titleMode) OO.world.cam.userYaw = U.clamp(down.yaw - dx * 0.004, -0.7, 0.7);
        return;
      }
      if (titleMode) return;
      const n = OO.world.pick(e.clientX, e.clientY);
      OO.world.setHover(n);
      cv.style.cursor = n ? 'pointer' : 'grab';
    });
    cv.addEventListener('pointerup', e => {
      const d = down; down = null;
      if (!d || d.moved || titleMode) return;
      const n = OO.world.pick(e.clientX, e.clientY);
      OO.ui.select(n);
    });
    cv.addEventListener('wheel', e => {
      if (titleMode) return;
      const c = OO.world.cam;
      c.userZoom = U.clamp(c.userZoom * (e.deltaY > 0 ? 0.94 : 1.06), 0.8, 1.4);
    }, { passive: true });
    cv.addEventListener('dblclick', () => { OO.world.cam.userYaw = 0; OO.world.cam.userZoom = 1; });

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      OO.audio.unlock();
      if (titleMode) { if (e.key === 'Enter' && $('#lobby').classList.contains('hidden')) $('#tStart').click(); return; }
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '9') { if (OO.ui.heroTurn) OO.game.heroAct('slot', { slot: +k - 1 }); return; }
      if (k === 'a') OO.ui.doAct('attack');
      else if (k === 's') OO.ui.doAct('useSelf');
      else if (k === 'd') OO.ui.doAct('useTarget');
      else if (k === 'f') OO.ui.doAct('pact');
      else if (k === 'w') OO.ui.doAct('wait');
      else if (k === 'b' || k === 'e') OO.ui.toggleBag();
      else if (k === 't') OO.ui.toggleTerm();
      else if (k === 'tab') {
        e.preventDefault();
        const alive = [...OO.world.chars.values()].filter(c => c.disp.alive && !c.isHero).map(c => c.name);
        if (!alive.length) return;
        const i = alive.indexOf(OO.world.selected);
        OO.ui.select(alive[(i + 1) % alive.length]);
      } else if (k === 'escape') {
        if (OO.ui.bagOpen) OO.ui.toggleBag(false);
        else if (!$('#settings').classList.contains('hidden')) $('#settings').classList.add('hidden');
        else OO.ui.select(null);
      }
    });
    window.addEventListener('pointerdown', () => OO.audio.unlock(), { once: true });
  }

  /* ---------------- 标题 ---------------- */
  let opponents = U.store.get('opp', 4);
  function bindTitle() {
    $('#nameIn').value = U.store.get('name', '');
    document.querySelectorAll('#oppSel button').forEach(b => {
      b.classList.toggle('on', +b.dataset.n === opponents);
      b.onclick = () => { opponents = +b.dataset.n; U.store.set('opp', opponents); document.querySelectorAll('#oppSel button').forEach(x => x.classList.toggle('on', x === b)); };
    });
    $('#tStart').onclick = () => {
      OO.audio.unlock(); OO.ui.applyMute();
      U.store.set('name', $('#nameIn').value.trim());
      if (!U.store.get('tutDone', false)) startTutorial(); else startMatch();
    };
    $('#tTut').onclick = () => { OO.audio.unlock(); OO.ui.applyMute(); startTutorial(); };
    $('#tOnline').onclick = () => { OO.audio.unlock(); OO.ui.applyMute(); U.store.set('name', $('#nameIn').value.trim()); OO.online.openLobby(); };
    $('#tSet').onclick = () => { OO.audio.unlock(); $('#btnMenu').click(); };
    $('#title').addEventListener('pointerdown', () => { OO.audio.unlock(); OO.ui.applyMute(); $('#title').classList.add('awake'); });
    refreshTitleBtn();
  }
  function refreshTitleBtn() {
    $('#tStart').innerHTML = U.store.get('tutDone', false) ? '开始对局' : '开始 <small>含新手引导</small>';
  }

  async function showTitle() {
    titleMode = true;
    document.body.classList.add('at-title');
    $('#title').classList.remove('hidden');
    $('#end').className = 'hidden';
    refreshTitleBtn();
    OO.game.opponents = 4;
    await OO.game.setup({ mode: 'showcase', heroDisplay: '誓约者' });
    OO.ui.showHUD(false);
    OO.world.letterbox = 0;
    OO.world.plates = false;
    OO.world.cam.userZoom = 0.8; OO.world.cam.screenYT = 0.74;
    OO.audio.music.setMode('title');
  }
  function leaveTitle() {
    titleMode = false;
    document.body.classList.remove('at-title');
    $('#title').classList.add('hidden');
    OO.world.cam.userYaw = 0; OO.world.cam.userZoom = 1; OO.world.cam.screenYT = 0.56;
    OO.world.plates = true;
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    $('#end').className = 'hidden';
    U.clearTweens(); U.time.slowmo = 1; U.time.freeze = 0;
    OO.world.letterbox = 0; OO.world.redVignette = 0;
  }

  function heroIdentity() {
    const raw = U.store.get('name', '') || '';
    const id = raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || 'Hero';
    return { heroName: id, heroDisplay: raw || '誓约者' };
  }
  async function startMatch() {
    leaveTitle();
    OO.game.opponents = opponents;
    await OO.game.start(Object.assign({ mode: 'match' }, heroIdentity()));
  }
  async function startTutorial() {
    leaveTitle();
    await OO.tutorial.run();
  }

  function menu(x) {
    if (OO.online.active) { // 联机中：重开 / 引导 / 回标题 都意味着离开房间
      if (x === 'restart') { OO.ui.toast('联机对局中无法重开，可等本局结束后由房主发起再来一局', 'red'); return; }
      OO.online.leave();
      if (x === 'tutorial') startTutorial();
      return;
    }
    if (x === 'restart') { if (titleMode) $('#tStart').click(); else startMatch(); }
    else if (x === 'title') { leaveTitle(); OO.game.over = true; showTitle(); }
    else if (x === 'tutorial') startTutorial();
  }
  /* 联机：进入对局画面 / 回到大厅背景 */
  function enterOnline() { leaveTitle(); }
  async function lobbyScene() { leaveTitle(); OO.game.over = true; await showTitle(); $('#title').classList.add('hidden'); }

  return { boot, menu, enterOnline, lobbyScene, get titleMode() { return titleMode; } };
})();
window.addEventListener('DOMContentLoaded', () => OO.main.boot());
