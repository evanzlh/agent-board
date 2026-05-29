import test from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../src/version.ts";

test("VERSION exposes the package version", () => {
  assert.equal(VERSION, "0.1.0");
});
