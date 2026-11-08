import { assertCan, DomainError, SECRET_VALUE_PATTERN } from "@consyrion/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { councilSession, projectDocument } from "../schema";
import { recordAudit } from "./audit";
import { extractDocumentText, OFFICE_EXTENSIONS } from "./document-text";
import type { ActorContext } from "./context";
import { getProject, lockProjectSources, assertProjectWritable } from "./projects";
import { assertNotDemoProject } from "./demo";

/** maxBytes: text files and the text extracted from a PDF/Word/PowerPoint file; maxUploadBytes: a PDF/Word/PowerPoint file itself. */
export const DOCUMENT_LIMITS = { maxBytes: 200_000, maxUploadBytes: 8_000_000, maxImageBytes: 3_500_000, maxPerProject: 10 } as const;

/** Images are described first (docs/documents.md): a model writes a text description, the user confirms it. */
const IMAGE_TYPES: Record<string, { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; magic: (b: Uint8Array) => boolean }> = {
  png: { mediaType: "image/png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { mediaType: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mediaType: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mediaType: "image/webp", magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
  gif: { mediaType: "image/gif", magic: (b) => String.fromCharCode(...b.slice(0, 4)) === "GIF8" },
};
const imageType = (name: string) => IMAGE_TYPES[name.toLowerCase().split(".").pop() ?? ""];

/** Media type of an image recognised by its first bytes (PNG, JPEG, WebP, GIF), independent of the file name; null otherwise. */
export function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes.byteLength < 12) return null;
  for (const type of Object.values(IMAGE_TYPES)) if (type.magic(bytes)) return type.mediaType;
  return null;
}
export const IMAGE_DESCRIPTION_LIMITS = { minChars: 20, maxChars: 20_000 } as const;

/** Text formats are stored as they are; PDF, DOCX and PPTX are stored as their extracted text (document-text.ts). */
const ALLOWED_EXTENSIONS = /\.(md|markdown|txt|json|ya?ml|csv|xml|html?|ts|tsx|js|jsx|py|java|kt|go|rs|rb|php|cs|sql|sh|toml|ini|env\.example)$/i;

export async function addDocument(db: Database, ctx: ActorContext, projectId: string, file: { name: string; mimeType: string; bytes: Uint8Array }) {
  // The demo project is read-only (owner decision 08.11.26, review of #374).
  await assertNotDemoProject(db, ctx, projectId);
  // #197: an archived project is read-only.
  await assertProjectWritable(db, ctx, projectId);
  assertCan(ctx.role, "project:write");
  await getProject(db, ctx, projectId);
  const name = file.name.replace(/[\\/]/g, "_").slice(0, 200);
  const office = OFFICE_EXTENSIONS.test(name);
  const image = imageType(name);
  if (!office && !image && !ALLOWED_EXTENSIONS.test(name))
    throw new DomainError(
      "VALIDATION",
      "Supported are PDF, Word (.docx), PowerPoint (.pptx), images (PNG, JPEG, WebP, GIF) and text documents (e.g. .md, .txt, .json, source code)",
    );
  if (file.bytes.byteLength === 0) throw new DomainError("VALIDATION", "The file is empty");
  if (image) return addImageDocument(db, ctx, projectId, name, image.mediaType, image.magic, file.bytes);
  const maxBytes = office ? DOCUMENT_LIMITS.maxUploadBytes : DOCUMENT_LIMITS.maxBytes;
  if (file.bytes.byteLength > maxBytes)
    throw new DomainError("VALIDATION", `Files of this type may be at most ${office ? `${maxBytes / 1_000_000} MB` : `${maxBytes / 1000} kB`}`);
  let content: string;
  if (office) {
    content = await extractDocumentText(name, file.bytes);
    // The same limit as for a text file: what the models read, not the size of the original file.
    if (new TextEncoder().encode(content).byteLength > DOCUMENT_LIMITS.maxBytes)
      throw new DomainError("VALIDATION", `The text of this file is longer than ${DOCUMENT_LIMITS.maxBytes / 1000} kB; split it or upload the relevant part`);
  } else {
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } catch {
      throw new DomainError("VALIDATION", "The file is not valid UTF-8 text");
    }
    if (content.includes("\u0000")) throw new DomainError("VALIDATION", "Binary files are not supported");
  }
  // sizeBytes is the text the models read (cost estimate, limits), not the size of an uploaded PDF/Word/PowerPoint file.
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  const id = newId("doc");
  await db.transaction(async (tx) => {
    // Serialised with council starts (#181 review): a start sees this document or the upload waits for the start.
    await lockProjectSources(tx, projectId);
    const existing = await listDocuments(tx, ctx, projectId);
    if (existing.length >= DOCUMENT_LIMITS.maxPerProject) throw new DomainError("CONFLICT", `At most ${DOCUMENT_LIMITS.maxPerProject} documents per project`);
    await tx.insert(projectDocument).values({
      id,
      organizationId: ctx.organizationId,
      projectId,
      name,
      mimeType: file.mimeType || "text/plain",
      sizeBytes,
      content,
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "document.uploaded",
      targetType: "project",
      targetId: projectId,
      metadata: { name, sizeBytes, uploadedBytes: file.bytes.byteLength },
    });
  });
  return { id, name, sizeBytes };
}

