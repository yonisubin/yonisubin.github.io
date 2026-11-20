"""SB3 VecEnv over Node simulation workers (rl/sim/worker.ts).

Each worker runs one city with N learning cars that share the policy (parameter sharing),
so W workers give W*N environment slots. Workers step in parallel: actions go out to all of
them first, then the results are read back.
"""
import os
import subprocess
from collections import deque

import gymnasium as gym
import numpy as np
from stable_baselines3.common.vec_env.base_vec_env import VecEnv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, "dist", "worker.mjs")
OBS_SIZE = 71
INFO_SIZE = 7
INFO_KEYS = ["success", "crash", "offroad", "red_light", "timeout", "progress", "length"]


class NodeVecEnv(VecEnv):
    def __init__(self, workers=3, cars=16, seed=0, stage=0, area="train", randomize=True):
        self.cars = cars
        self.procs = []
        for w in range(workers):
            args = ["node", WORKER, str(cars), str(seed * 1000 + w + 1), str(stage), area, "1" if randomize else "0"]
            self.procs.append(subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE))
        n = workers * cars
        obs_space = gym.spaces.Box(-np.inf, np.inf, (OBS_SIZE,), np.float32)
        act_space = gym.spaces.Box(-1.0, 1.0, (2,), np.float32)
        super().__init__(n, obs_space, act_space)
        self.result_floats = cars * (OBS_SIZE * 2 + 2 + INFO_SIZE)
        self.ep_return = np.zeros(n, np.float64)
        self.ep_len = np.zeros(n, np.int64)
        self.recent = deque(maxlen=400)  # info dicts of finished episodes
        self.stage = stage
        self._actions = None

    def _read(self, p, nbytes):
        data = b""
        while len(data) < nbytes:
            chunk = p.stdout.read(nbytes - len(data))
            if not chunk:
                raise RuntimeError("simulation worker exited")
            data += chunk
        return data

    def _result(self, p):
        a = np.frombuffer(self._read(p, self.result_floats * 4), dtype=np.float32)
        c = self.cars
        k = 0
        obs = a[k:k + c * OBS_SIZE].reshape(c, OBS_SIZE); k += c * OBS_SIZE
        rew = a[k:k + c]; k += c
        done = a[k:k + c] > 0.5; k += c
        info = a[k:k + c * INFO_SIZE].reshape(c, INFO_SIZE); k += c * INFO_SIZE
        term = a[k:k + c * OBS_SIZE].reshape(c, OBS_SIZE)
        return obs, rew, done, info, term

    def reset(self):
        for p in self.procs:
            p.stdin.write(b"O")
            p.stdin.flush()
        obs = [self._result(p)[0] for p in self.procs]
        self.ep_return[:] = 0
        self.ep_len[:] = 0
        return np.concatenate(obs).copy()

    def set_stage(self, stage):
        self.stage = stage
        for p in self.procs:
            p.stdin.write(b"G" + np.int32(stage).tobytes())
            p.stdin.flush()
        for p in self.procs:
            self._read(p, 1)
        self.recent.clear()

    def step_async(self, actions):
        acts = np.asarray(actions, dtype=np.float32).reshape(len(self.procs), self.cars * 2)
        for p, a in zip(self.procs, acts):
            p.stdin.write(b"S" + a.tobytes())
            p.stdin.flush()

    def step_wait(self):
        parts = [self._result(p) for p in self.procs]
        obs = np.concatenate([x[0] for x in parts]).copy()
        rew = np.concatenate([x[1] for x in parts]).astype(np.float32)
        done = np.concatenate([x[2] for x in parts])
        info = np.concatenate([x[3] for x in parts])
        term = np.concatenate([x[4] for x in parts])
        self.ep_return += rew
        self.ep_len += 1
        infos = [{} for _ in range(self.num_envs)]
        for i in np.nonzero(done)[0]:
            d = {k: float(v) for k, v in zip(INFO_KEYS, info[i])}
            infos[i] = {
                "terminal_observation": term[i].copy(),
                "TimeLimit.truncated": bool(d["timeout"]),
                "episode": {"r": float(self.ep_return[i]), "l": int(self.ep_len[i])},
                "outcome": d,
            }
            self.recent.append(d)
            self.ep_return[i] = 0
            self.ep_len[i] = 0
        return obs, rew, done, infos

    def rates(self):
        if not self.recent:
            return {}
        return {k: float(np.mean([r[k] for r in self.recent])) for k in INFO_KEYS[:6]}

    def close(self):
        for p in self.procs:
            try:
                p.stdin.write(b"Q")
                p.stdin.flush()
            except Exception:
                pass
            p.wait(timeout=5)

    # The rest of the VecEnv interface (unused here).
    def get_attr(self, attr_name, indices=None):
        return [getattr(self, attr_name)] * self.num_envs

    def set_attr(self, attr_name, value, indices=None):
        setattr(self, attr_name, value)

    def env_method(self, method_name, *args, indices=None, **kwargs):
        return [None] * self.num_envs

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs

    def seed(self, seed=None):
        return [None] * self.num_envs
