import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  stripCodeFences,
  stripLineCommentsOutsideStrings,
  extractBalancedJson,
  parseLooseJson,
} from "../ai.js";

describe("stripCodeFences", () => {
  it("returns clean JSON unchanged", () => {
    assert.equal(stripCodeFences('{"a":1}'), '{"a":1}');
  });

  it("strips ```json fences", () => {
    assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("strips bare ``` fences", () => {
    assert.equal(stripCodeFences('```\n{"b":2}\n```'), '{"b":2}');
  });
});

describe("stripLineCommentsOutsideStrings", () => {
  it("strips trailing // comment", () => {
    const out = stripLineCommentsOutsideStrings('{"a":1} // comment');
    assert.ok(!out.includes("comment"));
    assert.ok(out.includes('{"a":1}'));
  });

  it("preserves // inside string values", () => {
    const input = '{"url":"https://example.com"}';
    assert.equal(stripLineCommentsOutsideStrings(input), input);
  });

  it("handles escaped quotes inside strings", () => {
    const input = '{"text":"he said \\"hi\\""} // tail';
    const out = stripLineCommentsOutsideStrings(input);
    assert.ok(out.includes('he said \\"hi\\"'));
    assert.ok(!out.includes("tail"));
  });
});

describe("extractBalancedJson", () => {
  it("extracts complete object from prefix/suffix noise", () => {
    const out = extractBalancedJson('here you go: {"a":1} done');
    assert.equal(out, '{"a":1}');
  });

  it("handles nested objects", () => {
    const out = extractBalancedJson('{"a":{"b":{"c":3}}}');
    assert.equal(out, '{"a":{"b":{"c":3}}}');
  });

  it("ignores braces inside strings", () => {
    const out = extractBalancedJson('{"text":"with } brace"}');
    assert.equal(out, '{"text":"with } brace"}');
  });

  it("returns null when no object found", () => {
    assert.equal(extractBalancedJson("no json here"), null);
  });
});

describe("parseLooseJson", () => {
  it("parses clean JSON", () => {
    const out = parseLooseJson('{"reason":"ok","toolCalls":[]}');
    assert.deepEqual(out, { reason: "ok", toolCalls: [] });
  });

  it("parses fenced JSON with comments", () => {
    const out = parseLooseJson('```json\n{"a":1} // comment\n```');
    assert.deepEqual(out, { a: 1 });
  });

  it("parses JSON with prefix text", () => {
    const out = parseLooseJson('Sure! {"a":1}');
    assert.deepEqual(out, { a: 1 });
  });

  it("returns null on completely broken input", () => {
    assert.equal(parseLooseJson("nothing { but [ broken"), null);
  });
});
