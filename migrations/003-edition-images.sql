ALTER TABLE image_assets
    ADD COLUMN scope text NOT NULL DEFAULT 'project'
    CHECK (scope IN ('project', 'edition'));
ALTER TABLE image_assets ADD CONSTRAINT image_assets_id_project UNIQUE (id, project_id);
ALTER TABLE newsletters ADD CONSTRAINT newsletters_id_project UNIQUE (id, project_id);

CREATE TABLE newsletter_images (
    project_id uuid NOT NULL,
    newsletter_id uuid NOT NULL,
    image_asset_id uuid NOT NULL,
    PRIMARY KEY (newsletter_id, image_asset_id),
    FOREIGN KEY (newsletter_id, project_id) REFERENCES newsletters(id, project_id),
    FOREIGN KEY (image_asset_id, project_id) REFERENCES image_assets(id, project_id)
);
CREATE INDEX newsletter_images_project ON newsletter_images(project_id);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        REVOKE UPDATE, DELETE ON newsletter_images FROM postroom_app;
    END IF;
END
$$;
