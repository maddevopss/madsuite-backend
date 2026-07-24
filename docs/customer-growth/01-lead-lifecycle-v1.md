# Parcours des prospects — cycle de vie V1

## Intention

Établir un cycle de vie explicite, vérifiable et multi-organisation pour les prospects avant leur conversion en clients.

## Statuts retenus

- `new` — nouveau;
- `contacted` — contacté;
- `follow_up` — à suivre;
- `qualified` — qualifié;
- `converted` — converti;
- `lost` — perdu.

## Portée d’implantation

- centraliser les statuts et transitions permises;
- refuser les transitions invalides;
- conserver `converted` comme état terminal produit par le service de conversion;
- permettre la création, la lecture, la modification et l’archivage logique d’un prospect;
- filtrer la liste par statut et recherche texte;
- imposer l’organisation depuis le contexte serveur;
- réserver les écritures au rôle administrateur;
- retourner des erreurs métier stables.

## Transitions minimales

- `new` → `contacted`, `lost`;
- `contacted` → `follow_up`, `qualified`, `lost`;
- `follow_up` → `contacted`, `qualified`, `lost`;
- `qualified` → `follow_up`, `converted`, `lost`;
- `converted` → aucune transition manuelle;
- `lost` → `follow_up` seulement par action explicite de réouverture.

## Routes visées

- `POST /api/customer-growth/leads`;
- `GET /api/customer-growth/leads`;
- `GET /api/customer-growth/leads/:id`;
- `PATCH /api/customer-growth/leads/:id`;
- `POST /api/customer-growth/leads/:id/status`;
- `DELETE /api/customer-growth/leads/:id` pour archivage logique.

## Tests attendus

- validation stricte des données publiques;
- transitions permises et refusées;
- rôle administrateur;
- isolement entre organisations;
- impossibilité de forcer `organisation_id`;
- impossibilité de marquer manuellement un prospect comme converti;
- compatibilité avec la conversion idempotente déjà fusionnée.

## Hors portée

- rappels et activités de suivi;
- interface utilisateur;
- automatisation marketing;
- import de masse.
