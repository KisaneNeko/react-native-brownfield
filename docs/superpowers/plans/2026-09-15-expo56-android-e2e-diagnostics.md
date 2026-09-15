# Expo 56 Android E2E — Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the next Expo 56 Android E2E failure diagnosable, then reproduce it — without changing any test behaviour.

**Architecture:** Three independent evidence layers, then a reproduction attempt. Task 1 turns on Detox's own artifacts (logcat + screenshots). Task 2 adds a failure-time UIAutomator XML and logcat dump in the polling helper — the strongest signal, because we have proof UIAutomator was working during the observed failure. Task 3 makes the upload step actually surface those files. Task 4 gathers evidence from real CI runs. Each layer works if the others fail.

**Tech Stack:** Detox 20.51.1, `node:test`, CommonJS (`.cjs`) shared test helpers, GitHub Actions, `reactivecircus/android-emulator-runner`.

**Spec:** `docs/superpowers/specs/2026-09-15-e2e-ci-failures-design.md`

## Global Constraints

- **This plan changes no test behaviour.** No new retries, no changed timeouts, no altered launch strategy, no new waits. Diagnostics only. If you find yourself editing a timeout value, stop — that is Task 4's decision, gated on evidence.
- Everything under `apps/brownfield-example-shared-tests/e2e/` is CommonJS (`.cjs`) with `'use strict';` where the existing files have it. Match the surrounding file.
- Unit tests in this workspace must live at `apps/brownfield-example-shared-tests/<name>.test.cjs` — **top level only**. The workspace's test script is `node --test ./*.test.cjs`, which does not recurse into `e2e/`.
- Mirror the style of the existing `apps/brownfield-example-shared-tests/detox-ios-simulator-device.test.cjs`: `node:assert/strict`, `node:test`, one top-level `test(...)` per behaviour.
- Diagnostics must never throw. A failing diagnostic must not replace the real test failure — always swallow and continue.
- `keepOnlyFailedTestsArtifacts: true` everywhere. Green runs must not pay storage cost.
- Do not add a dependency on Detox's `uiHierarchy` plugin. Its Android support is unverified here; Task 2 covers the same need with a mechanism we know works.
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Background: what we know and what we don't

Observed failure (run `33749895553`, job `100638385268`):

```
Timed out waiting for UIAutomator to contain any of:
  Hello native Android (Expo 56), Hello native Android (Expo 57), Hello native Android (Expo
  at pollUntilUiAutomatorContainsAny (e2e/detoxUtils.cjs:159:5)
  at waitForAndroidAppReadyExpo   (e2e/androidAppDetoxUtils.cjs:156:3)
```

The app process started (`Android app process is up` at 12:01:47), then 90 s passed with no native shell.

Two facts that shape this plan:

1. `pollUntilUiAutomatorContainsAny` throws `lastError` when the dump throws, and the generic message only when `lastError` is unset. We got the generic message — so `dumpUiAutomatorHierarchy()` **succeeded on every poll**. We had the answer in hand on every iteration and discarded it.
2. `createAndroidAppEmulatorReleaseDetoxConfig` returns **no `artifacts` key at all**, so the upload step reported `No files were found with the provided path: apps/AndroidApp/artifacts.`

**This is likely a flake, not a regression.** Expo 57 was green in the same run; Expo 56 was green on 09-09 and 09-11. Do not assume you are fixing a live break. The deliverable is evidence.

---

### Task 1: Turn on Detox artifacts for the Android app

**Files:**
- Modify: `apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.cjs`
- Create: `apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.test.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `createAndroidAppEmulatorReleaseDetoxConfig({ gradleFlavor, detoxConfiguration?, jestConfigPath? })` now additionally returns an `artifacts` object of shape `{ rootDir: string, plugins: { log: {...}, screenshot: {...} } }`. Task 3 depends on `artifacts.rootDir === 'artifacts'`.

The factory is a pure function, so this is directly unit testable — and `yarn test:apps` already runs this workspace's `node --test` suite in CI's `build-lint` job.

- [ ] **Step 1: Write the failing test**

Create `apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.test.cjs`:

```js
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
```

That last test is a regression guard — it fails loudly if someone later reshapes the factory while adding artifacts.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd apps/brownfield-example-shared-tests && node --test ./detox-rc-androidapp-emulator-release.test.cjs
```

