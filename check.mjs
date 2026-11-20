// Smoke check for Stunt Take. Node built-ins only. Usage: node check.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const scripts = [...html.matchAll(/<script id="(\w+)">([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
ok(scripts.length === 2, 'found 2 inline scripts (levels, game)');
for (const s of scripts) {
  try { new vm.Script(s.src, { filename: s.id + '.js' }); ok(true, `script "${s.id}" parses`); }
  catch (e) { ok(false, `script "${s.id}" parses: ${e.message}`); }
}
const ext = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\//gi)];
ok(ext.length === 0, 'no external src/href resources');
ok(!/https?:\/\//.test(scripts.map(s => s.src).join('\n')), 'no http(s) URLs inside scripts');
ok(html.length < 120 * 1024, `file size ${(html.length / 1024).toFixed(1)} KB < 120 KB`);

const sandbox = {}; sandbox.globalThis = sandbox;
vm.runInNewContext(scripts.find(s => s.id === 'levels').src, sandbox);
const levels = sandbox.STUNT_LEVELS;
ok(Array.isArray(levels) && levels.length === 3, '3 levels defined');

// Jump model (matches game constants: G=0.38, JV=-7, MAXV=2.1 → ~64px rise, ~77px air travel at same height)
function reach(up, dx) {
  if (dx <= 1 && up <= 0) return true;        // walk / step down
  if (up > 3) return false;
  if (up === 3) return dx <= 3;
  if (up >= 1) return dx <= 4;
  return dx <= 4 + (up <= -3 ? 1 : 0);        // level or falling
}

levels.forEach((lv, i) => {
  const tag = `level ${i + 1} (${lv.name})`;
  ok(lv.tiles.length === lv.w * lv.h, `${tag}: grid ${lv.w}x${lv.h} consistent`);
  const T = (x, y) => (x < 0 || x >= lv.w || y < 0 || y >= lv.h) ? 0 : lv.tiles[y * lv.w + x];
  ok(lv.start && T(lv.start.x, lv.start.y) === 0 && T(lv.start.x, lv.start.y + 1) === 1, `${tag}: start tile free and on ground`);
  ok(lv.goal != null || lv.boss, `${tag}: has goal or boss`);
  if (lv.goal != null) ok(lv.goal < lv.w - 2, `${tag}: goal inside level`);
  for (const e of lv.ents) if (['walker', 'robot', 'mark', 'reel'].includes(e.type) && T(e.x, e.y) === 1) { ok(false, `${tag}: ${e.type} at ${e.x},${e.y} inside solid`); }

  // standing cells
  const cells = new Map();
  const add = (x, y) => { if (x >= 0 && x < lv.w) cells.set(x + ',' + y, { x, y }); };
  for (let x = 0; x < lv.w; x++) for (let y = 0; y < lv.h - 1; y++)
    if (T(x, y) === 0 && T(x, y + 1) === 1 && T(x, y - 1) !== 1) add(x, y);
  for (const e of lv.ents) if (e.type === 'mplat') {
    const w = e.w || 3, r = e.range || 6;
    if ((e.ax || 'x') === 'x') { for (let x = e.x; x < e.x + r + w; x++) add(x, e.y - 1); }
    else { for (let k = 0; k <= r; k++) for (let x = e.x; x < e.x + w; x++) add(x, e.y - 1 - k); }
  }
  const target = lv.goal != null ? lv.goal : lv.boss.arenaX + 3;
  const list = [...cells.values()];
  const seen = new Set([lv.start.x + ',' + lv.start.y]);
  const q = [{ x: lv.start.x, y: lv.start.y }];
  let maxX = 0, won = false;
  while (q.length) {
    const c = q.shift(); maxX = Math.max(maxX, c.x);
    if (c.x >= target) { won = true; break; }
    for (const n of list) {
      const k = n.x + ',' + n.y;
      if (seen.has(k)) continue;
      if (reach(c.y - n.y, Math.abs(n.x - c.x))) { seen.add(k); q.push(n); }
    }
  }
  ok(won, `${tag}: reachable start→${lv.goal != null ? 'goal' : 'boss arena'} under jump model (furthest col ${maxX})`);
});

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
