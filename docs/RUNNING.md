# Running the stack

## 1. Start a vanilla Minecraft 1.21.x server

You need any vanilla server jar and a writable directory. The simplest
recipe uses the official `server.jar`:

```bash
mkdir -p ~/minecraft/server
curl -L -o ~/minecraft/server/server.jar \
  https://piston-data.mojang.com/v1/objects/<sha>/server.jar
echo "eula=true" > ~/minecraft/server/eula.txt
```

Edit `server.properties`:

```properties
online-mode=false
enforce-secure-profile=false
allow-flight=true
max-tick-time=180000
view-distance=10
simulation-distance=6
```

Then start the server with Java 21+:

```bash
java -Xms2G -Xmx6G -jar ~/minecraft/server/server.jar nogui
```

## 2. Apply the 26.2 patches

This is the part that lets the bot actually talk to a 1.21.11+ server. See
`mineflayer-26.2-fork/` for the patch list and a one-command installer.

## 3. Start the bot

```bash
cd minecraft/hermescraft-fork/bot
node server.js --mc-host 127.0.0.1 --mc-port 25565 --port 3001
```

Verify: `mc status` should print health, position, inventory.

## 4. Start the bridge

```bash
cd lmstudio-bridge
LMS_MODEL=ornith-1.5-9b ./start.sh
```

The bridge listens on port 3002. Visit `http://127.0.0.1:3002/` to see
the latest observation and last action.

## 5. Start the controller (optional)

```bash
cd minecraft/minion-controller
./start.sh
```

The controller listens on port 3003. The default `config.json` configures
five minions with different models and tick intervals.

Set `INTELLIGENCE_MODE=observe|shadow|canary|active` (default `observe`)
and optionally `INTELLIGENCE_CANARY=<bot>` before starting the
controller. In `observe` the controller validates and audits structured
proposals at `GET /intelligence` without executing anything; higher
modes stay disabled until a canary is approved.

## 6. Connect with your Minecraft client

The easiest path is Prism Launcher. Create a 1.21.x vanilla instance,
install it once so it generates `~/.minecraft/`, then point it at
`localhost:25565` and join. The bot is `HermesBot`; you'll see it move
around as the model issues commands.

## 7. Bedrock players (phone, console, etc.)

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

## Service order matters

1. Minecraft server first (the bot will reconnect, but the world
   must exist)
2. If using Bedrock, Geyser + Floodgate next
3. Bot server (`hermescraft/bot/server.js`)
4. Bridge and/or controller (the brain)

The reverse order works too; the bridge will just retry `mc status`
until the bot is up.