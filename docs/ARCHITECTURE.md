# Architecture

Three layers, each independent. The bridge and the minion controller can be
removed without breaking the bot. The bot can run without the bridge.

```text
┌────────────────────────────────────────────────────────┐
│  Minecraft server (your machine, 127.0.0.1:25565)      │
│  Vanilla. Online-mode false. 1.21.x or higher.         │
└─────────────────────┬──────────────────────────────────┘
                      │ Minecraft protocol (port 25565)
┌─────────────────────▼──────────────────────────────────┐
│  HermesCraft bot server (Node, port 3001)              │
│  Wraps Mineflayer. Exposes a JSON-RPC API.             │
│  The `mc` CLI talks to this API.                       │
└─────────────────────┬──────────────────────────────────┘
                      │ HTTP / localhost
┌─────────────────────▼──────────────────────────────────┐
│  Bridge / Controller (Node, port 3002 / 3003)         │
│  Reasoning loop. Every 6 s, calls `mc status`,         │
│  asks the model, executes one `mc` command.            │
└─────────────────────┬──────────────────────────────────┘
                      │ OpenAI-compatible HTTP
┌─────────────────────▼──────────────────────────────────┐
│  LM Studio / Ollama / vLLM (port 1234 default)         │
│  Local model. Default: ornith-1.5-9b.                  │
└────────────────────────────────────────────────────────┘
```

## Component boundaries

- **Server**: pure Minecraft, no AI hooks. Drop a `server.jar` and start it.
- **HermesCraft bot server**: thin Mineflayer wrapper. Hard-coded user is `HermesBot`. To make your own bot bodies, copy this and change `--username`.
- **Bridge**: stateless. Restart it any time. Reads `mc`, calls model, writes `mc`. Default model is `ornith-1.5-9b`.
- **Controller**: one reasoning loop per configured minion. Each minion has its own LM Studio model and tick interval. Independent from the bridge.
- **Intelligence layer** (`minecraft/intelligence/`, no ports): typed capability/skill contracts, structured proposal parsing, deterministic policy, and the authority gateway. The controller exposes it read-only at `/intelligence`; Mission Control proxies it at `/api/intelligence`. Observe-only: proposals are validated and audited, never dispatched.

## Data flow (per tick)

1. Bridge reads `mc status` → bot position, health, inventory, time, nearby blocks, recent chat
2. Bridge packages that into a system + user prompt
3. Bridge POSTs to `http://127.0.0.1:1234/v1/chat/completions` (LM Studio)
4. Model returns free text
5. Bridge parses `THINK:` (one sentence) and `ACT:` (one `mc` command)
6. Bridge runs the `mc` command, records the result
7. Loop sleeps for the configured interval (default 6 s)

## Why the bridge is a separate process

- Restarting the bridge does not disconnect the bot
- Multiple bridges can drive the same bot body
- The bridge is small (~9 KB) and uses no native code, so a single `node bridge.mjs` works on every OS

## Bedrock players (phone, console, etc.)

The Java server does not speak Bedrock. To let a phone on the same
network join with the official Bedrock client, run a protocol
translator in front of the Java server.

```bash
# 1. Get the Geyser + Floodgate jars. The easiest path is to run them
#    in a small Docker container, or download Spigot and drop the
#    plugins in. Both projects publish build artifacts on their sites.
#
# 2. Configure Geyser to forward Bedrock (19132) to the Java server
#    (25565) on this host. Default config:
#
#    bedrock:
#      address: 0.0.0.0
#      port: 19132
#      motd1: "HermesCraft Bedrock"
#    remote:
#      address: 127.0.0.1
#      port: 25565
#      auth-type: offline
#      enable-proxy-protocol: false
#
# 3. Install Floodgate so the Bedrock client and the Java bot can
#    share a world without name collisions. Default behavior is fine.
#
# 4. From the Bedrock client on the phone: add a server with address
#    <this-machine>:19132, port 19132, leave the rest default.
#
# 5. The Bedrock player shows up as <name> in the Java world and as
#    a Bedrock-prefixed UUID on the Java side. HermesBot will see them
#    in chat and can address them by name.
```

The Minion Controller and the bridge talk to the **Java** server, not
to Geyser. So the bot still uses `127.0.0.1:25565`. Bedrock players
see and hear the bot as if the bot were a real player; the bot does
not know that some of its world is a translation.

## What is NOT in scope

- World generation, schematics, or builds
- Voice/chat plugins for Discord/Telegram
- Cloud LLM fallback (you can wire it yourself; the bridge is just a function call)
- Bedrock edition protocol support (this is Java edition only; use Geyser in front of the Java server if you need phone/console support)