# Mineflayer 26.2 fork

The upstream Mineflayer + `minecraft-data` package was lagging behind
Minecraft 26.2 (protocol 776). This directory documents the patch set
that lets Mineflayer talk to a 26.2 server and provides the data
overlay the bot needs.

## What was broken

1. `minecraft-data@3.115.0` (npm-published) only had entries up to 26.1
   in its `protocolVersions.json`. Minecraft 26.2 uses protocol 776.
2. The `data/pc/` folder did not contain a `26.2/` data directory.
3. `minecraft-protocol`'s `version.js` had a hardcoded whitelist of
   `supportedVersions` that ended at `'26.1'`. Even if the data was
   there, the protocol layer would refuse to attempt a 26.2 server.
4. `mineflayer`'s `lib/version.js` had a `testedVersions` list ending at
   `'26.1'`. The bot would refuse to attach.
5. `prismarine-chunk`'s `src/index.js` had a `chunkImplementations`
   map ending at `26.1: require('./pc/1.18/chunk')`. The 26.2 chunk
   decoder was missing.
6. `prismarine-physics`'s `lib/features.json` did not list `26.2` in
   the `proportionalLiquidGravity` or `climbUsingJump` feature
   versions, so the physics plugin threw `No liquid gravity settings`
   on bot startup.

## What we did

The cleanest, minimum-invasive patch is to overlay each file with the
upstream master version where it exists, then surgically add `26.2` to
the few whitelists that master has not yet refreshed.

### Patch list

| File                                                                            | Change                                                                  |
|--|--|
| `node_modules/minecraft-data/minecraft-data/data/pc/common/protocolVersions.json` | Replaced with upstream `PrismarineJS/minecraft-data` master version, which lists `26.2` |
| `node_modules/minecraft-data/minecraft-data/data/pc/26.2/`                     | Created as a copy of `26.1/` (no real `26.2/` data on upstream yet)  |
| `node_modules/minecraft-data/minecraft-data/data/pc/26.2/version.json`          | Patched `version` to `776`, `minecraftVersion` to `'26.2'`         |
| `node_modules/minecraft-data/data.js`                                          | Fixed upstream missing-comma bug; added `26.2` block                |
| `node_modules/minecraft-protocol/src/version.js`                               | Added `'26.2'` to `supportedVersions`                              |
| `node_modules/mineflayer/lib/version.js`                                      | Added `'26.2'` to `testedVersions`                                 |
| `node_modules/prismarine-chunk/src/index.js`                                   | Added `'26.2': require('./pc/1.18/chunk')` to `chunkImplementations` |
| `node_modules/prismarine-physics/lib/features.json`                            | Added `'26.2'` to `proportionalLiquidGravity` and `climbUsingJump`   |

## How to apply

The fastest way is to use the `install-26.2-fork.sh` script:

```bash
./install-26.2-fork.sh /path/to/your/bot/node_modules
```

The script:

1. Backs up each file it will touch
2. Copies `data/pc/` from the upstream master checkout
3. Patches each whitelist file
4. Adds the `26.2/` data folder

If you want to do it manually, copy `data/pc/common/protocolVersions.json`
from this directory into your installed
`node_modules/minecraft-data/minecraft-data/data/pc/common/`, then
copy `data/pc/26.2/` from this directory into the same parent
directory, then apply each `patches/*.patch` file in order using
`patch -p1`.

## Known limitations

- The real 26.2 `protocol.json` is not yet published. This fork uses
  26.1's protocol JSON as a placeholder. The bot is functional but
  the login packet's last byte is missing. This causes partial-packet
  warnings but no functional break.

## Regenerated 2026-09-03: true 26.2 item/entity IDs

The 26.2 data directory started as a copy of 26.1, but Mojang shifted
the **item** registry (31 net-new sulfur/cinnabar items) and the
**entity** registry (new `sulfur_cube` shifted later IDs by +1). Bots
misread every item (dirt showed as saplings, beds as potions), which
broke eating, crafting, smelting, and sharing.

Fix, all verified live against the running 26.2 server:
1. Ran the vanilla data generator from the official `server.jar`
   (`java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar
   --server --reports`) and took `reports/registries.json`
   `protocol_id` values as ground truth.
2. Cross-checked with differential probes (`give X` via RCON vs the
   name the bot client reported) — exact match.
3. Rewrote `data/pc/26.2/items.json` (1506 remapped + 31 new),
   `entities.json` (158, +`sulfur_cube`), `foods.json` (44 remapped).
   Block IDs were verified unchanged (sand/leaves/water/stone match).
4. Backups live next to the data dir as `26.2.bak-items-pre26.2regen`.

To regenerate after a server update, repeat steps 1–3 and restart all
bot processes (tables load at startup).

## When to remove

When `minecraft-data` ships a real 26.2 release on npm, uninstall this
fork and update:

```bash
npm install minecraft-data@latest
cd your-bot && rm -rf node_modules/.package-lock.json && npm install
```

You will lose the whitelist patches in `minecraft-protocol` and
`mineflayer` if those packages have not yet updated their whitelists.
Re-apply them by editing the whitelists to add `'26.2'`.