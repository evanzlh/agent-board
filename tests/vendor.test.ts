import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PACKAGE_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const UPDATE_SCRIPT_PATH = fileURLToPath(
  new URL("../scripts/update-euphony-vendor.sh", import.meta.url),
);
const VENDORED_ENTRY_PATH = fileURLToPath(
  new URL("../src/ui/vendor/euphony/euphony.js", import.meta.url),
);
const VENDOR_METADATA_PATH = fileURLToPath(
  new URL("../src/ui/vendor/euphony/VENDOR.md", import.meta.url),
);
const VENDOR_LICENSE_PATH = fileURLToPath(
  new URL("../src/ui/vendor/euphony/LICENSE", import.meta.url),
);
const VENDOR_NOTICE_PATH = fileURLToPath(
  new URL("../src/ui/vendor/euphony/NOTICE", import.meta.url),
);

test("euphony is vendored without a local file dependency", async () => {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  const script = await readFile(UPDATE_SCRIPT_PATH, "utf8");
  const entry = await readFile(VENDORED_ENTRY_PATH, "utf8");
  const metadata = await readFile(VENDOR_METADATA_PATH, "utf8");
  const license = await readFile(VENDOR_LICENSE_PATH, "utf8");
  const notice = await readFile(VENDOR_NOTICE_PATH, "utf8");

  assert.equal(packageJson.dependencies?.euphony, undefined);
  assert.doesNotMatch(script, /\/home\//);
  assert.match(script, /\/path\/to\/euphony/);
  assert.match(script, /cp "\$\{euphony_repo\}\/LICENSE"/);
  assert.match(script, /cp "\$\{euphony_repo\}\/NOTICE"/);
  assert.match(metadata, /https:\/\/github\.com\/openai\/euphony\.git/);
  assert.match(metadata, /6932db7728137b6fadc1cf7a77931358548e2b42/);
  assert.match(metadata, /Apache License 2\.0/);
  assert.match(metadata, /NOTICE/);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(notice, /Copyright 2026 OpenAI/);
  assert.match(entry, /parseCodexSession/);
});