Expected: FAIL. The first three tests throw
`TypeError: Cannot read properties of undefined (reading 'rootDir')` because
`config.artifacts` does not exist. The fourth test passes.

- [ ] **Step 3: Add the artifacts config**

In `apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.cjs`, add an `artifacts` key to the returned object, immediately before the existing `behavior` key.

Before:
```js
  return {
    testRunner: {
      $0: 'jest',
      args: {
        config: jestConfigPath,
        _: ['e2e'],
      },
      jest: {
        setupTimeout: 300000,
      },
    },
    behavior: {
```

After:
```js
  return {
    testRunner: {
      $0: 'jest',
      args: {
        config: jestConfigPath,
        _: ['e2e'],
      },
      jest: {
        setupTimeout: 300000,
      },
    },
    // Relative to apps/AndroidApp (Detox cwd). CI uploads this directory on
    // failure — see .github/actions/androidapp-road-test/action.yml.
    artifacts: {
      rootDir: 'artifacts',
      plugins: {
        // `log` is logcat on Android — the signal missing from run 33749895553.
        log: {
          enabled: true,
          keepOnlyFailedTestsArtifacts: true,
        },
        screenshot: {
          enabled: true,
          shouldTakeAutomaticSnapshots: true,
          keepOnlyFailedTestsArtifacts: true,
          takeWhen: {
            testStart: false,
            testDone: true,
          },
        },
      },
    },
    behavior: {
```

Also extend the JSDoc `@returns` description above the function if it enumerates the returned shape; leave it alone if it just says `import('detox').DetoxConfig`.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd apps/brownfield-example-shared-tests && node --test ./*.test.cjs
```

Expected: PASS. All 4 new tests plus the 3 pre-existing
`detox-ios-simulator-device.test.cjs` tests — 7 total, 0 failing.

- [ ] **Step 5: Confirm CI picks this suite up**

```bash
yarn test:apps
```

Expected: PASS, and the turbo output includes
`@callstack/brownfield-example-shared-tests:test`. This confirms the new test
runs in `build-lint` without any workflow change.

- [ ] **Step 6: Commit**

```bash
git add apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.cjs \
        apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.test.cjs
git commit -m "$(cat <<'EOF'
test(e2e): capture logcat and screenshots for failed Android Detox runs

createAndroidAppEmulatorReleaseDetoxConfig returned no artifacts config at
all, so Detox wrote nothing and the CI upload step reported "No files were
found with the provided path: apps/AndroidApp/artifacts". The Expo 56
failure in run 33749895553 left no screenshot, no logcat and no hierarchy
to diagnose.

Enable the log (logcat) and screenshot plugins, both scoped to failed tests
so green runs cost nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Dump the UIAutomator hierarchy and logcat when a poll times out

**Files:**
- Create: `apps/brownfield-example-shared-tests/e2e/detoxFailureDiagnostics.cjs`
- Create: `apps/brownfield-example-shared-tests/detox-failure-diagnostics.test.cjs`
- Modify: `apps/brownfield-example-shared-tests/e2e/detoxUtils.cjs` (the `pollUntilUiAutomatorContainsAny` function, currently at lines 128-161, and `module.exports` at 559-582)

**Interfaces:**
- Consumes: `artifacts.rootDir === 'artifacts'` from Task 1 — the dump is written to the same directory Detox and CI use.
- Produces:
  - `buildDiagnosticsReport({ label, needles, xml, logcat, timestamp }): string` — pure, returns the report body.
  - `writeDiagnosticsReport({ label, needles, xml, logcat, timestamp, rootDir, fs }): string | null` — returns the written path, or `null` if writing failed. Never throws.

  Both exported from `e2e/detoxFailureDiagnostics.cjs`.

**Why a separate module:** `detoxUtils.cjs` does `require('detox')` at line 3, so it cannot be loaded by a plain `node --test` unit test. Putting the report logic in a dependency-free module makes it directly testable, and keeps `detoxUtils.cjs` to a thin call site.

- [ ] **Step 1: Write the failing test**

Create `apps/brownfield-example-shared-tests/detox-failure-diagnostics.test.cjs`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDiagnosticsReport,
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
    rootDir: 'artifacts',
    fs: fakeFs,
  });

  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /^artifacts\//u);
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
    rootDir: 'artifacts',
    fs: fakeFs,
  });

  assert.equal(written, null);
});
```

That last test encodes the hard rule: a broken diagnostic must never mask the real failure.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd apps/brownfield-example-shared-tests && node --test ./detox-failure-diagnostics.test.cjs
```

Expected: FAIL with `Cannot find module './e2e/detoxFailureDiagnostics.cjs'`.

- [ ] **Step 3: Write the module**

Create `apps/brownfield-example-shared-tests/e2e/detoxFailureDiagnostics.cjs`:

```js
'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');

const UNAVAILABLE = '(unavailable)';

/**
 * Build a human-readable report describing a failed UIAutomator wait.
 *
 * Pure: takes already-captured inputs so it can be unit tested without adb.
 *
 * @param {{
 *   label: string,
 *   needles: string[],
 *   xml: string | null,
 *   logcat: string | null,
 *   timestamp: string,
 * }} input
 * @returns {string}
 */
