// The trained driver in the browser (or Node): a plain forward pass of the exported policy
// network (rl/train/export.py), batched over every car. The network is small (56 → 256 → 256
// → 2), so this is a fraction of a millisecond per car with no runtime dependency.

export interface PolicyWeights {
  obsMean: number[];
  obsStd: number[];
  clip: number;
  layers: { in: number; out: number; w: number[]; b: number[]; act: 'tanh' | 'none' }[];
  steps: number;
}

export class Policy {
  private readonly layers: { in: number; out: number; w: Float32Array; b: Float32Array; tanh: boolean }[];
  private readonly mean: Float32Array;
  private readonly std: Float32Array;
  private bufA = new Float32Array(0);
  private bufB = new Float32Array(0);

  constructor(readonly weights: PolicyWeights) {
    this.mean = new Float32Array(weights.obsMean);
    this.std = new Float32Array(weights.obsStd);
    this.layers = weights.layers.map((l) => ({ in: l.in, out: l.out, w: new Float32Array(l.w), b: new Float32Array(l.b), tanh: l.act === 'tanh' }));
  }

  /** Actions (cars × 2, each −1..1) for observations (cars × OBS_SIZE). Deterministic: the mean. */
  act(obs: Float32Array, cars: number, out: Float32Array): Float32Array {
    const dim = this.mean.length;
    const width = Math.max(dim, ...this.layers.map((l) => l.out));
    if (this.bufA.length < cars * width) {
      this.bufA = new Float32Array(cars * width);
      this.bufB = new Float32Array(cars * width);
    }
    let x = this.bufA;
    let y = this.bufB;
    const c = this.weights.clip;
    for (let k = 0; k < cars; k++) {
      for (let j = 0; j < dim; j++) {
        const v = (obs[k * dim + j] - this.mean[j]) / this.std[j];
        x[k * width + j] = v < -c ? -c : v > c ? c : v;
      }
    }
    for (const L of this.layers) {
      for (let k = 0; k < cars; k++) {
        const xo = k * width;
        for (let o = 0; o < L.out; o++) {
          let s = L.b[o];
          const wo = o * L.in;
          for (let i = 0; i < L.in; i++) s += L.w[wo + i] * x[xo + i];
          y[xo + o] = L.tanh ? Math.tanh(s) : s;
        }
      }
      const t = x;
      x = y;
      y = t;
    }
    for (let k = 0; k < cars; k++) {
      out[k * 2] = Math.max(-1, Math.min(1, x[k * width]));
      out[k * 2 + 1] = Math.max(-1, Math.min(1, x[k * width + 1]));
    }
    return out;
  }
}
