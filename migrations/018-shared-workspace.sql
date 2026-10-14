DROP TABLE project_members;

ALTER TABLE email_signatures
    RENAME COLUMN user_id TO created_by;
ALTER TABLE email_signatures
    ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT email_signatures_user_id_fkey,
    ADD CONSTRAINT email_signatures_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;
DROP INDEX email_signatures_user_id;
