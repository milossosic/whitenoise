class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kind = "white";
    this.prevKind = "white";
    this.xfade = 1;
    this.xfadeInc = 1 / (sampleRate * 0.1);
    this.phase = 0;
    this.slow = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    this.states = {
      white: this.freshState(),
      brown: this.freshState(),
      pink: this.freshState(),
      fan: this.freshState(),
      soft: this.freshState(),
      ac: this.freshState(),
    };
    const hz = (f) => 1 - Math.exp((-2 * Math.PI * f) / sampleRate);
    this.a20 = hz(20);
    this.a80 = hz(80);
    this.a160 = hz(160);
    this.a350 = hz(350);
    this.a800 = hz(800);
    this.a1k5 = hz(1500);
    this.a3k = hz(3000);
    this.a6k = hz(6000);
    this.a11k = hz(11000);
    this.port.onmessage = (event) => {
      if (!event.data || !event.data.kind) return;
      const next = event.data.kind;
      if (next === this.kind) return;
      this.prevKind = this.kind;
      this.kind = next;
      this.xfade = 0;
    };
  }

  freshState() {
    return {
      brown: 0,
      dc: 0,
      b0: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      b4: 0,
      b5: 0,
      b6: 0,
      lp1: 0,
      lp2: 0,
      lp3: 0,
      lp4: 0,
      air: 0,
    };
  }

  rand() {
    let s = this.seed | 0;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  }

  // Linear in the middle — tanh on the whole mix was the crackle.
  limit(x) {
    const t = 0.86;
    if (x > t) return t + Math.tanh(x - t) * 0.12;
    if (x < -t) return -t + Math.tanh(x + t) * 0.12;
    return x;
  }

  lp(s, key, x, a) {
    s[key] += a * (x - s[key]);
    return s[key];
  }

  pink(s, white) {
    s.b0 = 0.99886 * s.b0 + white * 0.0555179;
    s.b1 = 0.99332 * s.b1 + white * 0.0750759;
    s.b2 = 0.969 * s.b2 + white * 0.153852;
    s.b3 = 0.8665 * s.b3 + white * 0.3104856;
    s.b4 = 0.55 * s.b4 + white * 0.5329522;
    s.b5 = -0.7616 * s.b5 - white * 0.016898;
    const out = (s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362) * 0.11;
    s.b6 = white * 0.115926;
    return out;
  }

  brown(s, white) {
    s.brown += white * 0.016;
    s.brown *= 0.995;
    s.dc += this.a20 * (s.brown - s.dc);
    return (s.brown - s.dc) * 4.2;
  }

  sample(kind, white) {
    const s = this.states[kind];
    if (kind === "white") {
      return this.lp(s, "lp1", white, this.a11k) * 0.7;
    }
    if (kind === "brown") return this.limit(this.brown(s, white) * 1.2);
    if (kind === "pink") return this.limit(this.pink(s, white) * 2.1);

    const pink = this.pink(s, white);
    const brown = this.brown(s, white);

    if (kind === "fan") {
      // Box fan: mid whoosh, faster blades, a little motor — not the same LPF as the others.
      const low = this.lp(s, "lp1", pink, this.a160);
      const mid = this.lp(s, "lp2", pink, this.a800);
      const body = mid - low;
      const presence = this.lp(s, "lp3", pink, this.a3k) - mid;
      const blades = 1 + 0.1 * Math.sin(this.phase * 23) + 0.035 * Math.sin(this.phase * 46);
      const motor = Math.sin(this.phase * 96) * (0.028 + 0.012 * low);
      return this.limit((low * 0.4 + body * 0.95 + presence * 0.22 + brown * 0.2 + motor) * blades * 2.25);
    }

    if (kind === "soft") {
      // Ceiling fan: slow, round, 3-pole dark — almost no hiss.
      const mix = pink * 0.5 + brown * 0.5;
      const a = this.lp(s, "lp1", mix, this.a160);
      const b = this.lp(s, "lp2", a, this.a160);
      const far = this.lp(s, "lp3", b, this.a350);
      const whoosh = 1 + 0.14 * Math.sin(this.phase * 5.2);
      return this.limit(far * whoosh * 2.45);
    }

    // AC: deep duct + separate smooth vent hiss + slow compressor pump.
    const deep = this.lp(s, "lp1", brown, this.a80);
    const duct = this.lp(s, "lp2", pink, this.a160);
    const duct2 = this.lp(s, "lp3", duct, this.a350);
    const smooth = this.lp(s, "air", white, this.a6k);
    const hiss = smooth - this.lp(s, "lp4", smooth, this.a1k5);
    const pump = 1 + 0.08 * Math.sin(this.slow);
    const hum = Math.sin(this.phase * 58) * (0.032 + 0.01 * deep);
    return this.limit((deep * 0.85 + duct2 * 0.28 + hiss * 0.32 + hum) * pump * 1.85);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const channel = output && output[0];
    if (!channel) return true;

    const phaseStep = (Math.PI * 2) / sampleRate;
    const slowStep = (Math.PI * 2 * 0.28) / sampleRate;
    for (let i = 0; i < channel.length; i++) {
      this.phase += phaseStep;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
      this.slow += slowStep;
      if (this.slow > Math.PI * 2) this.slow -= Math.PI * 2;
      const white = this.rand();
      let out = this.sample(this.kind, white);
      if (this.xfade < 1) {
        const prev = this.sample(this.prevKind, white);
        out = prev + (out - prev) * this.xfade;
        this.xfade = Math.min(1, this.xfade + this.xfadeInc);
      }
      channel[i] = out;
    }
    for (let c = 1; c < output.length; c++) output[c].set(channel);

    return true;
  }
}

registerProcessor("noise-processor", NoiseProcessor);
