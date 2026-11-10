/* ============================================================
   誓约竞技场 · audio.js —— Web Audio 全合成音效 + 程序化史诗配乐
   信号链：各音源 → 声像 → SFX/音乐总线 → (干声 + 卷积混响) → 压缩器 → 输出
   ============================================================ */
'use strict';
OO.audio = (() => {
  const U = OO.U;
  let AC = null, master, comp, sfxBus, musicBus, revIn, noiseBuf, shaperHeavy, unlocked = false;
  const vol = U.store.get('vol', { master: 0.85, music: 0.55, sfx: 0.9 });

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function makeIR(sec, decay) {
    const len = Math.floor(AC.sampleRate * sec), buf = AC.createBuffer(2, len, AC.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 早期反射 + 指数衰减尾音
        const er = i < AC.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.9 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) * 0.6 + er;
      }
    }
    return buf;
  }

  function unlock() {
    if (unlocked) { if (AC && AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      comp = AC.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
      master = AC.createGain(); master.gain.value = vol.master;
      comp.connect(master); master.connect(AC.destination);
      const conv = AC.createConvolver(); conv.buffer = makeIR(3.2, 3.2);
      revIn = AC.createGain(); revIn.gain.value = 1;
      const revOut = AC.createGain(); revOut.gain.value = 0.55;
      const revLP = AC.createBiquadFilter(); revLP.type = 'lowpass'; revLP.frequency.value = 5200;
      revIn.connect(conv); conv.connect(revLP); revLP.connect(revOut); revOut.connect(comp);
      sfxBus = AC.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(comp);
      musicBus = AC.createGain(); musicBus.gain.value = vol.music; musicBus.connect(comp);
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      shaperHeavy = AC.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
      shaperHeavy.curve = curve;
      unlocked = true;
      music.start();
    } catch (e) { console.warn('音频不可用', e); }
  }

  function setVolume(k, v) {
    vol[k] = v; U.store.set('vol', vol);
    if (!unlocked) return;
    const t = AC.currentTime;
    if (k === 'master') master.gain.setTargetAtTime(v, t, 0.05);
    if (k === 'music') musicBus.gain.setTargetAtTime(v, t, 0.05);
    if (k === 'sfx') sfxBus.gain.setTargetAtTime(v, t, 0.05);
  }

  /* ---------------- 构件 ---------------- */
  function env(node, t, a, peak, d, curve = 'exp') {
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    else g.gain.linearRampToValueAtTime(0.0001, t + a + d);
    node.connect(g);
    return g;
  }
  function osc(type, f0, t, dur, f1, detune = 0) {
    const o = AC.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    o.detune.value = detune;
    o.start(t); o.stop(t + dur + 0.1);
    return o;
  }
  function noise(t, dur, type = 'lowpass', f = 1000, q = 0.7, f1 = null, fdur = null) {
    const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + (fdur || dur));
    s.connect(fl); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1);
    return fl;
  }
  function filt(node, type, f, q = 0.7) {
    const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    node.connect(fl); return fl;
  }
  function out(node, o = {}, bus) {
    const g = AC.createGain(); g.gain.value = o.vol == null ? 1 : o.vol;
    node.connect(g);
    let last = g;
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = U.clamp(o.pan || 0, -1, 1); g.connect(p); last = p; }
    last.connect(bus || sfxBus);
    const rs = AC.createGain(); rs.gain.value = o.rev == null ? 0.25 : o.rev;
    last.connect(rs); rs.connect(revIn);
    return g;
  }
  function heavy(node) { // 软削波，制造厚重的失真感
    const sh = AC.createWaveShaper(); sh.curve = shaperHeavy.curve; node.connect(sh); return sh;
  }

  /* 合成乐器 */
  function brass(t, midi, dur, o = {}, bus) {
    const f = mtof(midi);
    const mix = AC.createGain();
    [-7, 0, 7].forEach(dt => { const s = osc('sawtooth', f, t, dur + 0.3, null, dt); s.connect(mix); });
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(o.bright || 2400, t + 0.08);
    lp.frequency.exponentialRampToValueAtTime((o.bright || 2400) * 0.5, t + dur);
    mix.connect(lp);
    const g = AC.createGain(); lp.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak || 0.12, t + 0.06);
    g.gain.setValueAtTime((o.peak || 0.12) * 0.8, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    return out(g, { vol: 1, pan: o.pan || 0, rev: o.rev == null ? 0.45 : o.rev }, bus);
  }
  function bell(t, f, dur, peak, o = {}, bus) {
    [[1, 1], [2.76, 0.5], [5.4, 0.28], [8.93, 0.14], [0.5, 0.35]].forEach(([r, a], i) => {
      const s = osc('sine', f * r, t, dur);
      out(env(s, t, 0.003, peak * a, dur / (1 + i * 0.6)), { pan: o.pan || 0, rev: o.rev == null ? 0.6 : o.rev }, bus);
    });
  }
  function choir(t, midis, dur, peak, o = {}, bus) {
    midis.forEach((m, i) => {
      const f = mtof(m), mix = AC.createGain();
      [-11, 0, 9].forEach(dt => { const s = osc('sawtooth', f, t, dur + 1, null, dt); s.connect(mix); });
      // 元音“啊”的共振峰
      const f1 = filt(mix, 'bandpass', 760, 4), f2 = filt(mix, 'bandpass', 1150, 5), f3 = filt(mix, 'lowpass', 500, 0.5);
      const g = AC.createGain(); f1.connect(g); f2.connect(g); f3.connect(g);
      const v = AC.createGain(); g.connect(v);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.6));
      v.gain.setValueAtTime(peak, t + dur);
      v.gain.linearRampToValueAtTime(0.0001, t + dur + (o.release || 1.0));
      out(v, { pan: (i - 1) * 0.35, rev: o.rev == null ? 0.8 : o.rev }, bus);
    });
  }
  function taiko(t, power = 1, o = {}, bus) {
    const s = osc('sine', 120 * (o.pitch || 1), t, 0.6, 42 * (o.pitch || 1));
    out(env(s, t, 0.003, 0.9 * power, 0.55), { pan: o.pan || 0, rev: 0.35 }, bus);
    out(env(noise(t, 0.12, 'lowpass', 900, 0.8, 200), t, 0.002, 0.45 * power, 0.12), { pan: o.pan || 0, rev: 0.3 }, bus);
    out(env(noise(t, 0.05, 'bandpass', 2400, 1.2), t, 0.001, 0.12 * power, 0.04), { pan: o.pan || 0, rev: 0.2 }, bus);
  }
  function pluck(t, midi, dur, peak, o = {}, bus) {
    const s = osc('sawtooth', mtof(midi), t, dur);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(o.bright || 1800, t); lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    s.connect(lp);
    out(env(lp, t, 0.004, peak, dur), { pan: o.pan || 0, rev: o.rev == null ? 0.3 : o.rev }, bus);
  }

  /* ---------------- 音效配方 ---------------- */
  const R = {
    click(t, o) { out(env(osc('sine', 1900, t, 0.04, 1200), t, 0.001, 0.12, 0.04), { ...o, rev: 0.05 }); out(env(noise(t, 0.02, 'highpass', 4000), t, 0.001, 0.05, 0.02), { ...o, rev: 0 }); },
    hover(t, o) { out(env(osc('sine', 2600, t, 0.03), t, 0.001, 0.025, 0.03), { ...o, rev: 0.05 }); },
    error(t, o) { [0, 0.09].forEach(d => out(env(filt(osc('square', 150, t + d, 0.08), 'lowpass', 900), t + d, 0.002, 0.12, 0.08), { ...o, rev: 0.1 })); },
    slot(t, o) { out(env(osc('triangle', 900, t, 0.05, 600), t, 0.001, 0.12, 0.05), { ...o, rev: 0.1 }); out(env(noise(t, 0.03, 'bandpass', 3000, 2), t, 0.001, 0.1, 0.03), { ...o, rev: 0 }); },
    select(t, o) { out(env(noise(t, 0.18, 'bandpass', 800, 2, 3000), t, 0.02, 0.15, 0.16), { ...o, rev: 0.3 }); out(env(osc('sine', 880, t + 0.05, 0.25, 1320), t + 0.05, 0.005, 0.07, 0.22), { ...o, rev: 0.5 }); },
    swap(t, o) { out(env(noise(t, 0.08, 'bandpass', 1400, 1.5, 700), t, 0.005, 0.18, 0.08), { ...o, rev: 0.1 }); out(env(osc('triangle', 520, t + 0.05, 0.06, 760), t + 0.05, 0.002, 0.08, 0.06), o); },
    whoosh(t, o) {
      const p = o.power || 0.6;
      out(env(noise(t, 0.35, 'bandpass', 380, 1.6, 2600 + p * 1500, 0.16), t, 0.09, 0.55 * p + 0.15, 0.22), { ...o, rev: 0.2 });
      out(env(noise(t + 0.1, 0.2, 'bandpass', 3000, 1.2, 700), t + 0.1, 0.02, 0.18, 0.15), { ...o, rev: 0.15 });
    },
    dash(t, o) { out(env(noise(t, 0.25, 'lowpass', 300, 1, 1600), t, 0.06, 0.25, 0.2), { ...o, rev: 0.1 }); out(env(osc('sine', 90, t, 0.12, 50), t, 0.003, 0.3, 0.12), o); },
    impact(t, o) { // 物理命中：肉体冲击 + 低频冲击 + 高频碎裂
      const p = U.clamp(o.power || 0.5, 0.15, 1.4);
      out(env(osc('sine', 160, t, 0.3, 38), t, 0.002, 0.95 * Math.min(p + 0.3, 1.2), 0.32), { ...o, rev: 0.25 });
      out(env(heavy(noise(t, 0.16, 'lowpass', 2600, 0.8, 320)), t, 0.001, 0.38 * p + 0.12, 0.16), { ...o, rev: 0.3 });
      out(env(noise(t, 0.06, 'bandpass', 4200, 1.5), t, 0.001, 0.22 * p, 0.05), { ...o, rev: 0.2 });
      out(env(noise(t + 0.01, 0.22, 'bandpass', 260, 1.2), t + 0.01, 0.004, 0.4 * p, 0.2), { ...o, rev: 0.2 });
      if (p > 0.75) { // 重击追加次声轰鸣
        out(env(heavy(osc('sine', 70, t, 1.1, 26)), t, 0.004, 0.55 * (p - 0.5), 1.0), { ...o, rev: 0.6 });
        out(env(noise(t, 0.9, 'lowpass', 600, 0.6, 80), t, 0.01, 0.3 * (p - 0.5), 0.9), { ...o, rev: 0.7 });
      }
    },
    clang(t, o) { // 金属护甲受击
      const f0 = (o.f || 420) * U.rand(0.94, 1.06), p = o.power || 0.6;
      [[1, 0.5, 0.9], [2.76, 0.32, 0.6], [5.4, 0.2, 0.4], [8.93, 0.12, 0.25], [13.3, 0.07, 0.15]].forEach(([r, a, d]) => {
        out(env(osc('sine', f0 * r, t, d * 1.2), t, 0.001, a * p, d), { ...o, rev: 0.45 });
      });
      out(env(noise(t, 0.04, 'highpass', 5000), t, 0.001, 0.3 * p, 0.04), { ...o, rev: 0.2 });
    },
    shieldHit(t, o) {
      const p = o.power || 0.6;
      [1320, 1980, 2970, 4100].forEach((f, i) => out(env(osc('sine', f * U.rand(0.98, 1.02), t, 0.6, f * 0.92), t, 0.002, 0.14 * p / (1 + i * 0.4), 0.55 - i * 0.08), { ...o, rev: 0.6 }));
      out(env(filt(osc('sawtooth', 900, t, 0.25, 160), 'lowpass', 2500), t, 0.002, 0.18 * p, 0.25), { ...o, rev: 0.3 });
      out(env(noise(t, 0.3, 'highpass', 2500, 0.7, 6000), t, 0.003, 0.15 * p, 0.28), { ...o, rev: 0.5 });
    },
    throwP(t, o) { out(env(noise(t, 0.5, 'bandpass', 600, 2, 2200, 0.5), t, 0.15, 0.22, 0.35), { ...o, rev: 0.2 }); },
    glass(t, o) { // 玻璃瓶碎裂：一次脆响 + 大量随机碎片
      out(env(noise(t, 0.05, 'highpass', 3500), t, 0.001, 0.5, 0.05), { ...o, rev: 0.4 });
      for (let i = 0; i < 16; i++) {
        const tt = t + Math.pow(Math.random(), 1.8) * 0.45;
        out(env(noise(tt, 0.06, 'bandpass', U.rand(3000, 9000), 12), tt, 0.001, U.rand(0.15, 0.4), U.rand(0.03, 0.09)), { ...o, rev: 0.45 });
        if (i % 3 === 0) out(env(osc('sine', U.rand(3500, 7500), tt, 0.1), tt, 0.001, 0.05, 0.08), { ...o, rev: 0.5 });
      }
    },
    magic(t, o) { // 魔法爆裂（毒瓶）
      out(env(noise(t, 0.9, 'lowpass', 180, 2, 2400, 0.25), t, 0.01, 0.6, 0.85), { ...o, rev: 0.6 });
      [50, 53, 57].forEach((m, i) => out(env(filt(osc('sawtooth', mtof(m), t, 1.0, mtof(m - 12)), 'lowpass', 1400), t, 0.01, 0.1, 0.95), { ...o, pan: (o.pan || 0) + (i - 1) * 0.3, rev: 0.7 }));
      out(env(osc('sine', 110, t, 0.6, 35), t, 0.002, 0.8, 0.6), { ...o, rev: 0.4 });
      for (let i = 0; i < 8; i++) { const tt = t + 0.15 + i * 0.07 + Math.random() * 0.05; out(env(osc('sine', U.rand(300, 700), tt, 0.06, U.rand(800, 1400)), tt, 0.002, 0.06, 0.06), { ...o, rev: 0.4 }); }
    },
    drink(t, o) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.18;
        out(env(osc('sine', 230 - i * 15, tt, 0.12, 120), tt, 0.01, 0.22, 0.12), { ...o, rev: 0.1 });
        out(env(noise(tt, 0.12, 'lowpass', 500, 2), tt, 0.01, 0.18, 0.11), { ...o, rev: 0.1 });
      }
      out(env(osc('sine', 2800, t + 0.6, 0.2), t + 0.6, 0.001, 0.05, 0.2), { ...o, rev: 0.4 });
    },
    heal(t, o) { // 竖琴琶音 + 闪光
      [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => pluck(t + i * 0.055, m, 1.3, 0.1, { ...o, bright: 3200, rev: 0.75 }));
      [74, 78, 81].forEach((m, i) => out(env(osc('sine', mtof(m), t + 0.2, 1.6), t + 0.2, 0.3, 0.05, 1.3), { ...o, pan: (i - 1) * 0.4, rev: 0.9 }));
      out(env(noise(t, 1.2, 'highpass', 6000, 0.7), t, 0.4, 0.06, 0.8), { ...o, rev: 0.8 });
    },
    shieldUp(t, o) {
      const s = osc('sawtooth', 110, t, 0.9, 440); const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
      lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(3600, t + 0.7); s.connect(lp);
      out(env(lp, t, 0.6, 0.14, 0.4), { ...o, rev: 0.5 });
      bell(t + 0.65, mtof(81), 2.2, 0.12, o);
      bell(t + 0.65, mtof(88), 2.0, 0.06, o);
    },
    strength(t, o) {
      out(env(heavy(filt(osc('sawtooth', 68, t, 1.0, 52), 'lowpass', 700, 3)), t, 0.05, 0.3, 0.9), { ...o, rev: 0.4 });
      out(env(heavy(filt(osc('sawtooth', 102, t, 1.0, 78, 9), 'lowpass', 600, 3)), t, 0.05, 0.18, 0.9), { ...o, rev: 0.4 });
      taiko(t, 1.1, o); taiko(t + 0.22, 0.8, { ...o, pitch: 1.2 });
      out(env(noise(t, 0.6, 'bandpass', 400, 1, 4000, 0.55), t, 0.4, 0.25, 0.2), { ...o, rev: 0.5 });
    },
    equip(t, o) {
      out(env(noise(t, 0.2, 'bandpass', 900, 1, 2200), t, 0.02, 0.18, 0.18), { ...o, rev: 0.1 });
      R.clang(t + 0.16, { ...o, f: 300, power: 0.45 });
      R.clang(t + 0.3, { ...o, f: 520, power: 0.3 });
    },
    armorBreak(t, o) {
      R.clang(t, { ...o, f: 260, power: 1 });
      R.clang(t + 0.03, { ...o, f: 610, power: 0.7 });
      out(env(heavy(noise(t, 0.6, 'lowpass', 3000, 0.6, 300)), t, 0.002, 0.45, 0.55), { ...o, rev: 0.5 });
      for (let i = 0; i < 10; i++) { const tt = t + 0.1 + Math.random() * 0.5; R.clang(tt, { ...o, f: U.rand(800, 1600), power: 0.12 }); }
    },
    loot(t, o) {
      [86, 83, 81, 78, 74].forEach((m, i) => out(env(osc('sine', mtof(m), t + i * 0.05, 0.6), t + i * 0.05, 0.002, 0.07, 0.5), { ...o, rev: 0.7 }));
      out(env(osc('sine', 120, t + 0.35, 0.2, 60), t + 0.35, 0.003, 0.35, 0.2), { ...o, rev: 0.2 });
      out(env(noise(t + 0.35, 0.15, 'lowpass', 800), t + 0.35, 0.002, 0.15, 0.15), o);
    },
    beam(t, o) { out(env(filt(osc('sawtooth', 220, t, 0.7, 1760), 'bandpass', 1400, 3), t, 0.2, 0.08, 0.5), { ...o, rev: 0.7 }); out(env(noise(t, 0.7, 'highpass', 3000, 0.7, 9000), t, 0.3, 0.08, 0.4), { ...o, rev: 0.7 }); },
    cardFlip(t, o) { out(env(noise(t, 0.12, 'bandpass', 2000, 1, 5000), t, 0.01, 0.2, 0.1), { ...o, rev: 0.15 }); out(env(osc('sine', 660, t + 0.06, 0.2, 990), t + 0.06, 0.002, 0.05, 0.18), { ...o, rev: 0.5 }); },
    cardPick(t, o) { [74, 78, 81, 86].forEach((m, i) => bell(t + i * 0.04, mtof(m), 1.4, 0.06, o)); R.beam(t, o); },
    alarm(t, o) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.28;
        out(env(filt(osc('sawtooth', i % 2 ? 415 : 554, tt, 0.24), 'lowpass', 1800, 2), tt, 0.01, 0.14, 0.22, 'lin'), { ...o, rev: 0.5 });
      }
      [0, 0.17].forEach((d, i) => out(env(osc('sine', i ? 52 : 62, t + d, 0.14, 38), t + d, 0.004, i ? 0.45 : 0.6, 0.13), { ...o, rev: 0.2 }));
    },
    aidCast(t, o) { choir(t, [74, 78, 81], 0.5, 0.05, { attack: 0.2, release: 0.8 }); R.beam(t, o); },
    aidArrive(t, o) { bell(t, mtof(86), 1.8, 0.1, o); R.heal(t + 0.05, o); },
    deathSwell(t, o) {
      const s = noise(t, 1.0, 'bandpass', 300, 1, 2800, 1.0); const g = AC.createGain(); s.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.95); g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      out(g, { ...o, rev: 0.6 });
    },
    death(t, o) {
      out(env(heavy(osc('sine', 85, t, 2.4, 22)), t, 0.003, 0.9, 2.3), { ...o, rev: 0.7 });
      out(env(noise(t, 2.6, 'lowpass', 1200, 0.6, 60), t, 0.005, 0.55, 2.5), { ...o, rev: 0.8 });
      choir(t + 0.1, [50, 53, 57], 1.2, 0.045, { attack: 0.3, release: 2.2 });
      bell(t + 0.05, mtof(38), 4.5, 0.18, { ...o, rev: 0.9 });
    },
    pact(t, o) {
      bell(t, mtof(57), 4, 0.16, o); bell(t + 0.02, mtof(64), 3.5, 0.08, o);
      choir(t + 0.1, [62, 66, 69, 74], 1.2, 0.035, { attack: 0.5, release: 2 });
      out(env(noise(t, 1.5, 'highpass', 5000, 0.7), t, 0.6, 0.05, 0.9), { ...o, rev: 0.9 });
    },
    pactBreak(t, o) {
      out(env(noise(t, 0.05, 'highpass', 2500), t, 0.001, 0.6, 0.05), { ...o, rev: 0.4 });
      const s = osc('sawtooth', 1400, t, 0.6, 110); out(env(filt(s, 'lowpass', 3000, 4), t, 0.002, 0.15, 0.6), { ...o, rev: 0.6 });
      bell(t + 0.04, mtof(49), 2.5, 0.12, o);
    },
    drum(t, o) { taiko(t, o.power || 0.8, o); },
    yourTurn(t, o) { brass(t, 62, 0.22, { peak: 0.09, bright: 2600 }); brass(t + 0.24, 69, 0.55, { peak: 0.11, bright: 3000 }); taiko(t, 0.6); },
    enemyTurn(t, o) { taiko(t, 0.55, { pitch: 0.85 }); },
    roundStart(t, o) { taiko(t, 1); taiko(t + 0.2, 0.7, { pitch: 1.15 }); taiko(t + 0.4, 1.1, { pitch: 0.9 }); brass(t + 0.4, 50, 0.9, { peak: 0.1, bright: 1600 }); brass(t + 0.4, 57, 0.9, { peak: 0.08, bright: 1600 }); },
    victory(t, o) {
      const seq = [[62, 0, 0.25], [66, 0.25, 0.25], [69, 0.5, 0.25], [74, 0.75, 1.6]];
      seq.forEach(([m, d, l]) => { brass(t + d, m, l, { peak: 0.13, bright: 3200 }); brass(t + d, m - 12, l, { peak: 0.08, bright: 1800 }); });
      [0, 0.25, 0.5, 0.75].forEach(d => taiko(t + d, 1));
      choir(t + 0.75, [62, 66, 69, 74], 2.2, 0.05, { attack: 0.2, release: 2.5 });
      out(env(noise(t + 0.5, 2.5, 'highpass', 6000, 0.6), t + 0.5, 0.25, 0.12, 2.2), { rev: 0.8 });
    },
    defeat(t, o) {
      [[57, 0, 0.6], [53, 0.6, 0.6], [50, 1.2, 2.2]].forEach(([m, d, l]) => { brass(t + d, m, l, { peak: 0.1, bright: 1200 }); brass(t + d, m - 12, l, { peak: 0.08, bright: 900 }); });
      bell(t + 1.2, mtof(33), 6, 0.22, { rev: 0.95 });
      choir(t + 1.2, [50, 53, 57], 2.5, 0.04, { attack: 0.8, release: 3 });
    },
    full(t, o) { R.error(t, o); },
  };

  let lastT = {};
  function play(name, o = {}) {
    if (!unlocked || !R[name]) return;
    const t0 = AC.currentTime + (o.delay || 0);
    if (lastT[name] && t0 - lastT[name] < 0.025 && !o.force) return; // 同帧去重
    lastT[name] = t0;
    try { R[name](t0, o); } catch (e) { console.warn(e); }
  }

  /* ---------------- 程序化配乐 ----------------
     D 小调，84 BPM；层：长音合唱 Pad / 低音弦乐断奏 / 太鼓 / 铜管 / 钟琴旋律。
     intensity(0~1) 平滑控制层的进出。 */
  const music = (() => {
    const BPM = 84, STEP = 60 / BPM / 4; // 16 分音符
    // 和弦（MIDI 根音 + 和弦音）
    const PROG = [
      [50, [62, 65, 69]], [46, [62, 65, 70]], [53, [60, 65, 69]], [48, [60, 64, 67]],
      [50, [62, 65, 69]], [43, [62, 67, 70]], [46, [62, 65, 70]], [45, [61, 64, 69]],
    ];
    const DRUM = [1, 0, 0, .5, 0, 0, .8, 0, 1, 0, 0, 0, .7, 0, .5, .6];
    const MEL = [74, 72, 69, 67, 65, 69, 72, 74, 77, 76, 74, 72];
    let timer = null, step = 0, nextT = 0, mode = 'title', inten = 0, intenTarget = 0, melIdx = 0;
    function start() {
      if (timer) return;
      nextT = AC.currentTime + 0.1;
      timer = setInterval(sched, 25);
    }
    function setMode(m) { mode = m; if (m === 'title') intenTarget = 0; }
    function setIntensity(v) { intenTarget = U.clamp(v, 0, 1); }
    function sched() {
      if (!unlocked) return;
      while (nextT < AC.currentTime + 0.15) { tick(step, nextT); step++; nextT += STEP; }
      inten += (intenTarget - inten) * 0.01;
    }
    function tick(s, t) {
      if (mode === 'silent') return;
      const bar = Math.floor(s / 16) % PROG.length, k = s % 16;
      const [root, chord] = PROG[bar];
      const battle = mode === 'battle';
      // Pad / 合唱：每小节一次
      if (k === 0) {
        choir(t, chord.map(m => m - 12), STEP * 16 - 0.2, battle ? 0.022 : 0.03, { attack: 1.2, release: 1.6, rev: 0.9 }, musicBus);
        // 低音长音
        const s1 = osc('sawtooth', mtof(root - 12), t, STEP * 16 + 0.5);
        out(env(filt(s1, 'lowpass', 220, 1), t, 0.6, battle ? 0.1 : 0.07, STEP * 16), { rev: 0.3 }, musicBus);
      }
      if (battle) {
        // 弦乐断奏：八分音符
        if (k % 2 === 0) pluck(t, root + (k % 8 === 6 ? 7 : 0), 0.18, 0.06 + inten * 0.04, { bright: 1100 + inten * 900, rev: 0.25 }, musicBus);
        if (inten > 0.35 && k % 2 === 1) pluck(t, root + 12, 0.12, 0.03 * inten, { bright: 1400, rev: 0.25 }, musicBus);
        // 太鼓
        const dv = DRUM[k];
        if (dv && (inten > 0.15 || k === 0 || k === 8)) taiko(t, dv * (0.35 + inten * 0.45), { pitch: k % 4 === 0 ? 0.9 : 1.15, pan: (k % 3 - 1) * 0.3 }, musicBus);
        if (inten > 0.55 && k % 2 === 0) out(env(noise(t, 0.04, 'highpass', 7000), t, 0.001, 0.04 * inten, 0.04), { rev: 0.1, pan: 0.3 }, musicBus);
        // 铜管：高强度时每两小节一次
        if (inten > 0.5 && k === 0 && bar % 2 === 0) chord.forEach(m => brass(t, m - 12, STEP * 12, { peak: 0.035 * inten, bright: 1500 }, musicBus));
      } else {
        // 标题：钟琴旋律，稀疏
        if (k % 4 === 0 && Math.random() < 0.6) {
          melIdx = (melIdx + U.pick([-1, 1, 1, 2, -2])) % MEL.length; if (melIdx < 0) melIdx += MEL.length;
          bell(t, mtof(MEL[melIdx]), 2.6, 0.035, { pan: U.rand(-0.5, 0.5), rev: 0.9 }, musicBus);
        }
        if (k === 0 && bar % 2 === 0) taiko(t, 0.35, { pitch: 0.8 }, musicBus);
      }
    }
    return { start, setMode, setIntensity, get intensity() { return inten; } };
  })();

  return { unlock, play, setVolume, vol, music, get ready() { return unlocked; } };
})();