export async function listDocuments(db: Database, ctx: ActorContext, projectId: string) {
  assertCan(ctx.role, "project:read");
  const rows = await db
    .select({
      id: projectDocument.id,
      name: projectDocument.name,
      mimeType: projectDocument.mimeType,
      sizeBytes: projectDocument.sizeBytes,
      createdAt: projectDocument.createdAt,
      descriptionStatus: projectDocument.descriptionStatus,
      describedBy: projectDocument.describedBy,
      role: projectDocument.role,
      origin: projectDocument.origin,
      content: projectDocument.content,
    })
    .from(projectDocument)
    .where(and(eq(projectDocument.projectId, projectId), eq(projectDocument.organizationId, ctx.organizationId)))
    .orderBy(asc(projectDocument.createdAt));
  // The text of an image (its description) is shown for review; other documents are not sent back in the list.
  return rows.map(({ content, ...row }) => ({ ...row, description: row.descriptionStatus ? content : null }));
}

/**
 * The repository context of a project (docs/documents.md): one generated document with the chosen files of the
 * linked repository at one commit. It replaces the previous one – not while a running council reads it – and is never
 * scanned for requirements (`role: "context"`).
 */
export async function replaceRepositoryContext(
  db: Database,
  ctx: ActorContext,
  projectId: string,
  input: { repository: string; branch: string; commitSha: string; paths: string[]; skipped: Array<{ path: string; reason: string }>; content: string },
) {
  // The demo project is read-only (owner decision 08.11.26, review of #374).
  await assertNotDemoProject(db, ctx, projectId);
  // #197: an archived project is read-only.
  await assertProjectWritable(db, ctx, projectId);
  assertCan(ctx.role, "project:write");
  await getProject(db, ctx, projectId);
  const sizeBytes = new TextEncoder().encode(input.content).byteLength;
  if (sizeBytes > DOCUMENT_LIMITS.maxBytes)
    throw new DomainError(
      "VALIDATION",
      `The repository context has ${Math.round(sizeBytes / 1000)} kB; at most ${DOCUMENT_LIMITS.maxBytes / 1000} kB – choose fewer files`,
    );
  const name = `Repository ${input.repository} @ ${input.commitSha.slice(0, 7)}.md`.replace(/[\\/]/g, "_");
  const id = newId("doc");
  await db.transaction(async (tx) => {
    await lockProjectSources(tx, projectId);
    const previous = (await listDocuments(tx, ctx, projectId)).filter((d) => d.origin?.kind === "github");
    for (const doc of previous) await deleteDocumentLocked(tx, ctx, projectId, doc.id);
    if ((await listDocuments(tx, ctx, projectId)).length >= DOCUMENT_LIMITS.maxPerProject)
      throw new DomainError("CONFLICT", `At most ${DOCUMENT_LIMITS.maxPerProject} documents per project`);
    await tx.insert(projectDocument).values({
      id,
      organizationId: ctx.organizationId,
      projectId,
      name,
      mimeType: "text/markdown",
      sizeBytes,
      content: input.content,
      role: "context",
      origin: { kind: "github", repository: input.repository, branch: input.branch, commitSha: input.commitSha, paths: input.paths, skipped: input.skipped },
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "document.repository_context",
      targetType: "project",
      targetId: projectId,
      metadata: { repository: input.repository, commitSha: input.commitSha, files: input.paths.length, sizeBytes },
    });
  });
  return { id, name, sizeBytes };
}

