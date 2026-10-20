"use client";

function createNoiseBuffer(ctx: AudioContext, duration: number) {
  const rate = ctx.sampleRate;
  const frames = Math.max(1, Math.ceil(rate * duration));
  const buffer = ctx.createBuffer(1, frames, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Subtle mechanical click when the active can changes. */
export function playCanSwitch(ctx: AudioContext, destination?: AudioNode) {
  const t = ctx.currentTime;
  const out = destination ?? ctx.destination;
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(out);

  const dur = 0.04;
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, dur);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2600;
  filter.Q.value = 1.2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  src.start(t);
  src.stop(t + dur);
}

/** Metallic pull-tab snap + air-release hiss — the "开盖" sound of a can. */
export function playCanOpen(ctx: AudioContext, destination?: AudioNode) {
  const t = ctx.currentTime;
  const out = destination ?? ctx.destination;
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(out);

  // 1. metallic snap of the pull-tab
  const snapDur = 0.05;
  const snap = ctx.createBufferSource();
  snap.buffer = createNoiseBuffer(ctx, snapDur);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3500;
  bp.Q.value = 2;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0, t);
  sg.gain.linearRampToValueAtTime(0.9, t + 0.003);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  snap.connect(bp);
  bp.connect(sg);
  sg.connect(master);
  snap.start(t);
  snap.stop(t + snapDur);

  // 2. air-release hiss as the seal breaks
  const hissDur = 0.22;
  const hiss = ctx.createBufferSource();
  hiss.buffer = createNoiseBuffer(ctx, hissDur);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3000;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0, t + 0.02);
  hg.gain.linearRampToValueAtTime(0.35, t + 0.05);
  hg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  hiss.connect(hp);
  hp.connect(hg);
  hg.connect(master);
  hiss.start(t + 0.02);
  hiss.stop(t + hissDur);

  // 3. short metallic ring
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(420, t + 0.12);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.12, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.connect(og);
  og.connect(master);
  osc.start(t);
  osc.stop(t + 0.15);
}

/** Sparkling-water (气泡水) opening fizz: bright "psst" + scattered bubble pops. */
export function playSparklingOpen(ctx: AudioContext, destination?: AudioNode) {
  const t = ctx.currentTime;
  const out = destination ?? ctx.destination;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(out);

  // 1. Sharp carbonated fizz — high-passed white noise, fast attack then long tail
  const fizzDur = 0.75;
  const fizzSrc = ctx.createBufferSource();
  fizzSrc.buffer = createNoiseBuffer(ctx, fizzDur);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5200;
  const fizzGain = ctx.createGain();
  fizzGain.gain.setValueAtTime(0, t);
  fizzGain.gain.linearRampToValueAtTime(0.5, t + 0.02);
  fizzGain.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
  fizzSrc.connect(hp);
  hp.connect(fizzGain);
  fizzGain.connect(master);
  fizzSrc.start(t);
  fizzSrc.stop(t + fizzDur);

  // 2. Scattered tiny bubble pops (bandpass blips) for the "气泡" texture
  for (let i = 0; i < 7; i++) {
    const bt = t + 0.04 + Math.random() * 0.55;
    const bsrc = ctx.createBufferSource();
    bsrc.buffer = createNoiseBuffer(ctx, 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200 + Math.random() * 4200;
    bp.Q.value = 7;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, bt);
    bg.gain.linearRampToValueAtTime(0.22, bt + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.001, bt + 0.03);
    bsrc.connect(bp);
    bp.connect(bg);
    bg.connect(master);
    bsrc.start(bt);
    bsrc.stop(bt + 0.03);
  }

  // 3. Tiny low "click" of the cap releasing
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(72, t + 0.09);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.18, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(og);
  og.connect(master);
  osc.start(t);
  osc.stop(t + 0.13);
}
