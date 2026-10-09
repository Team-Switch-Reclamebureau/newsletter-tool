CREATE TABLE user_preferences (
    user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    editor_layout text NOT NULL DEFAULT 'split' CHECK (editor_layout IN ('split', 'dynamic'))
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        GRANT SELECT, INSERT, UPDATE ON user_preferences TO postroom_app;
        REVOKE DELETE ON user_preferences FROM postroom_app;
    END IF;
END
$$;
