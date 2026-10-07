ALTER TABLE application_settings RENAME COLUMN interface_color TO base_color;
ALTER TABLE application_settings ADD COLUMN accent_color text
    CHECK (accent_color ~ '^#[0-9a-f]{6}$');
UPDATE application_settings SET accent_color = base_color;
ALTER TABLE application_settings ALTER COLUMN accent_color SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postroom_app') THEN
        GRANT UPDATE (accent_color) ON application_settings TO postroom_app;
    END IF;
END
$$;
