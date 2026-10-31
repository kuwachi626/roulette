const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require("node:path").join(__dirname, "../index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function setup({ savedSound = null, audio = true, storageFails = false } = {}) {
	let now = 0, callback, roll = 0.5;
	const tones = [];
	const storage = new Map(savedSound === null ? [] : [["roulette-sound", savedSound]]);
	const element = () => ({
		hidden: true, checked: false, disabled: false, children: [], listeners: {},
		style: { setProperty(key, value) { this[key] = value; } },
		addEventListener(event, fn) { this.listeners[event] = fn; },
		querySelectorAll() { return [...this.children]; },
		appendChild(child) {
			this.children.push(child);
			child.remove = () => this.children.splice(this.children.indexOf(child), 1);
		},
	});
	const boxes = ["ALL", "シンデレラ", "ミリオン", "SideM", "シャニ", "学園", "ヴイアライヴ"]
		.map(value => ({ value, checked: true, getAttribute: () => "#fff" }));
	const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], element()]));
	Object.assign(ids.rouletteCanvas, {
		width: 360, height: 360, getContext: () => new Proxy({}, { get: () => () => {} }),
	});
	const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
	class AudioContext {
		state = "suspended"; currentTime = 0; destination = {};
		resume() { this.state = "running"; return Promise.resolve(); }
		createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
		createOscillator() {
			return { frequency: param(), connect() {}, disconnect() {}, start() { tones.push(this); }, stop() { this.onended?.(); } };
		}
	}
	const math = Object.create(Math);
	math.random = () => roll;
	const sandbox = {
		Math: math, window: audio ? { AudioContext } : {},
		localStorage: {
			getItem(key) { if (storageFails) throw Error("blocked"); return storage.get(key) ?? null; },
			setItem(key, value) { if (storageFails) throw Error("blocked"); storage.set(key, value); },
		},
		document: {
			getElementById: id => ids[id], createElement: element,
			querySelectorAll: query => query.includes(":checked") ? boxes.filter(box => box.checked) : boxes,
		},
		performance: { now: () => now }, requestAnimationFrame: fn => (callback = fn, 1),
		cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, alert() {},
	};
	vm.createContext(sandbox);
	const run = code => vm.runInContext(code, sandbox);
	run(script);
	return {
		ids, boxes, run, tones, storage,
		roll(value) { roll = value; },
		tick(ms) { now += ms; callback(); },
		select(values) { boxes.forEach(box => box.checked = values.includes(box.value)); run("updateRoulette()"); },
	};
}

test("SideM holds, darkens, strikes, reveals and restores controls on one timeline", () => {
	const app = setup();
	const { ids, run, tick, tones } = app;
	ids.reversalTest.checked = true;
	run("startRoulette()");
	tick(5000);
	assert.equal(ids.result.innerText, "SideM");
	assert.equal(ids.reversalEffect.hidden, true);
	assert.equal(ids.spinButton.disabled, true);
	tick(999);
	assert.equal(tones.length, 0);
	tick(1);
	assert.equal(ids.reversalEffect.hidden, false);
	assert.equal(ids.reversalEffect.style["--reversal-time"], "-1000ms");
	assert.equal(tones.length, 1);
	tick(600);
	assert.equal(tones.length, 3);
	tick(700);
	assert.equal(ids.result.innerText, "コメティック");
	assert.equal(tones.length, 7);
	tick(500);
	assert.equal(tones.length, 7, "sounds fire once per stage");
	run("startRoulette(); updateRoulette()");
	assert.equal(ids.spinButton.disabled, true);
	tick(1200);
	assert.equal(ids.reversalEffect.hidden, true);
	assert.equal(ids.spinButton.disabled, false);
	assert.equal(ids.reversalTest.disabled, false);
	assert.equal(run("wheelItems[3].text"), "コメティック");
	assert.equal(run("activeItems[3].text"), "SideM");
	run("startRoulette()");
	assert.equal(run("wheelItems[3].text"), "SideM");
});

test("background resume completes without replaying missed sounds", () => {
	const app = setup();
	app.ids.reversalTest.checked = true;
	app.run("startRoulette()"); app.tick(5000); app.tick(10000);
	assert.equal(app.ids.result.innerText, "コメティック");
	assert.equal(app.run("isSpinning"), false);
	assert.equal(app.ids.reversalEffect.hidden, true);
	assert.equal(app.tones.length, 0);
});

test("mute is saved and silences an active effect immediately", () => {
	const app = setup();
	app.ids.reversalTest.checked = true;
	app.run("startRoulette()"); app.tick(5000); app.tick(1000);
	app.ids.soundEnabled.checked = false;
	app.ids.soundEnabled.listeners.change();
	assert.equal(app.run("audioMaster.gain.value"), 0);
	assert.equal(app.storage.get("roulette-sound"), "off");
	app.tick(600); app.tick(700); app.tick(1700);
	assert.equal(app.tones.length, 1);
	assert.equal(app.ids.result.innerText, "コメティック");
	assert.equal(setup({ savedSound: "off" }).ids.soundEnabled.checked, false);
});

test("missing audio and denied storage do not block the result", () => {
	const app = setup({ audio: false, storageFails: true });
	app.ids.reversalTest.checked = true;
	app.ids.soundEnabled.listeners.change();
	app.run("startRoulette()"); app.tick(5000); app.tick(1000); app.tick(600); app.tick(700); app.tick(1700);
	assert.equal(app.ids.result.innerText, "コメティック");
	assert.equal(app.run("isSpinning"), false);
});

test("other brands skip reversal and existing chance thresholds stay unchanged", () => {
	const app = setup({ audio: false });
	for (const brand of ["ALL", "シンデレラ", "ミリオン", "学園", "ヴイアライヴ"]) {
		app.select([brand]); app.roll(0.5); app.run("startRoulette()"); app.tick(5000);
		assert.equal(app.ids.result.innerText, brand);
		assert.equal(app.run("isSpinning"), false);
		assert.equal(app.ids.reversalEffect.hidden, true);
	}
	for (const [selection, threshold] of [[["ALL", "SideM"], 0.05], [["シャニ"], 0.2]]) {
		for (const [roll, expected] of [[threshold - 0.001, true], [threshold, false]]) {
			app.select(selection); app.roll(roll); app.run("startRoulette()");
			assert.equal(app.run("chanceSpin"), expected);
			app.tick(5000);
			assert.equal(app.run("isSpinning"), false);
		}
	}
});
