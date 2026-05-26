import { describe, it, expect } from "vitest";
import { parseHeadings, injectHeadingIds } from "./structure.js";

/**
 * `structure` extracts h1-h3 headings out of mammoth's HTML output and
 * stamps deterministic ids onto the same HTML so the client can scroll
 * to a heading without a second roundtrip. The two functions share a
 * slug algorithm — the ids they produce for the same HTML MUST match,
 * otherwise scroll-sync silently breaks.
 */

describe("parseHeadings", () => {
  it("extracts h1, h2, h3 in document order with level + text", () => {
    const html = `
      <h1>Question 1</h1>
      <p>preamble</p>
      <h2>Subpart A</h2>
      <h3>Detail</h3>
      <h1>Question 2</h1>
    `;
    expect(parseHeadings(html)).toEqual([
      { id: "question-1", level: 1, text: "Question 1" },
      { id: "subpart-a", level: 2, text: "Subpart A" },
      { id: "detail", level: 3, text: "Detail" },
      { id: "question-2", level: 1, text: "Question 2" },
    ]);
  });

  it("skips empty headings", () => {
    const html = `<h1></h1><h1>Real</h1><h2>   </h2>`;
    const got = parseHeadings(html);
    expect(got.map((h) => h.text)).toEqual(["Real"]);
  });

  it("disambiguates duplicate heading text with -2, -3, ...", () => {
    const html = `<h1>Question 1</h1><h2>Question 1</h2><h2>Question 1</h2>`;
    expect(parseHeadings(html).map((h) => h.id)).toEqual([
      "question-1",
      "question-1-2",
      "question-1-3",
    ]);
  });

  it("decodes basic html entities and strips inline tags from heading text", () => {
    const html = `<h2>Q&amp;A <em>section</em>&nbsp;1</h2>`;
    const [h] = parseHeadings(html);
    expect(h.text).toBe("Q&A section 1");
    expect(h.id).toBe("q-a-section-1");
  });

  it("ignores h4+ (we only render up to h3)", () => {
    const html = `<h1>Top</h1><h4>Deep</h4>`;
    const got = parseHeadings(html);
    expect(got.map((h) => h.text)).toEqual(["Top"]);
  });
});

describe("injectHeadingIds", () => {
  it("adds data-heading-id to h1-h3 elements", () => {
    const html = `<h1>Question 1</h1><p>x</p><h2>Subpart A</h2>`;
    const out = injectHeadingIds(html);
    expect(out).toContain(`<h1 data-heading-id="question-1">Question 1</h1>`);
    expect(out).toContain(`<h2 data-heading-id="subpart-a">Subpart A</h2>`);
  });

  it("produces ids that match parseHeadings byte-for-byte", () => {
    const html = `
      <h1>Question 1</h1>
      <h2>Subpart A</h2>
      <h2>Subpart A</h2>
      <h3>Q&amp;A</h3>
    `;
    const headings = parseHeadings(html);
    const injected = injectHeadingIds(html);
    for (const h of headings) {
      expect(injected).toContain(`data-heading-id="${h.id}"`);
    }
  });

  it("preserves existing attributes on the heading tag", () => {
    const html = `<h2 class="big">Subpart A</h2>`;
    const out = injectHeadingIds(html);
    expect(out).toContain(`class="big"`);
    expect(out).toContain(`data-heading-id="subpart-a"`);
  });

  it("replaces a stale data-heading-id rather than duplicating it", () => {
    const html = `<h1 data-heading-id="stale">Question 1</h1>`;
    const out = injectHeadingIds(html);
    expect(out.match(/data-heading-id=/g)?.length).toBe(1);
    expect(out).toContain(`data-heading-id="question-1"`);
  });

  it("leaves empty headings unchanged", () => {
    const html = `<h1></h1>`;
    expect(injectHeadingIds(html)).toBe(html);
  });
});
