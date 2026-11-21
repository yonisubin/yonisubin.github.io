# RL drivers

AI drivers for the game, trained with reinforcement learning inside the game's own world. The
driver is never told how to steer: it gets a reward for making progress along a route and
penalties for crashing, leaving the road, speeding and running red lights, and works out
driving from millions of attempts. The trained network drives the NPC traffic near the player
and the car autopilot (`src/npc/traffic.ts`, `src/game/autopilot.ts`).

Only measured numbers appear below.

## How it fits together

```
 rl/train (Python, PPO)  ⇄ stdin/stdout ⇄  rl/sim/worker.ts (Node) × 3
   stable-baselines3                       one city, 16 learning cars, Rapier physics,
   VecNormalize, curriculum                rule-based traffic, traffic lights
        │
        └─ export.py → policy.bin ──► public/assets/ai/driver.bin ──► src/ai/policy.ts (browser)
```

- **Same world, same car, same inputs.** The simulator builds the game's seeded city
  (`src/world/layout.ts`, `streets.ts`, `roadGraph.ts`, `terrain.ts`) with no three.js: a
  Rapier heightfield of the road-level terrain plus every building as a box. Cars use
  `src/sim/carDynamics.ts`, the physics of the car the player drives (checked bit-for-bit
  against the pre-extraction car in `rl/tests/car_reference.json`). The observation is built by
  one function, `src/ai/observe.ts`, in training and in the game.
