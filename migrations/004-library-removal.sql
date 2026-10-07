ALTER TABLE image_assets ADD COLUMN deleted_at timestamptz;
ALTER TABLE newsletter_images ADD COLUMN removed_at timestamptz;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        GRANT UPDATE (deleted_at) ON image_assets TO postroom_app;
        GRANT UPDATE (removed_at) ON newsletter_images TO postroom_app;
    END IF;
END
$$;
