import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAudioPython } from '../services/audioService.js';

test('audio worker prefers its dedicated environment over the legacy root virtualenv and system python', () => {
  for (const platform of ['win32', 'linux']) {
    const projectRoot = path.resolve('fixture-project');
    const expected = path.join(projectRoot, 'Audio-Live', 'venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    assert.equal(resolveAudioPython({ env: {}, projectRoot, platform, fileExists: () => true }), expected);
  }
});

test('audio worker falls back to the legacy root virtualenv when its dedicated environment is absent', () => {
  for (const platform of ['win32', 'linux']) {
    const projectRoot = path.resolve('fixture-project');
    const expected = path.join(projectRoot, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    assert.equal(resolveAudioPython({ env: {}, projectRoot, platform, fileExists: candidate => candidate === expected }), expected);
  }
});

test('audio worker honors explicit interpreter paths and commands', () => {
  for (const interpreter of ['python3', 'C:/audio env/Scripts/python.exe']) {
    assert.equal(resolveAudioPython({ env: { AUDIO_PYTHON: interpreter }, fileExists: () => assert.fail('explicit interpreter takes precedence') }), interpreter);
  }
});

test('audio worker uses the system fallback when no environment is prepared', () => {
  assert.equal(resolveAudioPython({ env: { AUDIO_PYTHON: '   ' }, fileExists: () => false }), 'python');
});
