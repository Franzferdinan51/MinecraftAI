import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lmstudio-bridge/bridge.mjs', import.meta.url), 'utf8');
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
const latestHumanWhisper = Function(`${functionSource('latestHumanWhisper')}\nreturn latestHumanWhisper;`)();
const chat = '<Steve> status update [whisper]\n  <Duckets> why are you standing there [whisper]';
assert.deepEqual(
  latestHumanWhisper(chat, new Set(['duckbot', 'steve', 'reed', 'moss', 'flint', 'ember'])),
  { from: 'Duckets', message: 'why are you standing there' },
  'DuckBot must prioritize the latest human whisper over Landfolk chatter',
);
assert.equal(
  latestHumanWhisper('<Steve> hello [whisper]', new Set(['duckbot', 'steve'])),
  null,
  'Landfolk whispers must not trigger DuckBot user acknowledgements',
);
console.log('bridge whisper priority regression: PASS');
