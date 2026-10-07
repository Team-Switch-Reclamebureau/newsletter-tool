ALTER TABLE projects ADD COLUMN utm jsonb NOT NULL DEFAULT
    '{"utm_source":"","utm_medium":"","utm_campaign":"","utm_term":""}'::jsonb
    CHECK (jsonb_typeof(utm) = 'object');
