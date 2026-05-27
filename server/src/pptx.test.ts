import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractPptxText, extractPptxSlideTitles } from "./pptx.js";

/**
 * `pptx.ts` walks a real .pptx ZIP and extracts:
 *   - all slide text (for word_count + excerpt in `metrics.ts`)
 *   - one title per slide (for the Question dropdown in `structure.ts`)
 *
 * We avoid committing binary .pptx fixtures (per
 * `docs/workflows/testing.md` §3 — "No fixtures committed as
 * binaries.") by building minimal decks in-memory with jszip in
 * `buildDeck` below.
 *
 * What we test is the regex + numeric-sort behaviour — the parts that
 * break silently if a future agent swaps the regex out:
 *   - text from multiple slides is concatenated in numeric order
 *   - slide10 sorts after slide9 (not after slide1)
 *   - title placeholders win over body text
 *   - slides without a title placeholder default to "Slide N"
 *   - XML entities are decoded in both text and titles
 *   - decks with zero slide*.xml return slide_count: 0
 *   - a non-zip buffer throws (caller surfaces as parse_error)
 */

async function buildDeck(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
  });
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Build a deck with explicit slide numbering (so we can test sort order). */
async function buildDeckIndexed(
  entries: { index: number; xml: string }[]
): Promise<Buffer> {
  const zip = new JSZip();
  for (const { index, xml } of entries) {
    zip.file(`ppt/slides/slide${index}.xml`, xml);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function bodyOnly(text: string): string {
  return `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp>
          <p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`;
}

function withTitleAndBody(title: string, body: string): string {
  return `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp>
          <p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`;
}

describe("extractPptxText", () => {
  it("concatenates every <a:t> run across slides, separating slides with a blank line", async () => {
    const buf = await buildDeck([
      bodyOnly("hello world"),
      bodyOnly("second slide"),
    ]);
    const out = await extractPptxText(buf);
    expect(out.slide_count).toBe(2);
    expect(out.text).toBe("hello world\n\nsecond slide");
  });

  it("returns slide_count 0 and empty text for a deck with no ppt/slides/slideN.xml entries", async () => {
    const zip = new JSZip();
    zip.file("docProps/core.xml", "<x/>");
    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const out = await extractPptxText(buf);
    expect(out).toEqual({ text: "", slide_count: 0 });
  });

  it("sorts slide numbers numerically (slide10 after slide9, not after slide1)", async () => {
    // Insert out of order, with two-digit indices interleaved with one-digit.
    const buf = await buildDeckIndexed([
      { index: 10, xml: bodyOnly("ten") },
      { index: 2, xml: bodyOnly("two") },
      { index: 1, xml: bodyOnly("one") },
      { index: 11, xml: bodyOnly("eleven") },
      { index: 9, xml: bodyOnly("nine") },
    ]);
    const out = await extractPptxText(buf);
    expect(out.slide_count).toBe(5);
    expect(out.text).toBe("one\n\ntwo\n\nnine\n\nten\n\neleven");
  });

  it("decodes XML entities in text runs", async () => {
    const buf = await buildDeck([
      bodyOnly("Q&amp;A &lt;tag&gt; &quot;quoted&quot; &apos;single&apos;"),
    ]);
    const out = await extractPptxText(buf);
    expect(out.text).toBe(`Q&A <tag> "quoted" 'single'`);
  });

  it("joins multiple <a:t> runs inside one slide with a single space", async () => {
    const xml = `<?xml version="1.0"?>
      <p:sld xmlns:p="..." xmlns:a="http://x">
        <p:cSld><p:spTree>
          <p:sp><p:txBody>
            <a:p><a:r><a:t>first</a:t></a:r><a:r><a:t>second</a:t></a:r></a:p>
          </p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`;
    const buf = await buildDeck([xml]);
    const out = await extractPptxText(buf);
    expect(out.text).toBe("first second");
  });

  it("throws on a non-zip buffer (caller surfaces as parse_error)", async () => {
    const garbage = Buffer.from("not a zip at all", "utf8");
    await expect(extractPptxText(garbage)).rejects.toBeInstanceOf(Error);
  });
});

describe("extractPptxSlideTitles", () => {
  it("returns one title per slide, preferring the title placeholder over body runs", async () => {
    const buf = await buildDeck([
      withTitleAndBody("Welcome", "ignored body"),
      withTitleAndBody("Agenda", "more body"),
    ]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles).toEqual([
      { index: 1, title: "Welcome" },
      { index: 2, title: "Agenda" },
    ]);
  });

  it("falls back to 'Slide N' when a slide has no title placeholder", async () => {
    const buf = await buildDeck([
      withTitleAndBody("Real Title", "x"),
      bodyOnly("body but no title"),
    ]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles).toEqual([
      { index: 1, title: "Real Title" },
      { index: 2, title: "Slide 2" },
    ]);
  });

  it("falls back to 'Slide N' when the title placeholder exists but is empty", async () => {
    const buf = await buildDeck([withTitleAndBody("", "body")]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles).toEqual([{ index: 1, title: "Slide 1" }]);
  });

  it("decodes XML entities in title text", async () => {
    const buf = await buildDeck([withTitleAndBody("Q&amp;A &gt; rest", "x")]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles[0].title).toBe("Q&A > rest");
  });

  it("recognises ctrTitle placeholders, not just type='title'", async () => {
    const xml = `<?xml version="1.0"?>
      <p:sld xmlns:p="..." xmlns:a="...">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Center Title</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>`;
    const buf = await buildDeck([xml]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles[0].title).toBe("Center Title");
  });

  it("uses numeric slide ordering (matches extractPptxText)", async () => {
    const buf = await buildDeckIndexed([
      { index: 10, xml: withTitleAndBody("Ten", "x") },
      { index: 2, xml: withTitleAndBody("Two", "x") },
      { index: 1, xml: withTitleAndBody("One", "x") },
    ]);
    const titles = await extractPptxSlideTitles(buf);
    expect(titles.map((t) => `${t.index}:${t.title}`)).toEqual([
      "1:One",
      "2:Two",
      "10:Ten",
    ]);
  });
});
