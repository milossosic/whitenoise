class NoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kind = "white";
    this.brown = 0;
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.b3 = 0;
    this.b4 = 0;
    this.b5 = 0;
    this.b6 = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.kind) this.kind = event.data.kind;
    };
  }

  process(_inputs, outputs) {
    const channel = outputs[0] && outputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const white = Math.random() * 2 - 1;
      let sample = white * 0.45;

      if (this.kind === "brown") {
        this.brown += white * 0.02;
        this.brown *= 0.996;
        sample = Math.max(-1, Math.min(1, this.brown * 3.5));
      } else if (this.kind === "pink") {
        this.b0 = 0.99886 * this.b0 + white * 0.0555179;
        this.b1 = 0.99332 * this.b1 + white * 0.0750759;
        this.b2 = 0.969 * this.b2 + white * 0.153852;
        this.b3 = 0.8665 * this.b3 + white * 0.3104856;
        this.b4 = 0.55 * this.b4 + white * 0.5329522;
        this.b5 = -0.7616 * this.b5 - white * 0.016898;
        sample =
          (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362) *
          0.11;
        this.b6 = white * 0.115926;
      }

      channel[i] = sample;
    }

    return true;
  }
}

registerProcessor("noise-processor", NoiseProcessor);
