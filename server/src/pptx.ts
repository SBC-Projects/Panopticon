import JSZip from "jszip";

/**
 * Pure-JS extractors over `.pptx` files. A .pptx is just a ZIP of XML
 * parts; we walk `ppt/slides/slide<N>.xml` and pull text out with two
 * regexes (no XML parser dependency — same shape as how
 * `server/src/structure.ts` walks mammoth's HTML).
 *
 * Used by:
 *   - `metrics.ts`   → word_count + excerpt for the response cards
 *   - `structure.ts` → slide titles for the Question dropdown
 *
 * Neither extractor invokes PowerPoint / COM, so they work on every
 * platform and only need the bytes on disk.
 */

export interface PptxText {
  /** All slide text joined; slides separated by a blank line. */
  text: string;
  slide_count: number;
}

export interface PptxSlideTitle {
  /** 1-based slide index, matches PowerPoint's UI numbering. */
  index: number;
  /** Title placeholder text, or `Slide <N>` fallback when the slide has none. */
  title: string;
}

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const TEXT_RUN_RE = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
const SHAPE_BLOCK_RE = /<p:sp\b[\s\S]*?<\/p:sp>/g;
const TITLE_PLACEHOLDER_RE = /<p:ph\b[^>]*type=["'](?:title|ctrTitle)["']/;
const TXBODY_BLOCK_RE = /<p:txBody\b[\s\S]*?<\/p:txBody>/;

/**
 * Concatenate every `<a:t>` text run from every slide. Order follows
 * the slides' numeric index, not the zip's iteration order — so
 * slide10 comes after slide9 (lexicographic sort would put it after
 * slide1, which is wrong for word_count / excerpt purposes).
 *
 * Throws if the buffer isn't a valid zip. Caller decides whether to
 * surface that as `parse_error` or rethrow.
 */
export async function extractPptxText(buffer: Buffer): Promise<PptxText> {
  const slides = await loadSlideXmls(buffer);
  const parts: string[] = [];
  for (const { xml } of slides) {
    const runs: string[] = [];
    TEXT_RUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TEXT_RUN_RE.exec(xml)) !== null) {
      runs.push(decodeXmlEntities(m[1]));
    }
    if (runs.length) parts.push(runs.join(" "));
  }
  return { text: parts.join("\n\n"), slide_count: slides.length };
}

/**
 * Pull one title per slide. We look for the first `<p:sp>` containing a
 * `<p:ph type="title">` or `type="ctrTitle">` placeholder (those are the
 * two layout-bound title roles in OOXML) and take its first
 * `<a:t>` run. Fallback when a slide has no title placeholder, or the
 * placeholder is empty, is `Slide <index>` so the Question dropdown
 * never has blank entries.
 *
 * Every slide produces exactly one entry, even untitled ones.
 */
export async function extractPptxSlideTitles(
  buffer: Buffer
): Promise<PptxSlideTitle[]> {
  const slides = await loadSlideXmls(buffer);
  return slides.map(({ index, xml }) => ({
    index,
    title: extractTitleFromSlideXml(xml) || `Slide ${index}`,
  }));
}

function extractTitleFromSlideXml(xml: string): string {
  SHAPE_BLOCK_RE.lastIndex = 0;
  let sp: RegExpExecArray | null;
  while ((sp = SHAPE_BLOCK_RE.exec(xml)) !== null) {
    const block = sp[0];
    if (!TITLE_PLACEHOLDER_RE.test(block)) continue;
    const txBody = TXBODY_BLOCK_RE.exec(block);
    if (!txBody) return "";
    const runs: string[] = [];
    TEXT_RUN_RE.lastIndex = 0;
    let r: RegExpExecArray | null;
    while ((r = TEXT_RUN_RE.exec(txBody[0])) !== null) {
      runs.push(decodeXmlEntities(r[1]));
    }
    return runs.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

interface LoadedSlide {
  index: number;
  xml: string;
}

async function loadSlideXmls(buffer: Buffer): Promise<LoadedSlide[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slides: LoadedSlide[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    const m = SLIDE_PATH_RE.exec(name);
    if (!m || file.dir) continue;
    slides.push({ index: Number(m[1]), xml: await file.async("string") });
  }
  slides.sort((a, b) => a.index - b.index);
  return slides;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
