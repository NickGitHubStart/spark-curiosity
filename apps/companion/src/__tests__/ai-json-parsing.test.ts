import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLooseJson,
  stripCodeFences,
  stripLineCommentsOutsideStrings,
  extractBalancedJson,
} from "../ai.js";

/* ------------------------------------------------------------------ */
/*  stripCodeFences                                                    */
/* ------------------------------------------------------------------ */
describe("stripCodeFences", () => {
  it("returns clean JSON unchanged", () => {
    const input = '{"a":1}';
    assert.equal(stripCodeFences(input), '{"a":1}');
  });

  it("strips ```json ... ``` fences", () => {
    const input = '```json\n{"a":1}\n```';
    assert.equal(stripCodeFences(input), '{"a":1}');
  });

  it("strips ``` fences without language tag", () => {
    const input = '```\n{"b":2}\n```';
    assert.equal(stripCodeFences(input), '{"b":2}');
  });

  it("strips fences with extra whitespace", () => {
    const input = '  ```json\n  {"c":3}  \n```  ';
    assert.equal(stripCodeFences(input).trim(), '{"c":3}');
  });
});

/* ------------------------------------------------------------------ */
/*  stripLineCommentsOutsideStrings                                    */
/* ------------------------------------------------------------------ */
describe("stripLineCommentsOutsideStrings", () => {
  it("strips // comments outside strings", () => {
    const input = '{"a":1} // this is a comment';
    const result = stripLineCommentsOutsideStrings(input);
    assert.ok(!result.includes("// this is a comment"));
    assert.ok(result.includes('{"a":1}'));
  });

  it("preserves // inside string values", () => {
    const input = '{"url":"https://example.com"}';
    const result = stripLineCommentsOutsideStrings(input);
    assert.equal(result, input);
  });

  it("handles multiple comment lines", () => {
    const input = '{\n"a":1, // first\n"b":2 // second\n}';
    const result = stripLineCommentsOutsideStrings(input);
    assert.ok(!result.includes("first"));
    assert.ok(!result.includes("second"));
    assert.ok(result.includes('"a":1,'));
    assert.ok(result.includes('"b":2'));
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"msg":"he said \\"hello\\""}';
    const result = stripLineCommentsOutsideStrings(input);
    assert.equal(result, input);
  });

  it("handles // inside a string followed by a real comment outside", () => {
    const input = '{"url":"https://x.com"} // comment';
    const result = stripLineCommentsOutsideStrings(input);
    assert.ok(result.includes("https://x.com"));
    assert.ok(!result.includes("// comment"));
  });
});

/* ------------------------------------------------------------------ */
/*  extractBalancedJson                                                */
/* ------------------------------------------------------------------ */
describe("extractBalancedJson", () => {
  it("extracts balanced JSON from surrounding text", () => {
    const input = 'Here is the JSON: {"a":1} and some more text';
    assert.equal(extractBalancedJson(input), '{"a":1}');
  });

  it("handles nested objects", () => {
    const input = 'prefix {"outer":{"inner":42}} suffix';
    assert.equal(extractBalancedJson(input), '{"outer":{"inner":42}}');
  });

  it("handles braces inside string values", () => {
    const input = 'text {"msg":"use {braces} here"} end';
    assert.equal(extractBalancedJson(input), '{"msg":"use {braces} here"}');
  });

  it("returns null for no JSON", () => {
    assert.equal(extractBalancedJson("no json here"), null);
  });

  it("returns null for unbalanced braces", () => {
    assert.equal(extractBalancedJson('{"a":1'), null);
  });

  it("handles escaped quotes inside strings", () => {
    const input = '{"key":"val\\"ue"}';
    assert.equal(extractBalancedJson(input), '{"key":"val\\"ue"}');
  });
});

/* ------------------------------------------------------------------ */
/*  parseLooseJson (integration of the pipeline)                       */
/* ------------------------------------------------------------------ */
describe("parseLooseJson", () => {
  it("parses clean JSON", () => {
    const result = parseLooseJson('{"toolCalls":[],"reason":"ok"}');
    assert.deepEqual(result, { toolCalls: [], reason: "ok" });
  });

  it("strips code fences (```json ... ```)", () => {
    const input = '```json\n{"a":1}\n```';
    const result = parseLooseJson(input);
    assert.deepEqual(result, { a: 1 });
  });

  it("strips // comments outside strings", () => {
    const input = '{\n"a":1 // comment\n}';
    const result = parseLooseJson(input);
    assert.deepEqual(result, { a: 1 });
  });

  it("preserves // inside string values", () => {
    const input = '{"url":"https://example.com"}';
    const result = parseLooseJson(input);
    assert.deepEqual(result, { url: "https://example.com" });
  });

  it("extracts balanced JSON from surrounding text", () => {
    const input = 'Sure! Here is my answer: {"a":1} Hope that helps!';
    const result = parseLooseJson(input);
    assert.deepEqual(result, { a: 1 });
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"msg":"he said \\"hi\\""}';
    const result = parseLooseJson(input);
    assert.equal(result?.msg, 'he said "hi"');
  });

  it("returns null for garbage", () => {
    assert.equal(parseLooseJson("this is not json at all"), null);
    assert.equal(parseLooseJson(""), null);
    assert.equal(parseLooseJson("{{{{"), null);
  });

  it("handles nested objects", () => {
    const input = '{"toolCalls":[{"tool":"redirect_and_close","args":{"target":{"type":"url","value":"https://x.com"}}}]}';
    const result = parseLooseJson(input);
    assert.ok(result);
    assert.ok(Array.isArray(result.toolCalls));
    const calls = result.toolCalls as Array<Record<string, unknown>>;
    assert.equal(calls[0].tool, "redirect_and_close");
  });

  it("handles fences + comments combined", () => {
    const input = '```json\n{\n"a": 1, // inline comment\n"b": "https://x.com" // another\n}\n```';
    const result = parseLooseJson(input);
    assert.ok(result);
    assert.equal(result.a, 1);
    assert.equal(result.b, "https://x.com");
  });

  it("handles trailing comma before closing brace via balanced extraction", () => {
    // JSON.parse rejects trailing commas, but extractBalancedJson + re-parse
    // will also fail. This test documents current behavior: returns null.
    const input = '{"a":1,}';
    const result = parseLooseJson(input);
    assert.equal(result, null);
  });
});