function buildDiagnosticsReport({ label, needles, xml, logcat, timestamp }) {
  return [
    `# Detox failure diagnostics: ${label}`,
    `Captured at: ${timestamp}`,
    '',
    'Waited for any of:',
    ...needles.map((needle) => `  - ${needle}`),
    '',
    '## UIAutomator hierarchy',
    xml && xml.trim() ? xml : UNAVAILABLE,
    '',
    '## Logcat tail',
    logcat && logcat.trim() ? logcat : UNAVAILABLE,
    '',
  ].join('\n');
}

/**
 * Write a diagnostics report into the Detox artifacts directory.
 *
 * Never throws — diagnostics must not replace the failure they describe.
 *
 * @returns {string | null} the written path, or null if writing failed.
 */
function writeDiagnosticsReport({
  label,
  needles,
  xml,
  logcat,
  timestamp,
  rootDir = 'artifacts',
  fs = nodeFs,
}) {
  try {
    const safeLabel = label.replace(/[^a-z0-9._-]+/giu, '-');
    const safeStamp = timestamp.replace(/[:.]/gu, '-');
    const filePath = path.join(rootDir, `${safeLabel}-${safeStamp}.txt`);

    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(
      filePath,
      buildDiagnosticsReport({ label, needles, xml, logcat, timestamp })
    );

    return filePath;
  } catch {
    return null;
  }
}

module.exports = { buildDiagnosticsReport, writeDiagnosticsReport };
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd apps/brownfield-example-shared-tests && node --test ./*.test.cjs
```

Expected: PASS. 12 tests total (3 iOS device + 4 from Task 1 + 5 new), 0 failing.

- [ ] **Step 5: Call it from the polling helper**

In `apps/brownfield-example-shared-tests/e2e/detoxUtils.cjs`:

First add the require alongside the existing ones at the top of the file (after the `DETOX_TIMING` require on line 4):

```js
const {
  writeDiagnosticsReport,
} = require('./detoxFailureDiagnostics.cjs');
```

Then add a capture helper next to the existing `dumpUiAutomatorHierarchy` (around line 62-64):

```js
function dumpLogcatTail(lines = 3000) {
  try {
    return adbExecOut(`logcat -d -v threadtime -t ${lines}`);
  } catch {
    return null;
  }
}

/**
 * Persist the last hierarchy we saw plus a logcat tail, for CI upload.
 * Swallows everything — a failed capture must not mask the real failure.
 */
function captureUiAutomatorFailure(label, needles, lastXml) {
  let xml = lastXml;
  if (!xml) {
    try {
      xml = dumpUiAutomatorHierarchy();
    } catch {
      xml = null;
    }
  }

  const written = writeDiagnosticsReport({
    label,
    needles,
    xml,
    logcat: dumpLogcatTail(),
    timestamp: new Date().toISOString(),
  });

  if (written) {
    console.log(`[e2e] wrote failure diagnostics to ${written}`);
  }
}
```

Now change `pollUntilUiAutomatorContainsAny` to remember the last dump and capture on timeout. The function currently reads:

```js
async function pollUntilUiAutomatorContainsAny(
  needles,
  timeoutMs = 20000,
  { keepCurrentActivity = false } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const xml = dumpUiAutomatorHierarchy();
      const matched = uiAutomatorHierarchyContainsAny(xml, needles);
      if (matched) {
        return matched;
      }
    } catch (error) {
      lastError = error;
    }
