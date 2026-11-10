/* ============================================================
   誓约竞技场 · util.js —— 数学、缓动、补间、时间
   ============================================================ */
'use strict';
OO.U = (() => {
  const U = {};
  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randi = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  U.pick = arr => arr[Math.floor(Math.random() * arr.length)];
  U.shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  U.weighted = obj => { let s = 0; for (const k in obj) s += obj[k]; let r = Math.random() * s; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; };
  U.TAU = Math.PI * 2;

  /* 缓动 */
  U.ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    inOutQuad: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI) / 3) + 1,
    outExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  };

  /* 游戏时钟：所有演出时间都乘以 speed 缩放；hitstop 冻结 */
  U.time = { now: 0, speed: 1, freeze: 0, slowmo: 1, slowmoT: 0 };

  /* 补间：每帧由 main 调用 U.tick(dt) */
  const tweens = [];
  U.tween = (dur, fn, ease = U.ease.inOutQuad) => new Promise(res => {
    tweens.push({ t: 0, dur: Math.max(dur, 0.0001), fn, ease, res });
  });
  U.wait = dur => U.tween(dur, () => {});
  U.tick = dt => {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = Math.min(tw.t / tw.dur, 1);
      try { tw.fn(tw.ease(k), k); } catch (e) { console.error(e); }
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
  };
  U.clearTweens = () => { while (tweens.length) tweens.pop().res(); };

  U.fmt = n => Math.round(n).toLocaleString('en-US');
  U.norm = hex => { let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return h; };
  U.hexA = (hex, a) => {
    const h = U.norm(hex);
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };
  U.mix = (h1, h2, t) => {
    const a = U.norm(h1), b = U.norm(h2);
    const c = i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0');
    return '#' + c(0) + c(2) + c(4);
  };
  U.store = {
    get(k, d) { try { const v = localStorage.getItem('oath_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('oath_' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
  };
  return U;
})();
