ALTER TABLE projects
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deletion_completed_at timestamptz;
