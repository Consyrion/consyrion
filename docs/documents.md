# Project documents

Documents give the council context beyond the brief (concepts, specifications, existing code). They are attached to a
project, frozen into each council when it starts and go to **every** selected model as text, so all models read the
same input.

## Supported files

| Type                                                                            | Limit                  | What the models receive                                    |
| ------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Text (`.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.xml`, `.html`, source code, …) | 200 kB, UTF-8          | the file as it is                                          |
| PDF (`.pdf`)                                                                    | 8 MB file, 200 kB text | the text of every page, marked `[Page n]`                  |
| Word (`.docx`)                                                                  | 8 MB file, 200 kB text | the text of every paragraph, with tabs and line breaks     |
| PowerPoint (`.pptx`)                                                            | 8 MB file, 200 kB text | the text of every slide in slide order, marked `[Slide n]` |

At most 10 documents per project. The text extraction runs on the server (`packages/db/src/repositories/document-text.ts`,
`unpdf` for PDF, `jszip` for DOCX/PPTX); no file leaves the server for it and no model is called.

## What is not read

- Images, charts, layout and formatting inside a PDF/Word/PowerPoint file (upload an important diagram as an image).
- Scanned PDFs (pages that are images): the upload is refused with "contains no readable text" – there is no OCR.
- Encrypted or damaged files: refused with "could not be read", nothing is stored.
- Old formats (`.doc`, `.ppt`) and other binaries: refused; save them as `.docx`/`.pptx` or PDF.

The stored size (`sizeBytes`, shown as "kB text") is the size of the text the models read; the cost preview uses it.
The audit event `document.uploaded` also records the size of the uploaded file. An Office file is unpacked only up to
50 MB (protection against zip bombs).

## Images: described first

Sketches, screenshots, diagrams and whiteboard photos are uploaded as images, but a council never receives the image.
Instead (owner decision 29.10.26):

1. **Upload.** The image is stored (base64, `project_document.image_data`) with `description_status = pending` and no
   text. The file type is checked by its first bytes, not only by its name.
2. **Describe.** The user picks one model of their own keys and clicks *Describe* (`POST
   /api/projects/:id/documents/:docId/describe { credentialId, modelId }`). One call sends the image with a fixed prompt
   (`packages/council/src/image-description.ts`: what kind of image, every element and arrow, every readable text
   verbatim, unclear parts marked `[unclear]`, no judgement or assumptions). The answer is stored as a **draft**
   (`draft`, `described_by = provider/model`). This is the only paid step, on the user's key (BYOK), usually under one
   cent. DeepSeek has no image input and is not offered; a model without image input fails with a clear message.
   Instead of a model the user can also write the description.
3. **Confirm.** The user checks and corrects the text and confirms it (`PUT .../description { text }`, 20–20,000
   characters). Only now is it the document's text.

While an image is `pending` or `draft`, the requirement list cannot be confirmed and no council can start ("Confirm the
description of … first"). Every council model then reads the same confirmed text, marked
`<document name="…" kind="image description, confirmed by the user">`, so models without image input can take part
and all of them see identical input. Changing a confirmed description changes the source state, so the requirements
must be confirmed again; it is refused while a running or waiting council uses the image, like a deletion. Audit events:
`document.uploaded` (kind image), `document.description_drafted` (with the model), `document.description_confirmed`.

## Repository context for Decision councils

A Decision council reads a GitHub repository only through files the user chooses (project page → *Repository
context for councils*, shown when a repository is linked and the GitHub App is configured):

1. *Choose files from the repository* lists the readable text files of the default branch at its current commit
   (the snapshot filters apply: no build output, dependencies, binaries or secret-looking paths; at most 100 kB per
   file). README-like files and Markdown documentation whose path matches the brief are preselected up to about
   60 kB – a deterministic suggestion, no model decides what is read.
2. *Use as context* reads exactly those files at that commit (refused if the branch moved meanwhile), leaves out files
   with credential-like content and names them, and stores **one** document `Repository owner_name @ sha.md`: header
   with repository and commit, the file tree (first 400 paths), then each file. At most 60 files and 180 kB.
3. The document has `role: "context"`: the models read it in every call like any document, but it is **never scanned
   for requirement candidates** – its "muss"/"must" sentences describe the existing project. It is part of the source
   state, so a new context means confirming the requirements again; a running council keeps the one it started with.
4. A new context replaces the previous one. The token use shows on the start screen: the context is read by every
   model call (about 4 characters per token).

API: `GET /api/projects/{id}/repository/context` (files, suggestion, current context) and `POST` with
`{ commitSha, paths }`. Issues of the repository are not read yet (the GitHub App has no `issues:read` permission).
