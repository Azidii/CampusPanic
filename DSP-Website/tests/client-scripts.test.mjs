import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import vm from 'node:vm';

// These files are sent directly to browsers without a compilation step. A syntax
// error otherwise disables an entire page's controls before any handler runs.
const directory = new URL('../js/', import.meta.url);
for (const file of (await readdir(directory)).filter(file => file.endsWith('.js')).sort()) {
  test(`browser script parses: ${file}`, async () => {
    const source = await readFile(new URL(file, directory), 'utf8');
    assert.doesNotThrow(() => new Script(source, { filename: file }));
  });
}

test('opening another user clears a previously entered password reset', async () => {
  const listeners = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, dataset: {},
      addEventListener() {},
      classList: { add() {}, remove() {} }
    });
    return elements.get(id);
  };
  const editForm = element('editUserForm');
  editForm.reset = () => {
    for (const id of ['editUserId', 'editName', 'editEmail', 'editRole', 'editBuilding', 'editPassword']) element(id).value = '';
    element('editActive').checked = false;
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const source = await readFile(new URL('../js/admin-users.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document });
  listeners.get('DOMContentLoaded')();
  const clickEdit = async (id, name) => {
    const button = { dataset: { id, name, email: `${id}@test.invalid`, role: 'user', building: 'Library', active: 'true' } };
    await listeners.get('click')({ target: { closest: selector => selector === '.open-edit-user-btn' ? button : null } });
  };

  await clickEdit('first', 'First guard');
  element('editPassword').value = 'pending-reset-for-first-guard';
  await clickEdit('second', 'Second guard');
  assert.equal(element('editPassword').value, '');
  assert.equal(element('editUserId').value, 'second');
  assert.equal(element('editName').value, 'Second guard');
  assert.equal(element('editActive').checked, true);
});
