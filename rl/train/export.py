"""Export a checkpoint's deterministic policy (the mean action) for the browser.

    rl/.venv/bin/python rl/train/export.py runs/main/checkpoints/final rl/policies/final

Writes <out>.json (weights for rl/sim/policy.ts, a plain TypeScript forward pass) and
<out>.onnx (for onnxruntime-web when the drivers go into the game). The observation
normalisation (VecNormalize) is baked into both, so the input is the raw observation.
"""
import json
import pickle
import sys

import numpy as np
import torch
from stable_baselines3 import PPO


class Exported(torch.nn.Module):
    def __init__(self, policy, mean, std, clip):
        super().__init__()
        self.net = policy.mlp_extractor.policy_net
        self.head = policy.action_net
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.tensor(std, dtype=torch.float32))
        self.clip = clip

    def forward(self, obs):
        x = torch.clamp((obs - self.mean) / self.std, -self.clip, self.clip)
        return torch.clamp(self.head(self.net(x)), -1.0, 1.0)


def main(ckpt, out):
    model = PPO.load(ckpt, device="cpu")
    with open(ckpt + "_vecnorm.pkl", "rb") as f:
        vn = pickle.load(f)
    mean = vn.obs_rms.mean.astype(np.float32)
    std = np.sqrt(vn.obs_rms.var + vn.epsilon).astype(np.float32)
    layers = []
    mods = [m for m in model.policy.mlp_extractor.policy_net if isinstance(m, torch.nn.Linear)] + [model.policy.action_net]
    for i, m in enumerate(mods):
        layers.append({
            "in": m.in_features, "out": m.out_features,
            "w": [round(float(v), 6) for v in m.weight.detach().numpy().ravel()],
            "b": [round(float(v), 6) for v in m.bias.detach().numpy()],
            "act": "tanh" if i < len(mods) - 1 else "none",
        })
    data = {"obsMean": mean.tolist(), "obsStd": std.tolist(), "clip": float(vn.clip_obs), "layers": layers,
            "steps": int(model.num_timesteps)}
    with open(out + ".json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    m = Exported(model.policy, mean, std, vn.clip_obs).eval()
    torch.onnx.export(m, torch.zeros(1, len(mean)), out + ".onnx", input_names=["obs"], output_names=["action"],
                      dynamic_axes={"obs": {0: "cars"}, "action": {0: "cars"}}, dynamo=False)
    # Check: the JSON forward pass in numpy matches torch.
    x = np.random.randn(4, len(mean)).astype(np.float32) * std + mean
    h = np.clip((x - mean) / std, -vn.clip_obs, vn.clip_obs)
    for L in layers:
        h = h @ np.array(L["w"]).reshape(L["out"], L["in"]).T + np.array(L["b"])
        if L["act"] == "tanh":
            h = np.tanh(h)
    ref = m(torch.tensor(x)).detach().numpy()
    print(out, "steps", model.num_timesteps, "max diff", float(np.abs(np.clip(h, -1, 1) - ref).max()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
