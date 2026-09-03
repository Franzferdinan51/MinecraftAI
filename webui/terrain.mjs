// Real terrain renderer: reads Anvil region files from the live world save and
// returns a top-down surface-color grid. No deps except prismarine-nbt + zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire('/home/duckets/games/hermescraft/bot/package.json');
const nbt = require('prismarine-nbt');

const REGION_DIR = '/home/duckets/minecraft/server/hermescraft/dimensions/minecraft/overworld/region';

// Exact-name skips: thin/flat things you see through to the ground.
const SKIP = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air',
  'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern',
  'minecraft:dead_bush', 'minecraft:seagrass', 'minecraft:tall_seagrass', 'minecraft:kelp',
  'minecraft:kelp_plant', 'minecraft:snow', 'minecraft:vine', 'minecraft:glow_lichen',
  'minecraft:sugar_cane', 'minecraft:bamboo', 'minecraft:cactus']);
const SKIP_SUFFIX = ['_button', '_pressure_plate', 'torch', '_rail', 'carpet', '_sign',
  '_banner', 'flower', 'tulip', 'daisy', 'poppy', 'dandelion', 'orchid', 'allium',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', '_sapling', '_fungus',
  '_roots', '_sprouts', '_vines', 'sculk_vein', '_mat', 'moss_carpet', '_hanging_sign'];

function baseColor(name) {
  if (SKIP.has(name) || SKIP_SUFFIX.some((s) => name.endsWith(s))) return null;
  const n = name.replace('minecraft:', '');
  if (n.includes('water')) return [59, 111, 212];
  if (n.includes('lava')) return [255, 122, 26];
  if (n === 'grass_block') return [106, 190, 48];
  if (n === 'sand' || n.includes('sandstone') || n === 'birch_planks') return [227, 215, 155];
  if (n.includes('snow') || n.includes('ice') || n === 'quartz_block') return [238, 243, 246];
  if (n.includes('leaves') || n.includes('moss_block') || n === 'cactus') return [47, 122, 42];
  if (n.includes('_log') || n.includes('_wood') || n === 'chest' || n === 'barrel' ||
      n === 'crafting_table' || n === 'furnace' || n === 'bookshelf') return [125, 90, 50];
  if (n.includes('planks') || n === 'farmland' || n === 'dirt_path') return [150, 115, 70];
  if (n === 'dirt' || n.includes('coarse_dirt') || n.includes('rooted_dirt') || n === 'mud') return [134, 95, 60];
  if (n.includes('deepslate') || n.includes('bedrock') || n.includes('obsidian')) return [58, 58, 66];
  if (n.includes('ore') || n.includes('ancient_debris')) return [120, 110, 105];
  if (n.includes('stone') || n === 'cobblestone' || n === 'gravel' || n.includes('andesite') ||
      n.includes('diorite') || n.includes('granite') || n.includes('tuff')) return [125, 125, 130];
  if (n.includes('glass')) return [207, 232, 239];
  if (n.includes('bed')) return [196, 60, 60];
  if (n.includes('wool') || n.includes('concrete')) {
    if (n.includes('white')) return [230, 230, 230];
    if (n.includes('red')) return [170, 50, 50];
    if (n.includes('blue')) return [60, 90, 200];
    if (n.includes('green')) return [80, 160, 80];
    if (n.includes('yellow')) return [220, 200, 80];
    return [150, 150, 150];
  }
  if (n.includes('wheat') || n.includes('carrot') || n.includes('potato') || n.includes('beetroot') ||
      n.includes('melon') || n.includes('pumpkin') || n.includes('hay_block')) return [122, 182, 72];
  if (n === 'torch' || n === 'lantern' || n === 'glowstone' || n === 'sea_lantern') return [255, 215, 94];
  if (n.includes('door') || n.includes('fence') || n.includes('gate')) return [140, 105, 60];
  return [102, 102, 108]; // unknown solid
}

const regionCache = new Map(); // path -> {mtime, chunks: Map("cx,cz" -> parsed)}
function readRegion(rx, rz) {
  const p = path.join(REGION_DIR, `r.${rx}.${rz}.mca`);
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const hit = regionCache.get(p);
  if (hit && hit.mtime === st.mtimeMs) return hit.chunks;
  const fd = fs.openSync(p, 'r');
  const header = Buffer.alloc(8192);
  fs.readSync(fd, header, 0, 8192, 0);
  const chunks = new Map();
  for (let i = 0; i < 1024; i++) {
    const off = header.readUIntBE(i * 4, 3);
    if (!off) continue;
    const lenBuf = Buffer.alloc(4);
    fs.readSync(fd, lenBuf, 0, 4, off * 4096);
    const len = lenBuf.readUInt32BE(0);
    const data = Buffer.alloc(len);
    fs.readSync(fd, data, 0, len, off * 4096 + 4);
    const comp = data[0];
    const raw = comp === 2 ? zlib.inflateSync(data.subarray(1)) : comp === 1 ? zlib.gunzipSync(data.subarray(1)) : null;
    if (raw) chunks.set(i, raw);
  }
  fs.closeSync(fd);
  regionCache.set(p, { mtime: st.mtimeMs, chunks });
  return chunks;
}

