const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAndroidAppEmulatorReleaseDetoxConfig,
} = require('./detox-rc-androidapp-emulator-release.cjs');

test('writes artifacts into the directory CI uploads from', () => {
  const config = createAndroidAppEmulatorReleaseDetoxConfig({
    gradleFlavor: 'expo56',
  });

  assert.equal(config.artifacts.rootDir, 'artifacts');
});

test('captures logcat only for failed tests', () => {
  const config = createAndroidAppEmulatorReleaseDetoxConfig({
    gradleFlavor: 'expo56',
  });

  assert.equal(config.artifacts.plugins.log.enabled, true);
  assert.equal(config.artifacts.plugins.log.keepOnlyFailedTestsArtifacts, true);
});

test('captures a screenshot when a test finishes failing', () => {
  const config = createAndroidAppEmulatorReleaseDetoxConfig({
    gradleFlavor: 'expo56',
  });

  assert.equal(config.artifacts.plugins.screenshot.enabled, true);
  assert.equal(
    config.artifacts.plugins.screenshot.keepOnlyFailedTestsArtifacts,
    true
  );
  assert.equal(config.artifacts.plugins.screenshot.takeWhen.testDone, true);
});

test('keeps the existing app and device wiring intact', () => {
  const config = createAndroidAppEmulatorReleaseDetoxConfig({
    gradleFlavor: 'expo56',
    detoxConfiguration: 'android.emu.release.expo56',
    jestConfigPath: 'e2e/jest.config.expo56.cjs',
  });

  assert.equal(
    config.apps['android.release'].binaryPath,
    'app/build/outputs/apk/expo56/release/app-expo56-release.apk'
  );
  assert.equal(config.apps['android.release'].launchTimeout, 300000);
  assert.equal(config.behavior.cleanup.shutdownDevice, false);
  assert.ok(config.configurations['android.emu.release.expo56']);
});
