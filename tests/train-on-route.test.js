'use strict';
// A `train class` step takes the trainer of least detour on the guide's next
// steps, the player's Hearthstone and teleports counted (Own.trainerOnRoute).
// The travel planner is faked: straight running, a teleport from the player
// that lands at the Moonglade trainer, and a Hearthstone to an inn by the
// route's next place, which the planner takes when it saves 2 minutes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAddon } = require('./helpers/lua');
const { TEST_PACK, TEST_SOURCE } = require('./helpers/packs');

const MAP = '{ name = "Elwynn Forest", c = 0, left = 1500, right = -1500, top = 500, bottom = -1500 }';

// The npc the training step's group names, with the player at (px, py), the
// trainers `trainers` ({ npc, x, y }), the next step's goto at (rx, ry), and
// `fakes` (Lua) setting `teleport` = { x, y } and `inn` = { x, y } or nil.
function pick({ px, py, trainers, rx, ry, fakes = '' }) {
	const candidates = trainers.map((t) => `{ npc = ${t.npc}, npcName = "T${t.npc}", map = 1429, x = ${t.x}, y = ${t.y}, faction = "AH", classes = { "DRUID" } }`).join(', ');
	return runAddon({
		stubs: ['stub_world.lua'],
		before: `local w = stub.world
			w.addMap(1429, ${MAP}); w.moveTo(1429, ${px}, ${py})
			w.race, w.raceName, w.faction, w.class, w.className, w.level = "Tauren", "Tauren", "Horde", "DRUID", "Druid", 22`,
		addons: ['Polestar'],
		saved: { Polestar: 'PolestarCharDB = { schema = 1, guide = "test/train" }' },
		script: `${TEST_PACK}
${TEST_SOURCE}
Polestar.RegisterGuide({ id = "test/train", pack = "test", title = "Train", minLevel = 1, maxLevel = 60,
	steps = {
		{ title = "Druid trainer", goals = { { t = "train", class = true, candidates = { ${candidates} } } } },
		{ title = "On", goals = { { t = "goto", map = 1429, x = ${rx}, y = ${ry} } } },
	} })
local Nav = Polestar.Nav
local teleport, inn
${fakes}
local function at(p) return { map = 1429, x = p.x, y = p.y } end
local function run(a, b) return Polestar.DirectTravelCost(a, b) end
Nav.HearthInn = function() return inn and at(inn) or nil end
Nav.EstimateTravel = function(from, to, _, noHearth)
	local s = run(from or Polestar.PlayerPoint(), to)
	if from == nil and teleport then s = math.min(s, 10 + run(at(teleport), to)) end
	if from == nil and inn and not noHearth then
		local h = Nav.HEARTH_SECONDS + run(at(inn), to)
		if h + Nav.HEARTH_MARGIN <= s then s = h end
	end
	return s
end
stub.login(); stub.advance(0.5)
local E = Polestar.Engine
local v = E.GetStepView(1)
emit(v.groups[1] and v.groups[1].npc or 0)`,
	}).emitted[0];
}

test('#1357: the trainer in the town the guide goes on to, not the one behind the player', () => {
	const npc = pick({
		px: 20, py: 50, rx: 80, ry: 50,
		trainers: [{ npc: 1, x: 15, y: 50 }, { npc: 2, x: 79, y: 50 }],
	});
	assert.equal(npc, 2);
});

test('a trainer a teleport reaches, with the Hearthstone back to the route, beats trainers nearer as the crow flies', () => {
	// Four trainers east of the route, each a straight detour of about 3 minutes; Moonglade's (10, 10) is
	// over 6 minutes straight, but 10 s by the teleport, and the Hearthstone lands by the next place.
	const npc = pick({
		px: 50, py: 50, rx: 50, ry: 90,
		trainers: [{ npc: 1, x: 85, y: 60 }, { npc: 2, x: 85, y: 63 }, { npc: 3, x: 85, y: 66 }, { npc: 4, x: 85, y: 69 }, { npc: 5, x: 10, y: 10 }],
		fakes: 'teleport, inn = { x = 10, y = 10 }, { x = 50, y = 88 }',
	});
	assert.equal(npc, 5);
});

test('without the Hearthstone the teleported trainer\'s long way back counts, and a trainer on the way wins', () => {
	const npc = pick({
		px: 50, py: 50, rx: 50, ry: 90,
		trainers: [{ npc: 1, x: 52, y: 70 }, { npc: 5, x: 10, y: 10 }],
		fakes: 'teleport = { x = 10, y = 10 }',
	});
	assert.equal(npc, 1);
});
