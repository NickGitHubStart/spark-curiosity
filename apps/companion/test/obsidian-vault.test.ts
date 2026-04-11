import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildVaultEntryBody,
  captureVaultEntry,
  findUpIndex,
  getNextIndex,
  initializeVault
} from "../src/obsidian-vault.ts";

test("initializeVault creates structure and optional bootstrap", () => {
  const dir = mkdtempSync(join(tmpdir(), "spark-vault-"));
  try {
    const result = initializeVault({ vaultPath: dir, importCurrentMemory: "## Long-Term\n- test" });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getNextIndex follows hierarchical rules", () => {
  const dir = mkdtempSync(join(tmpdir(), "spark-vault-"));
  try {
    initializeVault({ vaultPath: dir });
    let created = captureVaultEntry({ vaultPath: dir, content: "A", title: "Alpha", themenpfad: "1" });
    assert.equal(created.index, "1.1");

    created = captureVaultEntry({ vaultPath: dir, content: "B", title: "Beta", themenpfad: "1" });
    assert.equal(created.index, "1.2");

    const nested = captureVaultEntry({ vaultPath: dir, content: "C", title: "Child", themenpfad: "1", parentIndex: "1.1" });
    assert.equal(nested.index, "1.1a");
    assert.equal(getNextIndex(dir, "1", "1.1a"), "1.1a1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildVaultEntryBody adds sections for source, KI, and notes", () => {
  const body = buildVaultEntryBody({
    content: "C",
    originalSource: "O",
    userNotes: "N",
    aiModel: "grok-test"
  });
  assert.match(body, /Quelle \(markiert\)/);
  assert.match(body, /Komprimiert \(KI: grok-test\)/);
  assert.match(body, /Deine Gedanken/);
  assert.match(body, /^O$/m);
  assert.match(body, /^C$/m);
  assert.match(body, /^N$/m);
});

test("buildVaultEntryBody plain when no extras", () => {
  assert.equal(buildVaultEntryBody({ content: "solo" }), "solo");
});

test("captureVaultEntry stores ai_model and structured body when compress fields set", () => {
  const dir = mkdtempSync(join(tmpdir(), "spark-vault-"));
  try {
    initializeVault({ vaultPath: dir });
    captureVaultEntry({
      vaultPath: dir,
      content: "compressed",
      title: "K",
      type: "knowledge",
      themenpfad: "3",
      source: "test",
      aiModel: "grok-x",
      originalSource: "orig line",
      userNotes: "note line"
    });
    const files = readdirSync(join(dir, "entries"));
    const raw = readFileSync(join(dir, "entries", files[0]), "utf8");
    assert.match(raw, /ai_model: "grok-x"/);
    assert.match(raw, /orig line/);
    assert.match(raw, /note line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captureVaultEntry writes frontmatter with up and related", () => {
  const dir = mkdtempSync(join(tmpdir(), "spark-vault-"));
  try {
    initializeVault({ vaultPath: dir });
    const first = captureVaultEntry({ vaultPath: dir, content: "A", title: "Root", themenpfad: "2" });
    const second = captureVaultEntry({
      vaultPath: dir,
      content: "B",
      title: "Child",
      themenpfad: "2",
      parentIndex: first.index,
      relatedIndices: [first.index],
    });
    const raw = readFileSync(join(dir, "entries", second.file), "utf8");
    assert.match(raw, /up:\n  - "2\.1"/);
    assert.match(raw, /related: \[\]/);
    assert.equal(findUpIndex(second.index), first.index);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
