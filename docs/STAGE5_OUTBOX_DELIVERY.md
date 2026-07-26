# Étage 5D — Événements différés et boîte de sortie

Un événement différé est créé dans la même transaction que le changement métier. Sa livraison commence uniquement après la validation de cette transaction.

La clé de livraison combine le type, l’agrégat et sa version afin de dédupliquer les reprises. Chaque tentative conserve son résultat. La réconciliation privilégie une livraison confirmée et signale les événements toujours en attente.
