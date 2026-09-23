// ---------------------------------------------------------------------------
// Static game data: goods, citizens, soldiers and buildings.
// Everything else in the simulation is driven off these tables.
// ---------------------------------------------------------------------------

export const TICK = 0.1;          // simulated seconds per simulation tick (10 ticks / s)

export const GOODS = {
  trunk:         { name: 'Tree trunk',    icon: '🪵', color: '#7a4a22' },
  stone:         { name: 'Stone',         icon: '🪨', color: '#9a9a92' },
  wood:          { name: 'Timber',        icon: '🪚', color: '#c9964f' },
  corn:          { name: 'Corn',          icon: '🌾', color: '#e3c24a' },
  flour:         { name: 'Flour',         icon: '🥣', color: '#f1ead6' },
  bread:         { name: 'Bread',         icon: '🍞', color: '#c98a3a' },
  pig:           { name: 'Pig',           icon: '🐖', color: '#f2a7a7' },
  sausage:       { name: 'Sausages',      icon: '🌭', color: '#b8452f' },
  skin:          { name: 'Pig skin',      icon: '🐾', color: '#d9a07a' },
  leather:       { name: 'Leather',       icon: '🟫', color: '#8a5530' },
  wine:          { name: 'Wine',          icon: '🍷', color: '#7a1f3d' },
  fish:          { name: 'Fish',          icon: '🐟', color: '#6fa6c9' },
  coal:          { name: 'Coal',          icon: '⚫', color: '#26221f' },
  iron_ore:      { name: 'Iron ore',      icon: '🟤', color: '#8d5a45' },
  gold_ore:      { name: 'Gold ore',      icon: '🟡', color: '#c9a227' },
  iron:          { name: 'Iron',          icon: '🔩', color: '#8e98a3' },
  gold:          { name: 'Gold chest',    icon: '💰', color: '#f0c419' },
  horse:         { name: 'Horse',         icon: '🐎', color: '#7b5230' },
  axe:           { name: 'Axe',           icon: '🪓', color: '#a0714a' },
  lance:         { name: 'Lance',         icon: '🔱', color: '#a0714a' },
  bow:           { name: 'Bow',           icon: '🏹', color: '#a0714a' },
  wooden_shield: { name: 'Wooden shield', icon: '🛡️', color: '#a0714a' },
  leather_armor: { name: 'Leather armor', icon: '🦺', color: '#8a5530' },
  sword:         { name: 'Sword',         icon: '🗡️', color: '#c0c8d0' },
  pike:          { name: 'Pike',          icon: '📍', color: '#c0c8d0' },
  crossbow:      { name: 'Crossbow',      icon: '🎯', color: '#c0c8d0' },
  iron_shield:   { name: 'Iron shield',   icon: '🔰', color: '#c0c8d0' },
  iron_armor:    { name: 'Iron armor',    icon: '🥋', color: '#c0c8d0' },
};
export const GOOD_LIST = Object.keys(GOODS);

// Food value restores this fraction of a unit's condition.
export const FOODS = { bread: 0.4, sausage: 0.6, wine: 0.3, fish: 0.5 };
export const FOOD_LIST = Object.keys(FOODS);

export const WARFARE = ['axe', 'lance', 'bow', 'wooden_shield', 'leather_armor',
  'sword', 'pike', 'crossbow', 'iron_shield', 'iron_armor', 'horse'];

