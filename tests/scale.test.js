'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const scale = require('../picker/js/core/scale.js');

const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
ajv.addSchema(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'identity.schema.json'), 'utf8')));
const validateTypeScale = ajv.getSchema('urn:hawiya:schema:identity:1#/properties/tokens/properties/typeScale');

// Hand-written expectations (common scales), two decimals.
const KNOWN = [
  [{ base: 16, ratio: 1.25, steps: 6, below: 1 }, [12.8, 16, 20, 25, 31.25, 39.06]],
  [{ base: 16, ratio: 1.2, steps: 5 }, [16, 19.2, 23.04, 27.65, 33.18]],
  [{ base: 16, ratio: 1.5, steps: 4, below: 1 }, [10.67, 16, 24, 36]],
  [{ base: 14, ratio: 1.125, steps: 3 }, [14, 15.75, 17.72]],
  [{ base: 18, ratio: 1.333, steps: 4, below: 2 }, [10.13, 13.5, 18, 23.99]]
];

test('known scales match hand-computed values (two decimals)', () => {
  for (const [opts, want] of KNOWN) assert.deepEqual(scale.generate(opts), want, JSON.stringify(opts));
});

// Expected values computed with exact fractions and decimal half-up rounding (Python, outside this code).
const EXACT = [
  [{ base: 10, ratio: 1.15, steps: 3 }, [10, 11.5, 13.23]], // Math.pow would give 13.22
  [{ base: 25, ratio: 1.067, steps: 3 }, [25, 26.68, 28.46]], // tie 26.675 → up
  [{ base: 25, ratio: 1.333, steps: 3 }, [25, 33.33, 44.42]], // tie 33.325 → up
  [{ base: 12.5, ratio: 1.15, steps: 3 }, [12.5, 14.38, 16.53]], // tie 14.375 → up
  [{ base: 15, ratio: 1.333, steps: 4, below: 1 }, [11.25, 15, 20, 26.65]], // 19.995 → 20 even with a small size
  [{ base: 22, ratio: 1.5, steps: 7, below: 2 }, [9.78, 14.67, 22, 33, 49.5, 74.25, 111.38]],
  [{ base: 10, ratio: 2, steps: 5 }, [10, 20, 40, 80, 160]], // ratio 2 (schema maximum) is allowed
  [{ base: 16, ratio: 1.1, steps: 4, below: 3 }, [12.02, 13.22, 14.55, 16]] // every other size below the base
];

test('matches exact decimal arithmetic, including half-way ties and the largest ratio', () => {
  for (const [opts, want] of EXACT) assert.deepEqual(scale.generate(opts), want, JSON.stringify(opts));
});

test('sizes above the base do not depend on how many small sizes are requested', () => {
  for (const base of [10, 14, 15, 16, 18, 21, 22, 24, 32]) {
    for (const ratio of [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618]) {
      let ref;
      try {
        ref = scale.generate({ base, ratio, steps: 5 });
      } catch {
        continue;
      }
      for (let below = 1; below <= 3; below++) {
        let s;
        try {
          s = scale.generate({ base, ratio, steps: 5 + below, below });
        } catch {
          continue;
        }
        assert.deepEqual(s.slice(below), ref, `${base}/${ratio} below ${below}`);
      }
    }
  }
});

test('below must be smaller than steps even when the sizes would be in range', () => {
  assert.throws(() => scale.generate({ base: 16, ratio: 1.1, steps: 3, below: 3 }), /below must be/);
});

test('every generated scale fits the identity schema and is strictly increasing with the base exact', () => {
  let n = 0;
  for (let base = 10; base <= 32; base += 0.5) {
    for (const ratio of [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618]) {
      for (let steps = 3; steps <= 8; steps++) {
        for (let below = 0; below < Math.min(steps, 3); below++) {
          let sizes;
          try {
            sizes = scale.generate({ base, ratio, steps, below });
          } catch (e) {
            assert.match(e.message, /outside 6\.\.200|equal after rounding/, `${base}/${ratio}/${steps}/${below}`);
            continue;
          }
          assert.equal(sizes.length, steps);
          assert.equal(sizes[below], base);
          for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
          for (const s of sizes) assert.equal(Math.round(s * 100) / 100, s, `${s} has more than two decimals`);
          assert.ok(validateTypeScale({ base, ratio, steps: sizes }), JSON.stringify(validateTypeScale.errors));
          n++;
        }
      }
    }
  }
  assert.ok(n > 1500, String(n));
});

test('same input, same output; repeated multiplication gives the same values as the closed form (± rounding)', () => {
  const a = scale.generate({ base: 16, ratio: 1.333, steps: 12, below: 3 });
  assert.deepEqual(scale.generate({ base: 16, ratio: 1.333, steps: 12, below: 3 }), a);
  a.forEach((s, i) => assert.ok(Math.abs(s - 16 * Math.pow(1.333, i - 3)) <= 0.005 + 1e-9, `step ${i}`));
});

test('refuses inputs outside the schema limits instead of returning a broken scale', () => {
  const bad = [
    null, {}, { base: 9, ratio: 1.25, steps: 5 }, { base: 33, ratio: 1.25, steps: 5 }, { base: '16', ratio: 1.25, steps: 5 },
    { base: 16, ratio: 1, steps: 5 }, { base: 16, ratio: 0.8, steps: 5 }, { base: 16, ratio: 2.5, steps: 5 },
    { base: 16, ratio: NaN, steps: 5 }, { base: 16, ratio: 1.25, steps: 2 }, { base: 16, ratio: 1.25, steps: 13 },
    { base: 16, ratio: 1.25, steps: 4.5 }, { base: 16, ratio: 1.25, steps: 5, below: 5 }, { base: 16, ratio: 1.25, steps: 5, below: -1 },
    { base: 32, ratio: 2, steps: 5 }, // 512 px > 200
    { base: 10, ratio: 2, steps: 5, below: 2 }, // 2.5 px < 6
    { base: 16, ratio: 1.0001, steps: 5 } // sizes equal after rounding
  ];
  for (const b of bad) assert.throws(() => scale.generate(b), /Hawiya\.scale/, JSON.stringify(b));
});

test('loads as a plain browser script (window.Hawiya.scale)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'core', 'scale.js'), 'utf8');
  const sandbox = { self: { Hawiya: { kept: 1 } } };
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.self.Hawiya.kept, 1);
  assert.deepEqual(Array.from(sandbox.self.Hawiya.scale.generate({ base: 16, ratio: 1.25, steps: 5 })), [16, 20, 25, 31.25, 39.06]);
});
