-- Ajout de champs additionnels pour les clients
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS adresse TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;