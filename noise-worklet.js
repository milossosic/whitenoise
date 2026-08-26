class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kind = "white";
    this.prevKind = "white";
    this.xfade = 1;
    this.xfadeInc = 1 / (sampleRate * 0.09);
    this.phase = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    this.states = {
      white: this.freshState(),
      brown: this.freshState(),
      pink: this.freshState(),
      fan: this.freshState(),
      soft: this.freshState(),
      ac: this.freshState(),
    };
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
      hp: 0,
      mid: 0,
    };
  }

  rand() {
    let s = this.seed | 0;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return (s >>> 0) / 4294967296 * 2 - 1;
  }

  soft(x) {
    return Math.tanh(x);
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
    s.brown += white * 0.02;
    s.brown *= 0.996;
    return s.brown * 3.2;
  }

  band(s, input, lowA, midA) {
    s.lp1 += lowA * (input - s.lp1);
    s.lp2 += midA * (input - s.lp2);
    s.hp += 0.02 * ((input - s.lp1) - s.hp);
    s.mid += midA * ((input - s.lp2) - s.mid);
    return s;
  }

  sample(kind, white) {
    const s = this.states[kind];
    if (kind === "brown") return this.soft(this.brown(s, white));
    if (kind === "pink") return this.soft(this.pink(s, white));
    if (kind === "white") return white * 0.42;

    const pink = this.pink(s, white);
    const brown = this.brown(s, white);

    if (kind === "fan") {
      this.band(s, pink, 0.012, 0.05);
      const flutter = 1 + 0.07 * Math.sin(this.phase * 28);
      const whoosh = s.mid * 0.55 + s.hp * 0.2;
      const rumble = brown * 0.22 + s.lp1 * 0.35;
      return this.soft((rumble + whoosh) * flutter * 0.95);
    }

    if (kind === "soft") {
      this.band(s, pink, 0.006, 0.028);
      const flutter = 1 + 0.045 * Math.sin(this.phase * 18);
      const air = s.lp1 * 0.55 + s.mid * 0.28 + brown * 0.18;
      return this.soft(air * flutter * 1.05);
    }

    // ac — deeper HVAC / room vent
    this.band(s, pink * 0.7 + white * 0.3, 0.004, 0.02);
    const throb = 1 + 0.035 * Math.sin(this.phase * 12);
    const hiss = s.mid * 0.22 + s.hp * 0.08;
    const deep = brown * 0.45 + s.lp1 * 0.5;
    return this.soft((deep + hiss) * throb * 0.9);
  }

  process(_inputs, outputs) {
    const channel = outputs[0] && outputs[0][0];
    if (!channel) return true;

    const phaseStep = (Math.PI * 2) / sampleRate;
    for (let i = 0; i < channel.length; i++) {
      this.phase += phaseStep;
      if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
      const white = this.rand();
      let out = this.sample(this.kind, white);
      if (this.xfade < 1) {
        const prev = this.sample(this.prevKind, white);
        out = prev + (out - prev) * this.xfade;
        this.xfade = Math.min(1, this.xfade + this.xfadeInc);
      }
      channel[i] = out;
    }

    return true;
  }
}

registerProcessor("noise-processor", NoiseProcessor);
