-- ADR 0206 (#206): removes again what users deleted after the restored backup was taken. Runs in ONE transaction,
-- after post-restore-scrub.sh created and filled the temp table scrub_list(deleted_at, kind, entity_id, organization_id)
-- from the deletion list outside the backups. The restored database's own tombstones are added to that list.
-- Only ids are handled; the output names counts, never names or content. Safe to run twice.
INSERT INTO scrub_list (deleted_at, kind, entity_id, organization_id)
  SELECT deleted_at, kind, entity_id, organization_id FROM deletion_tombstone;

CREATE TEMP TABLE scrub_workspaces ON COMMIT DROP AS
  SELECT id FROM organization WHERE id IN (SELECT entity_id FROM scrub_list WHERE kind = 'workspace');
-- A project still marked "deleting" in the dump (#197) is gone for the user too.
CREATE TEMP TABLE scrub_projects ON COMMIT DROP AS
  SELECT id FROM project
  WHERE id IN (SELECT entity_id FROM scrub_list WHERE kind = 'project') OR status = 'deleting'
    OR organization_id IN (SELECT id FROM scrub_workspaces);
CREATE TEMP TABLE scrub_sessions ON COMMIT DROP AS
  SELECT id FROM council_session
  WHERE id IN (SELECT entity_id FROM scrub_list WHERE kind = 'session') OR project_id IN (SELECT id FROM scrub_projects);
CREATE TEMP TABLE scrub_counts ON COMMIT DROP AS SELECT
  (SELECT count(*) FROM scrub_workspaces) AS workspaces,
  (SELECT count(*) FROM scrub_projects WHERE id NOT IN (SELECT p.id FROM project p JOIN scrub_workspaces w ON w.id = p.organization_id)) AS projects,
  (SELECT count(*) FROM scrub_sessions) AS sessions;

-- Queued work first, so nothing of a deleted workspace, project or session runs or delivers after the restart.
DELETE FROM job
WHERE organization_id IN (SELECT id FROM scrub_workspaces)
   OR payload->>'sessionId' IN (SELECT id FROM scrub_sessions)
   OR payload->>'planId' IN (SELECT id FROM development_plan WHERE session_id IN (SELECT id FROM scrub_sessions));
DELETE FROM council_session WHERE id IN (SELECT id FROM scrub_sessions);
DELETE FROM project WHERE id IN (SELECT id FROM scrub_projects);
DELETE FROM organization WHERE id IN (SELECT id FROM scrub_workspaces);

INSERT INTO deletion_tombstone (kind, entity_id, organization_id, deleted_at)
  SELECT DISTINCT ON (kind, entity_id) kind, entity_id, organization_id, deleted_at FROM scrub_list ORDER BY kind, entity_id, deleted_at
ON CONFLICT DO NOTHING;
INSERT INTO audit_event (id, organization_id, actor_user_id, action, target_type, target_id, metadata)
  SELECT 'aud_' || md5(random()::text || clock_timestamp()::text), NULL, NULL, 'privacy.restore_scrubbed', 'database', NULL,
         jsonb_build_object('workspaces', workspaces, 'projects', projects, 'sessions', sessions)
  FROM scrub_counts WHERE workspaces + projects + sessions > 0;

SELECT 'scrubbed workspaces=' || workspaces || ' projects=' || projects || ' sessions=' || sessions AS result FROM scrub_counts;
