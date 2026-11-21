### Empty roads (random city routes)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Weave (yaw rate RMS on straights, rad/s) | Gap to the line at a red, clear lane (m) | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 98.0% | 2 | 0 | 0 | 2 | 0.03 | 67% | 0.0% | 0.24 | 0.07 | 0.035 | 0.6 | 0.001 |
| RL (8.0M steps) | 96.5% | 0 | 7 | 0 | 0 | 0.00 | 97% | 7.0% | 0.53 | 1.71 | 0.330 | – | 0.193 |
| RL (14.0M steps) | 98.0% | 0 | 4 | 0 | 0 | 0.00 | 94% | 1.3% | 0.53 | 0.57 | 0.087 | – | 0.194 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).

### Heavy traffic (rule-based cars, stopped cars, traffic lights)

| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Weave (yaw rate RMS on straights, rad/s) | Gap to the line at a red, clear lane (m) | Inference (ms / car / decision, Node) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (pure pursuit + PID) | 79.5% | 19 | 0 | 3 | 19 | 0.39 | 43% | 0.0% | 0.24 | 0.06 | 0.041 | 4.3 | 0.001 |
| RL (8.0M steps) | 60.5% | 30 | 13 | 32 | 4 | 0.76 | 64% | 2.8% | 0.71 | 2.28 | 0.477 | 11.9 | 0.197 |
| RL (14.0M steps) | 66.0% | 25 | 2 | 36 | 5 | 0.67 | 65% | 0.6% | 0.85 | 1.15 | 0.163 | 9.4 | 0.199 |

200 episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).
