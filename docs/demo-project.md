# Demo project

Owner decision 08.11.26: every customer workspace gets **one read-only demo project**, so a new customer sees a finished
council (proposals, debate, minority review, verdict) before spending a token.

## How it works

- A platform admin picks a template under **Admin → Demo project**: one finished council (with a verdict) of the
  admin's own workspace per interface language (`de`, `en`, `fr`, `es`, `zh`). Stored as platform setting
  `demo.templates` (`packages/db/src/repositories/demo.ts`, `PUT /api/admin/demo`).
- The first time a workspace opens the dashboard or the project list, `ensureDemoProject` copies the template of the
  user's language (fallback English, then German) into the workspace as project `Demo: <name>` with `is_demo = true`.
  `organization.demo_seeded_at` is claimed first, so the copy happens once – a deleted demo never comes back, and
  existing workspaces get it once too. A failed copy is logged and released; the page never breaks over a demo.
- Copied: project, brief, confirmed requirement list, session, participants, roles, stages, proposals and revisions,
  debate, objections, minority review, consensus, evaluation rounds, requirement checks, scores, votes, verdict. Every
  id (also inside jsonb such as the verdict matrix) is replaced. **Not copied:** provider keys (participants have no
  credential), documents, usage, approvals, builds, deliveries.

## Read-only

- No council (`createSession`), approval (`submitApproval`) or build (`startExecution`) on a demo project – the
  repositories refuse, and the pages hide the buttons and show a banner with "Create your own project".
- The demo project and its session never count against plan limits (`usageThisMonth`).
- It can be deleted like any project.

Migration 0038 (`organization.demo_seeded_at`, `project.is_demo`). Test: `packages/council/test/demo.test.ts`.
