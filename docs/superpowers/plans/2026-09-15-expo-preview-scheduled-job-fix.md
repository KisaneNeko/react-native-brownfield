# Expo Preview Scheduled Job Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Expo preview road test` scheduled workflow run past its first step, and make CI capable of catching the class of bug that broke it.

**Architecture:** Three tasks in strict order. Task 1 fixes the one-character regex defect using the failing test that already exists. Task 2 wires the orphaned `scripts/__tests__/` suite into CI's `build-lint` job so this class of bug is caught from now on. Task 3 exercises the `--apply` code path that has never run in CI, and fixes what surfaces.

**Tech Stack:** Node 24 with `--experimental-strip-types`, `node:test`, GitHub Actions, yarn 4 workspaces, turbo.

**Spec:** `docs/superpowers/specs/2026-09-15-e2e-ci-failures-design.md`

## Global Constraints

- Node is invoked as `node --experimental-strip-types --no-warnings` everywhere in this repo. Match that exactly in any new script or workflow step.
- `scripts/` is **not** a yarn workspace and must not become one. The root `package.json` `workspaces` array stays `["packages/*", "apps/*", "docs", "gradle-plugins/*"]`.
- `scripts/package.json` is `{"type": "module"}` — ESM only.
- Do not remove the `u` flag from any regex in `scripts/check-expo-preview.ts`. Escape the metacharacter instead.
- Commit messages follow Conventional Commits (`fix:`, `ci:`, `test:`), matching the repo's existing history.
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Fix the `u`-flag regex in `check-expo-preview.ts`

**Files:**
- Modify: `scripts/check-expo-preview.ts:201`
- Test: `scripts/__tests__/check-expo-preview.test.ts` (already exists — do not create)

**Interfaces:**
- Consumes: nothing.
- Produces: a loadable `scripts/check-expo-preview.ts` module exporting `ensureConsumerNavigationSpec(contents: string): string`, `findLatestPreviewVersion(versions: string[]): string | null`, `replaceHomeScreenTitle`, `replaceTemplateAppReferences`, `updateExpoVersion`, and the type `ExpoPackageJson`. Task 2 depends on this module loading.

- [ ] **Step 1: Run the existing test suite to see it fail**

The failing test you need already exists. Do not write a new one.

Run:
```bash
node --experimental-strip-types --no-warnings --test scripts/__tests__/check-expo-preview.test.ts
```

Expected: FAIL. The whole file fails to load, so you see 1 "test" and 1 failure, not 9:

```
SyntaxError: Invalid regular expression: /\n}\s*$/u: Lone quantifier brackets
✖ scripts/__tests__/check-expo-preview.test.ts
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

If you see 9 tests running, the bug is already fixed — stop and report that.

- [ ] **Step 2: Apply the minimal fix**

In `scripts/check-expo-preview.ts`, inside `ensureConsumerNavigationSpec`, change the first argument of `contents.replace(...)`.

Before:
```ts
  const updated = contents.replace(
    /\n}\s*$/u,
    `${CONSUMER_ROAD_TEST_NAVIGATION_METHODS}\n}`
  );
```

After:
```ts
  const updated = contents.replace(
    /\n\}\s*$/u,
    `${CONSUMER_ROAD_TEST_NAVIGATION_METHODS}\n}`
  );
```

That is the entire change: `}` becomes `\}` in the pattern. Do not touch the replacement string (it is a template literal, not a regex — its `}` is correct as-is). Do not remove the `u` flag.

- [ ] **Step 3: Run the test suite to verify it passes**

Run:
```bash
node --experimental-strip-types --no-warnings --test scripts/__tests__/check-expo-preview.test.ts
```

Expected: PASS, with all 9 tests now discovered and green:

```
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

The two that specifically prove the fix are
`adds consumer road-test navigation methods when missing from template` and
`does not duplicate consumer road-test navigation methods`.

- [ ] **Step 4: Verify the module loads the way CI loads it**

The test runner is not the same entry point as CI. Confirm the script itself starts:

```bash
node --experimental-strip-types --no-warnings ./scripts/check-expo-preview.ts --help
```

Expected: no `SyntaxError`. The script has no `--help` handler, so it falls through `parseArgs` and runs `main()`, which queries the npm registry for Expo preview versions and prints something like:

```
Latest Expo preview: 57.0.0-preview.N
Last tested Expo preview: none
Should test: true
Generated ExpoAppPreview: false
Applied: false
```

Any network error here is acceptable and not a failure of this task — you are checking only that the module parses. A `SyntaxError` is a failure.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-expo-preview.ts
git commit -m "$(cat <<'EOF'
fix(scripts): escape brace in u-flag regex in check-expo-preview

An unescaped `}` in a `u`-flag regex is a malformed quantifier, not a
literal. The pattern `/\n}\s*$/u` raised `SyntaxError: Lone quantifier
brackets` at parse time, so check-expo-preview.ts never loaded and the
Expo preview scheduled workflow failed at its first step on every run
since 1e08ea5 (2026-07-14).

The existing suite in scripts/__tests__ already covered this and now
passes (9/9); it was simply never wired into CI. That gap is addressed
separately.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Run the `scripts/` test suite in CI

**Files:**
- Modify: `package.json` (root — `scripts` object)
- Modify: `.github/workflows/ci.yml` (the `build-lint` job)

**Interfaces:**
- Consumes: a loadable `scripts/check-expo-preview.ts` from Task 1. Without it this task's new CI step fails red.
- Produces: a root yarn script `test:scripts` that any later work can call. No new module exports.

**Why not a workspace:** promoting `scripts/` to a yarn workspace would pull it into the turbo task graph, the install topology, and the shared lint config, for no additional safety over a direct `node --test` invocation. Keep it simple.

- [ ] **Step 1: Add the root `test:scripts` script**

In the root `package.json`, inside the `"scripts"` object, add `test:scripts` immediately after the existing `"test:apps"` entry.

Before:
```json
    "test:packages": "turbo run test --filter='./packages/*'",
    "test:apps": "turbo run test --filter='./apps/*'",
    "dev": "yarn workspaces foreach -Api run dev",
```

After:
```json
    "test:packages": "turbo run test --filter='./packages/*'",
    "test:apps": "turbo run test --filter='./apps/*'",
    "test:scripts": "node --experimental-strip-types --no-warnings --test scripts/__tests__/",
    "dev": "yarn workspaces foreach -Api run dev",
```

Note the trailing slash on `scripts/__tests__/` — it makes `node --test` walk the directory, so test files added later are picked up without editing this line again.

- [ ] **Step 2: Run it to confirm it passes locally**

Run:
```bash
yarn test:scripts
```

Expected: PASS, 9 tests. This is green because Task 1 landed; if it is red, Task 1 is incomplete — go back.

- [ ] **Step 3: Prove the guard actually catches the bug class**

Temporarily reintroduce the defect and confirm CI would now catch it. Edit
`scripts/check-expo-preview.ts:201` **by hand** — change `/\n\}\s*$/u` back to
`/\n}\s*$/u` (remove the backslash before the brace). Do not script this edit;
the pattern contains enough regex metacharacters that a `sed` one-liner is
more likely to corrupt the file than to help.

Confirm the guard catches it:
```bash
yarn test:scripts
```

Expected: FAIL with `SyntaxError: Invalid regular expression: /\n}\s*$/u: Lone quantifier brackets`.

Now restore it and confirm green again:
```bash
git checkout -- scripts/check-expo-preview.ts
yarn test:scripts
```

Expected: PASS, 9 tests. Verify `git status --porcelain` shows no change to
`scripts/check-expo-preview.ts` before moving on — do not commit the broken state.

- [ ] **Step 4: Add the CI step**

In `.github/workflows/ci.yml`, in the `build-lint` job, add a step after the existing `Run packages' tests (Jest & vitest)` step.

Before:
```yaml
      - name: Run packages' tests (Jest & vitest)
        run: yarn test:packages

      - name: Test Brownfield CLI (version)
        run: |
          yarn workspace @callstack/react-native-brownfield brownfield --version
```

After:
```yaml
      - name: Run packages' tests (Jest & vitest)
        run: yarn test:packages

      - name: Run repo script tests (node:test)
        run: yarn test:scripts

      - name: Test Brownfield CLI (version)
        run: |
          yarn workspace @callstack/react-native-brownfield brownfield --version
```

