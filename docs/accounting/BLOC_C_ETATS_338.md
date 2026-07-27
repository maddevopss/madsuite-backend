# Bloc C — États financiers et exports

Issue : #338

## Résultat attendu

Les données comptables publiées produisent des rapports exacts, filtrables, comparatifs, retraçables et exportables.

## Portée obligatoire

- grand livre avec solde progressif;
- balance de vérification;
- comparaison entre périodes;
- état des résultats;
- bilan équilibré;
- flux de trésorerie;
- détail jusqu’aux écritures sources;
- exports CSV;
- exports PDF;
- cohérence des arrondis et totaux.

## Preuves avant fusion

- jeux de données PostgreSQL connus;
- égalité totale débit/crédit;
- actif = passif + avoir;
- concordance résultat net et capitaux propres;
- comparatifs et exports vérifiés.

Cette PR demeure en brouillon jusqu’à présence du code et des preuves.