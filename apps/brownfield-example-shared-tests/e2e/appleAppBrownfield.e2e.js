const { element, by, expect: detoxExpect } = require('detox');
const {
  brownfieldE2ETestIds: ids,
} = require('@callstack/brownfield-example-shared-tests/e2e/e2eTestIds');
const {
  assertDetoxTextMatches,
  launchBrownfieldAppForDetox,
  waitForNativeOverlayVisible,
  waitForVisible,
} = require('@callstack/brownfield-example-shared-tests/e2e/detoxUtils');
const {
  scrollToNativeShellVanilla,
  waitForAppleAppReadyVanilla,
  sendPostMessageToNativeAndWaitForToast,
} = require('@callstack/brownfield-example-shared-tests/e2e/appleAppDetoxUtils');

describe('Brownfield (AppleApp — Vanilla)', () => {
  beforeEach(async () => {
    await launchBrownfieldAppForDetox({ newInstance: true, enableSync: false });
    await waitForAppleAppReadyVanilla();
  });

  it('shows the native greeting shell and embedded RN home', async () => {
    await scrollToNativeShellVanilla();
    await detoxExpect(element(by.id(ids.appleAppGreeting))).toBeVisible();
    await detoxExpect(element(by.id(ids.rnAppHome))).toBeVisible();
    const title = element(by.id(ids.rnAppHomeTitle));
    await detoxExpect(title).toBeVisible();
    await assertDetoxTextMatches(title, /React Native Screen/);
  });

  it('increments the embedded RN shared-store counter', async () => {
    const count = element(by.id(ids.counterCount));
    await detoxExpect(count).toBeVisible();
    await assertDetoxTextMatches(count, /Count:\s*0/);
    await element(by.id(ids.counterIncrement)).tap();
    await assertDetoxTextMatches(count, /Count:\s*1/);
  });

  it('shows a native toast when RN sends postMessage', async () => {
    await sendPostMessageToNativeAndWaitForToast();
  });

  it('navigates to native settings from the RN surface', async () => {
    await element(by.id(ids.openNativeSettings)).tap();
    await waitForNativeOverlayVisible(by.label('Settings'), 10000);
  });

  it('navigates to native referrals from the RN surface', async () => {
    await element(by.id(ids.openNativeReferrals)).tap();
    await waitForNativeOverlayVisible(by.label('Referrals'), 10000, 0);
  });

  // Regression for https://github.com/callstack/react-native-brownfield/issues/354
  it('popToNative pops only the topmost RN screen, not the native screen beneath', async () => {
    // The host builds RN -> native -> RN up front, so the suite never has to
    // drive native SwiftUI controls (Detox cannot reliably tap them here).
    await launchBrownfieldAppForDetox({
      newInstance: true,
      enableSync: false,
      extraLaunchArgs: { BrownfieldPopToNativeDemo: 'YES' },
    });

    const topSurfaceGoBack = by.id(`${ids.rnAppGoBack}-second`);
    await waitForVisible(topSurfaceGoBack, 30000);

    // Real JS entry point: HomeScreen calls popToNative() at its root route.
    await element(topSurfaceGoBack).tap();

    // Bounded wait for the pop to land — a loaded CI simulator can be slow —
    // then a short settle before asserting. Asserting the first matching frame
    // is not enough: the unfixed cascade pops *through* the native screen on
    // its way to the root, so it is briefly visible even when the bug is present.
    await waitForVisible(by.label('Native middle screen'), 15000);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Native SwiftUI screens are matched by label — Detox does not resolve
    // accessibilityIdentifier on them here (see the Settings/Referrals cases).
    await detoxExpect(element(by.label('Native middle screen'))).toBeVisible();
    await detoxExpect(
      element(by.label('popToNative demo root'))
    ).not.toBeVisible();

    // These two assertions already pin "exactly one pop": landing on the native
    // middle screen with the demo root gone is unreachable by any other count.
    // Asserting the surviving RN surface below it is not possible — SwiftUI
    // detaches off-screen NavigationStack destinations, so a covered React
    // Native surface is absent from Detox's hierarchy even though it is alive.
  });
});
