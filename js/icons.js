/* ============================================================
   誓约竞技场 · icons.js —— 程序化绘制物品图标（96×96 逻辑尺寸）
   OO.icons.canvas(type, accent) → 缓存的离屏画布
   OO.icons.url(type, accent)    → dataURL（DOM 使用）
   ============================================================ */
'use strict';
OO.icons = (() => {
  const S = 96, RES = 2;
  const cache = new Map();

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function glow(ctx, x, y, r, col, a = 0.55) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, OO.U.hexA(col, a)); g.addColorStop(1, OO.U.hexA(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function outline(ctx, w = 2.4) { ctx.lineWidth = w; ctx.strokeStyle = 'rgba(8,8,16,.9)'; ctx.lineJoin = 'round'; ctx.stroke(); }

  /* ---------- 药水 ---------- */
  function flaskPath(ctx, shape) {
    ctx.beginPath();
    if (shape === 'round') {        // 圆底烧瓶
      ctx.moveTo(41, 18); ctx.lineTo(55, 18); ctx.lineTo(55, 36);
      ctx.bezierCurveTo(74, 41, 80, 58, 76, 70); ctx.bezierCurveTo(71, 86, 25, 86, 20, 70);
      ctx.bezierCurveTo(16, 58, 22, 41, 41, 36); ctx.closePath();
    } else if (shape === 'cone') {  // 锥形瓶
      ctx.moveTo(41, 16); ctx.lineTo(55, 16); ctx.lineTo(55, 34); ctx.lineTo(77, 76);
      ctx.quadraticCurveTo(79, 84, 70, 84); ctx.lineTo(26, 84); ctx.quadraticCurveTo(17, 84, 19, 76);
      ctx.lineTo(41, 34); ctx.closePath();
    } else if (shape === 'spike') { // 尖晶瓶（毒）
      ctx.moveTo(42, 18); ctx.lineTo(54, 18); ctx.lineTo(54, 32); ctx.lineTo(70, 44); ctx.lineTo(76, 62);
      ctx.lineTo(64, 84); ctx.lineTo(32, 84); ctx.lineTo(20, 62); ctx.lineTo(26, 44); ctx.lineTo(42, 32); ctx.closePath();
    } else {                        // 高瓶（力量）
      ctx.moveTo(42, 14); ctx.lineTo(54, 14); ctx.lineTo(54, 28); ctx.quadraticCurveTo(68, 32, 68, 46);
      ctx.lineTo(68, 78); ctx.quadraticCurveTo(68, 86, 60, 86); ctx.lineTo(36, 86); ctx.quadraticCurveTo(28, 86, 28, 78);
      ctx.lineTo(28, 46); ctx.quadraticCurveTo(28, 32, 42, 28); ctx.closePath();
    }
  }
  function potion(ctx, type) {
    const info = OO.data.items[type];
    const shape = { HealPotion: 'round', AbsorptionPotion: 'cone', DamagePotion: 'spike', StrengthPotion: 'tall' }[type];
    glow(ctx, 48, 62, 44, info.glow, 0.5);
    // 液体（裁剪到瓶身下半）
    ctx.save(); flaskPath(ctx, shape); ctx.clip();
    const lg = ctx.createLinearGradient(0, 44, 0, 88);
    lg.addColorStop(0, OO.U.mix(info.color, '#ffffff', 0.35)); lg.addColorStop(0.5, info.color); lg.addColorStop(1, OO.U.mix(info.color, '#000000', 0.55));
    ctx.fillStyle = 'rgba(200,220,255,.10)'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.moveTo(0, 50);
    for (let x = 0; x <= S; x += 6) ctx.lineTo(x, 50 + Math.sin(x * 0.25) * 2);
    ctx.lineTo(S, S); ctx.lineTo(0, S); ctx.fill();
    // 液面亮线
    ctx.strokeStyle = OO.U.hexA('#ffffff', 0.55); ctx.lineWidth = 1.5;
    ctx.beginPath(); for (let x = 0; x <= S; x += 6) ctx.lineTo(x, 50 + Math.sin(x * 0.25) * 2); ctx.stroke();
    // 气泡
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    [[38, 70, 3], [55, 62, 2.2], [46, 76, 1.8], [60, 74, 2.6], [33, 60, 1.6]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); });
    // 内发光
    const ig = ctx.createRadialGradient(48, 70, 2, 48, 70, 30);
    ig.addColorStop(0, OO.U.hexA(info.glow, 0.6)); ig.addColorStop(1, OO.U.hexA(info.glow, 0));
    ctx.fillStyle = ig; ctx.fillRect(0, 0, S, S);
    ctx.restore();
    // 玻璃轮廓 + 高光
    flaskPath(ctx, shape); outline(ctx, 3);
    flaskPath(ctx, shape); ctx.strokeStyle = 'rgba(220,235,255,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.save(); flaskPath(ctx, shape); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(shape === 'tall' ? 34 : 28, 56); ctx.quadraticCurveTo(shape === 'tall' ? 33 : 26, 68, 32, 76); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(shape === 'tall' ? 36 : 32, 50, 2.2, 0, 7); ctx.fill();
    ctx.restore();
    // 瓶塞
    const top = shape === 'tall' ? 14 : shape === 'cone' ? 16 : 18;
    const cg = ctx.createLinearGradient(40, 0, 56, 0); cg.addColorStop(0, '#6b4424'); cg.addColorStop(0.5, '#b0784a'); cg.addColorStop(1, '#5a361c');
    ctx.fillStyle = cg; rr(ctx, 39, top - 8, 18, 11, 3); ctx.fill(); outline(ctx, 2);
    // 瓶颈绳结
    ctx.strokeStyle = OO.U.mix(info.color, '#ffffff', 0.2); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(40, top + 7); ctx.lineTo(56, top + 7); ctx.stroke();
    // 符文
    ctx.save(); ctx.translate(48, 68); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    if (type === 'HealPotion') { ctx.beginPath(); ctx.moveTo(0, 7); ctx.bezierCurveTo(-11, -1, -6, -10, 0, -4); ctx.bezierCurveTo(6, -10, 11, -1, 0, 7); ctx.fill(); }
    else if (type === 'AbsorptionPotion') { ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, -5); ctx.lineTo(7, 3); ctx.quadraticCurveTo(4, 8, 0, 10); ctx.quadraticCurveTo(-4, 8, -7, 3); ctx.lineTo(-8, -5); ctx.closePath(); ctx.stroke(); }
    else if (type === 'DamagePotion') { ctx.beginPath(); ctx.arc(0, -1, 7, 0, 7); ctx.fill(); ctx.fillStyle = OO.U.mix(info.color, '#000000', .4); ctx.beginPath(); ctx.arc(-3, -2, 2, 0, 7); ctx.arc(3, -2, 2, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(-4, 5, 8, 4); }
    else { ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(8, -2, 5, 6); ctx.quadraticCurveTo(2, 10, 0, 10); ctx.quadraticCurveTo(-7, 8, -6, 1); ctx.quadraticCurveTo(-5, -3, -2, -5); ctx.quadraticCurveTo(-1, 0, 1, 1); ctx.quadraticCurveTo(3, -4, 0, -10); ctx.fill(); }
    ctx.restore();
  }

  /* ---------- 剑 ---------- */
  function sword(ctx, accent) {
    glow(ctx, 48, 48, 46, '#9fd0ff', 0.35);
    ctx.save(); ctx.translate(48, 50); ctx.rotate(-Math.PI / 4);
    // 刃
    const bg = ctx.createLinearGradient(-7, 0, 7, 0);
    bg.addColorStop(0, '#7d8fa8'); bg.addColorStop(0.45, '#f4f9ff'); bg.addColorStop(0.55, '#c3d2e6'); bg.addColorStop(1, '#55657c');
    ctx.beginPath(); ctx.moveTo(-6.5, 8); ctx.lineTo(-6.5, -36); ctx.lineTo(0, -46); ctx.lineTo(6.5, -36); ctx.lineTo(6.5, 8); ctx.closePath();
    ctx.fillStyle = bg; ctx.fill(); outline(ctx, 2.4);
    ctx.strokeStyle = 'rgba(80,110,150,.7)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -36); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-4.5, 4); ctx.lineTo(-4.5, -35); ctx.stroke();
    // 护手
    const gg = ctx.createLinearGradient(0, 6, 0, 14); gg.addColorStop(0, '#ffe39a'); gg.addColorStop(1, '#a06a1c');
    ctx.beginPath(); ctx.moveTo(-20, 8); ctx.quadraticCurveTo(-22, 13, -16, 14); ctx.lineTo(16, 14); ctx.quadraticCurveTo(22, 13, 20, 8); ctx.closePath();
    ctx.fillStyle = gg; ctx.fill(); outline(ctx, 2.2);
    // 握柄
    ctx.fillStyle = '#4a2c1a'; rr(ctx, -4, 14, 8, 18, 2); ctx.fill(); outline(ctx, 2);
    ctx.strokeStyle = '#8a5a34'; ctx.lineWidth = 1.5;
    for (let y = 17; y < 32; y += 4) { ctx.beginPath(); ctx.moveTo(-4, y); ctx.lineTo(4, y + 2); ctx.stroke(); }
    // 柄头宝石
    ctx.beginPath(); ctx.arc(0, 36, 5.5, 0, 7); ctx.fillStyle = gg; ctx.fill(); outline(ctx, 2);
    ctx.beginPath(); ctx.arc(0, 36, 3, 0, 7); ctx.fillStyle = accent || '#4da6ff'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(-1, 35, 1, 0, 7); ctx.fill();
    ctx.restore();
  }

  /* ---------- 护甲 ---------- */
  function metal(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#eef3fa'); g.addColorStop(0.35, '#aab6c6'); g.addColorStop(0.7, '#6d7a8c'); g.addColorStop(1, '#3d4656');
    return g;
  }
  function trim(ctx, accent) { const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#ffe8a8'); g.addColorStop(1, accent || '#b07a22'); return g; }
  function helmet(ctx, accent) {
    glow(ctx, 48, 50, 44, '#e6eef8', 0.3);
    // 羽饰
    ctx.beginPath(); ctx.moveTo(48, 16); ctx.bezierCurveTo(70, 2, 84, 16, 80, 34); ctx.bezierCurveTo(74, 24, 62, 20, 50, 24); ctx.closePath();
    const pg = ctx.createLinearGradient(48, 10, 80, 34); pg.addColorStop(0, accent || '#d23a3a'); pg.addColorStop(1, OO.U.mix(accent || '#d23a3a', '#000000', .5));
    ctx.fillStyle = pg; ctx.fill(); outline(ctx, 2);
    // 盔体
    ctx.beginPath(); ctx.moveTo(22, 52); ctx.bezierCurveTo(20, 22, 76, 22, 74, 52); ctx.lineTo(72, 78); ctx.quadraticCurveTo(60, 86, 48, 86); ctx.quadraticCurveTo(36, 86, 24, 78); ctx.closePath();
    ctx.fillStyle = metal(ctx, 24, 24, 72, 86); ctx.fill(); outline(ctx, 2.6);
    // 面甲缝
    ctx.fillStyle = '#10141c'; rr(ctx, 29, 50, 38, 7, 3); ctx.fill();
    ctx.fillStyle = OO.U.hexA('#7fd4ff', .8); rr(ctx, 33, 52, 10, 3, 1.5); ctx.fill(); rr(ctx, 53, 52, 10, 3, 1.5); ctx.fill();
    // 中脊与镶边
    ctx.strokeStyle = trim(ctx, accent); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(48, 26); ctx.lineTo(48, 48); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(48, 60); ctx.lineTo(48, 84); ctx.stroke();
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#1a1f28'; ctx.beginPath(); ctx.arc(40 + (i % 2) * 16, 66 + Math.floor(i / 2) * 7, 1.6, 0, 7); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(48, 52, 22, -2.6, -1.9); ctx.stroke();
  }
  function chestplate(ctx, accent) {
    glow(ctx, 48, 52, 44, '#e6eef8', 0.3);
    ctx.beginPath();
    ctx.moveTo(30, 16); ctx.lineTo(40, 22); ctx.lineTo(56, 22); ctx.lineTo(66, 16); ctx.lineTo(84, 26); ctx.lineTo(80, 44);
    ctx.lineTo(72, 42); ctx.lineTo(72, 76); ctx.quadraticCurveTo(48, 90, 24, 76); ctx.lineTo(24, 42); ctx.lineTo(16, 44); ctx.lineTo(12, 26); ctx.closePath();
    ctx.fillStyle = metal(ctx, 16, 16, 80, 88); ctx.fill(); outline(ctx, 2.6);
    ctx.strokeStyle = trim(ctx, accent); ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(40, 22); ctx.quadraticCurveTo(48, 32, 56, 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(26, 64); ctx.quadraticCurveTo(48, 72, 70, 64); ctx.stroke();
    // 胸前纹章
    ctx.save(); ctx.translate(48, 46);
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, -6); ctx.lineTo(8, 5); ctx.quadraticCurveTo(4, 11, 0, 13); ctx.quadraticCurveTo(-4, 11, -8, 5); ctx.lineTo(-10, -6); ctx.closePath();
    ctx.fillStyle = accent || '#c8962e'; ctx.fill(); outline(ctx, 1.8);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3, 0); ctx.lineTo(0, 7); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(28, 46); ctx.quadraticCurveTo(28, 64, 34, 72); ctx.stroke();
  }
  function leggings(ctx, accent) {
    glow(ctx, 48, 52, 44, '#e6eef8', 0.3);
    ctx.fillStyle = metal(ctx, 20, 14, 76, 86);
    ctx.beginPath(); ctx.moveTo(22, 14); ctx.lineTo(74, 14); ctx.lineTo(74, 28); ctx.lineTo(22, 28); ctx.closePath(); ctx.fill(); outline(ctx, 2.4);
    [[24, 46], [52, 74]].forEach(([x0, x1]) => {
      ctx.beginPath(); ctx.moveTo(x0, 28); ctx.lineTo(x1 - 2, 28); ctx.lineTo(x1 - 4, 86); ctx.lineTo(x0 + 3, 86); ctx.closePath();
      ctx.fillStyle = metal(ctx, x0, 28, x1, 86); ctx.fill(); outline(ctx, 2.4);
      const cx = (x0 + x1) / 2 - 1;
      ctx.beginPath(); ctx.ellipse(cx, 54, 9, 7, 0, 0, 7); ctx.fillStyle = trim(ctx, accent); ctx.fill(); outline(ctx, 2);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(x0 + 3, 32, 2, 16);
    });
    ctx.strokeStyle = trim(ctx, accent); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(23, 21); ctx.lineTo(73, 21); ctx.stroke();
  }
  function boots(ctx, accent) {
    glow(ctx, 48, 56, 44, '#e6eef8', 0.3);
    [[14, 0], [46, 1]].forEach(([x]) => {
      ctx.beginPath(); ctx.moveTo(x + 6, 22); ctx.lineTo(x + 26, 22); ctx.lineTo(x + 26, 64); ctx.quadraticCurveTo(x + 40, 66, x + 38, 80);
      ctx.lineTo(x + 2, 80); ctx.lineTo(x + 4, 64); ctx.closePath();
      ctx.fillStyle = metal(ctx, x, 22, x + 38, 80); ctx.fill(); outline(ctx, 2.4);
      ctx.fillStyle = trim(ctx, accent); rr(ctx, x + 4, 22, 24, 7, 2); ctx.fill(); outline(ctx, 1.8);
      ctx.fillStyle = '#2a2f38'; rr(ctx, x + 1, 78, 39, 6, 2); ctx.fill(); outline(ctx, 1.6);
      ctx.strokeStyle = 'rgba(30,36,48,.8)'; ctx.lineWidth = 1.5;
      for (let y = 40; y < 64; y += 8) { ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 26, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + 8, 32, 2, 26);
    });
  }

  function draw(ctx, type, accent) {
    if (type in OO.data.items && OO.data.potionTypes.includes(type)) potion(ctx, type);
    else if (type === 'Sword') sword(ctx, accent);
    else if (type === 'Helmet') helmet(ctx, accent);
    else if (type === 'Chestplate') chestplate(ctx, accent);
    else if (type === 'Leggings') leggings(ctx, accent);
    else if (type === 'Boots') boots(ctx, accent);
  }

  function canvas(type, accent = '') {
    const key = type + '|' + accent;
    if (cache.has(key)) return cache.get(key).cv;
    const cv = document.createElement('canvas'); cv.width = cv.height = S * RES;
    const ctx = cv.getContext('2d'); ctx.scale(RES, RES);
    draw(ctx, type, accent || undefined);
    cache.set(key, { cv, url: null });
    return cv;
  }
  function url(type, accent = '') {
    const key = type + '|' + accent;
    canvas(type, accent);
    const c = cache.get(key);
    if (!c.url) c.url = c.cv.toDataURL('image/png');
    return c.url;
  }
  return { canvas, url, S };
})();