```

Change it to:

```js
async function pollUntilUiAutomatorContainsAny(
  needles,
  timeoutMs = 20000,
  { keepCurrentActivity = false, diagnosticsLabel = 'uiautomator-wait' } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastXml = null;

  while (Date.now() < deadline) {
    try {
      const xml = dumpUiAutomatorHierarchy();
      lastXml = xml;
      const matched = uiAutomatorHierarchyContainsAny(xml, needles);
      if (matched) {
        return matched;
      }
    } catch (error) {
      lastError = error;
    }
```

and change its tail from:

```js
  throw (
    lastError ||
    new Error(`Timed out waiting for UIAutomator to contain any of: ${needles.join(', ')}`)
  );
}
```

to:

```js
  captureUiAutomatorFailure(diagnosticsLabel, needles, lastXml);

  throw (
    lastError ||
    new Error(`Timed out waiting for UIAutomator to contain any of: ${needles.join(', ')}`)
  );
}
```

Leave the body of the loop between those two edits exactly as it is. Do not change the poll interval, the timeout, or the overlay-dismissal behaviour.

- [ ] **Step 6: Label the call site that failed**

In `apps/brownfield-example-shared-tests/e2e/androidAppDetoxUtils.cjs`, in `waitForAndroidAppReadyExpo` (the first poll, currently at lines 156-160), pass a label so the artifact filename says which wait died.

Before:
```js
  await pollUntilUiAutomatorContainsAny(
    EXPO_ANDROID_GREETING_NEEDLES,
    90000,
    EXPO_ANDROID_POLL
  );
```

After:
```js
  await pollUntilUiAutomatorContainsAny(EXPO_ANDROID_GREETING_NEEDLES, 90000, {
    ...EXPO_ANDROID_POLL,
    diagnosticsLabel: 'expo-android-greeting',
  });
```

`EXPO_ANDROID_POLL` is `{ keepCurrentActivity: true }`, so spreading it preserves the existing behaviour exactly. **The 90000 stays 90000.**

- [ ] **Step 7: Verify nothing regressed**

Run:
```bash
yarn test:apps
yarn lint
```

Expected: PASS both. `yarn lint` matters here — `detoxUtils.cjs` is large and the repo lints `.cjs`.

- [ ] **Step 8: Commit**

```bash
git add apps/brownfield-example-shared-tests/e2e/detoxFailureDiagnostics.cjs \
        apps/brownfield-example-shared-tests/detox-failure-diagnostics.test.cjs \
        apps/brownfield-example-shared-tests/e2e/detoxUtils.cjs \
        apps/brownfield-example-shared-tests/e2e/androidAppDetoxUtils.cjs
git commit -m "$(cat <<'EOF'
test(e2e): dump UIAutomator hierarchy and logcat when a poll times out

In run 33749895553 pollUntilUiAutomatorContainsAny threw its generic
timeout message rather than lastError, which proves dumpUiAutomatorHierarchy
succeeded on every poll — we were reading the answer and discarding it.

Persist the last hierarchy plus a logcat tail to the Detox artifacts dir on
timeout, and label the Expo Android greeting wait so the filename says which
wait died. Report building lives in a detox-free module so it is unit
testable; writes never throw, so a failed capture cannot mask the real
failure.

No timeouts, retries or waits changed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Make the artifact upload actually surface diagnostics

**Files:**
- Modify: `.github/actions/androidapp-road-test/action.yml:412-418`

**Interfaces:**
- Consumes: `artifacts/` written by Task 1 (Detox) and Task 2 (failure dumps), relative to `apps/AndroidApp`.
- Produces: no code interface. A CI artifact named `${{ inputs.e2e-artifact-name }}-${{ inputs.flavor }}-android`.