// Citizens are trained at the School for one gold chest each.
export const CITIZENS = {
  serf:         { name: 'Serf',          icon: '🧺', tunic: '#b08a5a', desc: 'Carries goods along roads.' },
  laborer:      { name: 'Laborer',       icon: '🔨', tunic: '#8c6d4a', desc: 'Builds roads, fields and houses.' },
  woodcutter:   { name: 'Woodcutter',    icon: '🪓', tunic: '#4f7a3a', desc: 'Fells and plants trees.' },
  stonemason:   { name: 'Stonemason',    icon: '⛏️', tunic: '#80807a', desc: 'Quarries stone.' },
  carpenter:    { name: 'Carpenter',     icon: '🪚', tunic: '#a36f3c', desc: 'Sawmill and workshops.' },
  farmer:       { name: 'Farmer',        icon: '🌾', tunic: '#b7a23a', desc: 'Farms corn and grapes.' },
  baker:        { name: 'Baker',         icon: '🍞', tunic: '#e4dcc6', desc: 'Mill and bakery.' },
  butcher:      { name: 'Butcher',       icon: '🔪', tunic: '#9e3b32', desc: 'Butcher and tannery.' },
  fisher:       { name: 'Fisherman',     icon: '🎣', tunic: '#3f6f8f', desc: 'Catches fish.' },
  breeder:      { name: 'Animal breeder',icon: '🐖', tunic: '#7d5b3b', desc: 'Swine farm and stables.' },
  miner:        { name: 'Miner',         icon: '⛏️', tunic: '#4a4540', desc: 'Works the mines.' },
  metallurgist: { name: 'Metallurgist',  icon: '🔥', tunic: '#6b3a2a', desc: 'Smelts iron and gold.' },
  smith:        { name: 'Smith',         icon: '⚒️', tunic: '#3d3d46', desc: 'Forges iron weapons and armor.' },
  recruit:      { name: 'Recruit',       icon: '🪖', tunic: '#6e6e5a', desc: 'Equipped at the barracks. Also mans towers.' },
};
export const CITIZEN_LIST = Object.keys(CITIZENS);

// arm = fraction of damage absorbed. bonusMounted multiplies damage vs horsemen.
export const SOLDIERS = {
  militia:     { name: 'Militia',      icon: '🪓', hp: 60,  atk: 11, arm: 0.00, range: 1.5, cd: 1.1, speed: 2.1, needs: ['axe'] },
  axeman:      { name: 'Axe fighter',  icon: '🛡️', hp: 90,  atk: 15, arm: 0.35, range: 1.5, cd: 1.1, speed: 2.0, needs: ['axe', 'wooden_shield', 'leather_armor'] },
  lancer:      { name: 'Lance carrier',icon: '🔱', hp: 80,  atk: 13, arm: 0.25, range: 1.6, cd: 1.2, speed: 2.0, bonusMounted: 3.0, needs: ['lance', 'leather_armor'] },
  bowman:      { name: 'Bowman',       icon: '🏹', hp: 60,  atk: 10, arm: 0.15, range: 7.0, cd: 2.2, speed: 2.0, ranged: 'arrow', needs: ['bow', 'leather_armor'] },
  swordsman:   { name: 'Swordsman',    icon: '🗡️', hp: 120, atk: 22, arm: 0.55, range: 1.5, cd: 1.0, speed: 1.9, needs: ['sword', 'iron_shield', 'iron_armor'] },
  pikeman:     { name: 'Pikeman',      icon: '📍', hp: 110, atk: 18, arm: 0.45, range: 1.7, cd: 1.2, speed: 1.9, bonusMounted: 3.0, needs: ['pike', 'iron_armor'] },
  crossbowman: { name: 'Crossbowman',  icon: '🎯', hp: 80,  atk: 18, arm: 0.40, range: 8.0, cd: 2.8, speed: 1.9, ranged: 'bolt', needs: ['crossbow', 'iron_armor'] },
  scout:       { name: 'Scout',        icon: '🐎', hp: 90,  atk: 13, arm: 0.30, range: 1.5, cd: 1.0, speed: 3.4, mounted: true, needs: ['axe', 'leather_armor', 'horse'] },
  knight:      { name: 'Knight',       icon: '♞',  hp: 170, atk: 24, arm: 0.60, range: 1.5, cd: 1.0, speed: 3.0, mounted: true, needs: ['sword', 'iron_shield', 'iron_armor', 'horse'] },
};
export const SOLDIER_LIST = Object.keys(SOLDIERS);

