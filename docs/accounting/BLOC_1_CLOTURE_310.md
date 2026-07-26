# Bloc 1 — Constat de fermeture de la comptabilité complète

## Portée

Ce constat ferme l’issue #310 et confirme la réalisation des huit sprints du bloc de comptabilité complète de MADSuite.

## Preuves validées

- Sprint 1 — backend #312 : plan comptable, périodes, gouvernance des comptes système et isolation par organisation;
- Sprint 2 — backend #313 : écritures équilibrées, journal en partie double et normalisation monétaire au cent près;
- Sprint 3 — backend #314 : réconciliation du registre financier, détection des doublons et écarts de montant;
- Sprint 4 — backend #311 : grand livre, balance de vérification, états financiers, flux de trésorerie et exports CSV;
- Sprint 5 — frontend maddevopss/madsuite-frontend#89 : interface comptable protégée, accessible et présentée en dollars canadiens;
- Sprint 6 — backend #315 : intégration vérifiée des factures, paiements clients, dépenses et fournisseurs;
- Sprint 7 — backend #316 : scénario financier complet, équilibre débit/crédit et détection d’un écart d’un cent;
- Sprint 8 — backend #317 : dépendances fusionnées, validations CI vertes et risques résiduels consignés.

## Scénario de fermeture validé

1. Initialiser un plan comptable pour une organisation.
2. Ouvrir une période comptable.
3. Finaliser une facture de 114,98 $ comprenant 100,00 $ de revenus, 5,00 $ de TPS et 9,98 $ de TVQ.
4. Vérifier l’écriture : débit des comptes clients de 114,98 $, crédits correspondants de 100,00 $, 5,00 $ et 9,98 $.
5. Recevoir un paiement de 114,98 $ et vérifier le transfert des comptes clients vers l’encaisse.
6. Enregistrer une dépense et ses taxes récupérables.
7. Vérifier le journal, le grand livre, la balance, l’état des résultats, le bilan et le flux de trésorerie.
8. Réconcilier chaque source avec exactement une écriture équilibrée.
9. Vérifier qu’une seconde organisation ne peut lire aucune donnée du scénario.
10. Vérifier qu’une écriture publiée ne peut être modifiée et doit être corrigée par contrepassation.

## Dépendances fusionnées

- backend #312;
- backend #313;
- backend #314;
- backend #311;
- frontend maddevopss/madsuite-frontend#89;
- backend #315;
- backend #316.

## Conditions de fermeture

Les conditions bloquantes ont été levées :

- les migrations et validations contractuelles sont couvertes;
- les écritures testées demeurent équilibrées;
- les doublons de source et les écarts sont détectés;
- les routes comptables demeurent isolées par organisation;
- l’interface passe par le routeur protégé;
- les écritures publiées sont traitées comme immuables et corrigées par contrepassation;
- les validations CI de la PR de fermeture sont vertes avant la mise à jour finale.

## Risques résiduels

Les obligations fiscales, les formats de transmission gouvernementaux et les traitements spécialisés d’un cabinet comptable demeurent des chantiers réglementaires distincts. MADSuite produit et conserve les données comptables; il ne remplace pas automatiquement un professionnel autorisé lorsque la loi ou la situation de l’entreprise l’exige.

## Décision

Le bloc #310 peut être fermé. La comptabilité complète dispose maintenant de fondations vérifiables, d’intégrations métier, de rapports, d’une interface utilisateur et de preuves de réconciliation. Toute évolution réglementaire ou fonction spécialisée devra être traitée dans un chantier distinct, sans rouvrir implicitement ce constat.
