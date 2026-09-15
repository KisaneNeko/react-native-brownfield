# E2E CI Failures — Investigation & Design

**Date:** 2026-09-15
**Status:** Approved for planning
**Scope:** Two independent CI failures, tracked separately from here on.

## Summary

Two failing CI surfaces were reported:

1. **E2E Expo preview scheduled job** — example run
   [34742219413](https://github.com/callstack/react-native-brownfield/actions/runs/34742219413/job/103683722265)
2. **E2E Android tests on Expo 56** — example run
   [33749895553](https://github.com/callstack/react-native-brownfield/actions/runs/33749895553/job/100638385268)

They share no code and no root cause. Issue 1 is fully root-caused and
reproduced locally. Issue 2 is **not** root-caused, and the evidence
contradicts the premise that it is consistently failing. The two are split
into separate plans so they can be worked independently.

---

## Issue 1 — Expo preview scheduled job

### Root cause (confirmed, reproduced locally)

`scripts/check-expo-preview.ts:201` contains:

```ts
const updated = contents.replace(
  /\n}\s*$/u,
  `${CONSUMER_ROAD_TEST_NAVIGATION_METHODS}\n}`
);
```

With the `u` (unicode) flag, an unescaped `}` is not a literal — it is a
malformed quantifier. This is a **parse-time** error, so the module fails to
load before a single line of it executes:

```
$ node --experimental-strip-types --no-warnings \
    -e "import('./scripts/check-expo-preview.ts').catch(e => console.log(e.message))"
Invalid regular expression: /\n}\s*$/u: Lone quantifier brackets
```

The escaped form is valid and behaves as intended:

```
$ node -e "const re=/\n\}\s*$/u; console.log(re.test('interface X {\n  foo(): void;\n}\n'))"
true
```

### Why it went unnoticed

`scripts/__tests__/check-expo-preview.test.ts` exists, contains 9 `node:test`
cases, and **directly covers `ensureConsumerNavigationSpec`** (lines 104 and
116). Running it surfaces the bug immediately:

```
$ node --experimental-strip-types --no-warnings --test scripts/__tests__/check-expo-preview.test.ts
✖ scripts/__tests__/check-expo-preview.test.ts
ℹ tests 1  ℹ pass 0  ℹ fail 1
```

That suite has never run anywhere:

- `scripts/` is not a yarn workspace — `package.json` declares
  `["packages/*", "apps/*", "docs", "gradle-plugins/*"]`.
- The root package has no `test` script and no jest/vitest config.
- CI's `build-lint` job runs only `yarn test:apps`
  (`turbo test --filter='./apps/*'`) and `yarn test:packages`
  (`turbo test --filter='./packages/*'`).

**The missing CI wiring is the real defect.** The regex is just the first
bug it let through.

### Blast radius

The bug was introduced in `1e08ea5` (2026-07-14). Every scheduled run since
has failed at the first step with this exact `SyntaxError` — verified on runs
`31298447478` (08-09), `33056743638` (08-27), `34742219413` (09-13) and
`34935826821` (09-15, today). All 20 runs in the retained history failed.

Consequence: **the scheduled workflow has never progressed past its first
step.** The downstream steps — "Check whether this Expo preview was already
tested", "Finalize test decision", and the Android/iOS road-test jobs — have
never executed in CI. The `--apply` code path
(`.github/workflows/expo-preview-road-test.yml:73,112`), which is what
actually calls `ensureConsumerNavigationSpec` and `generateExpoPreviewApp`,
is entirely unvalidated.

Fixing the regex will make the first step pass. It should not be assumed to
make the workflow pass. The plan treats post-fix breakage as expected, not
exceptional.

### Design decisions

- Fix the regex by escaping the brace: `/\n\}\s*$/u`. Keep the `u` flag —
  dropping it would silently change semantics elsewhere in the pattern and
  weaken it against future edits.
- The failing test already exists. Task 1 needs no new test written — it
  needs the existing one *run*, which satisfies the red step honestly.
- Wire `scripts/__tests__/` into `build-lint` via a root `test:scripts`
  script. Rejected alternative: promoting `scripts/` to a yarn workspace —
  larger blast radius (turbo graph, install topology, lint config) for no
  extra safety.
- Verify the `--apply` path locally before trusting CI, then dispatch the
  workflow manually once.

---

## Issue 2 — Expo 56 Android Detox E2E

### What actually failed

```
FAIL ../brownfield-example-shared-tests/e2e/androidAppExpoBrownfield.e2e.js (151.76 s)
  ✕ shows the native greeting shell and embedded Expo home
  ✕ records the RN postMessage bubble in the Expo surface

  Timed out waiting for UIAutomator to contain any of:
    Hello native Android (Expo 56), Hello native Android (Expo 57), Hello native Android (Expo
    at pollUntilUiAutomatorContainsAny (e2e/detoxUtils.cjs:159:5)
    at waitForAndroidAppReadyExpo   (e2e/androidAppDetoxUtils.cjs:156:3)
    at Object.<anonymous>           (e2e/androidAppExpoBrownfield.e2e.js:24:5)
```

Both tests fail from the same `beforeAll`. The timeline:

| Time | Event |
|---|---|
| 12:01:11 | `[e2e] Launching brownfield app via Detox...` |
| 12:01:43 | `[e2e] Waiting for Android app process...` |
| 12:01:47 | `[e2e] Android app process is up` |
| 12:01:47 | `[e2e] Waiting for native Expo Android greeting...` |
| 12:03:20 | 90 s budget exhausted — `[FAIL]` |

### What the evidence rules out

- **Not a UIAutomator failure.** `pollUntilUiAutomatorContainsAny`
  (`detoxUtils.cjs:128-161`) throws `lastError` when the dump throws, and
  falls back to the generic `Timed out waiting for...` message only when
  `lastError` is unset. We got the generic message, so
  `dumpUiAutomatorHierarchy()` **succeeded on every poll** — the dumps simply
  never contained the greeting.
- **Not a wrong-needle bug.** `EXPO_ANDROID_GREETING_NEEDLES`
  (`androidAppDetoxUtils.cjs:18-22`) includes the open-ended prefix
  `'Hello native Android (Expo'`, and
  `apps/AndroidApp/app/src/expo56/.../ReactNativeConstants.kt:5` defines
  `APP_NAME = "Android (Expo 56)"`, rendered by `GreetingCard.kt:71` as
  `"Hello native $name 👋"`. The strings line up.
- **Not a build failure.** `Build AndroidApp & Detox APKs (Expo 56)` passed
  in the same run (23m19s), and the E2E job consumed its prebuilt APKs.

So: the app process started, and then its UI never rendered the native shell
for 90 seconds. Crash-after-start, ANR, or an activity that never reached the
foreground are all consistent with this. We cannot distinguish them.

### Why the premise is in doubt

| Run | Branch | Date | Expo 56 | Expo 57 |
|---|---|---|---|---|
| 33489024053 | e2e-for-android | 09-01 | ✓ | ✓ |
| 33513645320 | main | 09-01 | ✓ | ✓ |
| **33749895553** | **main** | **09-03** | **✗** | **✓** |
| 34354305730 | feat/bgp-transitive-dependencies-rnc | 09-09 | ✓ | ✓ |
| 34582797299 | fix/457/back-callback-lifecycle | 09-11 | ✓ | ✓ |

One failure. Expo 57 green in the same run on the same shared spec file. Expo
56 green on branches cut from main both before and after. That is the profile
of a **flake**, not a regression.

Caveat that keeps this open: there have been **no `main` runs since
2026-09-03**, so main itself is unverified. The 09-09 and 09-11 green runs are
feature branches, which is strong but not conclusive evidence for main.

### The blocking problem: we are diagnostically blind

`createAndroidAppEmulatorReleaseDetoxConfig`
(`apps/brownfield-example-shared-tests/detox-rc-androidapp-emulator-release.cjs`)
returns a config with **no `artifacts` section at all**. Detox therefore
writes nothing to `apps/AndroidApp/artifacts`, and the upload step
(`.github/actions/androidapp-road-test/action.yml:412-418`) reported:

```
No files were found with the provided path: apps/AndroidApp/artifacts.
No artifacts will be uploaded.
```

No screenshot. No logcat. No view hierarchy. On top of that,
`pollUntilUiAutomatorContainsAny` discards every XML dump it reads and prints
only the needle list on timeout — the one artifact we know was being produced
successfully is thrown away.

### Design decisions

**Diagnostics first. No behavioural fix until we have evidence.** Proposing a
retry or a longer timeout now would be guessing at a cause we have not
observed, and would likely mask it.

Three layers of evidence, chosen so each works independently of the others:

1. **Detox `artifacts` config** — `log` plugin (logcat on Android) and
   `screenshot` plugin, both with `keepOnlyFailedTestsArtifacts: true` so
   green runs stay cheap. The factory is a pure function, so this is unit
   testable in the existing `node --test` suite of the shared-tests
   workspace, which `yarn test:apps` already runs in CI.
2. **Failure-time dump in `pollUntilUiAutomatorContainsAny`** — on timeout,
   write the last UIAutomator XML and a logcat tail to the artifacts
   directory. This is the strongest signal available and it relies only on
   `dumpUiAutomatorHierarchy()`, which we have *proof* was working during the
   failure. Deliberately not relying on Detox's `uiHierarchy` plugin, whose
   Android support is not verified here.
3. **Unconditional artifact upload** — change the upload step so an empty
   directory is visible as an empty artifact rather than silently skipped,
   and so diagnostics survive a job that fails before Detox writes anything.

Only after a reproduction is captured do we decide between a real fix and
targeted hardening. That decision is explicitly out of scope for this plan.

---

## Out of scope

- Any behavioural change to Expo 56 E2E timing, retries, or launch strategy.
  Gated on evidence from the diagnostics work.
- The `iOS road test & E2E (AppleApp - Expo 57)` failure seen in run
  `34354305730` — unrelated, separate investigation.
- Homebrew tap-trust and Node 20 deprecation warnings in the Android job
  logs. Noise, not causes.

## Plans

- `docs/superpowers/plans/2026-09-15-expo-preview-scheduled-job-fix.md`
- `docs/superpowers/plans/2026-09-15-expo56-android-e2e-diagnostics.md`
