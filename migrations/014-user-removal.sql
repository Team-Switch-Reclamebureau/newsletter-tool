ALTER TABLE projects
    ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT projects_created_by_fkey,
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE newsletters
    ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT newsletters_created_by_fkey,
    ADD CONSTRAINT newsletters_created_by_fkey FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE image_assets
    ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT image_assets_created_by_fkey,
    ADD CONSTRAINT image_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE newsletter_publications
    ALTER COLUMN created_by DROP NOT NULL,
    DROP CONSTRAINT newsletter_publications_created_by_fkey,
    ADD CONSTRAINT newsletter_publications_created_by_fkey FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE project_members
    DROP CONSTRAINT project_members_user_id_fkey,
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
