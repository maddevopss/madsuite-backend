# Bloc 16 — Publication contrôlée et exploitation initiale

## Intention

Transformer une version techniquement prête en une publication traçable, vérifiée et réversible.

## Contrat de fermeture

Une publication ne peut être déclarée terminée que lorsque les éléments suivants sont prouvés :

1. la porte de préparation production est approuvée;
2. la version et le commit source sont identifiés;
3. le plan de retour arrière est vérifié;
4. les migrations et la base de données sont saines;
5. l’isolation entre organisations est confirmée;
6. les parcours critiques fonctionnent;
7. les traitements en arrière-plan et les alertes sont actifs;
8. aucun incident critique n’est ouvert;
9. les preuves sont conservées;
10. une personne autorisée prononce la fermeture.

## États

- `planned` : publication définie;
- `approved` : autorisation humaine enregistrée;
- `deploying` : déploiement en cours;
- `verifying` : contrôles après publication en cours;
- `completed` : publication vérifiée et fermée;
- `rolled_back` : retour arrière exécuté;
- `failed` : publication échouée et non fermée.

## Principe SYSTEME_MAD

Les automatismes observent, testent et rassemblent les preuves. Ils ne remplacent ni la responsabilité humaine ni la décision finale de publier ou de revenir en arrière.