/** File names that hold secrets: .env files (not .env.example), private keys, credential files. */
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$)[\w.-]+)?|id_(rsa|ed25519|ecdsa|dsa)|[^/]*\.(pem|key|p12|pfx)|credentials(\.json)?|\.npmrc|\.netrc|\.pgpass)$/i;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/;

/** Limits of the file excerpts an external client sends with a decision request (#331). */
export const CLIENT_FILE_LIMITS = { maxFiles: 20, maxPathChars: 300 } as const;

/**
 * File excerpts an external client (MCP `ask_consyrion`, #331) sends with its question, e.g. the code the decision is
 * about. They are stored as ONE document with role "context": the models read it like any document (as untrusted
 * <document> data), but it is never a source of requirements. Same total size limit as a text document. Called while
 * the project is new, before the requirement list is proposed, so the list is confirmed against these files.
 */
export function buildClientFileDocument(input: Array<{ path: string; content: string }>) {
  if (input.length > CLIENT_FILE_LIMITS.maxFiles) throw new DomainError("VALIDATION", `At most ${CLIENT_FILE_LIMITS.maxFiles} files per request`);
  const files = input.map((f, i) => {
    const path = String(f.path ?? "")
      .split("")
      .filter((c) => c.charCodeAt(0) >= 0x20) // no control characters (line breaks would break the heading)
      .join("")
      .trim()
      .slice(0, CLIENT_FILE_LIMITS.maxPathChars);
    if (!path) throw new DomainError("VALIDATION", `File ${i + 1} has no path`);
    const content = String(f.content ?? "");
    if (content.includes("\u0000")) throw new DomainError("VALIDATION", `${path}: binary files are not supported`);
    // Secrets never go to the council models (ChatGPT review 08.11.26): secret files by name, keys by content.
    if (SECRET_FILE.test(path)) throw new DomainError("VALIDATION", `${path}: files with secrets (.env, keys, credentials) are not accepted`);
    if (new RegExp(SECRET_VALUE_PATTERN.source).test(content) || PRIVATE_KEY.test(content))
      throw new DomainError("VALIDATION", `${path}: the content looks like it contains an API key or private key – remove it and send again`);
    return { path, content };
  });
  // Markdown with one section per file; the fence is longer than any backtick run inside, so a file cannot close it.
  const body = files
    .map(({ path, content }) => {
      const fence = "`".repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      return `## ${path}\n\n${fence}\n${content}\n${fence}`;
    })
    .join("\n\n");
  const content = `# Files sent with the question (${files.length})\n\n${body}\n`;
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > DOCUMENT_LIMITS.maxBytes)
    throw new DomainError(
      "VALIDATION",
      `The files have ${Math.round(sizeBytes / 1000)} kB together; at most ${DOCUMENT_LIMITS.maxBytes / 1000} kB – send only the relevant parts`,
    );
  return { content, sizeBytes, paths: files.map((f) => f.path) };
}

