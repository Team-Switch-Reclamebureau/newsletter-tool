DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        REVOKE UPDATE, DELETE ON image_assets, newsletter_publications FROM postroom_app;
    END IF;
END
$$;
