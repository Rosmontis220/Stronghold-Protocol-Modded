# Complete Windows and Android clients

Packaged clients default to local simulation. All game data, normal/elite operators, skills/modules, AI, alliance phases, skins, voices, rendering libraries and art/audio resources are bundled. Local matches use a browser-compatible copy of the production lobby and match engine with an in-memory protocol transport. Solo and alliance simulation work without an external server; alliance supports one human plus up to seven AI teammates. Joining another human's room and spectating online rooms require switching to online mode.

Title screen:
- 开始本地模拟: local solo/alliance simulation, no server required.
- 连接服务器 · 多人联机: switch to the configured public server.
- In online mode, 离线游玩 · 本地模拟 returns to local play. If the server is unavailable in the lobby, 服务器不可用 · 本地开玩 also switches back.

The packaged boot reads installed resources directly instead of fetching or caching a remote resource snapshot. Web deployments retain their resource verification flow. Mode switching reloads the client; leave a match before switching. Local match state is in memory, so closing the app ends the local simulation. AI rules and combat modules are regenerated from the production sources by `scripts/prepare-local-runtime.mjs` at build time.

Build:
- `npm run desktop:win`: x64 Windows NSIS installer and portable executable.
- `npm run mobile:apk`: prepare all static modules/assets, Capacitor sync, Android debug APK.
- Windows installer and portable artifact names are distinct.

Validation performed:
- External requests blocked: 1 human + 7 AI alliance reached round 2 without page errors.
- Android static payload under the same blocked-network scenario reached round 2 without page errors.
- Actual packaged Windows executable with an unreachable configured server created an AI alliance and entered INFO_CHECK.
- Android APK installed through ADB on a LNA-AL00 phone running Android 12. With Wi-Fi and mobile data disabled and no active default network, the installed WebView ran one human plus seven AI teammates through round 2 and its alliance defense into round 3. No JavaScript exceptions, app crash or ANR were observed. Native screen capture verified terrain, operator models, equipment and shop rendering in round-3 preparation. The player was returned from AI autopilot to manual play. A transient blank battlefield was observed during an alliance view transition; normal preparation rendering was confirmed afterwards. This was a short smoke test, not a complete match or performance soak.

Game art/audio remains copyright Hypergryph / Yostar. GPL notices apply to code; see LICENSE and NOTICE.md.
