import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMemoryMarkdown, serializeMemoryToMarkdown, applyMemoryOps } from "../d1-memory.js";

describe("parseMemoryMarkdown", () => {
  it("parses a normal three-section memory body", () => {
    const body = `## Long-Term
- Goal A
- Goal B

## Mid-Term
- Habit X

## Short-Term
- (leer)`;
    const parsed = parseMemoryMarkdown(body);
    assert.equal(parsed.longTerm.length, 2);
    assert.equal(parsed.longTerm[0].text, "Goal A");
    assert.equal(parsed.midTerm.length, 1);
    assert.equal(parsed.midTerm[0].text, "Habit X");
    assert.equal(parsed.shortTerm.length, 0); // (leer) is filtered
  });

  it("returns empty sections when body is empty/missing", () => {
    const parsed = parseMemoryMarkdown("");
    assert.equal(parsed.longTerm.length, 0);
    assert.equal(parsed.midTerm.length, 0);
    assert.equal(parsed.shortTerm.length, 0);
  });

  it("ignores lines that aren't list items inside a section", () => {
    const body = `## Long-Term
some preamble text
- Real entry`;
    const parsed = parseMemoryMarkdown(body);
    assert.equal(parsed.longTerm.length, 1);
    assert.equal(parsed.longTerm[0].text, "Real entry");
    assert.ok(parsed.preambles.long.includes("some preamble"));
  });
});

describe("serializeMemoryToMarkdown", () => {
  it("roundtrips a parsed memory body", () => {
    const body = `## Long-Term
- A
- B

## Mid-Term
- (leer)

## Short-Term
- C`;
    const parsed = parseMemoryMarkdown(body);
    const out = serializeMemoryToMarkdown(parsed, parsed.preambles);
    const reparsed = parseMemoryMarkdown(out);
    assert.equal(reparsed.longTerm.length, 2);
    assert.equal(reparsed.shortTerm.length, 1);
    assert.equal(reparsed.shortTerm[0].text, "C");
  });

  it("emits (leer) for empty sections", () => {
    const out = serializeMemoryToMarkdown(
      { longTerm: [], midTerm: [], shortTerm: [] }
    );
    assert.ok(out.includes("## Long-Term"));
    assert.ok(out.includes("- (leer)"));
  });
});

describe("applyMemoryOps", () => {
  const baseBody = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)`;

  it("adds an entry with a timestamp prefix", () => {
    const result = applyMemoryOps(baseBody, [
      { op: "add", section: "Short-Term", entry: "Just learned X" }
    ]);
    const parsed = parseMemoryMarkdown(result);
    assert.equal(parsed.shortTerm.length, 1);
    // Should be prefixed with [YYYY-MM-DD] (×1)
    assert.match(parsed.shortTerm[0].text, /^\[\d{4}-\d{2}-\d{2}\]/);
    assert.ok(parsed.shortTerm[0].text.includes("Just learned X"));
  });

  it("does not double-prefix an already-timestamped entry", () => {
    const result = applyMemoryOps(baseBody, [
      { op: "add", section: "Short-Term", entry: "[2026-01-01] (×3) Already stamped" }
    ]);
    const parsed = parseMemoryMarkdown(result);
    assert.equal(parsed.shortTerm[0].text, "[2026-01-01] (×3) Already stamped");
  });

  it("removes an exact-match entry", () => {
    const withEntry = applyMemoryOps(baseBody, [
      { op: "add", section: "Mid-Term", entry: "[2026-01-01] (×1) ToRemove" }
    ]);
    const removed = applyMemoryOps(withEntry, [
      { op: "remove", section: "Mid-Term", entry: "[2026-01-01] (×1) ToRemove" }
    ]);
    const parsed = parseMemoryMarkdown(removed);
    assert.equal(parsed.midTerm.length, 0);
  });

  it("update replaces matching entry text", () => {
    const seeded = applyMemoryOps(baseBody, [
      { op: "add", section: "Long-Term", entry: "[2026-01-01] (×1) Old text" }
    ]);
    const updated = applyMemoryOps(seeded, [
      { op: "update", section: "Long-Term", old: "[2026-01-01] (×1) Old text", new: "[2026-01-01 → 2026-02-01] (×2) New text" }
    ]);
    const parsed = parseMemoryMarkdown(updated);
    assert.equal(parsed.longTerm.length, 1);
    assert.ok(parsed.longTerm[0].text.includes("New text"));
  });

  it("ignores ops with invalid sections", () => {
    const result = applyMemoryOps(baseBody, [
      // @ts-expect-error testing runtime guard
      { op: "add", section: "Bogus", entry: "x" }
    ]);
    const parsed = parseMemoryMarkdown(result);
    assert.equal(parsed.longTerm.length, 0);
  });

  it("remove with non-matching entry is a no-op", () => {
    const result = applyMemoryOps(baseBody, [
      { op: "remove", section: "Short-Term", entry: "does not exist" }
    ]);
    const parsed = parseMemoryMarkdown(result);
    assert.equal(parsed.shortTerm.length, 0);
  });
});
