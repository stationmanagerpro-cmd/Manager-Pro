'use strict';
const assert = require('assert'); const Module = require('module'); const o = Module._load;
Module._load = function (req, ...a) {
  if (req === 'express') return { Router: () => ({ get() {}, put() {} }) };
  if (req === 'zod') { const z = new Proxy(function () {}, { get: () => z, apply: () => z }); return { z }; }
  if (req === './core') return { pool: {}, wrap: f => f, body: () => null, need: () => null, audit: () => null, setting: () => null };
  if (req === './safe') return { swallow: () => () => null };
  if (req === './alerts_extra') return {};
  return o.call(this, req, ...a);
};
const { progress } = require('../src/my_day');
assert.strictEqual(progress(0, 0, 5, 30), null);
assert.deepStrictEqual(progress(100, 100, 10, 30).status, 'atteint');
assert.strictEqual(progress(50, 100, 15, 30).status, 'en_avance');
assert.strictEqual(progress(45, 100, 15, 30).status, 'dans_le_rythme');
assert.strictEqual(progress(20, 100, 15, 30).status, 'en_retard');
assert.strictEqual(progress(30, 100, 10, 30).remaining, 70);
console.log('my-day : OK');
