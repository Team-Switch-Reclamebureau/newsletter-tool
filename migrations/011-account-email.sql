CREATE TABLE smtp_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    host text NOT NULL DEFAULT '',
    port integer NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
    security text NOT NULL DEFAULT 'starttls' CHECK (security IN ('starttls', 'tls', 'none')),
    username text NOT NULL DEFAULT '',
    password_encrypted text NOT NULL DEFAULT '',
    from_email text NOT NULL DEFAULT '',
    from_name text NOT NULL DEFAULT '',
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);

INSERT INTO smtp_settings(singleton) VALUES (true);

CREATE TABLE user_invitations (
    user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    invited_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        GRANT SELECT, UPDATE ON smtp_settings TO postroom_app;
        REVOKE INSERT, DELETE ON smtp_settings FROM postroom_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON user_invitations TO postroom_app;
        GRANT INSERT, DELETE ON application_admins TO postroom_app;
    END IF;
END
$$;
