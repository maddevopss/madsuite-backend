BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM invoices
    WHERE estimate_id IS NOT NULL
    GROUP BY organisation_id, estimate_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Doublons historiques détectés dans invoices pour (organisation_id, estimate_id).';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM invoices
    WHERE idempotency_key IS NOT NULL
    GROUP BY organisation_id, idempotency_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Doublons historiques détectés dans invoices pour (organisation_id, idempotency_key).';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_estimate_unique_idx
  ON invoices (organisation_id, estimate_id)
  WHERE estimate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_idempotency_unique_idx
  ON invoices (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
