import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const protocol = JSON.parse(fs.readFileSync(new URL('../mineflayer-26.2-fork/data/pc/26.2/protocol.json', import.meta.url)));

// Ground truth: javap -c -p on the official 26.2 server's GameProtocols,
// ServerboundUseItemOnPacket and FriendlyByteBuf.readBlockHitResult.
// These checks do not establish that the server accepted a placement.
test('26.2 placement packet matches vanilla ID and field order', () => {
  const types = protocol.play.toServer.types;
  assert.equal(types.packet[1][0].type[1].mappings['0x42'], 'block_place');
  assert.deepEqual(types.packet_block_place[1], [
    { name: 'hand', type: 'varint' }, { name: 'location', type: 'position' },
    { name: 'direction', type: 'varint' }, { name: 'cursorX', type: 'f32' },
    { name: 'cursorY', type: 'f32' }, { name: 'cursorZ', type: 'f32' },
    { name: 'insideBlock', type: 'bool' }, { name: 'worldBorderHit', type: 'bool' },
    { name: 'sequence', type: 'varint' },
  ]);
});

// Optional installed-dependency probe: no network client, world, or process
// is started. Set BOT_NODE_MODULES to the bot's installed node_modules.
const modules = process.env.BOT_NODE_MODULES;
test('installed Mineflayer emits modern placement and requires changed-block confirmation', { skip: !modules }, async () => {
  const require = createRequire(path.join(path.resolve(modules), '../package.json'));
  const registry = require('prismarine-registry')('26.2');
  const { Vec3 } = require('vec3');
  const bot = new EventEmitter();
  const dest = new Vec3(0, 65, 0);
  const air = { type: 0, name: 'air', position: dest };
  const stone = { type: 1, name: 'stone', position: dest };
  let current = air;
  const packets = [];
  Object.assign(bot, {
    registry, supportFeature: registry.supportFeature,
    heldItem: { name: 'stone' }, inventory: { slots: [] },
    lookAt: async () => {}, swingArm: () => {}, blockAt: () => current,
    _client: { write: (name, packet) => packets.push({ name, packet }) },
  });
  require('mineflayer/lib/plugins/generic_place')(bot);
  require('mineflayer/lib/plugins/place_block')(bot);
  const ref = { position: new Vec3(0, 64, 0) };
  const face = new Vec3(0, 1, 0);
  const placing = bot.placeBlock(ref, face);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].name, 'block_place');
  assert.equal(packets[0].packet.direction, 1);
  assert.equal(packets[0].packet.cursorY, 1);
  assert.equal(packets[0].packet.insideBlock, false);
  assert.equal(packets[0].packet.worldBorderHit, false);
  assert.equal(bot.listenerCount(`blockUpdate:${dest}`), 1);
  bot.emit(`blockUpdate:${dest}`, air, air);
  assert.equal(bot.listenerCount(`blockUpdate:${dest}`), 1, 'unchanged update is not success');
  current = stone;
  bot.emit(`blockUpdate:${dest}`, air, stone);
  await placing;
  assert.equal(bot.listenerCount(`blockUpdate:${dest}`), 0);

  // Rejection/no changed-block update gives exactly the reported timeout,
  // even with no latency whatsoever; timeout alone cannot diagnose lag.
  current = air;
  await assert.rejects(bot.placeBlock(ref, face), /Event blockUpdate:.* did not fire within timeout of 5000ms/);
  assert.equal(bot.listenerCount(`blockUpdate:${dest}`), 0);
});
