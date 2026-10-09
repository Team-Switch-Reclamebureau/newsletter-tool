CREATE TABLE project_test_recipients (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    recipients text[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipients) <= 20),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        GRANT SELECT, INSERT, UPDATE ON project_test_recipients TO postroom_app;
        REVOKE DELETE ON project_test_recipients FROM postroom_app;
    END IF;
END
$$;
