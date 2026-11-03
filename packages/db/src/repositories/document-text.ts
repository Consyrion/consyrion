import { DomainError } from "@consyrion/core";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Server-side text extraction for uploaded documents. Every model of a council receives the same text, so a PDF, Word
 * or PowerPoint file works with every provider. Layout, images and scanned pages are not read (no OCR).
 */

export const OFFICE_EXTENSIONS = /\.(pdf|docx|pptx)$/i;

/** Upper bound for the unpacked parts of an Office file that are read (protects against zip bombs). */
const MAX_UNPACKED_BYTES = 50_000_000;

export async function extractDocumentText(name: string, bytes: Uint8Array): Promise<string> {
  const extension = name.toLowerCase().split(".").pop();
  try {
    const text = extension === "pdf" ? await pdfText(bytes) : extension === "docx" ? await docxText(bytes) : await pptxText(bytes);
    const normalised = text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!normalised) throw new DomainError("VALIDATION", "The file contains no readable text (scanned pages and images are not read)");
    return normalised;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("VALIDATION", `The ${extension?.toUpperCase()} file could not be read (damaged, encrypted or not a valid file)`);
  }
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer; pass a copy so the caller's bytes stay intact.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  // Page markers only when there is text at all, so a scanned PDF is reported as unreadable.
  return text.some((page) => page.trim()) ? text.map((page, index) => `[Page ${index + 1}]\n${page}`).join("\n\n") : "";
}

async function openZip(bytes: Uint8Array, parts: RegExp): Promise<{ zip: JSZip; names: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => parts.test(n));
  // JSZip reads the sizes from the central directory without unpacking.
  const unpacked = names.reduce((sum, n) => sum + ((zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (unpacked > MAX_UNPACKED_BYTES) throw new DomainError("VALIDATION", "The file unpacks to more than 50 MB of text and is not read");
  return { zip, names };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]!,
  );
}

/** Paragraphs of an OOXML part: text runs joined, tabs and line breaks kept (as runs, so XML indentation is ignored). */
function paragraphs(xml: string, paragraph: string, run: string): string[] {
  const prefix = run.split(":")[0];
  return (xml.match(new RegExp(`<${paragraph}[ >][\\s\\S]*?</${paragraph}>`, "g")) ?? []).map((p) =>
    (
      p
        .replace(new RegExp(`<${prefix}:tab/>`, "g"), `<${run}>\t</${run}>`)
        .replace(new RegExp(`<${prefix}:br(?: [^>]*)?/>`, "g"), `<${run}>\n</${run}>`)
        .match(new RegExp(`<${run}(?: [^>]*)?>[^<]*</${run}>`, "g")) ?? []
    )
      .map((part) => decodeXml(part.replace(/<[^>]+>/g, "")))
      .join(""),
  );
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const { zip, names } = await openZip(bytes, /^word\/document\.xml$/);
  if (!names.length) throw new DomainError("VALIDATION", "The DOCX file has no document body");
  return paragraphs(await zip.file(names[0]!)!.async("string"), "w:p", "w:t").join("\n");
}

async function pptxText(bytes: Uint8Array): Promise<string> {
  const { zip, names } = await openZip(bytes, /^ppt\/slides\/slide\d+\.xml$/);
  if (!names.length) throw new DomainError("VALIDATION", "The PPTX file has no slides");
  const slides = names.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const texts = await Promise.all(slides.map(async (n) => paragraphs(await zip.file(n)!.async("string"), "a:p", "a:t").join("\n")));
  return texts.some((t) => t.trim()) ? texts.map((t, index) => `[Slide ${index + 1}]\n${t}`).join("\n\n") : "";
}
