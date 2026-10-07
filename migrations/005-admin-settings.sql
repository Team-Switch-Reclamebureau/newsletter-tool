CREATE TABLE application_admins (
    user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE application_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    application_name text NOT NULL CHECK (length(btrim(application_name)) BETWEEN 1 AND 80),
    interface_color text NOT NULL CHECK (interface_color ~ '^#[0-9a-f]{6}$'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);

INSERT INTO application_settings (application_name, interface_color)
VALUES ('Postroom', '#425f30');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        REVOKE INSERT, UPDATE, DELETE ON application_admins FROM postroom_app;
        GRANT SELECT ON application_admins TO postroom_app;
        REVOKE INSERT, UPDATE, DELETE ON application_settings FROM postroom_app;
        GRANT SELECT, UPDATE (application_name, interface_color, revision)
            ON application_settings TO postroom_app;
    END IF;
END
$$;
