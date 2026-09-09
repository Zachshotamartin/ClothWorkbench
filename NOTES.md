# Stable cloth drape integration

- `createExperiment(ctx)` API unchanged; now returns `deactivate()` as well as `dispose()`, both release grab and pointer capture. The runtime should retain the scene when deactivated and suspend its frame callbacks.
- Starts **paused flat above the ball** at all motion preferences. Explicit **Drop onto ball** starts the simulation and clears pins/velocity/history. **Reset cloth** pauses and clears state. No 80-frame automatic warmup.
- New **Triangles** select values `16`, `24`, `32`, `40` correspond to square grids and 512,1152,2048,3200 exported faces. Desktop default24, narrow/touch default16. Resolution change disposes old buffers, updates pin ranges, keeps material/wind/gravity, clears old grab/pins and pauses.
- Existing Material, Gravity, Wind strength, Pin arrangement, Show cloth mesh, Freeze & export cloth OBJ labels remain. Initial status now includes actual triangle count and `ready to drop`.
- Fixture changes for portfolio: no assumption of old891 vertices/1664 triangles or y4.3. Flat initial y3.2; Drop initially0pins. The existing integration test based on export equality/changedY should remain valid.
- No full triangle–triangle collision claim. Actual spatial-hash non-neighbor particle separation plus solid-contact facet allowance and bounded grabs are implemented/tested.
- Browser evidence stored in /tmp/cloth-upgrade-browser.json during development. Numerical tests exercise12s at three resolutions and all4OBJcounts. No Actions or publishing performed by this agent.
