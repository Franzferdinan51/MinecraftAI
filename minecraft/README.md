# minecraft/

Scripts to set up the bot server, the world, and the AI controllers.

| File                          | What it does                                           |
|--|--|
| `start-vanilla-server.sh`     | Boot a vanilla Minecraft 1.21.x server.jar with Java 21 |
| `start-bot-server.sh`         | Boot the hermescraft bot server (one Mineflayer bot)   |
| `start-bridge.sh`             | Boot the LM Studio bridge                               |
| `start-minion-controller.sh`  | Boot the minion controller (multiple AI characters)    |
| `stop-all.sh`                 | Stop everything, by PID lookup                         |

The bot server expects a running Minecraft server on `127.0.0.1:25565`
with `online-mode=false`. The bridge expects the bot server to be up.
The minion controller is independent and can run alongside the bridge.

These are convenience wrappers. See `docs/RUNNING.md` for the
canonical sequence and the underlying commands.