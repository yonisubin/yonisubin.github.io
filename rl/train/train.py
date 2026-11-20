"""PPO with a curriculum on the mini-GTA city (see rl/README.md).

    rl/.venv/bin/python rl/train/train.py --steps 6e6 --run runs/main
"""
import argparse
import json
import os
import time

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import VecNormalize

from node_vec_env import NodeVecEnv

STAGES = ["1 straight lanes", "2 curves + single junctions", "3 random city routes",
          "4 stopped cars ahead", "5 traffic", "6 traffic lights"]


class Curriculum(BaseCallback):
    """Log outcome rates; move to the next stage when the success rate passes the bar;
    save a checkpoint (policy + normalisation) every `every` steps."""

    def __init__(self, venv, raw, run, every, bar=0.8, min_steps=300_000):
        super().__init__()
        self.venv, self.raw, self.run, self.every, self.bar, self.min_steps = venv, raw, run, every, bar, min_steps
        self.next_ckpt = every
        self.stage_start = 0
        self.history = []
        self.t0 = time.time()

    def _on_step(self):
        return True

    def save(self, name):
        path = os.path.join(self.run, "checkpoints", name)
        self.model.save(path)
        self.venv.save(path + "_vecnorm.pkl")

    def _on_rollout_end(self):
        n = self.num_timesteps
        rates = self.raw.rates()
        for k, v in rates.items():
            self.logger.record(f"outcome/{k}", v)
        self.logger.record("curriculum/stage", self.raw.stage + 1)
        sps = n / (time.time() - self.t0)
        self.logger.record("time/total_sps", sps)
        row = {"steps": n, "stage": self.raw.stage + 1, "sps": round(sps), **{k: round(v, 3) for k, v in rates.items()}}
        self.history.append(row)
        with open(os.path.join(self.run, "progress.jsonl"), "a") as f:
            f.write(json.dumps(row) + "\n")
        print(row, flush=True)
        if n >= self.next_ckpt:
            self.save(f"step_{n // 1000:06d}k")
            self.next_ckpt += self.every
        full = len(self.raw.recent) >= self.raw.recent.maxlen
        if (full and rates.get("success", 0) >= self.bar and n - self.stage_start >= self.min_steps
                and self.raw.stage < len(STAGES) - 1):
            self.save(f"stage{self.raw.stage + 1}_done_{n // 1000:06d}k")
            self.raw.set_stage(self.raw.stage + 1)
            self.stage_start = n
            print(f"=== stage {self.raw.stage + 1}: {STAGES[self.raw.stage]} at {n} steps", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=float, default=6e6)
    ap.add_argument("--run", default="runs/main")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--cars", type=int, default=16)
    ap.add_argument("--stage", type=int, default=0)
    ap.add_argument("--ckpt-every", type=float, default=250_000)
    ap.add_argument("--resume", default=None)
    ap.add_argument("--ent", type=float, default=0.0)
    args = ap.parse_args()
    torch.set_num_threads(1)
    run = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), args.run)
    os.makedirs(os.path.join(run, "checkpoints"), exist_ok=True)

    raw = NodeVecEnv(workers=args.workers, cars=args.cars, seed=1, stage=args.stage)
    if args.resume:
        venv = VecNormalize.load(args.resume + "_vecnorm.pkl", raw)
        model = PPO.load(args.resume, env=venv, tensorboard_log=os.path.join(run, "tb"), custom_objects={"ent_coef": args.ent})
    else:
        venv = VecNormalize(raw, norm_obs=True, norm_reward=True, clip_obs=10.0, gamma=0.99)
        model = PPO(
            "MlpPolicy", venv,
            n_steps=256, batch_size=4096, n_epochs=5, learning_rate=3e-4,
            gamma=0.99, gae_lambda=0.95, clip_range=0.2, ent_coef=args.ent, vf_coef=0.5, max_grad_norm=0.5,
            policy_kwargs=dict(net_arch=dict(pi=[256, 256], vf=[256, 256]), activation_fn=torch.nn.Tanh, log_std_init=-0.5),
            tensorboard_log=os.path.join(run, "tb"), verbose=0, seed=1,
        )
    cb = Curriculum(venv, raw, run, int(args.ckpt_every))
    cb.model = model
    cb.next_ckpt = (model.num_timesteps // cb.every + 1) * cb.every
    if not args.resume:
        cb.save("step_000000k")
    try:
        model.learn(total_timesteps=int(args.steps), callback=cb, reset_num_timesteps=not args.resume)
    finally:
        cb.save("final")
        raw.close()


if __name__ == "__main__":
    main()