/** Stores the checked file excerpts (see `buildClientFileDocument`) as the project's client context document. */
export async function addClientFileContext(
  db: Database,
  ctx: ActorContext,
  projectId: string,
  input: { client: "mcp"; files: Array<{ path: string; content: string }> },
) {
  assertCan(ctx.role, "project:write");
  await getProject(db, ctx, projectId);
  if (!input.files.length) return null;
  const { content, sizeBytes, paths } = buildClientFileDocument(input.files);
  const files = paths.map((path) => ({ path }));
  const name = `Files from ${input.client.toUpperCase()} (${files.length}).md`;
  const id = newId("doc");
  await db.transaction(async (tx) => {
    await lockProjectSources(tx, projectId);
    if ((await listDocuments(tx, ctx, projectId)).length >= DOCUMENT_LIMITS.maxPerProject)
      throw new DomainError("CONFLICT", `At most ${DOCUMENT_LIMITS.maxPerProject} documents per project`);
    await tx.insert(projectDocument).values({
      id,
      organizationId: ctx.organizationId,
      projectId,
      name,
      mimeType: "text/markdown",
      sizeBytes,
      content,
      role: "context",
      origin: { kind: "client", client: input.client, paths: files.map((f) => f.path) },
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "document.client_files",
      targetType: "project",
      targetId: projectId,
      metadata: { client: input.client, files: files.length, sizeBytes },
    });
  });
  return { id, name, sizeBytes, paths: files.map((f) => f.path) };
}

/** Session states in which a run may still read its frozen documents (a repeat evaluation re-reads the brief). */
const DOCUMENT_READING_STATES = ["queued", "running", "cancel_requested", "awaiting_approval"] as const;

export async function deleteDocument(db: Database, ctx: ActorContext, projectId: string, documentId: string) {
  // The demo project is read-only (owner decision 08.11.26, review of #374).
  await assertNotDemoProject(db, ctx, projectId);
  // #197: an archived project is read-only.
  await assertProjectWritable(db, ctx, projectId);
  assertCan(ctx.role, "project:write");
  return db.transaction(async (tx) => {
    // Serialised with council starts (#181 review): a start sees the deletion or the deletion waits for the start.
    await lockProjectSources(tx, projectId);
    await deleteDocumentLocked(tx, ctx, projectId, documentId);
  });
}

async function deleteDocumentLocked(db: Database, ctx: ActorContext, projectId: string, documentId: string) {
  await assertNotInActiveCouncil(db, ctx, projectId, documentId, "deleted");
  const deleted = await db
    .delete(projectDocument)
    .where(and(eq(projectDocument.id, documentId), eq(projectDocument.projectId, projectId), eq(projectDocument.organizationId, ctx.organizationId)))
    .returning({ id: projectDocument.id });
  if (!deleted[0]) throw new DomainError("NOT_FOUND", "Document not found");
}

async function assertNotInActiveCouncil(db: Database, ctx: ActorContext, projectId: string, documentId: string, verb: "deleted" | "changed") {
  // A running council keeps its original source state (#190): a document it was started with cannot change under it.
  const active = await db
    .select({ id: councilSession.id, documentIds: councilSession.documentIds })
    .from(councilSession)
    .where(
      and(
        eq(councilSession.projectId, projectId),
        eq(councilSession.organizationId, ctx.organizationId),
        inArray(councilSession.status, [...DOCUMENT_READING_STATES]),
      ),
    );
  if (active.some((s) => (s.documentIds ?? []).includes(documentId)))
    throw new DomainError(
      "CONFLICT",
      `A council that is still running or waiting for a decision uses this document. It can be ${verb} after that council has finished.`,
    );
}

