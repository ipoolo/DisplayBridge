const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Mac adapter sends valid Get VCP checksum and rejects invalid replies', {
  skip: process.platform !== 'darwin', timeout: 30000
}, () => {
  const root = path.join(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'displaybridge-native-test-'));
  try {
    const binary = path.join(temp, 'read-test');
    const args = ['clang', '-fmodules', '-DMAX_DISPLAYS=16', '-I', 'vendor/m1ddc/headers',
      'tests/native-mac-read.m', 'vendor/m1ddc/sources/i2c.m', 'vendor/m1ddc/sources/ioregistry.m',
      '-framework', 'Foundation', '-framework', 'IOKit', '-framework', 'CoreGraphics',
      '-framework', 'ApplicationServices', '-framework', 'CoreDisplay', '-o', binary];
    const build = spawnSync('xcrun', args, {cwd: root, encoding: 'utf8', timeout: 20000});
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    const run = spawnSync(binary, [], {encoding: 'utf8', timeout: 5000});
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
