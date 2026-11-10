/* ============================================================
   誓约竞技场 · world.js —— 2.5D 渲染
   世界坐标：x 右、y 上、z 朝向镜头；地面 y=0。透视相机绕 y 轴环绕。
   角色是“立牌”，按深度排序；地面、光照、特效都在 3D 空间投影。
   ============================================================ */
'use strict';
OO.world = (() => {
  const U = OO.U, TAU = U.TAU;
  let cv, ctx, W = 0, H = 0, DPR = 1, Q = 1;
  let floorCv = null, floorKey = '', vgCv = null;
  const SPR = 1.5;   // 角色立牌离屏分辨率倍数
  const glowCache = new Map();
  let frameN = 0, ema = 1 / 60, slowT = 0, fastT = 0;
  const prof = { on: false };
  const R = 430;                 // 竞技台半径
  const RING = 255;              // 角色站位半径
  const cam = {
    yaw: 0, pitch: 0.52, dist: 1250, F: 1000,
    tx: 0, ty: 40, tz: 0,
    base: { yaw: 0, pitch: 0.52, dist: 1250, tx: 0, tz: 0 },
    userYaw: 0, userZoom: 1, sway: 0, screenY: 0.56, screenYT: 0.56,
    shakeP: 0, sx: 0, sy: 0, punch: 0,
    focus: null,
    view: { z: 1, ox: 0, oy: 0 },   // 2D 视图变换：screen = p * z + o
  };
  const chars = new Map();
  const props = [];
  let parts = [], texts = [], rings = [], slashes = [], beams = [], projs = [], bolts = [];
  let flash = { a: 0, col: '#fff' }, vignette = { red: 0 }, letterbox = 0, letterboxT = 0;
  let selected = null, activeTurn = null, hoverName = null, showPlates = true;
  let blood = 0, bloodT = 0;   // 血月：0~1
  let bg = null, tiles = [], stars = [];
  let T = 0;
  const linkPulse = new Map(); // "A>B" → 强度

  /* ---------------- 初始化 / 尺寸 ---------------- */
  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d', { alpha: false });
    if (QFIX[qMode]) Q = QFIX[qMode];
    resize();
    window.addEventListener('resize', resize);
    // 地砖
    const radii = [0, 70, 150, 230, 310, 380, R];
    const segs = [1, 10, 16, 22, 28, 34];
    for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs[i]; j++) {
        const t = { r0: radii[i], r1: radii[i + 1], a0: j / segs[i] * TAU + i * 0.13, a1: (j + 1) / segs[i] * TAU + i * 0.13, shade: U.rand(-0.06, 0.06) };
        const steps = Math.max(2, Math.ceil((t.a1 - t.a0) / 0.14)), pts = [];
        for (let k = 0; k <= steps; k++) { const a = t.a0 + (t.a1 - t.a0) * k / steps; pts.push([Math.cos(a) * t.r1, Math.sin(a) * t.r1]); }
        if (t.r0 > 0) for (let k = steps; k >= 0; k--) { const a = t.a0 + (t.a1 - t.a0) * k / steps; pts.push([Math.cos(a) * t.r0, Math.sin(a) * t.r0]); }
        t.pts = pts;
        const mid = (t.r0 + t.r1) / 2, am = (t.a0 + t.a1) / 2;
        t.light = t.shade + (Math.sin(am) * mid / R) * 0.06;
        if (Math.random() < 0.18) t.crackPts = [[Math.cos(am - 0.03) * (t.r0 + 8), Math.sin(am - 0.03) * (t.r0 + 8)], [Math.cos(am + 0.02) * mid, Math.sin(am + 0.02) * mid], [Math.cos(am - 0.01) * (t.r1 - 6), Math.sin(am - 0.01) * (t.r1 - 6)]];
        tiles.push(t);
      }
    }
    // 石柱 + 火盆
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU + TAU / N / 2;
      if (Math.sin(a) > 0.5) continue; // 镜头前方留空，不挡视线
      props.push({ kind: 'pillar', x: Math.cos(a) * (R - 24), z: Math.sin(a) * (R - 24), h: i % 3 === 1 ? 120 : 175, broken: i % 3 === 1, seed: Math.random() * 10 });
    }
    for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random() * 0.55, r: U.rand(0.5, 1.6), p: Math.random() * TAU, s: U.rand(0.5, 2) });
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5) * Q;
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    // 焦距：让竞技台占据画面主要区域
    const fitW = W * 0.86, fitH = H * 1.45;
    cam.F = Math.min(fitW, fitH) * cam.dist / (2 * R);
    bg = null; floorKey = ''; floorCv = null; vgCv = null;
  }

  /* ---------------- 投影 ---------------- */
  function project(x, y, z) {
    const dx = x - cam.tx, dy = y - cam.ty, dz = z - cam.tz;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const vy = dy - cam.dist * sp, vz = rz - cam.dist * cp;
    const depth = -vy * sp - vz * cp;
    const syv = vy * cp - vz * sp;
    const s = cam.F / Math.max(depth, 1);
    return { x: W / 2 + rx * s + cam.sx, y: H * cam.screenY - syv * s + cam.sy, s, depth };
  }
  function floorEllipse(x, z, r) {
    const c = project(x, 0, z), a = project(x + r, 0, z), b = project(x, 0, z + r);
    const ax = a.x - c.x, ay = a.y - c.y, bx = b.x - c.x, by = b.y - c.y;
    return { cx: c.x, cy: c.y, rx: Math.hypot(ax, ay), ry: Math.max(Math.hypot(bx, by), 0.5), rot: Math.atan2(ay, ax), s: c.s };
  }
  function ellipsePath(e, k = 1) { ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx * k, e.ry * k, e.rot, 0, TAU); }

  /* ---------------- 背景（离屏缓存） ---------------- */
  function buildBG() {
    const c = document.createElement('canvas'); c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    const g = c.getContext('2d'); g.scale(DPR, DPR);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#04050d'); sky.addColorStop(0.35, '#0d1030'); sky.addColorStop(0.62, '#2a1f45'); sky.addColorStop(0.8, '#4a2a48'); sky.addColorStop(1, '#120c1c');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // 星云
    const neb = (x, y, r, col, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, U.hexA(col, a)); rg.addColorStop(1, U.hexA(col, 0)); g.fillStyle = rg; g.fillRect(0, 0, W, H); };
    neb(W * 0.78, H * 0.18, W * 0.42, '#5b2bb8', 0.22);
    neb(W * 0.22, H * 0.32, W * 0.35, '#1b6b8a', 0.18);
    neb(W * 0.55, H * 0.5, W * 0.5, '#b8427a', 0.12);
    // 静态星星
    for (let i = 0; i < 520; i++) {
      const x = Math.random() * W, y = Math.pow(Math.random(), 1.6) * H * 0.62, r = Math.random() * 1.1 + 0.2;
      g.fillStyle = `rgba(255,255,255,${U.rand(0.15, 0.8) * (1 - y / (H * 0.7))})`;
      g.fillRect(x, y, r, r);
    }
    // 远山（三层）
    const mount = (base, amp, col, seed, rough) => {
      g.beginPath(); g.moveTo(-20, H);
      for (let x = -20; x <= W + 20; x += 8) {
        const n = Math.sin(x * 0.004 + seed) * 0.5 + Math.sin(x * 0.011 + seed * 2.1) * 0.3 + Math.sin(x * 0.031 + seed * 3.7) * rough;
        g.lineTo(x, base - Math.abs(n) * amp);
      }
      g.lineTo(W + 20, H); g.closePath(); g.fillStyle = col; g.fill();
    };
    mount(H * 0.55, H * 0.2, '#1c1530', 1.3, 0.12);
    mount(H * 0.6, H * 0.15, '#150f24', 4.1, 0.18);
    mount(H * 0.66, H * 0.1, '#0e0a18', 7.7, 0.25);
    // 云海
    const sea = g.createLinearGradient(0, H * 0.6, 0, H);
    sea.addColorStop(0, 'rgba(70,50,110,0)'); sea.addColorStop(0.3, 'rgba(60,45,100,.55)'); sea.addColorStop(1, 'rgba(18,12,30,.95)');
    g.fillStyle = sea; g.fillRect(0, H * 0.6, W, H * 0.4);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * W, y = H * U.rand(0.68, 1.05), r = U.rand(60, 200);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${110 + Math.random() * 40},${80 + Math.random() * 30},${150 + Math.random() * 40},${U.rand(0.05, 0.14)})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0, 0, TAU); g.fill();
    }
    // 月亮与月晕（静态烘焙）
    const mx = W * 0.2, my = H * 0.17, mr = Math.min(W, H) * 0.075;
    let rg = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 6);
    rg.addColorStop(0, 'rgba(200,210,255,.32)'); rg.addColorStop(0.3, 'rgba(140,150,255,.08)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    rg = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    rg.addColorStop(0, '#fffaf0'); rg.addColorStop(0.7, '#e8e4ff'); rg.addColorStop(1, '#b8b4e8');
    g.fillStyle = rg; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(150,140,200,.25)';
    [[0.3, -0.2, 0.22], [-0.25, 0.25, 0.16], [0.1, 0.4, 0.12], [-0.35, -0.3, 0.1]].forEach(([ox, oy, r]) => { g.beginPath(); g.arc(mx + ox * mr, my + oy * mr, r * mr, 0, TAU); g.fill(); });
    // 极光（静态）
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      const baseY = H * (0.16 + k * 0.08);
      for (let x = 0; x <= W; x += 20) { const y = baseY + Math.sin(x * 0.004 + k * 2) * H * 0.04 + Math.sin(x * 0.011) * H * 0.015; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      for (let x = W; x >= 0; x -= 20) g.lineTo(x, baseY + H * 0.09 + Math.sin(x * 0.005 + k) * H * 0.03);
      const ag = g.createLinearGradient(0, baseY, 0, baseY + H * 0.12);
      ag.addColorStop(0, 'rgba(0,0,0,0)'); ag.addColorStop(0.4, k ? 'rgba(60,220,180,.08)' : 'rgba(150,100,255,.07)'); ag.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ag; g.fill();
    }
    bg = c;
    // 暗角（静态）
    vgCv = document.createElement('canvas'); vgCv.width = c.width; vgCv.height = c.height;
    const v = vgCv.getContext('2d'); v.scale(DPR, DPR);
    const vg = v.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
    v.fillStyle = vg; v.fillRect(0, 0, W, H);
  }

  /* 预渲染的光点贴图（替代逐粒子创建径向渐变） */
  function glowSprite(col) {
    let c = glowCache.get(col);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, U.hexA(col, 1)); rg.addColorStop(0.3, U.hexA(col, 0.4)); rg.addColorStop(1, U.hexA(col, 0));
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    glowCache.set(col, c);
    return c;
  }
  const coreCache = new Map();
  function coreSprite(col) {
    let c = coreCache.get(col);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.18, U.hexA(col, 0.95)); rg.addColorStop(0.4, U.hexA(col, 0.3)); rg.addColorStop(1, U.hexA(col, 0));
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    coreCache.set(col, c);
    return c;
  }
  function glowAt(col, x, y, r, a) { if (a <= 0.004 || r < 0.3) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; }

  function drawSky() {
    if (!bg) buildBG();
    ctx.drawImage(bg, 0, 0, W, H);
    const mx = W * 0.2, my = H * 0.17, par = 0;
    // 月光光柱
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const a = 0.55 + i * 0.12 + Math.sin(T * 0.2 + i) * 0.02;
      const len = H * 1.4;
      ctx.fillStyle = `rgba(150,160,255,${0.025 + Math.sin(T * 0.3 + i * 2) * 0.01})`;
      ctx.beginPath(); ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(a - 0.04) * len, my + Math.sin(a - 0.04) * len);
      ctx.lineTo(mx + Math.cos(a + 0.04) * len, my + Math.sin(a + 0.04) * len); ctx.fill();
    }
    // 闪烁星
    for (const s of stars) {
      const a = 0.4 + Math.sin(T * s.s + s.p) * 0.4;
      ctx.fillStyle = `rgba(220,230,255,${a})`;
      const x = ((s.x * W - par * 0.5) % W + W) % W, y = s.y * H;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
      if (s.r > 1.3) { ctx.fillRect(x - s.r * 3, y - 0.3, s.r * 6, 0.6); ctx.fillRect(x - 0.3, y - s.r * 3, 0.6, s.r * 6); }
    }
    ctx.restore();
  }

  /* ---------------- 竞技台 ---------------- */
  const FM = 0.25; // 地台缓存四周留白（允许 2D 缩小时不露边）
  function drawPlatform() {
    const key = [cam.yaw.toFixed(4), cam.pitch.toFixed(4), cam.dist.toFixed(1), cam.tx.toFixed(1), cam.tz.toFixed(1), cam.screenY.toFixed(4), cam.F.toFixed(1), W, H, DPR].join('|');
    const mx = W * FM, my = H * FM;
    if (key !== floorKey || !floorCv) {
      if (!floorCv) { floorCv = document.createElement('canvas'); floorCv.width = Math.round((W + mx * 2) * DPR); floorCv.height = Math.round((H + my * 2) * DPR); }
      const main = ctx, sx = cam.sx, sy = cam.sy;
      ctx = floorCv.getContext('2d'); cam.sx = 0; cam.sy = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, floorCv.width, floorCv.height);
      ctx.setTransform(DPR, 0, 0, DPR, mx * DPR, my * DPR);
      drawPlatformStatic();
      ctx = main; cam.sx = sx; cam.sy = sy;
      floorKey = key;
    }
    ctx.drawImage(floorCv, cam.sx - mx, cam.sy - my, W + mx * 2, H + my * 2);
    drawRunes();
  }
  function drawPlatformStatic() {
    const N = 72;
    const top = [], bot = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      top.push(project(x, 0, z));
      const drop = 70 + Math.sin(a * 7) * 12 + Math.sin(a * 13 + 1) * 8;
      bot.push(project(x * 0.94, -drop, z * 0.94));
    }
    const center = project(0, 0, 0);
    const front = i => top[i].depth < center.depth + 40;   // 背面会被顶面挡住，不画
    const B = 6, bucket = l => Math.min(B - 1, Math.floor(l * B));
    // 底部岩体（倒锥）：按明暗分桶，一桶一次填充
    const tip = project(0, -520, 0);
    ctx.save();
    for (let b = 0; b < B; b++) {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const l = 0.5 + 0.5 * Math.cos(i / N * TAU + cam.yaw - 2.4);
        if (bucket(l) !== b) continue;
        const j = (i + 1) % N;
        ctx.moveTo(bot[i].x, bot[i].y); ctx.lineTo(bot[j].x, bot[j].y); ctx.lineTo(tip.x, tip.y); ctx.closePath();
      }
      const l = (b + 0.5) / B;
      ctx.fillStyle = `rgb(${18 + l * 22 | 0},${14 + l * 16 | 0},${28 + l * 22 | 0})`; ctx.fill();
    }
    const fog = ctx.createLinearGradient(0, center.y, 0, tip.y);
    fog.addColorStop(0, 'rgba(40,28,70,0)'); fog.addColorStop(1, 'rgba(40,28,70,.95)');
    ctx.fillStyle = fog; ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
    for (let i = 0; i < N; i++) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath(); ctx.fill();
    // 侧壁（只画朝向镜头的一半，分桶）
    let yTop = Infinity, yBot = -Infinity;
    for (let i = 0; i < N; i++) if (front(i)) { yTop = Math.min(yTop, top[i].y); yBot = Math.max(yBot, bot[i].y); }
    for (let b = 0; b < B; b++) {
      ctx.beginPath(); let any = false;
      for (let i = 0; i < N; i++) {
        if (!front(i) && !front((i + 1) % N)) continue;
        const l = 0.5 + 0.5 * Math.cos((i + 0.5) / N * TAU + cam.yaw - 2.2);
        if (bucket(l) !== b) continue;
        const j = (i + 1) % N; any = true;
        ctx.moveTo(top[i].x, top[i].y); ctx.lineTo(top[j].x, top[j].y); ctx.lineTo(bot[j].x, bot[j].y); ctx.lineTo(bot[i].x, bot[i].y); ctx.closePath();
      }
      if (!any) continue;
      const l = (b + 0.5) / B;
      const sg = ctx.createLinearGradient(0, yTop, 0, yBot);
      sg.addColorStop(0, `rgb(${70 + l * 50 | 0},${62 + l * 40 | 0},${84 + l * 40 | 0})`); sg.addColorStop(1, `rgb(${22 + l * 14 | 0},${18 + l * 10 | 0},${32 + l * 14 | 0})`);
      ctx.fillStyle = sg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // 符文腰带（侧壁发光）
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(120,200,255,.4)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const a = i / N * TAU; const p = project(Math.cos(a) * R, -16, Math.sin(a) * R); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // 顶面地砖：按亮度分 8 桶批量填充，所有缝线一次描边
    const TB = 8, paths = [];
    for (let b = 0; b < TB; b++) paths.push(new Path2D());
    const seams = new Path2D(), cracks = new Path2D();
    for (const t of tiles) {
      const path = new Path2D();
      t.pts.forEach(([x, z], k) => { const q = project(x, 0, z); k ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y); });
      path.closePath();
      const b = Math.max(0, Math.min(TB - 1, Math.floor((t.light + 0.15) / 0.3 * TB)));
      paths[b].addPath(path); seams.addPath(path);
      if (t.crackPts) t.crackPts.forEach(([x, z], k) => { const q = project(x, 0, z); k ? cracks.lineTo(q.x, q.y) : cracks.moveTo(q.x, q.y); });
    }
    for (let b = 0; b < TB; b++) {
      const v = 58 + ((b + 0.5) / TB * 0.3 - 0.15) * 160;
      ctx.fillStyle = `rgb(${v * 0.92 | 0},${v * 0.86 | 0},${v * 1.08 | 0})`; ctx.fill(paths[b]);
    }
    ctx.strokeStyle = 'rgba(10,8,18,.75)'; ctx.lineWidth = 1.6; ctx.stroke(seams);
    ctx.strokeStyle = 'rgba(15,10,25,.6)'; ctx.lineWidth = 1; ctx.stroke(cracks);
    // 外沿亮边
    ctx.strokeStyle = 'rgba(200,190,230,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); top.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    // 中央氛围暗角
    const ce = floorEllipse(0, 0, R);
    ctx.save(); ctx.translate(ce.cx, ce.cy); ctx.rotate(ce.rot); ctx.scale(1, ce.ry / ce.rx);
    const rg = ctx.createRadialGradient(0, 0, ce.rx * 0.2, 0, 0, ce.rx);
    rg.addColorStop(0, 'rgba(120,110,200,.10)'); rg.addColorStop(0.7, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(5,3,12,.45)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, ce.rx, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  /* 地面符文法阵（随时间旋转） */
  function floorPoly(pts, close = true) {
    ctx.beginPath(); pts.forEach((p, i) => { const q = project(p[0], 0, p[1]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); if (close) ctx.closePath();
  }
  function circlePts(r, n = 64, a0 = 0) { const a = []; for (let i = 0; i < n; i++) { const t = a0 + i / n * TAU; a.push([Math.cos(t) * r, Math.sin(t) * r]); } return a; }
  function drawRunes() {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.55 + Math.sin(T * 1.2) * 0.15;
    // 双层描边模拟发光（比 shadowBlur 便宜得多）
    const glow = (rgb, a, w) => {
      ctx.strokeStyle = `rgba(${rgb},${a * 0.22})`; ctx.lineWidth = w * 4; ctx.stroke();
      ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.lineWidth = w; ctx.stroke();
    };
    const B = '110,190,255', Gd = '255,200,110';
    floorPoly(circlePts(345, 90)); glow(B, 0.55 * pulse, 2.2);
    floorPoly(circlePts(325, 90)); glow(B, 0.4 * pulse, 1.2);
    floorPoly(circlePts(150, 60)); glow(B, 0.5 * pulse, 1.6);
    // 旋转刻度
    const rot = T * 0.05;
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = rot + i / 36 * TAU, l = i % 3 === 0 ? 18 : 8;
      const p0 = project(Math.cos(a) * 327, 0, Math.sin(a) * 327), p1 = project(Math.cos(a) * (327 + l), 0, Math.sin(a) * (327 + l));
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    }
    glow(B, 0.5 * pulse, 2);
    // 符文字形
    const glyphs = [[[-1, -1], [1, -1], [0, 1], [-1, -1]], [[-1, 1], [0, -1], [1, 1]], [[-1, -1], [-1, 1], [1, 1]], [[0, -1], [0, 1], [-1, 0], [1, 0]], [[-1, -1], [1, 1], [-1, 1], [1, -1]], [[-1, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]];
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = -rot * 1.4 + i / 18 * TAU, cx = Math.cos(a) * 240, cz = Math.sin(a) * 240;
      const g = glyphs[i % glyphs.length], s = 10, ca = Math.cos(a + Math.PI / 2), sa = Math.sin(a + Math.PI / 2);
      g.forEach(([x, y], k) => { const q = project(cx + (x * ca - y * sa * 0.8) * s, 0, cz + (x * sa + y * ca * 0.8) * s); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    }
    glow(B, 0.42 * pulse, 1.6);
    // 中心誓约印记：双环 + 三角
    floorPoly(circlePts(62, 48).map(([x, z]) => [x - 26, z])); glow(Gd, 0.45 * pulse + 0.15, 2);
    floorPoly(circlePts(62, 48).map(([x, z]) => [x + 26, z])); glow(Gd, 0.45 * pulse + 0.15, 2);
    const star = []; for (let i = 0; i < 6; i++) { const a = T * -0.1 + i * 2 * TAU / 6; star.push([Math.cos(a) * 110, Math.sin(a) * 110]); }
    floorPoly(star.slice(0, 3)); glow(Gd, 0.25 * pulse, 2); floorPoly(star.slice(3, 6)); glow(Gd, 0.25 * pulse, 2);
    ctx.restore();
  }

  /* ---------------- 立柱与火盆 ---------------- */
  function drawPillar(p) {
    const b = project(p.x, 0, p.z), t = project(p.x, p.h, p.z);
    const w = 26 * b.s;
    // 柱身
    const g = ctx.createLinearGradient(b.x - w, 0, b.x + w, 0);
    g.addColorStop(0, '#2a2438'); g.addColorStop(0.35, '#7d7490'); g.addColorStop(0.55, '#a39bb5'); g.addColorStop(1, '#2d2740');
    ctx.fillStyle = g;
    if (p.broken) {
      ctx.beginPath(); ctx.moveTo(b.x - w, b.y); ctx.lineTo(b.x - w, t.y + 10 * b.s); ctx.lineTo(b.x - w * 0.3, t.y - 6 * b.s); ctx.lineTo(b.x + w * 0.2, t.y + 8 * b.s); ctx.lineTo(b.x + w, t.y - 2 * b.s); ctx.lineTo(b.x + w, b.y); ctx.closePath(); ctx.fill();
    } else ctx.fillRect(b.x - w, t.y, w * 2, b.y - t.y);
    // 竖纹
    ctx.strokeStyle = 'rgba(20,15,30,.35)'; ctx.lineWidth = Math.max(1, b.s * 1.5);
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(b.x + k * w * 0.38, b.y - 10 * b.s); ctx.lineTo(b.x + k * w * 0.38, t.y + 14 * b.s); ctx.stroke(); }
    // 底座 / 柱头
    const cap = (y, hh, ww) => { const gg = ctx.createLinearGradient(0, y - hh, 0, y); gg.addColorStop(0, '#b5adc8'); gg.addColorStop(1, '#3a3350'); ctx.fillStyle = gg; ctx.fillRect(b.x - ww, y - hh, ww * 2, hh); ctx.strokeStyle = 'rgba(10,8,18,.6)'; ctx.lineWidth = 1; ctx.strokeRect(b.x - ww, y - hh, ww * 2, hh); };
    cap(b.y, 14 * b.s, w * 1.35);
    if (!p.broken) {
      cap(t.y + 4 * b.s, 12 * b.s, w * 1.4);
      // 火盆
      const bw = w * 1.3, by = t.y - 8 * b.s;
      ctx.fillStyle = '#2b2233'; ctx.beginPath(); ctx.moveTo(b.x - bw, by - 10 * b.s); ctx.lineTo(b.x + bw, by - 10 * b.s); ctx.lineTo(b.x + bw * 0.6, by + 6 * b.s); ctx.lineTo(b.x - bw * 0.6, by + 6 * b.s); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c8962e'; ctx.lineWidth = Math.max(1, 1.5 * b.s); ctx.stroke();
      drawFlame(b.x, by - 10 * b.s, b.s, p.seed);
    }
  }
  function drawFlame(x, y, s, seed) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowAt('#ff9a40', x, y - 20 * s, 130 * s, 0.55 + Math.sin(T * 7 + seed) * 0.05);
    for (let i = 0; i < 4; i++) {
      const h = (34 + Math.sin(T * 9 + seed + i * 1.7) * 9) * s * (1 - i * 0.18), w = (15 - i * 3) * s;
      const sway = Math.sin(T * 6 + seed * 3 + i) * 4 * s;
      const fg = ctx.createLinearGradient(0, y, 0, y - h);
      fg.addColorStop(0, i ? 'rgba(255,220,120,.9)' : 'rgba(255,120,40,.8)'); fg.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.8, y - h * 0.6, x + sway, y - h); ctx.quadraticCurveTo(x + w * 0.8, y - h * 0.6, x + w, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- 角色 ---------------- */
  function addChar(def, snap, angle) {
    const ch = makeChar(def, snap, angle);
    chars.set(def.id, ch);
    return ch;
  }
  /* 大厅里的角色立绘：用同一套立牌绘制，按初始装备显示 */
  const pcache = new Map();
  function portrait(def, cv, full = false) {
    let ch = pcache.get(def.id);
    if (!ch) {
      const kit = def.kit || [];
      const sw = kit.find(k => k[1] === 'Sword');
      const armor = ['Helmet', 'Chestplate', 'Leggings', 'Boots'].map(t => (def.equip || []).includes(t) ? { type: t, value: 1 } : null);
      ch = makeChar(def, { hp: 1, max: 1, shield: 0, atk: 0, alive: true, hand: sw ? { type: 'Sword', value: sw[3] } : null, armor, armorValue: 0, items: 0, subs: [] }, 0);
      pcache.set(def.id, ch);
    }
    drawFigure(ch);
    const g = cv.getContext('2d'), sp = ch.sprite, k = SPR;
    g.clearRect(0, 0, cv.width, cv.height);
    if (full) g.drawImage(sp, sp.width * 0.18, sp.height * 0.2, sp.width * 0.64, sp.height * 0.78, 0, 0, cv.width, cv.height);
    else { const cx = sp.width / 2, cy = sp.height - 15 * k - 128 * k; g.drawImage(sp, cx - 35 * k, cy - 32 * k, 70 * k, 70 * k, 0, 0, cv.width, cv.height); }
  }
  function makeChar(def, snap, angle) {
    const sprite = document.createElement('canvas');
    const ch = {
      name: def.id, display: def.name || def.id, title: def.title || '', palette: def.palette, archetype: def.archetype,
      isHero: !!def.isHero, home: { x: Math.cos(angle) * RING, z: Math.sin(angle) * RING }, angle,
      pos: { x: Math.cos(angle) * RING, y: 0, z: Math.sin(angle) * RING },
      disp: snap, hpLag: snap.hp, shieldLag: snap.shield,
      a: { bob: Math.random() * TAU, arm: 0, armT: 0, lean: 0, hurt: 0, dissolve: 0, alpha: 1, facing: 1, raise: 0, squash: 0, glowCol: null, glow: 0, shieldHit: 0, drink: 0, cast: 0, spin: 0 },
      sprite, sctx: sprite.getContext('2d'), bbox: null, grave: false, seed: Math.random() * 100,
      relation: 'enemy',
    };
    sprite.width = Math.round(260 * SPR); sprite.height = Math.round(330 * SPR);
    return ch;
  }
  function clearChars() { chars.clear(); parts = []; texts = []; rings = []; slashes = []; beams = []; projs = []; bolts = []; selected = null; activeTurn = null; linkPulse.clear(); }

  function shade(hex, k) { return k > 0 ? U.mix(hex, '#ffffff', k) : U.mix(hex, '#000000', -k); }

  /* 在角色离屏画布上绘制立牌。局部坐标：脚底 (0,0)，向上为负，身高约 150 */
  function drawFigure(ch) {
    const g = ch.sctx, P = ch.palette, A = ch.a, d = ch.disp;
    const SW = ch.sprite.width, SH = ch.sprite.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, SW, SH);
    g.setTransform(SPR, 0, 0, SPR, SW / 2, SH - 15 * SPR);
    g.scale(A.facing, 1);
    const t = T + ch.seed;
    const breathe = Math.sin(t * 2.2) * 1.6;
    const sq = 1 - A.squash * 0.12;
    g.scale(1 + A.squash * 0.08, sq);
    g.rotate(A.lean);
    const arch = ch.archetype;
    const big = arch === 'berserker' || arch === 'guardian' || arch === 'golem' ? 1.15 : arch === 'mage' || arch === 'rogue' ? 0.92 : 1;
    const hipY = -60, shY = -112 + breathe, headY = -134 + breathe;
    const armor = {}; (d.armor || []).forEach(a => { if (a) armor[a.type] = a; });
    const OL = 'rgba(8,6,14,.92)';
    const stroke = (w = 2.2) => { g.lineWidth = w; g.strokeStyle = OL; g.lineJoin = 'round'; g.stroke(); };
    const metalG = (x0, y0, x1, y1) => { const m = g.createLinearGradient(x0, y0, x1, y1); m.addColorStop(0, '#f2f6fc'); m.addColorStop(0.4, '#a8b4c6'); m.addColorStop(1, '#4a5466'); return m; };

    // —— 背后披风 ——
    if (arch !== 'golem') {
      const wave = (k) => Math.sin(t * 2.4 + k) * 5;
      g.beginPath(); g.moveTo(-18 * big, shY + 4);
      g.bezierCurveTo(-34 * big, -80, -40 * big + wave(1), -40, -36 * big + wave(2), -8);
      g.quadraticCurveTo(-12, -2 + wave(3) * 0.5, 4, -6);
      g.quadraticCurveTo(22, -1 + wave(4) * 0.5, 34 * big + wave(5), -10);
      g.bezierCurveTo(36 * big, -50, 30 * big, -84, 18 * big, shY + 4); g.closePath();
      const cg = g.createLinearGradient(0, shY, 0, 0); cg.addColorStop(0, shade(P.cloak, -0.15)); cg.addColorStop(1, P.cloak2);
      g.fillStyle = cg; g.fill(); stroke();
    }
    // —— 腿 ——
    const stride = Math.sin(t * 1.1) * 1.2;
    const leg = (x, ph) => {
      g.beginPath(); g.moveTo(x - 8 * big, hipY); g.lineTo(x + 8 * big, hipY); g.lineTo(x + 6 + ph, -6); g.lineTo(x - 6 + ph, -6); g.closePath();
      const lg = g.createLinearGradient(x - 8, 0, x + 8, 0); lg.addColorStop(0, shade(P.body, -0.35)); lg.addColorStop(1, shade(P.body, 0.05));
      g.fillStyle = lg; g.fill(); stroke(1.8);
      if (armor.Leggings) {
        g.beginPath(); g.moveTo(x - 9 * big, hipY + 2); g.lineTo(x + 9 * big, hipY + 2); g.lineTo(x + 7 + ph, -18); g.lineTo(x - 7 + ph, -18); g.closePath();
        g.fillStyle = metalG(x - 9, hipY, x + 9, -18); g.fill(); stroke(1.6);
        g.beginPath(); g.ellipse(x + ph * 0.5, -36, 6, 5, 0, 0, TAU); g.fillStyle = P.accent; g.fill(); stroke(1.4);
      }
      // 靴
      g.beginPath(); g.moveTo(x - 7 + ph, -18); g.lineTo(x + 7 + ph, -18); g.lineTo(x + 8 + ph, -4); g.quadraticCurveTo(x + 16 + ph, -3, x + 15 + ph, 2); g.lineTo(x - 8 + ph, 2); g.closePath();
      g.fillStyle = armor.Boots ? metalG(x - 8, -18, x + 15, 2) : '#2a1d16'; g.fill(); stroke(1.6);
      if (armor.Boots) { g.fillStyle = P.accent; g.fillRect(x - 7 + ph, -19, 14, 3); }
    };
    if (arch === 'mage') {
      // 长袍
      g.beginPath(); g.moveTo(-14, hipY - 6); g.lineTo(14, hipY - 6); g.quadraticCurveTo(26, -20, 24 + Math.sin(t * 2) * 2, 0); g.lineTo(-24 + Math.sin(t * 2 + 1) * 2, 0); g.quadraticCurveTo(-26, -20, -14, hipY - 6); g.closePath();
      const rg = g.createLinearGradient(-24, 0, 24, 0); rg.addColorStop(0, shade(P.cloak, -0.45)); rg.addColorStop(0.5, P.cloak); rg.addColorStop(1, shade(P.cloak, -0.3));
      g.fillStyle = rg; g.fill(); stroke();
      g.strokeStyle = P.accent; g.lineWidth = 2; g.beginPath(); g.moveTo(-23, -4); g.lineTo(23, -4); g.stroke();
      if (armor.Leggings || armor.Boots) { g.fillStyle = metalG(-20, -14, 20, 0); g.fillRect(-20, -12, 40, 8); g.strokeStyle = OL; g.lineWidth = 1.4; g.strokeRect(-20, -12, 40, 8); }
    } else { leg(-9 * big, -stride); leg(9 * big, stride); }

    // —— 后臂 ——
    const backArm = () => {
      g.save(); g.translate(-16 * big, shY + 4); g.rotate(0.25 + Math.sin(t * 2.2) * 0.04 - A.cast * 1.2);
      g.beginPath(); g.moveTo(-5 * big, 0); g.lineTo(5 * big, 0); g.lineTo(4, 44); g.lineTo(-4, 44); g.closePath();
      g.fillStyle = shade(P.body, -0.35); g.fill(); stroke(1.8);
      g.beginPath(); g.arc(0, 47, 5, 0, TAU); g.fillStyle = arch === 'golem' ? P.skin : shade(P.skin, -0.2); g.fill(); stroke(1.4);
      g.restore();
    };
    backArm();

    // —— 躯干 ——
    g.beginPath(); g.moveTo(-20 * big, shY); g.lineTo(20 * big, shY); g.lineTo(14 * big, hipY); g.lineTo(-14 * big, hipY); g.closePath();
    const tg = g.createLinearGradient(-20, 0, 20, 0); tg.addColorStop(0, shade(P.body, -0.3)); tg.addColorStop(0.55, shade(P.body, 0.12)); tg.addColorStop(1, shade(P.body, -0.2));
    g.fillStyle = tg; g.fill(); stroke();
    if (arch === 'golem') { // 发光裂纹
      g.strokeStyle = P.accent; g.lineWidth = 2; g.shadowColor = P.accent; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(-8, shY + 10); g.lineTo(-2, -88); g.lineTo(-10, -76); g.moveTo(6, shY + 6); g.lineTo(10, -84); g.lineTo(4, -70); g.stroke(); g.shadowBlur = 0;
    }
    if (armor.Chestplate) {
      g.beginPath(); g.moveTo(-21 * big, shY - 1); g.quadraticCurveTo(0, shY + 6, 21 * big, shY - 1); g.lineTo(16 * big, hipY + 6); g.quadraticCurveTo(0, hipY + 12, -16 * big, hipY + 6); g.closePath();
      g.fillStyle = metalG(-20, shY, 20, hipY); g.fill(); stroke();
      g.save(); g.translate(0, -88 + breathe);
      g.beginPath(); g.moveTo(0, -8); g.lineTo(7, -4); g.lineTo(5, 4); g.quadraticCurveTo(0, 9, 0, 9); g.quadraticCurveTo(0, 9, -5, 4); g.lineTo(-7, -4); g.closePath();
      g.fillStyle = P.accent; g.fill(); stroke(1.2); g.restore();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-14, shY + 8); g.quadraticCurveTo(-15, -80, -11, hipY + 10); g.stroke();
    } else if (arch !== 'golem') {
      // 衣襟 / 腰带
      g.strokeStyle = shade(P.accent, -0.1); g.lineWidth = 2; g.beginPath(); g.moveTo(0, shY + 2); g.lineTo(0, hipY); g.stroke();
    }
    g.fillStyle = '#2a1a10'; g.fillRect(-15 * big, hipY - 6, 30 * big, 6); g.fillStyle = P.accent; g.fillRect(-4, hipY - 7, 8, 8);
    // 肩甲
    if (arch === 'knight' || arch === 'guardian' || arch === 'veteran' || armor.Chestplate) {
      [-1, 1].forEach(sd => {
        g.beginPath(); g.ellipse(sd * 19 * big, shY + 3, 11 * big, 8, sd * 0.25, Math.PI, 0); g.closePath();
        g.fillStyle = armor.Chestplate || arch === 'guardian' ? metalG(sd * 10, shY - 6, sd * 30, shY + 6) : P.cloak; g.fill(); stroke(1.6);
      });
    }
    if (arch === 'berserker') { // 毛领
      g.fillStyle = '#6b5440';
      for (let i = -4; i <= 4; i++) { g.beginPath(); g.ellipse(i * 5, shY - 1 + Math.abs(i) * 0.5, 6, 5, 0, 0, TAU); g.fill(); }
    }
    // —— 头 ——
    g.save(); g.translate(0, headY);
    if (arch === 'golem') {
      g.beginPath(); g.moveTo(-14, -14); g.lineTo(14, -14); g.lineTo(16, 10); g.lineTo(-16, 10); g.closePath();
      g.fillStyle = shade(P.skin, -0.1); g.fill(); stroke();
      g.fillStyle = P.eye; g.shadowColor = P.eye; g.shadowBlur = 10; g.fillRect(-9, -3, 6, 4); g.fillRect(3, -3, 6, 4); g.shadowBlur = 0;
    } else {
      // 颈
      g.fillStyle = shade(P.skin, -0.25); g.fillRect(-5, 8, 10, 10);
      g.beginPath(); g.moveTo(-13, -6); g.quadraticCurveTo(-14, 10, 0, 16); g.quadraticCurveTo(14, 10, 13, -6); g.quadraticCurveTo(12, -18, 0, -18); g.quadraticCurveTo(-12, -18, -13, -6); g.closePath();
      const hg = g.createLinearGradient(-12, 0, 12, 0); hg.addColorStop(0, shade(P.skin, -0.25)); hg.addColorStop(0.6, P.skin); hg.addColorStop(1, shade(P.skin, -0.12));
      g.fillStyle = hg; g.fill(); stroke();
      // 眼
      const eyeGlow = arch === 'mage' || arch === 'rogue';
      g.fillStyle = eyeGlow ? P.eye : '#1a1420';
      if (eyeGlow) { g.shadowColor = P.eye; g.shadowBlur = 8; }
      g.beginPath(); g.ellipse(4, -2, 2, 2.4, 0, 0, TAU); g.ellipse(10, -2, 1.6, 2.2, 0, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = 'rgba(40,20,20,.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(3, 8); g.lineTo(9, 7.5); g.stroke();
      // 发型 / 兜帽
      g.fillStyle = P.hair;
      if (arch === 'knight') {
        g.beginPath(); g.moveTo(-15, 2); g.quadraticCurveTo(-18, -22, 2, -21); g.quadraticCurveTo(16, -20, 15, -8); g.quadraticCurveTo(6, -14, -4, -10); g.quadraticCurveTo(-8, -4, -10, 6); g.closePath(); g.fill(); stroke(1.6);
      } else if (arch === 'berserker') {
        g.beginPath(); g.moveTo(-15, 4);
        for (let i = 0; i <= 8; i++) { const a = Math.PI + i / 8 * Math.PI; g.lineTo(Math.cos(a) * (18 + (i % 2) * 7), -6 + Math.sin(a) * (16 + (i % 2) * 7)); }
        g.lineTo(14, -6); g.quadraticCurveTo(2, -12, -8, -6); g.closePath(); g.fill(); stroke(1.6);
        g.fillStyle = P.accent; g.fillRect(-14, -11, 28, 3); // 战纹头带
        g.beginPath(); g.moveTo(-12, 14); g.quadraticCurveTo(0, 26, 12, 14); g.quadraticCurveTo(0, 18, -12, 14); g.fillStyle = P.hair; g.fill();
      } else if (arch === 'mage' || arch === 'rogue') {
        g.beginPath();
        if (arch === 'mage') { g.moveTo(-18, 14); g.quadraticCurveTo(-22, -16, 4, -34 + Math.sin(t * 2) * 2); g.quadraticCurveTo(20, -14, 18, 14); }
        else { g.moveTo(-17, 14); g.quadraticCurveTo(-20, -20, 2, -22); g.quadraticCurveTo(20, -18, 17, 14); }
        g.quadraticCurveTo(8, 0, 0, -6); g.quadraticCurveTo(-8, 0, -18, 14); g.closePath();
        const hd = g.createLinearGradient(-18, -30, 18, 14); hd.addColorStop(0, shade(P.cloak, 0.1)); hd.addColorStop(1, shade(P.cloak, -0.4));
        g.fillStyle = hd; g.fill(); stroke();
        if (arch === 'rogue') { g.fillStyle = shade(P.cloak2, 0.1); g.beginPath(); g.moveTo(-12, 4); g.lineTo(14, 4); g.lineTo(12, 14); g.quadraticCurveTo(0, 18, -12, 12); g.closePath(); g.fill(); stroke(1.4); }
      } else if (arch === 'guardian') {
        g.beginPath(); g.moveTo(-13, -4); g.quadraticCurveTo(-12, -20, 0, -19); g.quadraticCurveTo(12, -20, 13, -4); g.quadraticCurveTo(0, -12, -13, -4); g.fill(); stroke(1.4);
        g.beginPath(); g.moveTo(-11, 6); g.quadraticCurveTo(0, 26, 11, 6); g.quadraticCurveTo(0, 12, -11, 6); g.fill(); stroke(1.2);
      } else if (arch === 'veteran') {
        g.beginPath(); g.moveTo(-12, 4); g.quadraticCurveTo(0, 34, 13, 4); g.quadraticCurveTo(6, 10, 0, 9); g.quadraticCurveTo(-6, 10, -12, 4); g.fill(); stroke(1.2);
        g.fillStyle = shade(P.cloak, -0.2); g.beginPath(); g.ellipse(0, -12, 15, 7, 0, Math.PI, 0); g.fill(); stroke(1.4);
      }
    }
    if (armor.Helmet) {
      g.beginPath(); g.moveTo(-16, 6); g.quadraticCurveTo(-18, -24, 0, -24); g.quadraticCurveTo(18, -24, 16, 6); g.lineTo(14, 14); g.lineTo(-14, 14); g.closePath();
      g.fillStyle = metalG(-16, -24, 16, 14); g.fill(); stroke();
      g.fillStyle = '#0c0f16'; g.fillRect(-11, -4, 24, 5);
      g.fillStyle = U.hexA(P.eye, .9); g.shadowColor = P.eye; g.shadowBlur = 6; g.fillRect(2, -3, 9, 2.4); g.shadowBlur = 0;
      g.strokeStyle = P.accent; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, -24); g.lineTo(0, -6); g.stroke();
      g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(-10, -40 + Math.sin(t * 3) * 2, -26, -34, -30, -20); g.bezierCurveTo(-20, -26, -10, -26, 0, -20); g.closePath();
      g.fillStyle = P.accent; g.fill(); stroke(1.2);
    }
    g.restore();

    // —— 前臂与手持物 ——
    g.save(); g.translate(17 * big, shY + 4);
    const armAng = -0.2 + Math.sin(t * 2.2 + 1) * 0.04 + A.arm - A.raise * 1.6 - A.drink * 2.2;
    g.rotate(armAng);
    g.beginPath(); g.moveTo(-5 * big, 0); g.lineTo(6 * big, 0); g.lineTo(5, 44); g.lineTo(-4, 44); g.closePath();
    const ag = g.createLinearGradient(-5, 0, 6, 0); ag.addColorStop(0, shade(P.body, -0.25)); ag.addColorStop(1, shade(P.body, 0.15));
    g.fillStyle = arch === 'berserker' ? P.skin : ag; g.fill(); stroke(1.8);
    if (armor.Chestplate) { g.fillStyle = metalG(-5, 20, 6, 40); g.fillRect(-5, 24, 11, 14); g.strokeStyle = OL; g.lineWidth = 1.2; g.strokeRect(-5, 24, 11, 14); }
    g.translate(0, 47);
    const hand = d.hand;
    if (hand) drawHeld(g, hand, ch, A);
    g.beginPath(); g.arc(0, 0, 5.2, 0, TAU); g.fillStyle = arch === 'golem' ? P.skin : P.skin; g.fill(); stroke(1.4);
    g.restore();

    // —— 光照：月光边缘光 + 火光（source-atop 只作用于角色像素） ——
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const rim = g.createLinearGradient(0, 0, SW, SH * 0.6);
    rim.addColorStop(0, 'rgba(160,180,255,.22)'); rim.addColorStop(0.35, 'rgba(160,180,255,0)'); rim.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rim; g.fillRect(0, 0, SW, SH);
    const warm = g.createLinearGradient(0, SH, 0, SH * 0.4);
    warm.addColorStop(0, 'rgba(255,140,60,.18)'); warm.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = warm; g.fillRect(0, 0, SW, SH);
    if (A.glow > 0 && A.glowCol) { g.fillStyle = U.hexA(A.glowCol, A.glow * 0.55); g.fillRect(0, 0, SW, SH); }
    if (A.hurt > 0) { g.fillStyle = `rgba(255,255,255,${A.hurt * 0.85})`; g.fillRect(0, 0, SW, SH); }
    if (!d.alive && A.dissolve < 1) { g.fillStyle = `rgba(40,30,60,${0.4 + A.dissolve * 0.4})`; g.fillRect(0, 0, SW, SH); }
    // 溶解：用噪点抠洞
    if (A.dissolve > 0) {
      g.globalCompositeOperation = 'destination-out';
      const cut = A.dissolve;
      for (let i = 0; i < 260 * cut + 20; i++) {
        const y = SH - (Math.random() * SH * cut * 1.25);
        const x = Math.random() * SW;
        g.fillStyle = `rgba(0,0,0,${0.6 + Math.random() * 0.4})`;
        g.beginPath(); g.arc(x, y, 6 + Math.random() * 16 * cut, 0, TAU); g.fill();
      }
      g.fillStyle = `rgba(0,0,0,${cut})`; g.fillRect(0, SH * (1 - cut), SW, SH * cut);
    }
    g.globalCompositeOperation = 'source-over';
  }

  /* 手持物（在手的局部坐标中绘制） */
  function drawHeld(g, item, ch, A) {
    const type = item.type;
    if (type === 'Sword') {
      g.save(); g.rotate(-1.35 + A.spin);
      const len = 52 + Math.min(item.value || 20, 80) * 0.35;
      const bg = g.createLinearGradient(-4, 0, 4, 0); bg.addColorStop(0, '#6d7d94'); bg.addColorStop(0.5, '#f6faff'); bg.addColorStop(1, '#4d5a6e');
      if (A.raise > 0.3 || A.spin) { g.shadowColor = '#9fd0ff'; g.shadowBlur = 16; }
      g.beginPath(); g.moveTo(-3.5, -4); g.lineTo(-3.5, -len); g.lineTo(0, -len - 9); g.lineTo(3.5, -len); g.lineTo(3.5, -4); g.closePath();
      g.fillStyle = bg; g.fill(); g.shadowBlur = 0; g.lineWidth = 1.6; g.strokeStyle = 'rgba(8,6,14,.9)'; g.stroke();
      g.fillStyle = '#e0b04a'; g.fillRect(-11, -6, 22, 5); g.strokeRect(-11, -6, 22, 5);
      g.fillStyle = '#3a2216'; g.fillRect(-2.5, -1, 5, 12);
      g.fillStyle = '#e0b04a'; g.beginPath(); g.arc(0, 13, 3.4, 0, TAU); g.fill();
      g.restore();
    } else {
      const ic = OO.icons.canvas(type);
      const s = OO.data.potionTypes.includes(type) ? 30 : 34;
      g.save(); g.rotate(0.2);
      g.drawImage(ic, -s / 2, -s * 0.75, s, s);
      g.restore();
    }
  }

  /* ---------------- 链接（关注关系） ---------------- */
  function drawLinks() {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const ch of chars.values()) {
      if (!ch.disp.alive) continue;
      const seen = new Set();
      for (const toName of ch.disp.subs || []) {
        if (seen.has(toName)) continue; seen.add(toName);
        const to = chars.get(toName); if (!to || !to.disp.alive) continue;
        const key = ch.name + '>' + toName;
        const mutual = (to.disp.subs || []).includes(ch.name);
        const heroLink = ch.isHero || to.isHero;
        const col = heroLink ? [255, 205, 110] : [120, 220, 255];
        const pulse = linkPulse.get(key) || 0;
        // 弧线：从 A 胸口到 B 胸口，弯曲方向偏一侧（互相关注时两条分开）
        const a = ch.pos, b = to.pos, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L, bend = mutual ? 40 : 0;
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const k = i / 24, hk = Math.sin(k * Math.PI);
          const x = U.lerp(a.x, b.x, k) + nx * bend * hk, z = U.lerp(a.z, b.z, k) + nz * bend * hk;
          pts.push(project(x, 78 + hk * 70, z));
        }
        const base = 0.18 + pulse * 0.6;
        ctx.lineCap = 'round';
        for (const [w, al] of [[7, 0.08], [3, 0.25], [1.4, 0.7]]) {
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${al * (base + 0.3)})`;
          ctx.lineWidth = w * pts[12].s * 1.1 * (1 + pulse);
          ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
        }
        // 流动光点（方向：守护者 → 被守护者）
        const speed = 0.35 + pulse;
        for (let m = 0; m < 4; m++) {
          const k = ((T * speed + m / 4) % 1);
          const idx = k * 24, i0 = Math.floor(idx), f = idx - i0;
          const p0 = pts[i0], p1 = pts[Math.min(i0 + 1, 24)];
          const x = U.lerp(p0.x, p1.x, f), y = U.lerp(p0.y, p1.y, f), r = 3.5 * p0.s * (1 + pulse);
          glowAt(heroLink ? '#ffcd6e' : '#78dcff', x, y, r * 3.2, 0.9);
          glowAt('#ffffff', x, y, r * 1.1, 0.9);
        }
        // 箭头（终点前）
        const pa = pts[19], pb = pts[21];
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x), s = 9 * pb.s * 1.4;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + pulse * 0.4})`;
        ctx.beginPath(); ctx.moveTo(pb.x + Math.cos(ang) * s, pb.y + Math.sin(ang) * s);
        ctx.lineTo(pb.x + Math.cos(ang + 2.5) * s, pb.y + Math.sin(ang + 2.5) * s);
        ctx.lineTo(pb.x + Math.cos(ang - 2.5) * s, pb.y + Math.sin(ang - 2.5) * s); ctx.fill();
        if (pulse > 0) linkPulse.set(key, Math.max(0, pulse - 0.008));
      }
    }
    ctx.restore();
  }
  function pulseLink(from, to, v = 1) { linkPulse.set(from + '>' + to, v); }
  function pulseChainTo(target, helpers) {
    // 高亮所有能到达 target 的关注边
    const set = new Set(helpers);
    for (const ch of chars.values()) for (const s of ch.disp.subs || []) if (set.has(ch.name) && set.has(s)) pulseLink(ch.name, s, 1);
  }

  /* ---------------- 地面层：影子、选中环、光池 ---------------- */
  function drawFloorFX() {
    for (const ch of chars.values()) {
      const e = floorEllipse(ch.pos.x, ch.pos.z, 46);
      // 影子
      ctx.save(); ctx.translate(e.cx, e.cy); ctx.rotate(e.rot); ctx.scale(1, e.ry / e.rx);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, e.rx);
      sg.addColorStop(0, `rgba(0,0,0,${0.55 * ch.a.alpha * (ch.disp.alive ? 1 : 0.4)})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, e.rx, 0, TAU); ctx.fill();
      ctx.restore();
      if (!ch.disp.alive) continue;
      // 阵营环
      const rel = ch.isHero ? '#ffcf6b' : ch.relation === 'ally' ? '#6bffb0' : '#ff6b7a';
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const r1 = floorEllipse(ch.pos.x, ch.pos.z, 54);
      ctx.strokeStyle = U.hexA(rel, 0.35); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r1.cx, r1.cy, r1.rx, r1.ry, r1.rot, 0, TAU); ctx.stroke();
      if (ch.name === activeTurn) {
        const k = (T * 0.8) % 1;
        const r2 = floorEllipse(ch.pos.x, ch.pos.z, 54 + k * 40);
        ctx.strokeStyle = U.hexA(rel, 0.6 * (1 - k)); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(r2.cx, r2.cy, r2.rx, r2.ry, r2.rot, 0, TAU); ctx.stroke();
        const lg = floorEllipse(ch.pos.x, ch.pos.z, 80);
        ctx.translate(lg.cx, lg.cy); ctx.rotate(lg.rot); ctx.scale(1, lg.ry / lg.rx);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, lg.rx);
        rg.addColorStop(0, U.hexA(rel, 0.25)); rg.addColorStop(1, U.hexA(rel, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, lg.rx, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (ch.name === selected || ch.name === hoverName) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const isSel = ch.name === selected;
        const col = isSel ? '#ff4d5e' : '#ffffff';
        const rr = floorEllipse(ch.pos.x, ch.pos.z, 62);
        ctx.strokeStyle = U.hexA(col, isSel ? 0.9 : 0.4); ctx.lineWidth = isSel ? 3 : 2;
        ctx.setLineDash([12, 8]); ctx.lineDashOffset = -T * 40;
        ctx.beginPath(); ctx.ellipse(rr.cx, rr.cy, rr.rx, rr.ry, rr.rot, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (isSel) { // 四角准星
          for (let i = 0; i < 4; i++) {
            const a = T * 1.2 + i * TAU / 4;
            const p = project(ch.pos.x + Math.cos(a) * 74, 0, ch.pos.z + Math.sin(a) * 74);
            ctx.fillStyle = U.hexA(col, 0.9); ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * p.s, 0, TAU); ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    // 地面冲击波
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      const k = r.t / r.life;
      const e = floorEllipse(r.x, r.z, U.lerp(r.r0, r.r1, U.ease.outCubic(k)));
      ctx.strokeStyle = U.hexA(r.col, (1 - k) * r.a); ctx.lineWidth = r.w * (1 - k * 0.6) * e.s;
      ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx, e.ry, e.rot, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- 绘制角色立牌 + 护盾 ---------------- */
  function drawCharSprite(ch) {
    const A = ch.a;
    if (ch.grave) { drawGrave(ch); if (A.dissolve >= 1) return; }
    const busy = A.hurt > 0 || A.glow > 0 || A.dissolve > 0 || A.raise || A.drink || A.lockFacing || A.squash > 0.01 || A.shieldHit > 0 || Math.abs(Math.abs(A.facing) - 1) > 0.01;
    if (busy || (frameN + (ch.seed | 0)) % 2 === 0 || !ch.drawn) { drawFigure(ch); ch.drawn = true; }
    const p = project(ch.pos.x, ch.pos.y, ch.pos.z);
    const scale = p.s * 0.92;
    const w = 260 * scale, h = 330 * scale;
    const x = p.x - w / 2, y = p.y - h + 15 * scale;
    ctx.save(); ctx.globalAlpha = A.alpha;
    ctx.drawImage(ch.sprite, x, y, w, h);
    ctx.restore();
    ch.bbox = { x: p.x - 45 * scale, y: p.y - 175 * scale, w: 90 * scale, h: 180 * scale, s: scale, fx: p.x, fy: p.y };
    // 护盾泡泡
    const sh = ch.disp.shield;
    if (ch.disp.alive && (sh > 0 || A.shieldHit > 0)) {
      const c = project(ch.pos.x, 80, ch.pos.z);
      const rx = 62 * c.s, ry = 98 * c.s;
      const str = U.clamp(sh / 400, 0.25, 1) + A.shieldHit;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rg = ctx.createRadialGradient(c.x, c.y, rx * 0.5, c.x, c.y, ry);
      rg.addColorStop(0, 'rgba(255,210,110,0)'); rg.addColorStop(0.75, `rgba(255,200,90,${0.06 * str})`); rg.addColorStop(1, `rgba(255,230,150,${0.35 * str})`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU); ctx.fill();
      // 六边形纹
      ctx.strokeStyle = `rgba(255,220,140,${0.18 * str})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU); ctx.clip();
      const hs = 12 * c.s;
      ctx.beginPath();
      for (let yy = -ry; yy < ry; yy += hs * 1.5) for (let xx = -rx; xx < rx; xx += hs * 1.73) {
        const ox = c.x + xx + ((Math.round(yy / (hs * 1.5)) % 2) ? hs * 0.86 : 0), oy = c.y + yy;
        for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6, px = ox + Math.cos(a) * hs * 0.55, py = oy + Math.sin(a) * hs * 0.55; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawGrave(ch) {
    const p = project(ch.home.x, 0, ch.home.z), s = p.s;
    ctx.save();
    // 插在地上的断剑 + 余烬光
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 50 * s);
    rg.addColorStop(0, U.hexA(ch.palette.accent, 0.25 + Math.sin(T * 2 + ch.seed) * 0.08)); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(p.x, p.y, 50 * s, 18 * s, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(p.x, p.y); ctx.rotate(0.12);
    ctx.fillStyle = '#5a6272'; ctx.fillRect(-3 * s, -46 * s, 6 * s, 46 * s);
    ctx.fillStyle = '#9aa4b4'; ctx.fillRect(-1 * s, -46 * s, 2 * s, 40 * s);
    ctx.fillStyle = '#8a6a2a'; ctx.fillRect(-12 * s, -52 * s, 24 * s, 5 * s);
    ctx.fillStyle = '#3a2216'; ctx.fillRect(-2.5 * s, -66 * s, 5 * s, 14 * s);
    ctx.fillStyle = ch.palette.cloak; ctx.beginPath(); ctx.moveTo(-3 * s, -62 * s); ctx.quadraticCurveTo(14 * s, -58 * s + Math.sin(T * 2) * 3 * s, 20 * s, -40 * s); ctx.lineTo(6 * s, -44 * s); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------------- 头顶铭牌 ---------------- */
  function drawPlates() {
    if (!showPlates) return;
    for (const ch of chars.values()) {
      if (!ch.disp.alive || ch.a.alpha < 0.3) continue;
      const p = project(ch.pos.x, 182, ch.pos.z);
      const s = U.clamp(p.s * 1.05, 0.62, 1.05);
      const w = 132 * s, x = p.x - w / 2, y = p.y - 10 * s;
      const d = ch.disp;
      ctx.save();
      // 名字
      const relCol = ch.isHero ? '#ffd36b' : ch.relation === 'ally' ? '#7dffbe' : '#ff8a96';
      ctx.font = `700 ${Math.round(14 * s)}px "Noto Serif SC", "Source Han Serif SC", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,4,12,.85)'; ctx.strokeText(ch.display, p.x, y - 6 * s);
      ctx.fillStyle = relCol; ctx.fillText(ch.display, p.x, y - 6 * s);
      if (ch.relation === 'ally' && !ch.isHero) {
        ctx.font = `700 ${Math.round(10 * s)}px "Noto Serif SC", serif`;
        const tw = ctx.measureText(ch.display).width;
        ctx.fillStyle = 'rgba(40,120,80,.85)'; roundRect(p.x + tw / 2 + 4 * s, y - 18 * s, 18 * s, 14 * s, 3 * s); ctx.fill();
        ctx.fillStyle = '#d6ffe8'; ctx.fillText('盟', p.x + tw / 2 + 13 * s, y - 7 * s);
      }
      // 框
      const bh = 10 * s;
      ctx.fillStyle = 'rgba(8,6,16,.82)'; roundRect(x - 2, y - 1, w + 4, bh + 2 + (d.shield > 0 ? 5 * s : 0), 3 * s); ctx.fill();
      // 体力
      const ratio = d.hp / d.max, lag = ch.hpLag / d.max;
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(x, y, w * U.clamp(lag, 0, 1), bh);
      const hg = ctx.createLinearGradient(0, y, 0, y + bh);
      const hc = ratio > 0.5 ? ['#7dff9a', '#1f9e48'] : ratio > 0.25 ? ['#ffe27a', '#c98a12'] : ['#ff7a7a', '#a8121e'];
      hg.addColorStop(0, hc[0]); hg.addColorStop(1, hc[1]);
      ctx.fillStyle = hg; ctx.fillRect(x, y, w * U.clamp(ratio, 0, 1), bh);
      // 半血刻度
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x + w / 2 - 0.75, y, 1.5, bh);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, w * U.clamp(ratio, 0, 1), bh * 0.35);
      if (d.shield > 0) {
        const sr = U.clamp(d.shield / d.max, 0, 1);
        const sg = ctx.createLinearGradient(x, 0, x + w, 0); sg.addColorStop(0, '#ffe9a8'); sg.addColorStop(1, '#ffb52e');
        ctx.fillStyle = sg; ctx.fillRect(x, y + bh + 1, w * sr, 4 * s);
      }
      ctx.font = `700 ${Math.round(9.5 * s)}px "Cinzel", serif`;
      ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      const txt = `${d.hp}/${d.max}` + (d.shield > 0 ? `  +${d.shield}` : '');
      ctx.strokeText(txt, p.x, y + bh - 1.5 * s); ctx.fillText(txt, p.x, y + bh - 1.5 * s);
      // 攻 / 甲 小标
      const iy = y + bh + (d.shield > 0 ? 17 : 12) * s;
      ctx.font = `700 ${Math.round(10 * s)}px "Cinzel", serif`;
      const atkTxt = `⚔ ${d.atk + (d.hand && d.hand.type === 'Sword' ? '+' + d.hand.value : '')}`;
      const armTxt = `⛨ ${d.armorValue}`;
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffb28a'; ctx.strokeText(atkTxt, p.x - 5 * s, iy); ctx.fillText(atkTxt, p.x - 5 * s, iy);
      ctx.textAlign = 'left'; ctx.fillStyle = '#a8d8ff'; ctx.strokeText(armTxt, p.x + 5 * s, iy); ctx.fillText(armTxt, p.x + 5 * s, iy);
      // 回合指示
      if (ch.name === activeTurn) {
        const by = y - 30 * s + Math.sin(T * 5) * 3;
        ctx.fillStyle = relCol; ctx.beginPath(); ctx.moveTo(p.x, by + 8 * s); ctx.lineTo(p.x - 7 * s, by); ctx.lineTo(p.x + 7 * s, by); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  /* ---------------- 特效 ---------------- */
  const fx = {
    spark(x, y, z, o = {}) {
      const n = o.n || 20;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, e = U.rand(-0.3, 1.2), sp = U.rand(o.min || 120, o.max || 420);
        parts.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + (o.up || 0), vz: Math.sin(a) * Math.cos(e) * sp, g: o.g == null ? 700 : o.g, life: U.rand(0.25, o.life || 0.7), t: 0, size: U.rand(1.5, o.size || 4), col: o.col || '#ffd27a', kind: o.kind || 'spark', drag: o.drag || 1.5, bounce: o.bounce });
      }
    },
    shards(x, y, z, col, n = 14) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = U.rand(100, 360);
        parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: U.rand(150, 420), vz: Math.sin(a) * sp, g: 980, life: U.rand(0.8, 1.6), t: 0, size: U.rand(3, 8), col, kind: 'shard', rot: Math.random() * TAU, vr: U.rand(-14, 14), drag: 0.4, bounce: 0.35 });
      }
    },
    embers(x, y, z, col, n = 30, o = {}) {
      for (let i = 0; i < n; i++) {
        parts.push({ x: x + U.rand(-30, 30), y: y + U.rand(0, o.h || 150), z: z + U.rand(-20, 20), vx: U.rand(-30, 30), vy: U.rand(40, o.vy || 160), vz: U.rand(-30, 30), g: -40, life: U.rand(0.8, o.life || 2.2), t: 0, size: U.rand(1.5, o.size || 4), col, kind: 'ember', drag: 0.6, wob: Math.random() * TAU });
      }
    },
    smoke(x, y, z, col, n = 12) {
      for (let i = 0; i < n; i++) parts.push({ x: x + U.rand(-20, 20), y: y + U.rand(0, 40), z: z + U.rand(-20, 20), vx: U.rand(-60, 60), vy: U.rand(20, 90), vz: U.rand(-60, 60), g: -20, life: U.rand(0.8, 1.6), t: 0, size: U.rand(20, 46), col, kind: 'smoke', drag: 1.2 });
    },
    ring(x, z, col, o = {}) { rings.push({ x, z, col, r0: o.r0 || 10, r1: o.r1 || 180, life: o.life || 0.6, t: 0, w: o.w || 8, a: o.a || 0.9 }); },
    text(name, txt, o = {}) {
      const ch = chars.get(name); if (!ch) return;
      texts.push({ x: ch.pos.x + U.rand(-40, 40), y: o.y || 150, z: ch.pos.z, txt, col: o.col || '#ffffff', size: o.size || 30, t: 0, life: o.life || 1.4, rise: o.rise == null ? 60 : o.rise, kind: o.kind || 'num', sub: o.sub || '', dx: U.rand(-1, 1) });
    },
    slash(name, col = '#cfe8ff', dir = 1, power = 1) {
      const ch = chars.get(name); if (!ch) return;
      slashes.push({ x: ch.pos.x, z: ch.pos.z, col, t: 0, life: 0.32, dir, power, rot: U.rand(-0.5, 0.2) });
    },
    beam(name, col, o = {}) {
      const ch = chars.get(name); if (!ch) return;
      beams.push({ x: ch.pos.x, z: ch.pos.z, col, t: 0, life: o.life || 1.1, w: o.w || 46, h: o.h || 520 });
    },
    projectile(o) { // {from:{x,y,z}, to:{x,y,z}, dur, arc, kind:'flask'|'orb', type, col}
      return new Promise(res => { projs.push(Object.assign({ t: 0, res, trail: [] }, o)); });
    },
    bolt(from, to, col) { bolts.push({ from, to, col, t: 0, life: 0.35, seed: Math.random() }); },
  };

  function updateFX(dt) {
    if (parts.length > 420) parts.splice(0, parts.length - 420);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.life) { parts.splice(i, 1); continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * (p.kind === 'ember' ? 1 : dr) - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.kind === 'ember') { p.wob += dt * 3; p.x += Math.sin(p.wob) * 12 * dt; }
      if (p.rot != null) p.rot += p.vr * dt;
      if (p.y < 0 && p.bounce != null) { p.y = 0; p.vy = -p.vy * p.bounce; p.vx *= 0.6; p.vz *= 0.6; p.vr *= 0.5; }
    }
    for (const arr of [texts, rings, slashes, beams, bolts]) for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].life) arr.splice(i, 1); }
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i]; p.t += dt;
      const k = Math.min(p.t / p.dur, 1);
      const pos = projPos(p, k);
      p.trail.push(pos); if (p.trail.length > 16) p.trail.shift();
      if (p.kind === 'orb' && Math.random() < 0.8) parts.push({ x: pos.x, y: pos.y, z: pos.z, vx: U.rand(-20, 20), vy: U.rand(-20, 30), vz: U.rand(-20, 20), g: 0, life: 0.5, t: 0, size: U.rand(2, 4), col: p.col, kind: 'spark', drag: 2 });
      if (k >= 1) { projs.splice(i, 1); p.res(); }
    }
  }
  function projPos(p, k) {
    const e = p.ease ? p.ease(k) : k;
    return { x: U.lerp(p.from.x, p.to.x, e), y: U.lerp(p.from.y, p.to.y, e) + Math.sin(e * Math.PI) * (p.arc || 120), z: U.lerp(p.from.z, p.to.z, e) };
  }

  function drawFX() {
    ctx.save();
    // 光柱
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const k = b.t / b.life, a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const p0 = project(b.x, 0, b.z), p1 = project(b.x, b.h, b.z);
      const w = b.w * p0.s * (1 - k * 0.3);
      const g = ctx.createLinearGradient(p0.x - w, 0, p0.x + w, 0);
      g.addColorStop(0, U.hexA(b.col, 0)); g.addColorStop(0.5, U.hexA(b.col, 0.55 * a)); g.addColorStop(1, U.hexA(b.col, 0));
      ctx.fillStyle = g; ctx.fillRect(p0.x - w, p1.y, w * 2, p0.y - p1.y);
      const g2 = ctx.createLinearGradient(p0.x - w * 0.25, 0, p0.x + w * 0.25, 0);
      g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, `rgba(255,255,255,${0.7 * a})`); g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(p0.x - w * 0.25, p1.y, w * 0.5, p0.y - p1.y);
      const e = floorEllipse(b.x, b.z, b.w * 1.8);
      ctx.save(); ctx.translate(e.cx, e.cy); ctx.scale(1, e.ry / e.rx);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, e.rx); rg.addColorStop(0, U.hexA(b.col, 0.6 * a)); rg.addColorStop(1, U.hexA(b.col, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, e.rx, 0, TAU); ctx.fill(); ctx.restore();
    }
    // 闪电（援助连线）
    for (const b of bolts) {
      const k = b.t / b.life;
      const pa = project(b.from.x, b.from.y, b.from.z), pb = project(b.to.x, b.to.y, b.to.z);
      ctx.strokeStyle = U.hexA(b.col, 1 - k); ctx.lineWidth = 3; ctx.shadowColor = b.col; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
      for (let i = 1; i < 10; i++) { const f = i / 10; ctx.lineTo(U.lerp(pa.x, pb.x, f) + (Math.random() - 0.5) * 26, U.lerp(pa.y, pb.y, f) + (Math.random() - 0.5) * 26); }
      ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.shadowBlur = 0;
    }
    // 斩击弧
    for (const s of slashes) {
      const k = s.t / s.life;
      const c = project(s.x, 95, s.z);
      const r = 95 * c.s * (0.8 + k * 0.5) * (0.9 + s.power * 0.25);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(s.rot); ctx.scale(s.dir, 1);
      const a0 = -2.3 + k * 1.2, a1 = a0 + 2.6 * Math.min(1, k * 3);
      ctx.lineCap = 'round';
      for (const [w, al] of [[22, 0.18], [10, 0.5], [4, 1]]) {
        ctx.strokeStyle = al === 1 ? `rgba(255,255,255,${1 - k})` : U.hexA(s.col, al * (1 - k));
        ctx.lineWidth = w * c.s * (1 + s.power * 0.4);
        ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
      }
      ctx.restore();
    }
    // 粒子
    const trails = new Map();
    for (const p of parts) {
      const q = project(p.x, p.y, p.z), k = p.t / p.life;
      if (p.kind === 'smoke') {
        ctx.globalCompositeOperation = 'source-over';
        const r = p.size * q.s * (1 + k);
        const rg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        rg.addColorStop(0, U.hexA(p.col, 0.35 * (1 - k))); rg.addColorStop(1, U.hexA(p.col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      } else if (p.kind === 'shard') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(p.rot); ctx.globalAlpha = 1 - Math.max(0, k - 0.7) / 0.3;
        ctx.fillStyle = p.col; const s = p.size * q.s;
        ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.8, -s * 0.6); ctx.lineTo(s * 0.3, s * 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-s * 0.3, -s * 0.4, s * 0.5, s * 0.15);
        ctx.restore(); ctx.globalCompositeOperation = 'lighter';
      } else {
        const r = p.size * q.s * (p.kind === 'ember' ? 1 : 1 - k * 0.5);
        const a = p.kind === 'ember' ? Math.sin(k * Math.PI) * (p.amb ? 0.7 : 1) : 1 - k;
        if (p.kind === 'ember') glowAt(p.col, q.x, q.y, r * 2.4, a);
        else if (a > 0.004) { ctx.globalAlpha = Math.min(1, a); ctx.drawImage(coreSprite(p.col), q.x - r * 2.8, q.y - r * 2.8, r * 5.6, r * 5.6); ctx.globalAlpha = 1; }
        if (p.kind === 'spark' && r > 0.5 && a > 0.2) { // 拖尾：按颜色归并，循环后统一描边
          const q2 = project(p.x - p.vx * 0.025, p.y - p.vy * 0.025, p.z - p.vz * 0.025);
          let tp = trails.get(p.col); if (!tp) { tp = new Path2D(); trails.set(p.col, tp); }
          tp.moveTo(q.x, q.y); tp.lineTo(q2.x, q2.y);
        }
      }
    }
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const [col, tp] of trails) { ctx.strokeStyle = U.hexA(col, 0.7); ctx.stroke(tp); }
    // 投射物
    for (const p of projs) {
      const k = Math.min(p.t / p.dur, 1), pos = projPos(p, k), q = project(pos.x, pos.y, pos.z);
      for (let i = 0; i < p.trail.length; i++) {
        const tq = project(p.trail[i].x, p.trail[i].y, p.trail[i].z), a = i / p.trail.length;
        ctx.fillStyle = U.hexA(p.col, a * 0.35); ctx.beginPath(); ctx.arc(tq.x, tq.y, (p.kind === 'orb' ? 10 : 6) * a * tq.s, 0, TAU); ctx.fill();
      }
      if (p.kind === 'orb') {
        const r = 16 * q.s;
        glowAt(p.col, q.x, q.y, r * 2.6, 1); glowAt('#ffffff', q.x, q.y, r * 0.9, 1);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        const s = 38 * q.s;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(k * 9);
        ctx.drawImage(OO.icons.canvas(p.type), -s / 2, -s / 2, s, s); ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    ctx.restore();
  }

  function drawTexts() {
    // 飘字
    ctx.save();
    for (const t of texts) {
      const k = t.t / t.life;
      const q = project(t.x, t.y + U.ease.outCubic(k) * t.rise, t.z);
      const pop = k < 0.12 ? U.ease.outBack(k / 0.12) : 1;
      const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const size = t.size * U.clamp(q.s, 0.7, 1.15) * pop;
      ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const isNum = t.kind === 'num' || t.kind === 'crit';
      ctx.font = `900 ${Math.round(size)}px ${isNum ? '"Cinzel", "Times New Roman", serif' : '"Noto Serif SC", serif'}`;
      const x = q.x + t.dx * k * 30;
      ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = 'rgba(10,5,15,.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(t.txt, x, q.y);
      const g = ctx.createLinearGradient(0, q.y - size / 2, 0, q.y + size / 2);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, t.col); g.addColorStop(1, U.mix(t.col, '#000000', 0.35));
      ctx.fillStyle = g;
      if (t.kind === 'crit') { ctx.shadowColor = t.col; ctx.shadowBlur = 18; }
      ctx.fillText(t.txt, x, q.y); ctx.shadowBlur = 0;
      if (t.sub) { ctx.font = `700 ${Math.round(size * 0.42)}px "Noto Serif SC", serif`; ctx.lineWidth = 3; ctx.strokeText(t.sub, x, q.y + size * 0.62); ctx.fillStyle = '#e8e2ff'; ctx.fillText(t.sub, x, q.y + size * 0.62); }
    }
    ctx.restore();
  }

  /* ---------------- 环境粒子 ---------------- */
  function ambient(dt) {
    if (Math.random() < dt * (qMode === 'low' ? 6 : 14)) {
      const a = Math.random() * TAU, r = Math.random() * R * 1.4;
      parts.push({ x: Math.cos(a) * r, y: U.rand(-200, 0), z: Math.sin(a) * r, vx: U.rand(-10, 10), vy: U.rand(30, 70), vz: U.rand(-10, 10), g: -5, life: U.rand(3, 6), t: 0, size: U.rand(0.6, 1.4), col: Math.random() < 0.6 ? '#ff9a4d' : '#9fb8ff', kind: 'ember', drag: 0.1, wob: Math.random() * TAU, amb: true });
    }
    for (const p of props) if (!p.broken && Math.random() < dt * 5) {
      parts.push({ x: p.x + U.rand(-8, 8), y: p.h + 30, z: p.z + U.rand(-8, 8), vx: U.rand(-15, 15), vy: U.rand(60, 120), vz: U.rand(-15, 15), g: -10, life: U.rand(0.8, 1.8), t: 0, size: U.rand(0.8, 1.8), col: '#ffb060', kind: 'ember', drag: 0.4, wob: Math.random() * TAU, amb: true });
    }
  }

  /* ---------------- 相机 ---------------- */
  function shake(p) { cam.shakeP = Math.min(cam.shakeP + p, 40); }
  function focusOn(names, zoom = 1.12) {
    if (!names) { cam.focus = null; return; }
    let x = 0, z = 0, n = 0;
    for (const nm of names) { const c = chars.get(nm); if (c) { x += c.home.x; z += c.home.z; n++; } }
    if (n) cam.focus = { x: x / n, z: z / n, zoom };
  }
  function updateCam(dt) {
    cam.sway += dt;
    const k = 1 - Math.exp(-dt * 3);
    cam.yaw = cam.base.yaw + cam.userYaw;
    cam.pitch = cam.base.pitch;
    cam.dist = cam.base.dist; cam.tx = 0; cam.tz = 0;
    cam.screenY += (cam.screenYT - cam.screenY) * k; if (Math.abs(cam.screenY - cam.screenYT) < 0.0003) cam.screenY = cam.screenYT;
    const fitW = W * 0.86, fitH = H * 1.45;
    cam.F = Math.min(fitW, fitH) * cam.base.dist / (2 * R);
    // 目标视图：把焦点往屏幕中心拉近一部分，并缩放；外加极缓慢的呼吸漂移
    const f = cam.focus, cx = W / 2, cy = H * 0.52;
    let z = (f ? f.zoom : 1) * cam.userZoom * (1 + cam.punch * 0.05), fx = cx, fy = cy;
    if (f) { const p = project(f.x, 90, f.z); fx = p.x; fy = p.y; }
    const pull = f ? 0.45 : 0;
    // screen = (p - F) * z + F + (C - F) * pull
    const tox = (cx - fx) * pull + fx * (1 - z) + Math.sin(cam.sway * 0.21) * 4;
    const toy = (cy - fy) * pull + fy * (1 - z) + Math.sin(cam.sway * 0.17) * 3;
    const v = cam.view;
    v.z += (z - v.z) * k; v.ox += (tox - v.ox) * k; v.oy += (toy - v.oy) * k;
    cam.punch *= Math.exp(-dt * 6);
    cam.shakeP *= Math.exp(-dt * 7);
    cam.sx = (Math.random() - 0.5) * cam.shakeP; cam.sy = (Math.random() - 0.5) * cam.shakeP;
  }
  const toScreen = (x, y) => ({ x: x * cam.view.z + cam.view.ox, y: y * cam.view.z + cam.view.oy });
  const fromScreen = (x, y) => ({ x: (x - cam.view.ox) / cam.view.z, y: (y - cam.view.oy) / cam.view.z });

  /* ---------------- 主更新 / 渲染 ---------------- */
  function update(dt) {
    T += dt;
    updateCam(dt);
    updateFX(dt);
    ambient(dt);
    if (letterboxT !== letterbox) letterbox += (letterboxT - letterbox) * Math.min(1, dt * 5);
    flash.a *= Math.exp(-dt * 6);
    blood += (bloodT - blood) * Math.min(1, dt * 0.8);
    for (const ch of chars.values()) {
      const A = ch.a;
      A.hurt = Math.max(0, A.hurt - dt * 5);
      A.shieldHit = Math.max(0, A.shieldHit - dt * 3);
      A.glow = Math.max(0, A.glow - dt * 1.2);
      A.squash *= Math.exp(-dt * 10);
      // 血条拖尾
      if (ch.hpLag > ch.disp.hp) ch.hpLag = Math.max(ch.disp.hp, ch.hpLag - Math.max(40, (ch.hpLag - ch.disp.hp) * 2.2) * dt);
      else ch.hpLag = ch.disp.hp;
      // 朝向：默认面向场地中心
      if (!A.lockFacing) {
        const me = project(ch.pos.x, 0, ch.pos.z), c = project(0, 0, 0);
        const dx = c.x - me.x;
        if (Math.abs(dx) > 30 * me.s) A.faceT = dx >= 0 ? 1 : -1;  // 迟滞，避免在中线附近来回翻转
      } else A.faceT = A.facing >= 0 ? 1 : -1;
      if (A.faceT == null) A.faceT = A.facing >= 0 ? 1 : -1;
      if (!A.lockFacing && Math.sign(A.facing) !== A.faceT) A.facing = A.faceT * 0.25; // 快速翻转：先瞬间换向再展开
      if (!A.lockFacing) A.facing += (A.faceT - A.facing) * Math.min(1, dt * 12);
    }
  }

  /* 自适应画质：持续掉帧就降低渲染分辨率，流畅后再升回 */
  let qMode = U.store.get('quality', 'auto');
  const QFIX = { high: 1, mid: 0.8, low: 0.6 };
  function setQuality(m) { qMode = m; U.store.set('quality', m); Q = QFIX[m] || 1; resize(); }
  function perf(raw) {
    ema += (raw - ema) * 0.08;
    if (qMode !== 'auto') return;
    if (ema > 1 / 48) { slowT += raw; fastT = 0; } else if (ema < 1 / 57) { fastT += raw; slowT = 0; } else { slowT = 0; fastT = 0; }
    if (slowT > 1.2 && Q > 0.55) { Q = Math.max(0.55, Q - 0.15); slowT = 0; resize(); }
    if (fastT > 5 && Q < 1) { Q = Math.min(1, Q + 0.15); fastT = 0; resize(); }
  }
  function render() {
    frameN++;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const P = prof.on ? performance.now.bind(performance) : null;
    let t = P ? P() : 0;
    const mark = k => { if (P) { const n = P(); prof[k] = (prof[k] || 0) * 0.9 + (n - t) * 0.1; t = n; } };
    drawSky();
    if (blood > 0.01) { // 血月：天空泛红，月亮染血
      ctx.fillStyle = `rgba(140,8,24,${0.24 * blood})`; ctx.fillRect(0, 0, W, H);
      const mx = W * 0.2, my = H * 0.17, mr = Math.min(W, H) * 0.075;
      glowAt('#ff2a3a', mx, my, mr * 5, 0.45 * blood);
      ctx.fillStyle = `rgba(210,30,40,${0.6 * blood})`; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    }
    mark('sky');
    const v = cam.view;
    ctx.setTransform(DPR * v.z, 0, 0, DPR * v.z, DPR * v.ox, DPR * v.oy);
    drawPlatform(); mark('floor');
    drawFloorFX(); mark('floorfx');
    // 深度排序：立柱 + 角色
    const list = [];
    for (const p of props) list.push({ d: project(p.x, 0, p.z).depth, f: () => drawPillar(p) });
    for (const ch of chars.values()) list.push({ d: project(ch.pos.x, 0, ch.pos.z).depth, f: () => drawCharSprite(ch) });
    list.sort((a, b) => b.d - a.d);
    for (const it of list) it.f(); mark('sprites');
    drawLinks(); mark('links');
    drawFX(); mark('fx');
    drawPlates(); drawTexts(); mark('plates');
    // 后期：暗角、受伤红晕、闪屏、宽银幕
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (vgCv) ctx.drawImage(vgCv, 0, 0, W, H);
    if (vignette.red > 0.01) {
      const rv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      rv.addColorStop(0, 'rgba(120,0,0,0)'); rv.addColorStop(1, `rgba(160,0,10,${vignette.red * (0.75 + Math.sin(T * 4) * 0.25)})`);
      ctx.fillStyle = rv; ctx.fillRect(0, 0, W, H);
    }
    if (flash.a > 0.01) { ctx.fillStyle = U.hexA(flash.col, flash.a); ctx.fillRect(0, 0, W, H); }
    if (letterbox > 0.01) { const h = H * 0.09 * letterbox; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, h); ctx.fillRect(0, H - h, W, h); }
  }

  /* ---------------- 交互 ---------------- */
  function pick(sx0, sy0) {
    const { x, y } = fromScreen(sx0, sy0);
    let best = null, bd = Infinity;
    for (const ch of chars.values()) {
      const b = ch.bbox; if (!b || !ch.disp.alive) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        const d = project(ch.pos.x, 0, ch.pos.z).depth;
        if (d < bd) { bd = d; best = ch.name; }
      }
    }
    return best;
  }
  function screenOf(name, h = 90) { const ch = chars.get(name); if (!ch) return null; const p = project(ch.pos.x, h, ch.pos.z), q = toScreen(p.x, p.y); return { x: q.x, y: q.y, s: p.s * cam.view.z }; }
  function bboxScreen(name) {
    const ch = chars.get(name); if (!ch || !ch.bbox) return null;
    const b = ch.bbox, a = toScreen(b.x, b.y);
    return { x: a.x, y: a.y, w: b.w * cam.view.z, h: b.h * cam.view.z };
  }

  return {
    init, update, render, perf, SPR, prof, bboxScreen, setQuality, get qualityMode() { return qMode; }, get quality() { return Q; }, get fps() { return 1 / ema; }, project, pick, screenOf, addChar, portrait, clearChars, chars, fx, shake, focusOn,
    pulseLink, pulseChainTo, cam,
    get W() { return W; }, get H() { return H; },
    setSelected(n) { selected = n; }, set plates(v) { showPlates = v; }, get selected() { return selected; },
    setActive(n) { activeTurn = n; }, setHover(n) { hoverName = n; },
    flash(col, a) { flash.col = col; flash.a = Math.max(flash.a, a); },
    set redVignette(v) { vignette.red = v; },
    set bloodMoon(v) { bloodT = v; if (!v) blood = 0; }, get bloodMoon() { return bloodT; },
    set letterbox(v) { letterboxT = v; },
    punch(v = 1) { cam.punch = Math.max(cam.punch, v); },
  };
})();