// Building kinds:
//   store   - storehouse, accepts every good
//   school  - trains citizens from gold
//   inn     - citizens and soldiers eat here
//   barracks- equips recruits into soldiers
//   tower   - a recruit throws stones at enemies
//   convert - worker turns inputs into outputs inside
//   mine    - convert with no inputs; must sit on an ore deposit
//   gather  - worker walks out to trees / stone / water
//   farm    - worker sows and harvests fields
export const BUILDINGS = {
  storehouse: { name: 'Storehouse', icon: '📦', w: 3, h: 3, cost: { wood: 6, stone: 5 }, hp: 500, kind: 'store', group: 'Town',
    desc: 'Stores all goods. Serfs bring surplus here.' },
  school:     { name: 'School', icon: '🏫', w: 3, h: 2, cost: { wood: 5, stone: 4 }, hp: 350, kind: 'school', group: 'Town',
    desc: 'Trains citizens. Each costs one gold chest.' },
  inn:        { name: 'Inn', icon: '🍺', w: 3, h: 2, cost: { wood: 5, stone: 4 }, hp: 300, kind: 'inn', group: 'Town',
    desc: 'Hungry people come here to eat bread, sausages, wine and fish.' },
  woodcutter: { name: "Woodcutter's", icon: '🌲', w: 2, h: 2, cost: { wood: 2, stone: 2 }, hp: 200, kind: 'gather', group: 'Basic',
    worker: 'woodcutter', radius: 8, out: ['trunk'], desc: 'Fells mature trees and plants saplings.' },
  quarry:     { name: 'Quarry', icon: '⛏️', w: 2, h: 2, cost: { wood: 2, stone: 1 }, hp: 200, kind: 'gather', group: 'Basic',
    worker: 'stonemason', radius: 9, out: ['stone'], desc: 'Must be near stone deposits.' },
  sawmill:    { name: 'Sawmill', icon: '🪚', w: 2, h: 2, cost: { wood: 2, stone: 3 }, hp: 200, kind: 'convert', group: 'Basic',
    worker: 'carpenter', recipes: [{ in: { trunk: 1 }, out: { wood: 2 }, time: 9 }], desc: 'Saws trunks into timber.' },
  farm:       { name: 'Farm', icon: '🌾', w: 3, h: 2, cost: { wood: 3, stone: 3 }, hp: 250, kind: 'farm', group: 'Food',
    worker: 'farmer', radius: 6, field: 1, out: ['corn'], desc: 'Sows and harvests corn fields you lay out nearby.' },
  mill:       { name: 'Mill', icon: '🌀', w: 2, h: 2, cost: { wood: 3, stone: 2 }, hp: 200, kind: 'convert', group: 'Food',
    worker: 'baker', recipes: [{ in: { corn: 1 }, out: { flour: 1 }, time: 8 }], desc: 'Grinds corn into flour.' },
  bakery:     { name: 'Bakery', icon: '🍞', w: 2, h: 2, cost: { wood: 2, stone: 3 }, hp: 200, kind: 'convert', group: 'Food',
    worker: 'baker', recipes: [{ in: { flour: 1 }, out: { bread: 2 }, time: 11 }], desc: 'Bakes bread from flour.' },
  swine:      { name: 'Swine farm', icon: '🐖', w: 3, h: 2, cost: { wood: 4, stone: 2 }, hp: 250, kind: 'convert', group: 'Food',
    worker: 'breeder', recipes: [{ in: { corn: 1 }, out: { pig: 1, skin: 1 }, time: 16 }], desc: 'Raises pigs on corn. Yields pigs and skins.' },
  butcher:    { name: "Butcher's", icon: '🌭', w: 2, h: 2, cost: { wood: 2, stone: 3 }, hp: 200, kind: 'convert', group: 'Food',
    worker: 'butcher', recipes: [{ in: { pig: 1 }, out: { sausage: 2 }, time: 11 }], desc: 'Turns pigs into sausages.' },
  vineyard:   { name: 'Vineyard', icon: '🍇', w: 3, h: 2, cost: { wood: 3, stone: 2 }, hp: 250, kind: 'farm', group: 'Food',
    worker: 'farmer', radius: 6, field: 2, out: ['wine'], desc: 'Tends wine fields you lay out nearby and presses wine.' },
  fisher:     { name: "Fisherman's", icon: '🐟', w: 2, h: 2, cost: { wood: 2, stone: 1 }, hp: 200, kind: 'gather', group: 'Food',
    worker: 'fisher', radius: 9, out: ['fish'], desc: 'Must be near water.' },
  tannery:    { name: 'Tannery', icon: '🟫', w: 2, h: 2, cost: { wood: 3, stone: 2 }, hp: 200, kind: 'convert', group: 'Industry',
    worker: 'butcher', recipes: [{ in: { skin: 1 }, out: { leather: 1 }, time: 10 }], desc: 'Tans skins into leather.' },
  coalmine:   { name: 'Coal mine', icon: '⚫', w: 2, h: 2, cost: { wood: 4, stone: 0 }, hp: 200, kind: 'mine', group: 'Industry',
    worker: 'miner', ore: 1, recipes: [{ in: {}, out: { coal: 1 }, time: 9 }], desc: 'Place on a coal seam in the mountains.' },
  ironmine:   { name: 'Iron mine', icon: '🟤', w: 2, h: 2, cost: { wood: 4, stone: 0 }, hp: 200, kind: 'mine', group: 'Industry',
    worker: 'miner', ore: 2, recipes: [{ in: {}, out: { iron_ore: 1 }, time: 11 }], desc: 'Place on an iron seam in the mountains.' },
  goldmine:   { name: 'Gold mine', icon: '🟡', w: 2, h: 2, cost: { wood: 4, stone: 0 }, hp: 200, kind: 'mine', group: 'Industry',
    worker: 'miner', ore: 3, recipes: [{ in: {}, out: { gold_ore: 1 }, time: 12 }], desc: 'Place on a gold seam in the mountains.' },
  smelter:    { name: 'Iron smelter', icon: '🔩', w: 2, h: 2, cost: { wood: 3, stone: 4 }, hp: 250, kind: 'convert', group: 'Industry',
    worker: 'metallurgist', recipes: [{ in: { iron_ore: 1, coal: 1 }, out: { iron: 1 }, time: 11 }], desc: 'Smelts iron ore with coal.' },
  mint:       { name: "Metallurgist's", icon: '💰', w: 2, h: 2, cost: { wood: 3, stone: 4 }, hp: 250, kind: 'convert', group: 'Industry',
    worker: 'metallurgist', recipes: [{ in: { gold_ore: 1, coal: 1 }, out: { gold: 1 }, time: 10 }], desc: 'Casts gold chests from gold ore and coal.' },
  weaponshop: { name: 'Weapons workshop', icon: '🪓', w: 2, h: 2, cost: { wood: 3, stone: 2 }, hp: 200, kind: 'convert', group: 'Military',
    worker: 'carpenter', recipes: [
      { in: { wood: 1 }, out: { axe: 1 }, time: 12 },
      { in: { wood: 1 }, out: { lance: 1 }, time: 12 },
      { in: { wood: 1 }, out: { bow: 1 }, time: 12 }], desc: 'Makes axes, lances and bows from timber.' },
  armorshop:  { name: 'Armory workshop', icon: '🛡️', w: 2, h: 2, cost: { wood: 3, stone: 2 }, hp: 200, kind: 'convert', group: 'Military',
    worker: 'carpenter', recipes: [
      { in: { wood: 1 }, out: { wooden_shield: 1 }, time: 12 },
      { in: { leather: 1 }, out: { leather_armor: 1 }, time: 12 }], desc: 'Makes wooden shields and leather armor.' },
  weaponsmith:{ name: 'Weapon smithy', icon: '🗡️', w: 2, h: 2, cost: { wood: 3, stone: 4 }, hp: 250, kind: 'convert', group: 'Military',
    worker: 'smith', recipes: [
      { in: { iron: 1, coal: 1 }, out: { sword: 1 }, time: 14 },
      { in: { iron: 1, coal: 1 }, out: { pike: 1 }, time: 14 },
      { in: { iron: 1, coal: 1 }, out: { crossbow: 1 }, time: 14 }], desc: 'Forges swords, pikes and crossbows.' },
  armorsmith: { name: 'Armor smithy', icon: '🔰', w: 2, h: 2, cost: { wood: 3, stone: 4 }, hp: 250, kind: 'convert', group: 'Military',
    worker: 'smith', recipes: [
      { in: { iron: 1, coal: 1 }, out: { iron_shield: 1 }, time: 14 },
      { in: { iron: 1, coal: 1 }, out: { iron_armor: 1 }, time: 14 }], desc: 'Forges iron shields and armor.' },
  stables:    { name: 'Stables', icon: '🐎', w: 3, h: 2, cost: { wood: 4, stone: 3 }, hp: 250, kind: 'convert', group: 'Military',
    worker: 'breeder', recipes: [{ in: { corn: 2 }, out: { horse: 1 }, time: 20 }], desc: 'Breeds horses on corn.' },
  barracks:   { name: 'Barracks', icon: '⚔️', w: 3, h: 3, cost: { wood: 6, stone: 6 }, hp: 500, kind: 'barracks', group: 'Military',
    desc: 'Stores weapons. Equips recruits as soldiers.' },
  tower:      { name: 'Watchtower', icon: '🗼', w: 2, h: 2, cost: { wood: 2, stone: 4 }, hp: 300, kind: 'tower', group: 'Military',
    range: 8, desc: 'A recruit inside throws stones at enemies in range.' },
};
export const BUILDING_LIST = Object.keys(BUILDINGS);
export const BUILD_GROUPS = ['Town', 'Basic', 'Food', 'Industry', 'Military'];

