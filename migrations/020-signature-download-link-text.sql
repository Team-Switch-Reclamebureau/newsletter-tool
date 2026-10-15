ALTER TABLE email_signatures ADD COLUMN download_link_text text NOT NULL
    DEFAULT 'Download your personalized signature.html'
    CHECK (length(btrim(download_link_text)) BETWEEN 1 AND 200);
