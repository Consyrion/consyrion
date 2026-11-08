import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { auditEvent, aiProviderCredential, membership, projectDocument, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { setSubscriptionPlan } from "./saas";
import { createCredential, decryptCredentialForUse, deleteCredential, listCredentials } from "./credentials";
import { createOrganization, ensurePersonalOrganization, listOrganizationsForUser } from "./organizations";
import { archiveProject, createProject, getProject, listProjects, updateBrief } from "./projects";
import { assertRepositoryLinked, linkRepository, saveGitHubInstallation, suspendGitHubInstallation } from "./github";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

const validProject = {
  name: "Repo analyzer",
  type: "architecture" as const,
  brief: { idea: "Design the best architecture for a SaaS that analyzes GitHub repositories.", goal: "MVP in 8 weeks" },
};

async function addUser(id: string) {
  await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
}

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await addUser("alice");
  await addUser("bob");
  const orgA = await ensurePersonalOrganization(handle.db, "alice", "Alice");
  const orgB = await createOrganization(handle.db, "bob", { name: "Bob Inc" });
  alice = await resolveActor(handle.db, "alice", orgA.id);
  // Plan limits are tested separately; these tests use the largest plan.
  await setSubscriptionPlan(handle.db, "alice", orgA.id, "business");
  bob = await resolveActor(handle.db, "bob", orgB.id);
});

afterAll(async () => {
  await handle.close();
});

describe("organizations", () => {
  it("creates exactly one personal workspace with an owner membership", async () => {
    const again = await ensurePersonalOrganization(handle.db, "alice", "Alice");
    expect(again.id).toBe(alice.organizationId);
    expect(await listOrganizationsForUser(handle.db, "alice")).toHaveLength(1);
    expect(alice.role).toBe("owner");
  });

  it("does not resolve memberships in foreign organizations", async () => {
    await expect(resolveActor(handle.db, "alice", bob.organizationId)).rejects.toThrow(/not found/);
  });

  it("validates organization names", async () => {
    await expect(createOrganization(handle.db, "alice", { name: "x" })).rejects.toThrow(/Invalid/);
  });
});