- **Route vs driving.** A route (random in training, A* over lanes for the autopilot, the
  traffic planner's next pieces for NPCs) is a polyline in the right-hand lane
  (`src/ai/path.ts`). The policy learns to follow it, not where to go.
- **Observation (71 numbers, roughly −1…1):** speed, sideways slip, yaw rate, wheel angle;
  six route waypoints 4–45 m ahead in the car's frame; lane offset and heading error; the
  road's and the next 40 m of curves' speed limits; 15 rays over 180° (distance, car or not,
  closing speed — a cheap radar); the next traffic light within 60 m (distance, red, yellow);
  the last action.
- **Action:** steering and throttle/brake, −1…1, decided every 4 physics steps (15 Hz). The
  steering command is low-passed (`src/ai/driver.ts` `smoothAction`: 40 % of the way to the
  new value each decision, τ ≈ 0.13 s) in training and in the game alike.
- **Network:** 71 → 256 → 256 → 2 (tanh), shared by all cars (parameter sharing). Deterministic
  mean action at run time. ~340 KB as `driver.bin`.

## Reward (per decision)

| Term | Value | Why |
|---|---|---|
| Progress along the route | +0.1 per m | The main signal (projection onto the route: circling or reversing earns nothing) |
| Over the road's speed limit | −0.05 per m/s | Drive legally, not just fast |
| Distance from lane centre | −0.02 per m | Keep to the lane |
| Change of steering | −0.1 per unit (was 0.02) | Smooth driving |
| Steering and turning where the route is straight | −0.08 × straightness × (\|steer\| + ½ \|yaw rate\|) | No swaying on straights (failure 6) |
| Time | −0.01 | Don't dawdle |
| Standing still with no reason (not at a red's stop line, nothing close ahead *in its lane*) | −0.05 | Failures 1 and 7 |
| Closing on a car ahead in its lane, time-to-collision < 2.5 s | up to −0.15 | See failure 4 |
| Too fast to stop for a red light ahead | up to −0.15 | See failure 5 |
| Crash (not when rear-ended) | −30, ends | |
| Off the road / > 6 m off the route | −20, ends | |
| Running a red light (stage 6) | −20, ends | |
| Arriving | +10, ends | |

Episodes: a random route of 120 m – 700 m, a time limit of 20 s + length / 3.5 m/s (at most
2 min). Each car's mass, engine power and tyre grip are randomised ±10–15 % and the sensors get
1 % noise, so the policy doesn't overfit one car.

## Curriculum

The stage advances when ≥ 80 % of the last 400 episodes reach their destination (and the
stage has had at least 300 k steps).

| Stage | Reached at (steps, final run) |
|---|---|
| 1 Straight lanes | 0 |
| 2 Curves and single junctions | 307 k |
| 3 Random city routes (whole city) | 946 k |
| 4 Stopped / slow cars ahead on the route | 1.25 M |
| 5 Traffic: 16 learners meet near a hub + 10 rule-based cars | 7.48 M |
| 6 Traffic lights enforced (later split: lights without the crowd, then 7 traffic + lights) | 8.00 M (not passed) |

**Where it ended up.** Stages 1–5 passed the 80 % bar; stage 6 (lights) did not. The
shipped policy is the one that finished stage 5 (`stage5_done`, 8.0 M steps), fine-tuned on
stage 5 for 6 M more steps with the sway and lane fixes below (`runs/v3`, 14.0 M steps). Training went
on to 17.3 M steps on the traffic-light stages without passing (55–65 % success with 25–35 %
of episodes running a red, flat over the last ~2 M steps), and the 17.3 M checkpoint is no
better on the evaluation below, so it wasn't shipped. In the game, red lights are still obeyed:
the traffic's rule layer brakes for them and the autopilot's safety layer does too. Learning
lights is the main open item (see "Next").

## Reward hacking and other failures (and the fixes)

1. **Parking at junctions.** The deterministic policy stopped when a light turned red (often
   30–50 m early) and never moved off again, even on green: its mean action at a standstill was
   "don't move", and standing still only cost −0.01 a step. Fix: an idle penalty, only when
   there is no reason to wait (no red/yellow within 40 m, nothing within 12 m ahead).
2. **Timeouts that weren't the driver's fault.** Downtown routes (right-angle turns, lights)
   timed out even for the hand-written baseline at the original limit (an average of 5 m/s).
   Fix: 20 s + length / 3.5 m/s. Stage-2 success went from ~73 % to ~98 % at once.
3. **Physics: sleeping cars.** Rapier puts a stopped body to sleep and engine force doesn't
   wake it, so a car waiting at a light never moved again. Fix: wake learners every decision.
   Also: narrow local streets' right turns are tighter than the car's turning circle, so
   "leaving the road" is judged by the road surface, not a strict lane band.
4. **Rear-ending stopped cars (stage 4 plateau at ~76 % for 4 M steps).** 23 of 26 crashes were
   into a car ahead. The policy sees one frame at a time, and distances alone can't tell a
   stopped car from one driving away, so it learned a middling, too-gentle brake. Fixes: a
   closing speed per ray (radar) in the observation — a retrain from scratch — and a dense
   time-to-collision penalty. Stage 4 then passed within ~0.2 M steps.
5. **Running red lights (stage 6 stuck at 35–70 % violations).** In 96 of 118 violations the
   car could have stopped. Cause: any contact ended a learner's episode as a crash, so a
   learner that stopped at a red was often rear-ended by another learner — a −30 crash —
   which is worse than the −20 for running the light. Stopping was being punished. Fixes tried:
   being rear-ended is not the learner's fault (no penalty, the episode goes on); a dense
   penalty for approaching a red too fast to stop; the amber rule (a yellow you could still
   stop for counts as red — the traces showed it speeding up on yellow); lights first without
   the crowd of learners (stage 6 / 7 split). Violations came down from ~50 % to ~28 % but the
   stage never passed; the network does react to the light (throttle −0.11 on red vs +0.69 on
   green in the same states) but brakes too late and too softly. Still open.

6. **Swaying on straights** (Yoni's review of the clips). The steering command flickered from
   one decision to the next (3.1 units of steering change per second vs 0.06 for the baseline).
   A sway penalty on straights alone barely moved it (2.8 after 3 M steps). Fix: low-pass the
   steering command as part of the driver (training, traffic and autopilot), then fine-tune
   with it in the loop: weaving on straights 0.33 → 0.09 rad/s (empty roads), steering change
   1.7 → 0.6 /s, with *more* routes completed.
7. **Waiting behind a car in the next lane** at a red light, short of a free stop line. Every
   training car drove the inner lane, so the policy had never seen a car in the next lane, and
   standing still was excused near any red within 40 m. Fixes: half the training traffic drives
   the outer lane on two-lane roads; waiting is excused only at the stop line or behind
   something in its own lane (hit points projected onto the route); the autopilot's safety
   brake uses the same own-lane test. The gap to the line at a red with a clear lane went from
   11.9 m to 9.4 m (baseline 4.3 m): better, not solved.

## Evaluation

200 fixed, seeded routes per set, all starting in the south-east of the city, where training
never starts a route. "Heavy traffic" is stage-6 conditions with 18 rule-based cars, stopped
cars on the route and enforced lights. Numbers from `rl/results/eval.md`:

#### Empty roads (random city routes)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Weave (yaw rate RMS on straights, rad/s) | Gap to the line at a red, clear lane (m) | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 98.0% | 2 | 0 | 0 | 2 | 0.03 | 67% | 0.0% | 0.24 | 0.07 | 0.035 | 0.6 | 0.001 |
| RL (8.0M steps) | 96.5% | 0 | 7 | 0 | 0 | 0.00 | 97% | 7.0% | 0.53 | 1.71 | 0.330 | – | 0.193 |
| RL (14.0M steps) | 98.0% | 0 | 4 | 0 | 0 | 0.00 | 94% | 1.3% | 0.53 | 0.57 | 0.087 | – | 0.194 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

#### Heavy traffic (rule-based cars, stopped cars, traffic lights)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Weave (yaw rate RMS on straights, rad/s) | Gap to the line at a red, clear lane (m) | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 79.5% | 19 | 0 | 3 | 19 | 0.39 | 43% | 0.0% | 0.24 | 0.06 | 0.041 | 4.3 | 0.001 |
| RL (8.0M steps) | 60.5% | 30 | 13 | 32 | 4 | 0.76 | 64% | 2.8% | 0.71 | 2.28 | 0.477 | 11.9 | 0.197 |
| RL (14.0M steps) | 66.0% | 25 | 2 | 36 | 5 | 0.67 | 65% | 0.6% | 0.85 | 1.15 | 0.163 | 9.4 | 0.199 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

**Reading it honestly:** the shipped policy is "RL (14.0M steps)" (stage 5 + the smoothing
fine-tune). On empty roads it matches the baseline's completion (98 %) with no crashes, at 94 %
of the limit against the baseline's 67 %. In heavy traffic the baseline still completes more
routes (79.5 % vs 66 %) and crashes less per km; the RL driver almost never times out where
the baseline does 19 times, but it runs red lights (it never passed the lights stage — in the
game, the safety layers stop it) and waits further back from the line. It still weaves more
than the baseline (0.09 vs 0.035 rad/s on straights), far less than before.

The baseline is a hand-written pure-pursuit steering controller (aim at a point 4 m + 0.4 s
ahead on the route) with a proportional speed controller toward the road and curve limits,
raycast braking, and stopping for red lights (`src/ai/baseline.ts`).

## In the game

- **NPC traffic** (`src/npc/traffic.ts`): cars within 130 m of the player are physics cars
  driven by the network; the existing rule-based planner still chooses turns, lanes and
  overtakes, and acts as a safety layer: when the rules brake harder than 0.8 m/s² (stop signs,
  cars crossing a junction, the player in the road — things the network never trained on),
  their braking wins. Further away, or where the ground isn't loaded, cars drive kinematically
  as before. `?ai=0` turns the AI off.
- **Autopilot** (`src/game/autopilot.ts`): buy it at a gun store (`AUTOPILOT_PRICE`, $50 for
  testing), set a destination on the map, press O (AUTO on touch) in any car.
- **Cost:** a decision is ~0.1 ms per car in Node (network 0.08 ms with the unrolled float64
  forward pass, 15 rays 0.02 ms). In the game, about +0.8 ms per physics step for ~15 AI cars,
  measured in headless Chromium while training was using the CPU.

## Next

- **Lights.** Splitting stage 6 (lights without the crowd first) and the amber rule didn't get
  it over the bar in ~3 M steps. Things to try: a frame of memory (previous rays / light state)
  or a recurrent policy, a longer discount horizon (γ = 0.995; at 15 Hz γ = 0.99 discounts a
  12 s wait to 11 %), and a lights stage from the start of the curriculum.
- **Smoothness.** Longer training with the higher steering penalty, or a steering-rate action.
- **Stop signs and pedestrians** in the simulator (the game's rule layer handles them now).

## Running it

```bash
# Python trainer (once)
python3 -m venv rl/.venv
rl/.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
rl/.venv/bin/pip install -r rl/requirements.txt

npm run rl:build                       # TypeScript sim → rl/dist/*.mjs (rolldown)
node rl/dist/test_sim.mjs              # car physics = game car; simulator deterministic
node rl/dist/bench.mjs                 # throughput
node rl/dist/check_baseline.mjs        # the baseline on every stage

rl/.venv/bin/python rl/train/train.py --steps 25e6 --run runs/main     # curriculum from stage 1
rl/.venv/bin/python rl/train/train.py --run runs/main --stage 5 --resume rl/runs/main/checkpoints/<ckpt>
rl/.venv/bin/tensorboard --logdir rl/runs

rl/.venv/bin/python rl/train/export.py rl/runs/main/checkpoints/<ckpt> rl/policies/final
cp rl/policies/final.bin public/assets/ai/driver.bin                  # into the game
node rl/dist/eval.mjs rl/policies/final.json                           # → rl/results/eval.md

npm run rl:viewer                      # http://localhost:5190/?policy=<name>&stage=6&sensors=1
node rl/record/record.cjs <name> "<viewer query>" <seconds>            # viewer clip
node rl/record/game.cjs <name> <seconds> [metres]                      # in-game autopilot clip
```

Throughput (this machine, 4 cores): one simulation worker runs ~4,000–5,600 car decisions/s
(16–22 k car physics steps/s); training with 3 workers × 16 cars runs ~4,000–5,000 steps/s
including PPO updates.
