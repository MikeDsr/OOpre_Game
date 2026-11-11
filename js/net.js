/* ============================================================
   誓约竞技场 · net.js —— 与联机服务器的 WebSocket 连接
   - 网页由 Worker 托管时直接连同源；否则连 OO.data.net.server
   - 断线自动重连（指数退避），用 sessionStorage 记住本标签页在该房间的身份
   ============================================================ */
'use strict';
OO.net = (() => {
  let ws = null, base = null, code = null, name = '', create = false;
  let handlers = {}, wantOpen = false, retry = 0, retryTimer = 0, lastMsg = 0;
  // 心跳：每 15 秒 ping 一次；40 秒没收到服务器任何消息就判定半断开，主动重连
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    send({ t: 'ping' });
    // 后台标签页的定时器会被浏览器降频，只在前台判定，避免误判
    if (!document.hidden && Date.now() - lastMsg > 45000) { try { ws.close(); } catch (e) { } }
  }, 15000);

  async function server() {
    if (base) return base;
    const override = OO.U.store.get('server', '');
    if (override) return (base = override.replace(/\/$/, ''));
    try {
      if (location.protocol.startsWith('http')) {
        const r = await fetch('/api/ping', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.ok === 'oath-arena') return (base = location.origin);
      }
    } catch (e) { /* 不是由 Worker 托管 */ }
    return (base = OO.data.net.server.replace(/\/$/, ''));
  }

  const pidKey = c => 'oath_pid_' + c;
  function pidOf(c) { try { return sessionStorage.getItem(pidKey(c)) || ''; } catch (e) { return ''; } }
  function savePid(c, pid) { try { if (pid) sessionStorage.setItem(pidKey(c), pid); } catch (e) { } }

  async function connect(roomCode, nick, isCreate) {
    close();
    code = roomCode.toUpperCase(); name = nick; create = !!isCreate; wantOpen = true; retry = 0;
    await open();
  }
  async function open() {
    const b = await server();
    const url = b.replace(/^http/, 'ws') + '/ws/' + code + (create ? '?create=1' : '');
    let sock;
    try { sock = new WebSocket(url); } catch (e) { emit('status', { state: 'error', msg: '无法连接服务器' }); return; }
    ws = sock;
    emit('status', { state: retry ? 'reconnecting' : 'connecting' });
    sock.onopen = () => {
      if (sock !== ws) return;
      retry = 0; lastMsg = Date.now();
      emit('status', { state: 'open' });
      send({ t: 'hello', name, pid: pidOf(code) });
    };
    sock.onmessage = e => {
      if (sock !== ws) return;
      lastMsg = Date.now();
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'pong') return;
      if (m.t === 'welcome') { if (m.pid) savePid(code, m.pid); create = false; }
      if (m.t === 'err') wantOpen = false;
      emit(m.t, m);
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      ws = null;
      if (!wantOpen) { emit('status', { state: 'closed' }); return; }
      retry++;
      if (retry > 12) { wantOpen = false; emit('status', { state: 'error', msg: '与服务器断开，重连失败' }); return; }
      emit('status', { state: 'reconnecting', retry });
      retryTimer = setTimeout(open, Math.min(8000, 600 * Math.pow(1.6, retry)));
    };
  }
  function close() {
    wantOpen = false; clearTimeout(retryTimer);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { } }
  }
  function send(obj) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; }
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function emit(type, m) { for (const fn of handlers[type] || []) { try { fn(m); } catch (e) { console.error(e); } } }
  function newCode() { const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (let i = 0; i < 5; i++) o += s[Math.floor(Math.random() * s.length)]; return o; }

  return { connect, close, send, on, newCode, server, get code() { return code; }, get connected() { return !!(ws && ws.readyState === 1); } };
})();
