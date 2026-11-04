import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('button and LED GPIOs match the supplied PCB routing and wiring table', async () => {
  const sketch = await readFile(new URL('../ESP32.ino', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const pins = name => {
    const declaration = sketch.match(new RegExp(`${name}\\[\\] = \\{([^}]+)\\}`));
    assert.ok(declaration, `Missing ${name}`);
    return declaration[1].split(',').map(value => Number(value.trim()));
  };
  const buttons = pins('BUTTON_PINS');
  const leds = pins('LED_PINS');
  assert.deepEqual(buttons, [27, 26, 25]);
  assert.deepEqual(leds, [32, 33, 14]);
  assert.equal(new Set([...buttons, ...leds]).size, 6);
  buttons.forEach((pin, index) => {
    assert.ok(readme.includes(`| Button ${index + 1} / LED ${index + 1} | ${pin} / ${leds[index]} |`));
  });
});