- [ ] **Step 5: Check the job's path filter will actually trigger on script changes**

`build-lint` runs under:
```yaml
    if: needs.filter.outputs.packages == 'true' || needs.filter.outputs.ci == 'true'
```

Read the `filter` job at the top of `.github/workflows/ci.yml` and find which output covers `scripts/**`. Run:

```bash
sed -n '/^  filter:/,/^  build-lint:/p' .github/workflows/ci.yml
```

If no filter output matches `scripts/**`, add `scripts/**` to the `ci` filter's path list so edits to `scripts/` trigger `build-lint`. If `scripts/**` is already covered by an existing output, change nothing and note which one in the commit body.

Without this, a future break in `scripts/` would not run the guard you just added — the whole point of the task.

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: run scripts/__tests__ suite in build-lint

scripts/__tests__/check-expo-preview.test.ts has 9 node:test cases and
covers ensureConsumerNavigationSpec directly, but has never executed
anywhere: scripts/ is not a yarn workspace, the root package has no test
runner, and CI only ran turbo test filtered to ./packages/* and ./apps/*.

Add a root test:scripts script and call it from build-lint. Verified by
reintroducing the u-flag regex defect and confirming the new step fails.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Exercise the never-tested `--apply` path

**Files:**
- Modify: `scripts/check-expo-preview.ts` (only if the run surfaces a defect)
- Modify: `scripts/__tests__/check-expo-preview.test.ts` (add regression cases for anything found)

**Interfaces:**
- Consumes: the loadable module from Task 1; the `test:scripts` runner from Task 2.
- Produces: evidence that `generateExpoPreviewApp()` and the `--apply` branch of `main()` work, plus regression tests for any defect found.

**Context you need:** the scheduled workflow calls the script twice with different arguments.

- `.github/workflows/expo-preview-road-test.yml:27` (the `prepare` job) runs it **without** `--apply`. That path only reads the npm registry and writes step outputs. Task 1 already fixed it.
- `.github/workflows/expo-preview-road-test.yml:73` and `:112` run it **with** `--apply`, which is the branch that calls `generateExpoPreviewApp()` → `ensureConsumerNavigationSpec()` and rewrites `apps/ExpoAppPreview`.

Because the `prepare` job has failed on every run since 2026-07-14, **the `--apply` path has never executed in CI.** Expect defects. Finding none is a valid outcome; assuming none is not.

- [ ] **Step 1: Read the code you are about to exercise**

Read these in full before running anything — you need to know what files get written:

```bash
sed -n '113,260p' scripts/check-expo-preview.ts
```

This covers `updateFileContents`, `getExpoTemplateApp`, `replaceTemplateAppReferences`, `replaceHomeScreenTitle`, `ensureConsumerNavigationSpec`, and `generateExpoPreviewApp`. Note every path it writes to.

- [ ] **Step 2: Confirm the working tree is clean before you generate anything**

```bash
git status --porcelain
```

Expected: empty. `--apply` writes real files into the repo; you need a clean baseline to see exactly what it produced and to revert it.

- [ ] **Step 3: Run the `--apply` path against a real preview version**

First get the current latest preview version without applying:

```bash
node --experimental-strip-types --no-warnings ./scripts/check-expo-preview.ts \
  --github-step-summary /dev/null
```

Take the version it prints after `Latest Expo preview:` and feed it back with `--apply`, exactly as the workflow does:

```bash
node --experimental-strip-types --no-warnings ./scripts/check-expo-preview.ts \
  --expo-version "<version-from-above>" \
  --apply \
  --github-step-summary /dev/null
```

Expected on success:
```
Generated ExpoAppPreview: true
Applied: true
```

If the npm registry returns no preview release at all, the first command prints `No Expo preview release found`. In that case substitute a known-good published version string (e.g. the newest `57.0.0-preview.*` visible from `npm view expo versions --json`) for `--expo-version` and continue — `--apply` does not re-query the registry when given an explicit version.

- [ ] **Step 4: Inspect what it generated**

```bash
git status --porcelain
git diff --stat
```

Read the generated `BrownfieldNavigationSpec` to confirm the Task 1 regex did its job in a real file rather than a unit-test fixture:

```bash
grep -rn "requestNativeConfirmation" apps/ExpoAppPreview/ | head
```

Expected: the method is present, appearing once, inside the interface body and before its closing brace.

Record any error, stack trace, or obviously wrong output. Those are your Task 3 findings.

- [ ] **Step 5: Revert the generated app**

```bash
git checkout -- .
git clean -fd apps/ExpoAppPreview
git status --porcelain
```

Expected: empty. The generated app is a CI artifact, not something to commit.

- [ ] **Step 6: If Step 3 or 4 surfaced a defect — write a failing test first**

Add a case to `scripts/__tests__/check-expo-preview.test.ts` that reproduces it. Follow the file's existing style — `node:test` with `node:assert/strict`, one top-level `test(...)` per behaviour:

```js
test('<describe the defect in behavioural terms>', () => {
  const input = /* the exact shape that broke */;
  const output = /* call the offending exported function */;
  assert.equal(output, /* what it should have produced */);
});
```

Run `yarn test:scripts` and confirm it fails for the expected reason before touching the implementation. Then fix `scripts/check-expo-preview.ts`, re-run, and confirm 10/10 (or however many cases you ended up with) pass.

If Step 3 and 4 were clean, skip to Step 7 — there is nothing to fix and you must not invent a change.

- [ ] **Step 7: Commit (only if Step 6 produced a change)**

```bash
git add scripts/check-expo-preview.ts scripts/__tests__/check-expo-preview.test.ts
git commit -m "$(cat <<'EOF'
fix(scripts): <one-line description of the defect found in the --apply path>

