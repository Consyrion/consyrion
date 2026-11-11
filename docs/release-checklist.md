# Release checklist (#34)

## End-to-end demonstration (with real keys – still open)
- [ ] Sign up (e-mail and Google/GitHub), create a workspace
- [ ] Add two real provider keys; *Check* both; *Load models*
- [ ] Create a project with a document; configure a council (2–3 models, Adversarial Review)
- [ ] Watch Independent Thinking → … → Final Verdict live; export the report
- [ ] Approve; link a GitHub repository; run the Execution Council on a worker **with Docker**
- [ ] Tests run in the sandbox (passed or failed honestly); reviews present
- [ ] Create the draft PR; CI checks visible; merge manually in GitHub
- [ ] Open the decision and the changes in the VS Code extension
- [ ] Record the demo (screen capture) and the token usage per provider

## Technical gates
- [ ] CI green on the release branch (tests, lint, typecheck, build, migrations, VSIX, Docker images)
- [ ] All stacked PRs (#59–#65) reviewed and merged by a human
- [ ] Production environment variables set; `/api/health` ok
- [ ] Database backups verified by a test restore
- [ ] GitHub App and OAuth apps point to production URLs
- [ ] Stripe in live mode only after pricing is final

## Legal and business
- [ ] Trademark check by a lawyer (risk "Consirion", see CONSYRIUM_BRAND_CHECK.md)
- [ ] Privacy policy, terms, imprint (Switzerland), DPA template
- [ ] Prices for Starter/Pro/Developer/Business entered in `/admin`
- [ ] Evaluation: council vs. single model on real tasks (docs/review/brief-review.md)
