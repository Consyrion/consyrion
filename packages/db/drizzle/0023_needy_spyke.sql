-- Stage 1b of #181: the gate version a council was started for, fixed at creation. Existing sessions and sessions
-- inserted by older releases get 1 (what they compute); a release supporting only lower versions never runs them.
ALTER TABLE "council_session" ADD COLUMN "gate_version" integer DEFAULT 1 NOT NULL;