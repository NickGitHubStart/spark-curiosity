import assert from "node:assert/strict";
import { test } from "node:test";
import { closeCurrentTab } from "../src/providers/windows-native.ts";

test("closeCurrentTab returns false when native exe is missing", async () => {
  const prev = process.env.SPARK_WINDOWS_NATIVE_EXE;
  process.env.SPARK_WINDOWS_NATIVE_EXE = "C:\\does-not-exist\\ActiveWindowWatcher.exe";
  try {
    const result = await closeCurrentTab();
    assert.equal(result, false);
  } finally {
    if (prev) process.env.SPARK_WINDOWS_NATIVE_EXE = prev;
    else delete process.env.SPARK_WINDOWS_NATIVE_EXE;
  }
});