describe("projects", () => {
  it("creates a project with brief version 1 and an audit event", async () => {
    const created = await createProject(handle.db, alice, validProject);
    const loaded = await getProject(handle.db, alice, created.id);
    expect(loaded.brief?.version).toBe(1);
    expect(loaded.status).toBe("ready");
    expect(loaded.intent).toBe("decision");
    const audits = await handle.db.select().from(auditEvent).where(eq(auditEvent.targetId, created.id));
    expect(audits.map((a) => a.action)).toContain("project.created");
  });

  it("rejects invalid input", async () => {
    await expect(createProject(handle.db, alice, { ...validProject, brief: { idea: "too short" } })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createProject(handle.db, alice, { ...validProject, brief: { ...validProject.brief, repositoryUrl: "https://evil.example/repo" } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps earlier brief versions when updating", async () => {
    const created = await createProject(handle.db, alice, validProject);
    const v2 = await updateBrief(handle.db, alice, created.id, { idea: "A revised and more precise description of the idea." });
    expect(v2.version).toBe(2);
    expect((await getProject(handle.db, alice, created.id)).brief?.idea).toContain("revised");
  });

  it("isolates tenants", async () => {
    const created = await createProject(handle.db, alice, validProject);
    await expect(getProject(handle.db, bob, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateBrief(handle.db, bob, created.id, { idea: "Bob tries to overwrite Alice's project brief." })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listProjects(handle.db, bob)).every((p) => p.organizationId === bob.organizationId)).toBe(true);
  });

  it("enforces roles", async () => {
    await addUser("victor");
    await handle.db.insert(membership).values({ id: "mem_victor", organizationId: alice.organizationId, userId: "victor", role: "viewer" });
    const viewer = await resolveActor(handle.db, "victor", alice.organizationId);
    expect(await listProjects(handle.db, viewer)).not.toHaveLength(0);
    await expect(createProject(handle.db, viewer, validProject)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [first] = await listProjects(handle.db, viewer);
    await expect(archiveProject(handle.db, viewer, first!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("github installations (#394)", () => {
  const installation = { installationId: 394, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected" };

  it("connects an installation to one workspace only", async () => {
    await saveGitHubInstallation(handle.db, alice, installation);
    // Reconnecting in the same workspace is fine.
    await saveGitHubInstallation(handle.db, alice, installation);
    await expect(saveGitHubInstallation(handle.db, bob, installation)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("frees the installation once it is suspended or uninstalled", async () => {
    await suspendGitHubInstallation(handle.db, 394);
    await expect(saveGitHubInstallation(handle.db, bob, installation)).resolves.toEqual(expect.any(String));
  });
});

describe("github reads (#402)", () => {
  it("reads pull requests only of repositories linked to a project of the workspace", async () => {
    const integrationId = await saveGitHubInstallation(handle.db, alice, { installationId: 4020, accountLogin: "alice", accountType: "User", repositorySelection: "all" });
    const created = await createProject(handle.db, alice, { ...validProject, name: "Linked repo" });
    await linkRepository(handle.db, alice, created.id, { integrationId, fullName: "alice/app", defaultBranch: "main" });
    await expect(assertRepositoryLinked(handle.db, alice, integrationId, "alice/app")).resolves.toBeUndefined();
    // Granted by the installation, but not linked to any project.
    await expect(assertRepositoryLinked(handle.db, alice, integrationId, "alice/secret-tooling")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another workspace never sees it.
    await expect(assertRepositoryLinked(handle.db, bob, integrationId, "alice/app")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("credentials", () => {
  it("stores keys encrypted and never lists the secret", async () => {
    const created = await createCredential(handle.db, alice, keyring, { provider: "anthropic", label: "team", secret: "sk-ant-test-0000000000001234" });
    expect(created.secretHint).toBe("••••1234");
    expect(JSON.stringify(created)).not.toContain("sk-ant");
    const [raw] = await handle.db.select().from(aiProviderCredential).where(eq(aiProviderCredential.id, created.id));
    expect(raw!.encryptedSecret).not.toContain("sk-ant");
    const listed = await listCredentials(handle.db, alice);
    expect(JSON.stringify(listed)).not.toContain("encrypted");
    const audits = await handle.db.select().from(auditEvent).where(eq(auditEvent.targetId, created.id));
    expect(JSON.stringify(audits)).not.toContain("sk-ant");
  });

  it("decrypts only inside the owning tenant", async () => {
    const created = await createCredential(handle.db, alice, keyring, { provider: "openai", label: "main", secret: "sk-openai-test-000000005678" });
    expect((await decryptCredentialForUse(handle.db, alice, keyring, created.id)).secret).toBe("sk-openai-test-000000005678");
    await expect(decryptCredentialForUse(handle.db, bob, keyring, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteCredential(handle.db, bob, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects duplicate labels per provider", async () => {
    await createCredential(handle.db, alice, keyring, { provider: "google", label: "dup", secret: "AIza-test-0000000000000000" });
    await expect(createCredential(handle.db, alice, keyring, { provider: "google", label: "dup", secret: "AIza-test-1111111111111111" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets only owners and admins manage keys", async () => {
    await handle.db.update(membership).set({ role: "member" }).where(eq(membership.id, "mem_victor"));
    const member = await resolveActor(handle.db, "victor", alice.organizationId);
    await expect(createCredential(handle.db, member, keyring, { provider: "anthropic", secret: "sk-ant-member-000000000000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("documents: PDF, Word and PowerPoint (#181 follow-up)", () => {
  it("stores the extracted text of a DOCX, sized by the text the models read, and refuses a text that is too long", async () => {
    const { addDocument } = await import("./documents");
    const { default: JSZip } = await import("jszip");
    const docx = async (text: string) => {
      const z = new JSZip();
      z.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
      return z.generateAsync({ type: "uint8array" });
    };
    const project = await createProject(handle.db, alice, { name: "Upload", type: "architecture", brief: { idea: "A clinic scheduling SaaS." } });
    const stored = await addDocument(handle.db, alice, project.id, {
      name: "konzept.docx",
      mimeType: "application/octet-stream",
      bytes: await docx("Daten nur in Deutschland"),
    });
    expect(stored.sizeBytes).toBe("Daten nur in Deutschland".length);
    const [row] = await handle.db.select().from(projectDocument).where(eq(projectDocument.id, stored.id));
    expect(row!.content).toBe("Daten nur in Deutschland");
    await expect(addDocument(handle.db, alice, project.id, { name: "lang.docx", mimeType: "", bytes: await docx("x".repeat(200_001)) })).rejects.toThrow(
      /longer than 200 kB/,
    );
    await expect(addDocument(handle.db, alice, project.id, { name: "bild.bmp", mimeType: "image/bmp", bytes: new Uint8Array([1]) })).rejects.toThrow(
      /Supported are PDF/,
    );
  });
});
