'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');

const UNAVAILABLE = '(unavailable)';

/**
 * Whether a timed-out wait should persist diagnostics.
 *
 * Opt-in by design. `pollUntilUiAutomatorContainsAny` is also called inside
 * retry loops (see waitForAndroidAppReadyExpo) where a timeout is expected and
 * handled, and capturing there would dump logcat up to ten times per green run
 * — slowing a wait loop in a suite we already suspect is timing-sensitive.
 * Only call sites that pass an explicit label capture.
 *
 * @param {string | undefined} label
 * @returns {boolean}
 */
function shouldCaptureDiagnostics(label) {
  return typeof label === 'string' && label.length > 0;
}

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
  rootDir = 'e2e-artifacts',
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

module.exports = {
  buildDiagnosticsReport,
  shouldCaptureDiagnostics,
  writeDiagnosticsReport,
};
