# Contrat backend — Soumissions publiques sécurisées V1

- Les jetons publics sont opaques, expirables, révocables et stockés sous forme d’empreinte SHA-256.
- Les anciens UUID de soumission ne donnent plus accès au portail public.
- Une décision publique exige un nom de signataire; l’acceptation exige un consentement explicite.
- Une seule décision est autorisée par soumission; une répétition identique est idempotente.
- Une décision contradictoire est refusée.
- Seules les soumissions acceptées peuvent être converties en facture ou en projet.
- Une seule facture active peut provenir d’une même soumission.
- Les rappels par courriel utilisent uniquement un jeton sécurisé fraîchement créé.
