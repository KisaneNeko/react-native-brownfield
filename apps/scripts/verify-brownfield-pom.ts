import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Checks that dependencies of libraries embedded in the brownfield AAR are published in its
// POM and Gradle module file, e.g. com/callstack/rnbrownfield/demo/expoapp57/brownfieldlib.
const mavenPath = process.argv[2];
if (!mavenPath) {
  throw new Error('Maven path is required');
}

const VERSION = '0.0.1-SNAPSHOT';
// Dependency of apps/brownfield-example-transitive-dep-fixture.
const REQUIRED = { group: 'org.apache.commons', module: 'commons-lang3', version: '3.17.0' };
const EXPO_GROUP = /^(host\.exp\.exponent|BareExpo|expo(\..*)?)$/;

const dir = path.join(os.homedir(), '.m2', 'repository', mavenPath, VERSION);
const baseName = `${path.basename(mavenPath)}-${VERSION}`;
const pom = fs.readFileSync(path.join(dir, `${baseName}.pom`), 'utf8');
const moduleJson = JSON.parse(fs.readFileSync(path.join(dir, `${baseName}.module`), 'utf8'));

const problems: string[] = [];

const pomDependencies = [
  ...pom
    .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
    .matchAll(/<dependency>([\s\S]*?)<\/dependency>/g),
].map(([, body]) => ({
  group: /<groupId>([^<]+)<\/groupId>/.exec(body)?.[1],
  module: /<artifactId>([^<]+)<\/artifactId>/.exec(body)?.[1],
  version: /<version>([^<]+)<\/version>/.exec(body)?.[1],
}));

if (
  !pomDependencies.some(
    (d) =>
      d.group === REQUIRED.group &&
      d.module === REQUIRED.module &&
      d.version === REQUIRED.version
  )
) {
  problems.push(
    `POM is missing ${REQUIRED.group}:${REQUIRED.module}:${REQUIRED.version}`
  );
}

for (const d of pomDependencies) {
  if (d.group && EXPO_GROUP.test(d.group)) {
    problems.push(`POM publishes embedded Expo module ${d.group}:${d.module}`);
  }
}

const variants: { name: string; dependencies?: { group: string; module: string }[] }[] =
  moduleJson.variants ?? [];
if (variants.length === 0) {
  problems.push('Module file has no variants');
}
for (const variant of variants) {
  if (
    !(variant.dependencies ?? []).some(
      (d) => d.group === REQUIRED.group && d.module === REQUIRED.module
    )
  ) {
    problems.push(
      `Module variant ${variant.name} is missing ${REQUIRED.group}:${REQUIRED.module}`
    );
  }
}

if (problems.length > 0) {
  console.error(`Brownfield POM check failed for ${mavenPath}:`);
  problems.forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}

console.log(`Brownfield POM check passed for ${mavenPath}`);
