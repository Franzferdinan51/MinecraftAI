# minecraft/

Scripts to set up the bot server, the world, and the AI controllers.

| File                          | What it does                                           |
|--|--|
| `start-vanilla-server.sh`     | Boot a vanilla Minecraft 1.21.x server.jar with Java 21 |
| `start-bot-server.sh`         | Boot the hermescraft bot server (one Mineflayer bot)   |
| `start-bridge.sh`             | Boot the LM Studio bridge                               |
| `start-minion-controller.sh`  | Boot the minion controller (multiple AI characters)    |
| `start-geyser.sh`             | Boot the Geyser Bedrock-to-Java bridge            |
| `stop-all.sh`                 | Stop the bot/bridge/controller, not the MC server  |

The bot server expects a running Minecraft server on `127.0.0.1:25565`
with `online-mode=false`. The bridge expects the bot server to be up.
The minion controller is independent and can run alongside the bridge.

### Default multi-agent mapping

The checked-in controller config starts five independent Mineflayer
players, all using `ornith-1.5-9b`:

- Steve → API port 3011
- Reed → API port 3012
- Moss → API port 3013
- Flint → API port 3014
- Ember → API port 3015

The primary DuckBot remains on API port 3001. Each minion API process
uses the same Java server port 25565 but a different offline username.

These are convenience wrappers. See `docs/RUNNING.md` for the
canonical sequence and the underlying commands.