Surfaced by running check-expo-preview.ts --apply locally for the first
time. The --apply branch had never executed in CI because the prepare job
failed at module load on every scheduled run since 2026-07-14.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

If Step 6 was skipped, make no commit here. Report "`--apply` path exercised, no defects found" instead.

- [ ] **Step 8: Dispatch the real workflow once and read the result**

The workflow has `workflow_dispatch`, so it can be triggered on demand. **Ask the human partner before running this** — it triggers Android and iOS road-test jobs on the repo, which are expensive (~30+ min each).

Once approved, from the branch carrying these commits:

```bash
gh workflow run expo-preview-road-test.yml \
  --repo callstack/react-native-brownfield \
  --ref <this-branch>
```

Then watch it:
```bash
gh run list --repo callstack/react-native-brownfield \
  --workflow expo-preview-road-test.yml --limit 1
gh run watch <run-id> --repo callstack/react-native-brownfield
```

Expected: the `Detect Expo preview to test` job reaches `Finalize test decision` — that alone proves the reported issue is fixed.

The downstream road-test jobs have never run in CI. **If they fail, that is new information, not a regression from this plan.** Capture the failure and report it as a separate finding; do not expand this plan's scope to chase it.

- [ ] **Step 9: Verify before claiming completion**

REQUIRED SUB-SKILL: use `superpowers:verification-before-completion`.

Run and paste the real output of each:

```bash
yarn test:scripts        # expect 9+ passing, 0 failing
yarn lint
yarn typecheck
git status --porcelain   # expect empty
```

Do not claim the workflow is fixed on the strength of the local tests alone. The claim that is actually supported by evidence is: "the first step now passes" (from Step 8) — state it that precisely.

---

## Self-Review Notes

- **Spec coverage:** regex root cause → Task 1. Missing CI wiring → Task 2. Never-executed `--apply` path and expected post-fix breakage → Task 3. All three spec decisions for Issue 1 are covered.
- **Interfaces:** `ensureConsumerNavigationSpec`, `findLatestPreviewVersion`, `replaceHomeScreenTitle`, `replaceTemplateAppReferences`, `updateExpoVersion` and `ExpoPackageJson` are named consistently between the spec, Task 1's Produces block, and the existing test file's import list (verified against `scripts/__tests__/check-expo-preview.test.ts:4-11`).
- **Known unknown, stated deliberately:** Task 2 Step 5 cannot name the exact filter output because it depends on the `filter` job's current path lists. The step gives the command to resolve it and the decision rule for both outcomes, rather than guessing a value.
- **Known unknown, stated deliberately:** Task 3 Steps 6-7 are conditional because whether the `--apply` path is broken is genuinely unknown until run. The plan gives a complete procedure for both branches and forbids inventing a change when none is needed.
