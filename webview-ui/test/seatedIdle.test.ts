/**
 * An agent resting in its chair (its turn over, or back from wandering) shows the seated
 * frame, not the typing animation. Helpers have no chair and keep typing through the gaps
 * between their tools.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { createCharacter, getCharacterSprite } from '../src/office/engine/characters.js';
import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { CharacterSprites } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout, SpriteData } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

beforeAll(() => {
  const chair: LoadedAssetData['catalog'][number] = {
    id: 'TEST_CHAIR',
    label: 'chair',
    category: 'chairs',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  };
  assert.ok(buildDynamicCatalog({ catalog: [chair], sprites: { TEST_CHAIR: [['c']] } }));
});

function layoutWithChair(): OfficeLayout {
  const cols = 8;
  const rows = 6;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [{ uid: 'a', type: 'TEST_CHAIR', col: 1, row: 1 }],
  };
}

/** Run the office for `seconds` in 1/30 s frames. */
function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) os.update(1 / 30);
}

const named = (name: string): SpriteData => [[name]];
const pair = (name: string): [SpriteData, SpriteData] => [named(`${name}1`), named(`${name}2`)];
const each = <T>(make: (dir: string) => T) =>
  Object.fromEntries(Object.values(Direction).map((d) => [d, make(String(d))])) as Record<
    Direction,
    T
  >;
const sprites: CharacterSprites = {
  walk: each((d) => [named(`walk${d}`), named(`walk${d}`), named(`walk${d}`), named(`walk${d}`)]),
  typing: each((d) => pair(`type${d}`)),
  reading: each((d) => pair(`read${d}`)),
  seated: each((d) => named(`seated${d}`)),
};

test('a seated agent types while active and rests in the seated frame when not', () => {
  const ch = createCharacter(1, 0, null, null);
  ch.state = CharacterState.TYPE;
  ch.dir = Direction.UP;
  assert.equal(getCharacterSprite(ch, sprites), sprites.typing[Direction.UP][0]);
  ch.currentTool = null;
  ch.isActive = false;
  assert.equal(getCharacterSprite(ch, sprites), sprites.seated[Direction.UP]);
  ch.dir = Direction.LEFT;
  assert.equal(getCharacterSprite(ch, sprites), sprites.seated[Direction.LEFT]);
});

test('an idle helper between tools keeps typing', () => {
  const ch = createCharacter(-1, 0, null, null);
  ch.isSubagent = true;
  ch.state = CharacterState.TYPE;
  ch.isActive = false;
  assert.equal(getCharacterSprite(ch, sprites), sprites.typing[Direction.DOWN][0]);
});

test('a restored agent rests in its chair until the replay says it is working', () => {
  // A reload: the snapshot lists the agent, then the replay sends only what is live.
  const os = new OfficeState(layoutWithChair());
  restoreAgent(os, { id: 1, seatId: 'a' });
  const ch = os.characters.get(1)!;
  run(os, 1);
  assert.equal(ch.isActive, false);
  assert.equal(ch.state, CharacterState.TYPE, 'still in its chair');
  assert.equal(getCharacterSprite(ch, sprites), sprites.seated[ch.dir]);

  // a replayed "waiting" (or a reconnect's reset) doesn't stand it up
  os.setAgentActive(1, false);
  run(os, 1);
  assert.equal(ch.state, CharacterState.TYPE);

  // a running tool in the replay puts it back to work
  os.setAgentActive(1, true);
  assert.equal(getCharacterSprite(ch, sprites), sprites.typing[ch.dir][ch.frame % 2]);
});

test('a turn that ends stands the agent up', () => {
  const os = new OfficeState(layoutWithChair());
  os.addAgent(1, undefined, undefined, 'a', true);
  const ch = os.characters.get(1)!;
  os.setAgentActive(1, false);
  run(os, 0.1);
  assert.equal(ch.state, CharacterState.IDLE);
});

test('an idle agent rests in the break room, not at its desk, and goes back to work there', () => {
  // Two chairs with no PC: 'a' is the agent's own, 'b' is free, so 'b' is the break room.
  const layout = layoutWithChair();
  layout.furniture.push({ uid: 'b', type: 'TEST_CHAIR', col: 5, row: 4 });
  const os = new OfficeState(layout);
  os.addAgent(1, undefined, undefined, 'a', true);
  const ch = os.characters.get(1)!;

  // Its turn ends: it stands up; once it has wandered enough, it goes for a rest.
  os.setAgentActive(1, false);
  run(os, 0.1);
  ch.wanderCount = ch.wanderLimit;
  ch.wanderTimer = 0;
  run(os, 5);
  assert.equal(ch.restSeatId, 'b');
  assert.deepEqual([ch.tileCol, ch.tileRow, ch.state], [5, 4, CharacterState.TYPE]);
  assert.equal(getCharacterSprite(ch, sprites), sprites.seated[ch.dir]);

  // A newcomer needs a chair and 'b' is the only free one: it is the newcomer's
  // own now, so the resting agent gets up and walks off it.
  os.addAgent(2, undefined, undefined, undefined, true);
  assert.equal(os.characters.get(2)!.seatId, 'b');
  run(os, 1);
  assert.equal(ch.restSeatId, null);
  assert.notDeepEqual([ch.tileCol, ch.tileRow], [5, 4], "off the newcomer's chair");

  // Work comes in: back to its own desk.
  os.setAgentActive(1, true);
  run(os, 5);
  assert.equal(ch.restSeatId, null);
  assert.deepEqual([ch.tileCol, ch.tileRow, ch.state], [1, 1, CharacterState.TYPE]);
});
