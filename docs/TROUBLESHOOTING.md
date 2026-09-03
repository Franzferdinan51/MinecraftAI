# Troubleshooting

## `Unsupported protocol version '776'`

The `mineflayer-26.2-fork/` patches were not applied. The server you are
connecting to is Minecraft 26.2, which uses protocol 776. The npm-published
`minecraft-data@3.115.0` only supports up to 26.1. Apply the fork (see
`mineflayer-26.2-fork/README.md`).

## `No data available for version 26.2`

`minecraft-data` cannot find a `pc.26.2` data folder. Copy the
`data/pc/26.2/` directory from this repo into your installed
`node_modules/minecraft-data/minecraft-data/data/pc/26.2/`. The folder
ships with `protocol.json` plus the side-channel data the bot needs to
identify blocks, items, and entities.

## `Error: Server version '26.2' is not supported. Latest supported version is '26.1'.`

`minecraft-protocol` and `mineflayer` both maintain hardcoded "supported
versions" whitelists. The fork patches both to include `26.2`. Apply
the fork.

## `Chunk size is N but only M was read` (M < N)

The protocol JSON in `data/pc/26.2/` is a placeholder copy of 26.1
because upstream `minecraft-data` has not yet shipped real 26.2
protocol data. The bot is still in the world, but some packets will
be parsed with the wrong format. The bot's `mc status` works, inventory
works, basic movement works, mining works. Chunked terrain rendering
inside the bot's world model is incomplete.

## Bot joins, then disconnects within a few seconds

The bot is crashing on a packet it cannot decode. Check
`<your-minecraft-server>/logs/latest.log` for the server's view
and `<your-bot>/botserver.log` for the bot's view. The fork should resolve
the most common crash, but the placeholder protocol JSON is a known
limitation. Workarounds:

- Connect your client to the server, set yourself to creative, give
  yourself items, then spawn the bot
- Avoid teleporting the bot across dimensions
- Do not put the bot in a high-speed vehicle

## Bridge says `last_action: ERROR mc exit N`

The model produced a syntactically valid `mc` command that the bot could
not execute. Most often: bad coordinates (model hallucinated numbers),
unknown block name, or the bot is too far from the target. The bridge
keeps running; the next tick will produce a new action.

## LM Studio returns 400 / 404

`LMS_URL` is wrong, or the chosen `LMS_MODEL` is not loaded in LM Studio.
Visit `http://127.0.0.1:1234/v1/models` to see what is loaded.

## Bot is in the world but the bridge cannot find it

The bot's `mc status` call may take a few seconds to return. The bridge
retries on error. If the bridge is permanently stuck on `pending: true`,
restart it with `kill -15 $(lsof -ti tcp:3002)` and re-run
`./start.sh`.

## `eaddr_in_use` on port 3002

A previous bridge process is still running. `kill -15` the old PID
(graceful shutdown) and try again. If it is stuck, use `kill -9` and
verify with `ss -ltn | grep 3002`.

## Bot moves to weird coordinates

The model is hallucinating. Try a larger model (`ornith-1.5-35b-a3b`),
tighten the system prompt in `bridge.mjs`, or reduce
`DECISION_INTERVAL_MS` so the bot makes more, smaller decisions.