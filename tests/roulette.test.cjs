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
		hidden: true, checked: false, disabled: false, children: [], listeners: {}, dataset: {},
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
	ids.reversalTestOutcome.value = "reverse";
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
	assert.equal(ids.reversalEffect.dataset.outcome, "normal");
	assert.equal(tones.length, 1);
	tick(600);
	assert.equal(ids.reversalEffect.dataset.outcome, "reverse");
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

test("all other brands darken and retain their own result and wheel", () => {
	const app = setup({ audio: false });
	for (const brand of ["ALL", "シンデレラ", "ミリオン", "学園", "ヴイアライヴ"]) {
		app.select([brand]); app.roll(0.5); app.run("startRoulette()"); app.tick(5000);
		assert.equal(app.ids.result.innerText, brand);
		assert.equal(app.run("isSpinning"), true);
		assert.equal(app.ids.reversalEffect.hidden, true);
		app.tick(1000);
		assert.equal(app.ids.reversalEffect.hidden, false);
		assert.equal(app.ids.stoppedLabelUpper.textContent, brand);
		assert.equal(app.ids.stoppedLabelLower.textContent, brand);
		assert.equal(app.ids.reversalEffect.dataset.outcome, "normal");
		app.tick(1300);
		assert.equal(app.ids.result.innerText, brand);
		app.tick(500);
		assert.equal(app.ids.reversalEffect.hidden, true);
		assert.equal(app.run("isSpinning"), false);
		assert.equal(app.run("wheelItems[0].text"), brand);
	}
	app.select(["SideM", "シャニ"]);
	app.roll(0.75); app.run("startRoulette()"); app.tick(5000); app.tick(2800);
	assert.equal(app.ids.result.innerText, "シャニ");
});

test("SideM non-reversal keeps result, has only shared low tone, and unlocks at 2.8s", () => {
	const app = setup();
	app.ids.reversalTest.checked = true;
	app.ids.reversalTest.listeners.change();
	assert.equal(app.ids.reversalTestOutcome.hidden, false);
	app.ids.reversalTestOutcome.value = "keep";
	app.run("startRoulette()"); app.tick(5000);
	assert.equal(app.ids.reversalTestOutcome.disabled, true);
	app.tick(1000);
	assert.equal(app.tones.length, 1);
	app.tick(600); app.tick(700);
	assert.equal(app.ids.reversalEffect.dataset.outcome, "normal");
	assert.equal(app.ids.result.innerText, "SideM");
	assert.equal(app.run("wheelItems[3].text"), "SideM");
	app.tick(499);
	assert.equal(app.ids.spinButton.disabled, true);
	app.tick(1);
	assert.equal(app.ids.result.innerText, "SideM");
	assert.equal(app.tones.length, 1);
	assert.equal(app.ids.spinButton.disabled, false);
	assert.equal(app.ids.reversalTestOutcome.disabled, false);
	app.select(["学園"]);
	assert.equal(app.ids.reversalTest.checked, false);
	assert.equal(app.ids.reversalTestOutcome.hidden, true);
	assert.equal(app.ids.reversalTestOutcome.value, "reverse");
});

test("SideM reverses only below 20%, drawing once at stop", () => {
	for (const [roll, expected] of [[0.199999, "コメティック"], [0.2, "SideM"]]) {
		const app = setup({ audio: false });
		app.select(["SideM"]);
		app.roll(0.5); app.run("startRoulette()");
		app.roll(roll); app.tick(5000);
		app.roll(1 - roll);
		app.tick(1000); app.tick(600); app.tick(700); app.tick(1700);
		assert.equal(app.ids.result.innerText, expected);
		assert.equal(app.run("wheelItems[0].text"), expected);
		assert.equal(app.run("isSpinning"), false);
	}
});

test("brand 5% chance remains and CoMETIK gets normal confirmation without another strike", () => {
	for (const [roll, expected] of [[0.049999, true], [0.05, false]]) {
		const app = setup();
		app.select(["ALL"]); app.roll(roll); app.run("startRoulette()");
		assert.equal(app.run("chanceSpin"), expected);
		app.tick(1750);
		assert.equal(app.ids.cometEffect.hidden, !expected);
		app.tick(3250); app.tick(1000); app.tick(1300);
		assert.equal(app.ids.reversalEffect.dataset.outcome, "normal");
		assert.equal(app.tones.length, 1);
		app.tick(500);
		assert.equal(app.ids.result.innerText, expected ? "コメティック" : "ALL");
		assert.equal(app.run("isSpinning"), false);
	}
});

test("Shiny alone draws every unit without comet chance or post-stop darkness", () => {
	const app = setup();
	app.select(["シャニ"]);
	const expected = app.run("shinyUnits.map(item => item.text).join('|')").split("|");
	for (let i = 0; i < expected.length; i++) {
		app.roll((i + 0.5) / expected.length); app.run("startRoulette()");
		assert.equal(app.run("chanceSpin"), false);
		app.tick(1750);
		assert.equal(app.ids.cometEffect.hidden, true);
		app.tick(3250);
		assert.equal(app.ids.result.innerText, expected[i]);
		assert.equal(app.ids.reversalEffect.hidden, true);
		assert.equal(app.run("isSpinning"), false);
	}
});

test("normal darkness completes correctly after background resume", () => {
	const app = setup();
	app.ids.reversalTest.checked = true;
	app.ids.reversalTestOutcome.value = "keep";
	app.run("startRoulette()"); app.tick(5000); app.tick(10000);
	assert.equal(app.ids.result.innerText, "SideM");
	assert.equal(app.ids.reversalEffect.hidden, true);
	assert.equal(app.ids.spinButton.disabled, false);
	assert.equal(app.tones.length, 0);
});