- [ ] **Step 1: Read the current step**

```bash
sed -n '405,420p' .github/actions/androidapp-road-test/action.yml
```

You should see:
```yaml
    - name: Upload Detox artifacts on failure
      if: failure() && (steps.e2e.outputs.phase == 'full' || steps.e2e.outputs.phase == 'test')
      uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
      with:
        name: ${{ inputs.e2e-artifact-name }}-${{ inputs.flavor }}-android
        path: apps/AndroidApp/artifacts
        if-no-files-found: ignore
```

- [ ] **Step 2: Change `if-no-files-found` to `warn` and add a listing step**

`if-no-files-found: ignore` is why run 33749895553 said `No artifacts will be uploaded` as a quiet info line. Make it visible, and print what was actually on disk so a future empty upload is self-explaining.

Replace the block from Step 1 with:

```yaml
    - name: List Detox artifacts (diagnostics)
      if: failure() && (steps.e2e.outputs.phase == 'full' || steps.e2e.outputs.phase == 'test')
      shell: bash
      run: |
        echo "==> Contents of apps/AndroidApp/artifacts"
        ls -lAR apps/AndroidApp/artifacts 2>/dev/null || echo "(directory does not exist)"

    - name: Upload Detox artifacts on failure
      if: failure() && (steps.e2e.outputs.phase == 'full' || steps.e2e.outputs.phase == 'test')
      uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
      with:
        name: ${{ inputs.e2e-artifact-name }}-${{ inputs.flavor }}-android
        path: apps/AndroidApp/artifacts
        if-no-files-found: warn
        retention-days: 14
```

The listing step runs before the upload, so even a totally empty artifacts directory produces a readable explanation in the log. `retention-days: 14` is enough to investigate a flake without holding emulator video-sized artifacts forever.

Do not change the `if:` conditions or the pinned action SHA.

- [ ] **Step 3: Validate the workflow parses**

```bash
yarn lint
gh workflow view ci.yml --repo callstack/react-native-brownfield >/dev/null && echo "remote workflow reachable"
```

If `actionlint` is available, prefer it:
```bash
actionlint .github/actions/androidapp-road-test/action.yml .github/workflows/ci.yml
```

Expected: no YAML or schema errors. If `actionlint` is not installed, skip it — do not install tooling as part of this task.

- [ ] **Step 4: Commit**

```bash
git add .github/actions/androidapp-road-test/action.yml
git commit -m "$(cat <<'EOF'
ci: surface Android Detox artifacts instead of silently skipping them

if-no-files-found: ignore meant run 33749895553 reported "No artifacts will
be uploaded" as a quiet info line, leaving the Expo 56 failure with nothing
to inspect. Switch to warn, list the directory before uploading so an empty
result explains itself, and cap retention at 14 days.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Reproduce, and gather evidence

**Files:** none. This task produces a written finding, not a code change.

**Interfaces:**
- Consumes: Tasks 1-3, all landed on the branch under test.
- Produces: a decision — real defect, or flake — recorded in the spec document.

**This task deliberately has no fix step.** Do not write one. If you reach the end of this task wanting to change a timeout, that is a new brainstorming conversation with the human partner, not a step here.

- [ ] **Step 1: Confirm the diagnostics fire locally before spending CI time**

Prove the Task 2 dump works by forcing a timeout against a needle that cannot match. From `apps/AndroidApp`, with an emulator running:

```bash
cd apps/AndroidApp
node -e "
const { pollUntilUiAutomatorContainsAny } = require('@callstack/brownfield-example-shared-tests/e2e/detoxUtils');
pollUntilUiAutomatorContainsAny(['__no_such_text__'], 3000, { keepCurrentActivity: true, diagnosticsLabel: 'smoke-test' })
  .catch((error) => console.log('threw as expected:', error.message));
"
ls -l artifacts/
```

Expected: the promise rejects with the timeout message, **and** `artifacts/smoke-test-*.txt` exists containing a `## UIAutomator hierarchy` section and a `## Logcat tail` section.

If `require('detox')` fails outside a Detox run, skip this step and rely on Step 2 — note in your report that the local smoke test was not possible.

- [ ] **Step 2: Ask before spending CI, then run the Expo 56 job**

