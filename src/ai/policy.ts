// The trained driver in the browser (or Node): a plain forward pass of the exported policy
// network (rl/train/export.py), batched over every car. The network is small (71 → 256 → 256
// → 2), so this is a fraction of a millisecond per car with no runtime dependency.

export interface PolicyWeights {
  obsMean: number[];
  obsStd: number[];
  clip: number;
  layers: { in: number; out: number; w: number[]; b: number[]; act: 'tanh' | 'none' }[];
  steps: number;
}

export class Policy {
  /** Load the compact binary written by rl/train/export.py (see the format there). */
  static fromBinary(buf: ArrayBuffer): Policy {
    const head = new Int32Array(buf, 0, 5);
    if (head[0] !== 0x31444c52 || head[1] !== 1) throw new Error('not a driver policy file');
    const inputs = head[2];
    const n = head[3];
    const dims = new Int32Array(buf, 20, n * 3);
    const f = new Float32Array(buf, 20 + n * 12);
    let k = 0;
    const take = (len: number) => {
      const a = Array.from(f.subarray(k, k + len));
      k += len;
      return a;
    };
    const obsMean = take(inputs);
    const obsStd = take(inputs);
    const clip = take(1)[0];
    const layers: PolicyWeights['layers'] = [];
    for (let i = 0; i < n; i++) {
      const [lin, lout, tanh] = [dims[i * 3], dims[i * 3 + 1], dims[i * 3 + 2]];
      layers.push({ in: lin, out: lout, w: take(lin * lout), b: take(lout), act: tanh ? 'tanh' : 'none' });
    }
    return new Policy({ obsMean, obsStd, clip, layers, steps: head[4] * 1000 });
  }

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

  /**
   * One car's action (steering, throttle) into out[0..1]: the hot path in the game, with
   * per-layer buffers and a 4-way unrolled dot product (~4× faster than a plain loop in V8).
   */
  act1(obs: Float32Array, out: Float32Array): Float32Array {
    const dim = this.mean.length;
    if (!this.single) {
      this.single = this.layers.map((l) => new Float64Array(l.out));
      this.w64 = this.layers.map((l) => Float64Array.from(l.w));
    }
    let x: Float64Array = this.input1 ?? (this.input1 = new Float64Array(dim));
    const c = this.weights.clip;
    for (let j = 0; j < dim; j++) {
      const v = (obs[j] - this.mean[j]) / this.std[j];
      x[j] = v < -c ? -c : v > c ? c : v;
    }
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      const y = this.single[li];
      const w = this.w64![li];
      const n = L.in;
      const n4 = n - (n % 4);
      for (let o = 0; o < L.out; o++) {
        const base = o * n;
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        let s3 = 0;
        let i = 0;
        for (; i < n4; i += 4) {
          s0 += w[base + i] * x[i];
          s1 += w[base + i + 1] * x[i + 1];
          s2 += w[base + i + 2] * x[i + 2];
          s3 += w[base + i + 3] * x[i + 3];
        }
        let s = L.b[o] + s0 + s1 + s2 + s3;
        for (; i < n; i++) s += w[base + i] * x[i];
        y[o] = L.tanh ? Math.tanh(s) : s;
      }
      x = y;
    }
    out[0] = Math.max(-1, Math.min(1, x[0]));
    out[1] = Math.max(-1, Math.min(1, x[1]));
    return out;
  }

  private single: Float64Array[] | null = null;
  private w64: Float64Array[] | null = null;
  private input1: Float64Array | null = null;

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
