import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('../minecraft/bot-server/server.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

const tableFreeCraftRecipe = Function(`${functionSource('tableFreeCraftRecipe')}\nreturn tableFreeCraftRecipe;`)();
const recipe = tableFreeCraftRecipe(
  'oak_planks',
  [{ name: 'oak_log', type: 17, count: 1 }],
  { oak_planks: { id: 5 } },
);

assert.deepEqual(
  recipe,
  {
    result: { id: 5, metadata: null, count: 4 },
    ingredients: [{ id: 17, metadata: null, count: -1 }],
    inShape: null,
    outShape: null,
    requiresTable: false,
  },
  'one normal log must produce a valid table-free 2x2 planks recipe',
);
assert.equal(
  tableFreeCraftRecipe('oak_planks', [{ name: 'stripped_oak_log', type: 17, count: 1 }], { oak_planks: { id: 5 } }),
  null,
  'stripped logs are not valid plank inputs in this deployment',
);
console.log('bot crafting fallback regression: PASS');
