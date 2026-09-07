ALTER TABLE guests
  ADD COLUMN seat_count integer NOT NULL DEFAULT 1 CHECK (seat_count > 0),
  ADD COLUMN is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN source_key text UNIQUE;
