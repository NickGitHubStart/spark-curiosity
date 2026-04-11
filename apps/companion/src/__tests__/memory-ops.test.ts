import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMemoryOps,
  parseMemoryMarkdown,
  extractMemoryMarkdown,
  extractMemoryOps,
} from "../memory.js";

const DEFAULT_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;

const POPULATED_BODY = `## Long-Term
- Langfristiges Ziel: Mehr lesen

## Mid-Term
- Diese Woche: Buch fertiglesen

## Short-Term
- Gerade: Kapitel 3
`;

/* ------------------------------------------------------------------ */
/*  parseMemoryMarkdown                                                */
/* ------------------------------------------------------------------ */
describe("parseMemoryMarkdown", () => {
  it("parses empty sections (leer markers)", () => {
    const result = parseMemoryMarkdown(DEFAULT_BODY);
    assert.equal(result.longTerm.length, 0);
    assert.equal(result.midTerm.length, 0);
    assert.equal(result.shortTerm.length, 0);
  });

  it("parses populated sections", () => {
    const result = parseMemoryMarkdown(POPULATED_BODY);
    assert.equal(result.longTerm.length, 1);
    assert.ok(result.longTerm[0].text.includes("Mehr lesen"));
    assert.equal(result.midTerm.length, 1);
    assert.ok(result.midTerm[0].text.includes("Buch fertiglesen"));
    assert.equal(result.shortTerm.length, 1);
    assert.ok(result.shortTerm[0].text.includes("Kapitel 3"));
  });

  it("preserves preambles (non-list text under a section header)", () => {
    const body = `## Long-Term
Preamble text here

- Item 1

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;
    const result = parseMemoryMarkdown(body);
    assert.equal(result.preambles.long, "Preamble text here");
    assert.equal(result.longTerm.length, 1);
    assert.equal(result.longTerm[0].text, "Item 1");
  });
});

/* ------------------------------------------------------------------ */
/*  applyMemoryOps                                                     */
/* ------------------------------------------------------------------ */
describe("applyMemoryOps", () => {
  it("adds entry to correct section", () => {
    const result = applyMemoryOps(DEFAULT_BODY, [
      { op: "add", section: "Short-Term", entry: "Neuer Eintrag" },
    ]);
    // applyMemoryOps prepends [YYYY-MM-DD] (×1) via ensureTimestamp
    assert.ok(result.includes("Neuer Eintrag"));
    assert.ok(result.includes("## Short-Term"));
  });

  it("removes exact match", () => {
    const result = applyMemoryOps(POPULATED_BODY, [
      { op: "remove", section: "Short-Term", entry: "Gerade: Kapitel 3" },
    ]);
    assert.ok(!result.includes("Kapitel 3"));
    // Short-Term should now show (leer) since it's empty
    const lines = result.split("\n");
    const shortIdx = lines.findIndex(l => l.includes("## Short-Term"));
    assert.ok(shortIdx >= 0);
    const afterShort = lines.slice(shortIdx + 1).filter(l => l.trim().startsWith("- "));
    assert.ok(afterShort.some(l => l.includes("(leer)")));
  });

  it("updates old to new", () => {
    const result = applyMemoryOps(POPULATED_BODY, [
      { op: "update", section: "Mid-Term", old: "Diese Woche: Buch fertiglesen", new: "Diese Woche: Buch abgeschlossen" },
    ]);
    assert.ok(result.includes("Buch abgeschlossen"));
    assert.ok(!result.includes("Buch fertiglesen"));
  });

  it("ignores invalid section", () => {
    const result = applyMemoryOps(POPULATED_BODY, [
      { op: "add", section: "Invalid-Section" as any, entry: "Should not appear" },
    ]);
    assert.ok(!result.includes("Should not appear"));
    // Original content preserved
    assert.ok(result.includes("Mehr lesen"));
  });

  it("preserves preambles", () => {
    const bodyWithPreamble = `## Long-Term
Preamble line

- Existing item

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;
    const result = applyMemoryOps(bodyWithPreamble, [
      { op: "add", section: "Long-Term", entry: "New item" },
    ]);
    assert.ok(result.includes("Preamble line"));
    assert.ok(result.includes("Existing item"));
    assert.ok(result.includes("New item"));
  });

  it("shows (leer) for empty sections", () => {
    const result = applyMemoryOps(DEFAULT_BODY, []);
    assert.ok(result.includes("- (leer)"));
  });

  it("handles multiple ops in sequence", () => {
    const result = applyMemoryOps(DEFAULT_BODY, [
      { op: "add", section: "Short-Term", entry: "First" },
      { op: "add", section: "Short-Term", entry: "Second" },
      { op: "add", section: "Long-Term", entry: "Goal" },
    ]);
    assert.ok(result.includes("First"));
    assert.ok(result.includes("Second"));
    assert.ok(result.includes("Goal"));
  });
});

/* ------------------------------------------------------------------ */
/*  extractMemoryMarkdown                                              */
/* ------------------------------------------------------------------ */
describe("extractMemoryMarkdown", () => {
  it("accepts valid markdown with all 3 sections", () => {
    const validMd = "## Long-Term\n- x\n\n## Mid-Term\n- y\n\n## Short-Term\n- z";
    const result = extractMemoryMarkdown({ memoryMarkdown: validMd });
    assert.equal(result, validMd);
  });

  it("rejects markdown missing a section", () => {
    const missingShort = "## Long-Term\n- x\n\n## Mid-Term\n- y";
    assert.equal(extractMemoryMarkdown({ memoryMarkdown: missingShort }), undefined);
  });

  it("rejects non-string", () => {
    assert.equal(extractMemoryMarkdown({ memoryMarkdown: 42 }), undefined);
    assert.equal(extractMemoryMarkdown({ memoryMarkdown: null }), undefined);
    assert.equal(extractMemoryMarkdown({}), undefined);
  });

  it("rejects empty string", () => {
    assert.equal(extractMemoryMarkdown({ memoryMarkdown: "" }), undefined);
    assert.equal(extractMemoryMarkdown({ memoryMarkdown: "   " }), undefined);
  });
});

/* ------------------------------------------------------------------ */
/*  extractMemoryOps                                                   */
/* ------------------------------------------------------------------ */
describe("extractMemoryOps", () => {
  it("extracts valid add ops", () => {
    const ops = extractMemoryOps({
      memoryOps: [{ op: "add", section: "Short-Term", entry: "test" }],
    });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, "add");
  });

  it("filters out invalid ops", () => {
    const ops = extractMemoryOps({
      memoryOps: [
        { op: "add", section: "Short-Term", entry: "valid" },
        { op: "invalid", section: "Short-Term", entry: "bad" },
        { op: "add", section: "Nonexistent", entry: "bad" },
        null,
        42,
      ],
    });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].entry, "valid");
  });

  it("requires old and new for update ops", () => {
    const ops = extractMemoryOps({
      memoryOps: [
        { op: "update", section: "Long-Term", old: "a", new: "b" },
        { op: "update", section: "Long-Term", entry: "missing old/new" },
      ],
    });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, "update");
  });

  it("returns empty array for missing/non-array", () => {
    assert.deepEqual(extractMemoryOps({}), []);
    assert.deepEqual(extractMemoryOps({ memoryOps: "not array" }), []);
    assert.deepEqual(extractMemoryOps({ memoryOps: [] }), []);
  });
});
