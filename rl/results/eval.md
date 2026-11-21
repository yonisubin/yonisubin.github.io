### Empty roads (random city routes)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 98.0% | 2 | 0 | 0 | 2 | 0.03 | 67% | 0.0% | 0.26 | 0.06 | 0.001 |
| RL (8.0M steps) | 95.5% | 0 | 9 | 0 | 0 | 0.00 | 95% | 7.1% | 0.48 | 3.10 | 0.192 |
| RL (11.0M steps) | 97.0% | 0 | 6 | 0 | 0 | 0.00 | 96% | 11.9% | 0.48 | 2.76 | 0.186 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

### Heavy traffic (rule-based cars, stopped cars, traffic lights)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 81.5% | 17 | 0 | 2 | 18 | 0.34 | 45% | 0.0% | 0.26 | 0.05 | 0.001 |
| RL (8.0M steps) | 67.0% | 24 | 8 | 32 | 2 | 0.72 | 63% | 3.3% | 0.76 | 2.90 | 0.190 |
| RL (11.0M steps) | 67.0% | 31 | 6 | 28 | 1 | 0.89 | 63% | 5.8% | 0.57 | 2.65 | 0.200 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).
