# Soumissions publiques sécurisées V1

## Parcours

Soumission envoyée → lien client opaque → consultation sans compte → acceptation ou refus signé → conversion unique en facture.

## Autorité du lien

- jeton aléatoire de 256 bits;
- seulement l’empreinte SHA-256 est persistée;
- expiration de 1 à 365 jours;
- toute rotation révoque immédiatement le lien précédent;
- révocation explicite disponible;
- les anciens UUID `estimates.public_token` ne donnent plus accès au portail.

## Décision publique

Une décision exige :

- `action`: `accepted` ou `rejected`;
- `signer_name`: nom complet du signataire;
- `consent_confirmed=true` pour une acceptation;
- adresse IP et horodatage enregistrés côté serveur.

Une seule décision est autorisée par organisation et soumission. Une répétition identique est reconnue comme un doublon; une décision différente est refusée.

## Réponse publique

Le portail retourne seulement :

- numéro, statut, dates et notes;
- nom du client;
- lignes, sous-total, taxes et total;
- décision, nom du signataire et horodatage lorsqu’ils existent.

Les identifiants internes, `organisation_id`, `client_id`, `estimate_id`, `public_token` et les empreintes ne sont jamais exposés.

## Conversion

Seule une soumission `accepted` peut devenir une facture ou un projet. Une contrainte unique en base empêche plusieurs factures actives pour la même soumission. La conversion existante reste transactionnelle et idempotente.

## Routes

Gestion authentifiée :

- `POST /api/portal/manage/estimates/:estimateId`
- `GET /api/portal/manage/estimates/:estimateId/status`
- `DELETE /api/portal/manage/estimates/:estimateId`

Accès public :

- `GET /api/portal/:token`
- `POST /api/portal/:token/action`
