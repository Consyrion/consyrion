-- Rename to CONSYRIUM AI (11 Nov 2026): the operator's SkillHub handle and the stored origin labels of adopted
-- skills and profiles follow the new name. Old public links are redirected by the web app (next.config.ts).
UPDATE "skill_publisher" SET "handle" = 'consyrium-team'
WHERE "handle" = 'consyrion-team' AND NOT EXISTS (SELECT 1 FROM "skill_publisher" p WHERE p."handle" = 'consyrium-team');--> statement-breakpoint
UPDATE "skill" SET "forked_from" = jsonb_set("forked_from", '{name}', to_jsonb(replace(replace("forked_from"->>'name', '@consyrion-team/', '@consyrium-team/'), '@consyrion/', '@consyrium/')))
WHERE "forked_from"->>'name' LIKE '@consyrion%';--> statement-breakpoint
UPDATE "role_profile" SET "forked_from" = jsonb_set("forked_from", '{name}', to_jsonb(replace(replace("forked_from"->>'name', '@consyrion-team/', '@consyrium-team/'), '@consyrion/', '@consyrium/')))
WHERE "forked_from"->>'name' LIKE '@consyrion%';
