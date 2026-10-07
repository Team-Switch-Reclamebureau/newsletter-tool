UPDATE newsletters n
SET content = jsonb_set(n.content, '{utm}', p.utm),
    revision = n.revision + 1,
    updated_at = now()
FROM projects p
WHERE n.project_id = p.id AND n.deleted_at IS NULL AND NOT (n.content ? 'utm');

ALTER TABLE projects DROP COLUMN utm;