**Ask the human partner for approval before triggering runs.** Each Android E2E run is roughly 30 minutes of CI, and reproducing a suspected flake means running it several times.

Once approved, push the branch and let CI run:

```bash
git push -u origin <this-branch>
gh run list --repo callstack/react-native-brownfield --branch <this-branch> --limit 5
```

Watch the Expo 56 job specifically:
```bash
gh run view <run-id> --repo callstack/react-native-brownfield | grep "Expo 5"
```

- [ ] **Step 3: If it goes green — try to force the flake**

A single green run proves nothing about an intermittent failure. Re-run the Expo 56 job several times:

```bash
gh run rerun <run-id> --repo callstack/react-native-brownfield --job <expo56-job-id>
```

Agree the number of attempts with the human partner first (3-5 is usually enough to distinguish "rare flake" from "fixed by accident"). Record the pass/fail tally.

- [ ] **Step 4: If it goes red — collect the evidence**

```bash
gh run download <run-id> --repo callstack/react-native-brownfield \
  --name detox-androidapp-expo56-expo56-android --dir /tmp/expo56-artifacts
ls -lAR /tmp/expo56-artifacts
```

Read, in this order:

1. `expo-android-greeting-*.txt` — the Task 2 dump. The `## UIAutomator hierarchy` section tells you what was actually on screen instead of the greeting. This is the single most informative artifact.
2. The `## Logcat tail` section of the same file — look for `FATAL EXCEPTION`, `ANR in`, `Force finishing activity`, or a `ReactNativeJS` error.
3. Detox's own `*.log` (logcat plugin) and `*.png` (screenshot plugin) from Task 1.

- [ ] **Step 5: Write up the finding**

Append a `## Reproduction findings (YYYY-MM-DD)` section to
`docs/superpowers/specs/2026-09-15-e2e-ci-failures-design.md` under Issue 2,
covering:

- how many runs, how many failed
- if it failed: what the hierarchy showed instead of the greeting, and the
  relevant logcat lines, quoted
- if it never failed: say so plainly, and state that the diagnostics are now
  in place for the next occurrence

Then commit:

```bash
git add docs/superpowers/specs/2026-09-15-e2e-ci-failures-design.md
git commit -m "$(cat <<'EOF'
docs: record Expo 56 Android E2E reproduction findings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify before claiming completion**

REQUIRED SUB-SKILL: use `superpowers:verification-before-completion`.

Run and paste the real output of:

```bash
yarn test:apps
yarn lint
git status --porcelain
git log --oneline origin/main..HEAD
```

State the outcome precisely. If the failure never reproduced, the honest
claim is **"diagnostics landed; root cause not reproduced in N runs"** — not
"fixed". Do not describe this plan as fixing the Expo 56 failure unless Step
4 produced evidence and a subsequent change addressed it.

---

## Self-Review Notes

- **Spec coverage:** all three diagnostic layers from the spec's "Design decisions" map to Tasks 1-3; the reproduce-then-decide gate is Task 4. The spec's explicit "no behavioural fix" constraint is enforced in Global Constraints and repeated at Task 4.
- **Interfaces:** `artifacts.rootDir === 'artifacts'` is produced in Task 1 and consumed in Tasks 2 and 3. `buildDiagnosticsReport` / `writeDiagnosticsReport` signatures match between the Task 2 Interfaces block, the test in Step 1, and the implementation in Step 3. `diagnosticsLabel` is introduced in Task 2 Step 5 and used in Step 6 with the same spelling.
- **Behaviour preservation checked:** Task 2 Step 6 spreads `EXPO_ANDROID_POLL` rather than replacing it, and keeps `90000`. Task 1 Step 1's fourth test guards `binaryPath`, `launchTimeout`, `shutdownDevice` and the configuration key against accidental reshaping.
- **Deliberate omission:** Detox's `uiHierarchy` plugin is not used. Its Android support is unverified in this investigation, and Task 2 covers the same need through `dumpUiAutomatorHierarchy()`, which the failure log proves was working.
- **Conditional steps are fully specified:** Task 4 Steps 3 and 4 branch on green/red, and both branches have complete instructions plus an explicit rule against inventing a fix.
