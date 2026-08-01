-- 20260801_public_link_resolvers.sql
-- Le portail public (facture/soumission consultée par un client sans compte
-- via un lien à jeton) doit résoudre l'organisation à partir du seul jeton,
-- avant même de savoir à quelle organisation appartient la ressource — un
-- besoin intrinsèquement cross-tenant, comme le lookup d'email à la
-- connexion (cf. auth_find_user_by_email). Sans fonction SECURITY DEFINER
-- dédiée, ce lookup passe par une lecture directe bloquée par RLS FORCE :
-- getPublicInvoiceContextByToken/getPublicEstimateContextByToken retournent
-- toujours null, quel que soit le jeton — le portail public est entièrement
-- inopérant. Ces fonctions étroites ne permettent que le strict nécessaire :
-- résoudre + horodater l'accès d'un lien non révoqué et non expiré, jamais
-- une lecture arbitraire.

CREATE OR REPLACE FUNCTION resolve_invoice_public_link(p_token_hash TEXT)
RETURNS TABLE(
  link_id BIGINT,
  organisation_id INTEGER,
  invoice_id INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE invoice_public_links
     SET last_accessed_at = NOW()
   WHERE token_hash = p_token_hash
     AND revoked_at IS NULL
     AND invoice_public_links.expires_at > NOW()
  RETURNING id, invoice_public_links.organisation_id, invoice_public_links.invoice_id, invoice_public_links.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_estimate_public_link(p_token_hash TEXT)
RETURNS TABLE(
  link_id BIGINT,
  organisation_id INTEGER,
  estimate_id INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE estimate_public_links
     SET last_accessed_at = NOW()
   WHERE token_hash = p_token_hash
     AND revoked_at IS NULL
     AND estimate_public_links.expires_at > NOW()
  RETURNING id, estimate_public_links.organisation_id, estimate_public_links.estimate_id, estimate_public_links.expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_invoice_public_link(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_estimate_public_link(TEXT) TO PUBLIC;

-- Les webhooks Stripe reçoivent un invoice_id (via metadata/client_reference_id)
-- sans contexte d'organisation préétabli : même besoin cross-tenant étroit que
-- les liens publics ci-dessus, résolu via une fonction SECURITY DEFINER dédiée
-- plutôt qu'une lecture directe bloquée par RLS FORCE.
CREATE OR REPLACE FUNCTION resolve_invoice_organisation(p_invoice_id INTEGER)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organisation_id FROM invoices WHERE id = p_invoice_id AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION resolve_invoice_organisation(INTEGER) TO PUBLIC;

-- Jobs cron cross-tenant par nature (traitement en lot pour toutes les
-- organisations) : trialReminderJob et securityBufferJob doivent joindre
-- utilisateurs (RLS FORCE) sans contexte d'organisation unique. Fonctions
-- SECURITY DEFINER étroites, strictement équivalentes aux requêtes qu'elles
-- remplacent — jamais un accès arbitraire.
CREATE OR REPLACE FUNCTION list_trial_reminder_admins()
RETURNS TABLE(
  org_id INTEGER,
  org_nom TEXT,
  trial_ends_at TIMESTAMPTZ,
  admin_email TEXT,
  admin_nom TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.nom, o.trial_ends_at, u.email, u.nom
  FROM organisations o
  JOIN utilisateurs u ON u.organisation_id = o.id AND u.role_org = 'admin'
  WHERE o.trial_ends_at IS NOT NULL
    AND o.trial_ends_at::date = (NOW() + INTERVAL '2 days')::date
    AND u.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION list_trial_reminder_admins() TO PUBLIC;

CREATE OR REPLACE FUNCTION lock_pending_security_incidents()
RETURNS TABLE(
  utilisateur_id INTEGER,
  organisation_id INTEGER,
  email TEXT,
  nom TEXT,
  incident_ids BIGINT[],
  incidents JSON
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked_incidents AS (
    SELECT sib.id, sib.utilisateur_id, sib.type, sib.details
    FROM security_incidents_buffer sib
    WHERE sib.notified_at IS NULL
    ORDER BY sib.id
    FOR UPDATE OF sib SKIP LOCKED
  )
  SELECT
    li.utilisateur_id,
    u.organisation_id,
    u.email,
    u.nom,
    array_agg(li.id ORDER BY li.id),
    json_agg(json_build_object('type', li.type, 'details', li.details) ORDER BY li.id)
  FROM locked_incidents li
  JOIN utilisateurs u ON u.id = li.utilisateur_id
  GROUP BY li.utilisateur_id, u.organisation_id, u.email, u.nom;
END;
$$;

GRANT EXECUTE ON FUNCTION lock_pending_security_incidents() TO PUBLIC;
