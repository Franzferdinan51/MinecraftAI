# Bot server (Mineflayer HTTP API)

One process per bot body. Each exposes the `mc` command surface
(`goto_near`, `bg_goto`, `collect`, `dig`, `fight`, `flee`, `eat`, `craft`,
`smelt`, `sleep`, `follow`, `place`, `place_fill`, `chat`, `chat_to`,
`till`, `sow`, `harvest`, `breed`, `shear`, `milk`, `fish` (`bg_fish`),
`door` (`door close`), `inspect`, `status`, …) over HTTP so the bridge
and minion controller can drive six independent players.

Long actions (`bg_goto`, `fish`, `collect`, `place_fill`) run in the
background via `POST /task/ACTION` (`mc bg ACTION '{json}'`); poll with
`mc task`, cancel with `mc cancel`. The `mc` CLI script in this directory
is tracked here and installed at `~/.local/bin/mc`.

- Live path: `~/games/hermescraft/bot/server.js` (ports 3001, 3011–3015)
- This directory tracks the same code for review and backup.

Setup:

```sh
cd minecraft/bot-server
npm install
# apply the 26.2 protocol fork to node_modules (see ../mineflayer-26.2-fork/)
node server.js --mc-host 127.0.0.1 --mc-port 25565 --port 3001
```

Tests: `npm test` (runs `test/chat.test.js`, `test/perception.test.js`).

Notes:
- `mineflayer-pvp` is installed but intentionally **not loaded** — its
  deprecated physicTick event breaks pathfinder. Combat uses `mc fight`.
- Armor (`mineflayer-armor-manager`) and eating (`mineflayer-auto-eat`)
  run as bot-level safety nets under the controller's survival rules.
