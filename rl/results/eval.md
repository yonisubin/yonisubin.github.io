### Empty roads (random city routes)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 87.5% | 2 | 0 | 0 | 3 | 0.15 | 67% | 0.0% | 0.24 | 0.06 | 0.001 |

40 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

### Heavy traffic (rule-based cars, stopped cars, traffic lights)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 70.0% | 2 | 0 | 1 | 9 | 0.16 | 46% | 0.0% | 0.27 | 0.05 | 0.001 |

40 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).
