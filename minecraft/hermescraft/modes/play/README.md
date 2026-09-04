# Play / server mode

HermesCraft upstream also ships `play.sh`, `server/start.sh`, `setup.sh`,
`hermescraft.sh`, and `civilization.sh`. MinecraftAI keeps these as
referenced upstream flows rather than copying launchers that could collide
with the user's live server. Our safe entry points are:

- `minecraft/start-bot-server.sh`
- `minecraft/start-bridge.sh`
- `minecraft/start-minion-controller.sh`
- `minecraft/start-geyser.sh`
- `webui/` Mission Control

Use `minecraft/hermescraft/modes.json` for the complete mode catalog and
`docs/RUNNING.md` for the fixture-pinned 26.2 startup sequence. The
upstream launcher names and responsibilities are documented in the root
README and `docs/THIRD-PARTY.md`.
