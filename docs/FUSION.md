# Paper / upstream integration

Integration branch: `integrate/paper-0161-upstream-v021`.
Custom baseline: `cfbc0b4`; Paper source: `paper/0.1.6.1` (`6f6e5c7`); upstream reviewed through `c2a2ef7` (0.2.1).

This is a selective integration, not a complete merge of upstream 0.2.1. The upstream architecture and data overhaul have not been imported wholesale.

Included:
- Japanese / Chinese operator combat voices, persisted language selection and alternate-language fallback.
- Independent voice channel, priority gate, battle skills / encounter / settlement lines and deployment events.
- 174 skin selections, skin metadata, avatar / battle-model resources, room synchronization, loadout import/export, prep and combat render wiring.
- Mobile Pixi startup fallback from high-performance context to default context at reduced resolution.
- Upstream c225559: apoptosis SP drain includes stored charges.
- Upstream ce2bd75: refresh dispatch snapshots operators before effects grant or merge new pieces.
- Upstream 14df10a: flying enemies keep road-relative body height while their shadows follow the tile.

Preserved: eight-player rooms, fixed six-card repeatable large-room drafts, two-column dense team panel, custom resource checks and Capacitor Android pipeline.

Validation:
- Final full suite: 3,716 tests, 3,699 passed, 17 skipped, zero failures.
- After resource completion: assets / resource-index / audio tests 67/67 passed; manifest missing file count zero.
- Chromium local and deployed page smoke tests: no page errors.
- Android debug APK successfully built; offline payload 8,599 files, approximately 543 MiB. No physical-device test was performed.

Production migration:
- New container `stronghold-fused`, image `stronghold-protocol:fused`, loopback port 3001.
- Application checkout `/opt/Stronghold-Fused`.
- Assets and fonts mounted read-only from `/opt/stronghold-resources`.
- Gateway routes to `stronghold-fused:3000`; HTTPS health and WebSocket verified.
- Old `stronghold` container stopped and retained for rollback; gateway backup `/opt/gateway/nginx.conf.before-fused`.
- `/root/update-stronghold.sh` now uses the external-resource deployment script; original retained as `/root/update-stronghold-before-fused.sh`.
- Unused Docker build cache reclaimed: approximately 8.33 GB. Root filesystem available space increased to approximately 12 GB (60% used).
- Resources remain on the same host disk; separate containers do not create new disk capacity.
