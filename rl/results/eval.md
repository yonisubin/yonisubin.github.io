### Empty roads (random city routes)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 98.0% | 2 | 0 | 0 | 2 | 0.03 | 67% | 0.0% | 0.26 | 0.06 | 0.001 |
| RL (8.0M steps) | 95.5% | 0 | 9 | 0 | 0 | 0.00 | 95% | 7.1% | 0.48 | 3.10 | 0.254 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

### Heavy traffic (rule-based cars, stopped cars, traffic lights)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 75.5% | 11 | 0 | 5 | 33 | 0.17 | 43% | 0.0% | 0.23 | 0.04 | 0.001 |
| RL (8.0M steps) | 68.5% | 24 | 7 | 30 | 2 | 0.82 | 63% | 3.2% | 0.64 | 3.01 | 0.216 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).
