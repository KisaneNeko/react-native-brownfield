const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDiagnosticsReport,
  shouldCaptureDiagnostics,
  writeDiagnosticsReport,
} = require('./e2e/detoxFailureDiagnostics.cjs');

test('report names what was being waited for', () => {
  const report = buildDiagnosticsReport({
    label: 'expo-android-greeting',
    needles: ['Hello native Android (Expo 56)'],
    xml: '<hierarchy />',
    logcat: 'E ActivityManager: boom',
    timestamp: '2026-09-15T06:00:00.000Z',
  });

  assert.match(report, /expo-android-greeting/u);
  assert.match(report, /Hello native Android \(Expo 56\)/u);
  assert.match(report, /2026-09-15T06:00:00\.000Z/u);
});

test('report embeds the hierarchy and the logcat tail', () => {
  const report = buildDiagnosticsReport({
    label: 'expo-android-greeting',
    needles: ['needle'],
    xml: '<hierarchy><node text="something else" /></hierarchy>',
    logcat: 'E ActivityManager: boom',
    timestamp: '2026-09-15T06:00:00.000Z',
  });

  assert.match(report, /<node text="something else" \/>/u);
  assert.match(report, /E ActivityManager: boom/u);
});

test('report is still usable when a capture came back empty', () => {
  const report = buildDiagnosticsReport({
    label: 'expo-android-greeting',
    needles: ['needle'],
    xml: null,
    logcat: null,
    timestamp: '2026-09-15T06:00:00.000Z',
  });

  assert.match(report, /needle/u);
  assert.match(report, /unavailable/iu);
});

test('writes the report under the artifacts root', () => {
  const writes = [];
  const fakeFs = {
    mkdirSync: () => {},
    writeFileSync: (path, contents) => writes.push({ path, contents }),
  };

  const written = writeDiagnosticsReport({
    label: 'expo-android-greeting',
    needles: ['needle'],
    xml: '<hierarchy />',
    logcat: 'log line',
    timestamp: '2026-09-15T06:00:00.000Z',
    rootDir: 'e2e-artifacts',
    fs: fakeFs,
  });

  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /^e2e-artifacts\//u);
  assert.match(writes[0].path, /expo-android-greeting/u);
  assert.equal(written, writes[0].path);
});

test('never throws when the filesystem rejects the write', () => {
  const fakeFs = {
    mkdirSync: () => {},
    writeFileSync: () => {
      throw new Error('EACCES');
    },
  };

  const written = writeDiagnosticsReport({
    label: 'expo-android-greeting',
    needles: ['needle'],
    xml: '<hierarchy />',
    logcat: 'log line',
    timestamp: '2026-09-15T06:00:00.000Z',
    rootDir: 'e2e-artifacts',
    fs: fakeFs,
  });

  assert.equal(written, null);
});

test('only captures when a call site opts in with a label', () => {
  assert.equal(shouldCaptureDiagnostics('expo-android-greeting'), true);
  assert.equal(shouldCaptureDiagnostics(undefined), false);
  assert.equal(shouldCaptureDiagnostics(''), false);
});