// Goods each building accepts as input, derived from recipes and kinds.
export function buildingInputs(def) {
  const set = new Set();
  if (def.recipes) for (const r of def.recipes) for (const g in r.in) set.add(g);
  if (def.kind === 'inn') FOOD_LIST.forEach(g => set.add(g));
  if (def.kind === 'school') set.add('gold');
  if (def.kind === 'barracks') WARFARE.forEach(g => set.add(g));
  if (def.kind === 'tower') set.add('stone');
  return [...set];
}
export function buildingOutputs(def) {
  if (def.out) return def.out.slice();
  const set = new Set();
  if (def.recipes) for (const r of def.recipes) for (const g in r.out) set.add(g);
  return [...set];
}
for (const k of BUILDING_LIST) {
  const d = BUILDINGS[k];
  d.type = k;
  d.inputs = buildingInputs(d);
  d.outputs = buildingOutputs(d);
}

export const DIFFICULTY = {
  peaceful: { name: 'Peaceful', firstAttack: Infinity, interval: Infinity, wave: 0, waveGrow: 0, cap: 20, trickle: 0, gold: 1, startArmy: 0.5 },
  easy:     { name: 'Easy',     firstAttack: 1320, interval: 540, wave: 6,  waveGrow: 2, cap: 18, trickle: 0, gold: 1, startArmy: 0.7 },
  normal:   { name: 'Normal',   firstAttack: 960,  interval: 420, wave: 9,  waveGrow: 3, cap: 30, trickle: 1, gold: 1, startArmy: 1.0 },
  hard:     { name: 'Hard',     firstAttack: 660,  interval: 300, wave: 12, waveGrow: 4, cap: 50, trickle: 2, gold: 2, startArmy: 1.3 },
};

export const PLAYER_COLORS = [
  { main: '#2f6fd6', dark: '#1d4a93', name: 'Blue' },
  { main: '#c8342b', dark: '#86201a', name: 'Red' },
];