async function addImageDocument(
  db: Database,
  ctx: ActorContext,
  projectId: string,
  name: string,
  mediaType: string,
  magic: (bytes: Uint8Array) => boolean,
  bytes: Uint8Array,
) {
  if (bytes.byteLength > DOCUMENT_LIMITS.maxImageBytes)
    throw new DomainError("VALIDATION", `Images may be at most ${DOCUMENT_LIMITS.maxImageBytes / 1_000_000} MB`);
  if (!magic(bytes)) throw new DomainError("VALIDATION", "The file is not a valid image of its type");
  const id = newId("doc");
  await db.transaction(async (tx) => {
    await lockProjectSources(tx, projectId);
    const existing = await listDocuments(tx, ctx, projectId);
    if (existing.length >= DOCUMENT_LIMITS.maxPerProject) throw new DomainError("CONFLICT", `At most ${DOCUMENT_LIMITS.maxPerProject} documents per project`);
    // No text yet: the requirement list cannot be confirmed and no council can start until the description is confirmed.
    await tx.insert(projectDocument).values({
      id,
      organizationId: ctx.organizationId,
      projectId,
      name,
      mimeType: mediaType,
      sizeBytes: 0,
      content: "",
      imageData: Buffer.from(bytes).toString("base64"),
      descriptionStatus: "pending",
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "document.uploaded",
      targetType: "project",
      targetId: projectId,
      metadata: { name, kind: "image", uploadedBytes: bytes.byteLength },
    });
  });
  return { id, name, sizeBytes: 0, descriptionStatus: "pending" as const };
}

async function imageDocument(db: Database, ctx: ActorContext, projectId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(projectDocument)
    .where(and(eq(projectDocument.id, documentId), eq(projectDocument.projectId, projectId), eq(projectDocument.organizationId, ctx.organizationId)));
  if (!row) throw new DomainError("NOT_FOUND", "Document not found");
  if (!row.imageData || !row.descriptionStatus) throw new DomainError("VALIDATION", "Only images have a description");
  return row;
}

/** The image of a document, for the one call that describes it. */
export async function getImageForDescription(db: Database, ctx: ActorContext, projectId: string, documentId: string) {
  assertCan(ctx.role, "project:write");
  await getProject(db, ctx, projectId);
  const row = await imageDocument(db, ctx, projectId, documentId);
  return { name: row.name, mediaType: row.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: row.imageData! };
}

/**
 * Stores the image description: a model's draft ("draft", needs review) or the text the user confirmed ("confirmed").
 * Only a confirmed description is the text every model of a council reads. Refused while a council uses the document,
 * like a deletion: a running council never sees its input change.
 */
export async function setImageDescription(
  db: Database,
  ctx: ActorContext,
  projectId: string,
  documentId: string,
  input: { text: string; status: "draft" | "confirmed"; describedBy?: string },
) {
  // The demo project is read-only (owner decision 08.11.26, review of #374).
  await assertNotDemoProject(db, ctx, projectId);
  // #197: an archived project is read-only.
  await assertProjectWritable(db, ctx, projectId);
  assertCan(ctx.role, "project:write");
  await getProject(db, ctx, projectId);
  const text = input.text.trim();
  if (text.length < IMAGE_DESCRIPTION_LIMITS.minChars || text.length > IMAGE_DESCRIPTION_LIMITS.maxChars)
    throw new DomainError("VALIDATION", `The description must have ${IMAGE_DESCRIPTION_LIMITS.minChars}–${IMAGE_DESCRIPTION_LIMITS.maxChars} characters`);
  return db.transaction(async (tx) => {
    await lockProjectSources(tx, projectId);
    const row = await imageDocument(tx, ctx, projectId, documentId);
    await assertNotInActiveCouncil(tx, ctx, projectId, documentId, "changed");
    await tx
      .update(projectDocument)
      .set({
        content: text,
        sizeBytes: new TextEncoder().encode(text).byteLength,
        descriptionStatus: input.status,
        ...(input.describedBy ? { describedBy: input.describedBy } : {}),
      })
      .where(eq(projectDocument.id, row.id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.status === "confirmed" ? "document.description_confirmed" : "document.description_drafted",
      targetType: "project",
      targetId: projectId,
      metadata: { documentId, name: row.name, chars: text.length, ...(input.describedBy ? { describedBy: input.describedBy } : {}) },
    });
    return { id: row.id, descriptionStatus: input.status };
  });
}