async function parseChunk(raw) {
  const { parsed } = await nbt.parse(raw);
  const v = nbt.simplify(parsed);
  return v;
}

function columnSurface(chunk, lx, lz) {
  const sections = (chunk.sections || []).slice().sort((a, b) => b.Y - a.Y);
  for (const s of sections) {
    const bs = s.block_states;
    if (!bs || !bs.palette) continue;
    const pal = bs.palette.map((p) => (typeof p === 'string' ? p : p.Name));
    if (pal.length === 1) {
      const c = baseColor(pal[0]);
      if (c) return { y: (s.Y + 1) * 16 - 1, color: c };
      continue;
    }
    const bits = Math.max(4, Math.ceil(Math.log2(pal.length)));
    const data = bs.data || [];
    const perLong = Math.floor(64 / bits);
    for (let y = 15; y >= 0; y--) {
      const idx = (y * 16 + lz) * 16 + lx;
      const li = Math.floor(idx / perLong);
      const off = (idx % perLong) * bits;
      const raw = BigInt(data[li] ?? 0);
      // data stores signed int64; mask the bits we need
      const m = Number((raw >> BigInt(off)) & BigInt((1 << bits) - 1));
      const c = baseColor(pal[m] || 'minecraft:air');
      if (c) return { y: s.Y * 16 + y, color: c };
    }
  }
  return null;
}

const gridCache = new Map(); // "x0,z0,size,res" -> {mtimeKey, out}
// Render size x size blocks centered on (cx,cz) at res px per block (<=1).
export async function renderTerrain(cx, cz, size = 384, res = 0.5) {
  const w = Math.max(32, Math.min(256, Math.round(size * res)));
  const x0 = Math.floor(cx - size / 2), z0 = Math.floor(cz - size / 2);
  const step = size / w;
  const key = `${x0},${z0},${size},${w}`;
  // mtimeKey: max region mtime involved (cheap stat check)
  let mMax = 0;
  const rx0 = Math.floor(x0 / 512), rx1 = Math.floor((x0 + size) / 512);
  const rz0 = Math.floor(z0 / 512), rz1 = Math.floor((z0 + size) / 512);
  for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
    try { mMax = Math.max(mMax, fs.statSync(path.join(REGION_DIR, `r.${rx}.${rz}.mca`)).mtimeMs); } catch {}
  }
  const hit = gridCache.get(key);
  if (hit && hit.mMax === mMax) return hit.out;

  const cells = new Array(w * w).fill(0);
  const chunkMemo = new Map();
  async function chunkAt(bx, bz) {
    const ccx = Math.floor(bx / 16), ccz = Math.floor(bz / 16);
    const k = `${ccx},${ccz}`;
    if (chunkMemo.has(k)) return chunkMemo.get(k);
    const rx = Math.floor(ccx / 32), rz = Math.floor(ccz / 32);
    const chunks = readRegion(rx, rz);
    if (!chunks) { chunkMemo.set(k, null); return null; }
    const lx = ((ccx % 32) + 32) % 32, lz = ((ccz % 32) + 32) % 32;
    const raw = chunks.get(lx + lz * 32);
    if (!raw) { chunkMemo.set(k, null); return null; }
    try {
      const parsed = await parseChunk(raw);
      chunkMemo.set(k, parsed);
      return parsed;
    } catch { chunkMemo.set(k, null); return null; }
  }
  for (let py = 0; py < w; py++) {
    for (let pxx = 0; pxx < w; pxx++) {
      const bx = Math.floor(x0 + pxx * step), bz = Math.floor(z0 + py * step);
      const ch = await chunkAt(bx, bz);
      if (!ch) continue;
      const s = columnSurface(ch, ((bx % 16) + 16) % 16, ((bz % 16) + 16) % 16);
      if (!s) continue;
      const shade = Math.max(0.55, Math.min(1.2, 0.78 + (s.y - 62) * 0.008));
      const r = Math.min(255, s.color[0] * shade) | 0;
      const g = Math.min(255, s.color[1] * shade) | 0;
      const b = Math.min(255, s.color[2] * shade) | 0;
      cells[py * w + pxx] = (r << 16) | (g << 8) | b;
    }
  }
  const out = { w, x0, z0, step, cells };
  gridCache.set(key, { mMax, out });
  return out;
}
