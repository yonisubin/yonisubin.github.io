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
