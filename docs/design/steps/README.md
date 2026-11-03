# Design references for the ten screens

The PNGs are the original concept mockups, renamed to the file names planned in
the brief and prefixed with their UX issue. They are **visual references only**. The real screens are React
components connected to the API; where a mockup shows invented content the implementation deliberately differs:

- Fixed model names (GPT-4o, Claude 3.5, Gemini 1.5, Mistral, DeepSeek) → models are loaded live from the providers.
- "Denkt nach…" brain animations and percentages during Independent Thinking → only real states (waiting, running, submitted, failed).
- Example scores, test counts and coverage → only stored results; tests appear only when they actually ran (Milestone 4).
- The "Beschreibung für Claude" side panels are implementation notes, not product UI.

| Issue | Screen | Mockup | Implementation |
|---|---|---|---|
| #37 | Project creation | 37-ai_decision_board_projekt_erstellen.png | `/projects/new` |
| #38 | AI team configuration | 38-ki_team_konfiguration_im_dark_mode_dashboard.png, 38b-ki_team_konfiguration_variante.png | `/projects/[id]/council/new` |
| #39 | Independent Thinking | 39-neon_dashboard_für_unabhängiges_ki_brainstorming.png | `/sessions/[id]` → Independent Thinking |
| #40 | Open Council | 40-neon_dashboard_für_ki_lösungsvorschläge.png | `/sessions/[id]` → Open Council |
| #41 | 12 Minds Council | 41-kritische_debatte_im_ai_decision_board.png | `/sessions/[id]` → 12 Minds Council |
| #42 | Minority Review & Consensus Round | 42-ki_entscheidungsboard_überarbeitete_lösungen.png | `/sessions/[id]` → Minority Review / Consensus Round |
| #43 | Evaluation | 43-ki_bewertungsdashboard_im_dark_mode.png | `/sessions/[id]` → Evaluation |
| #44 | Final Verdict | 44-ki_entscheidungsdashboard_im_neonstil.png | `/sessions/[id]` → Final Verdict |
| #45 | Execution Council | 45-ki_teams_im_entwicklungs_dashboard.png | `/sessions/[id]` → Execution Council (Milestone 4) |
| #46 | Code review & tests | 46-ai_dashboard_für_tests_und_gegenprüfung.png | `/sessions/[id]` → Review & Tests (Milestone 4) |
