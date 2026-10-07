ALTER TABLE newsletters ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE newsletters ADD CONSTRAINT newsletters_public_id_unique UNIQUE (public_id);
