# Étage 5F — Journaux, mesures et corrélation

Chaque requête et chaque traitement différé transporte un identifiant de corrélation stable. Les événements structurés indiquent le module, l’événement, l’organisation concernée et les données utiles à l’enquête.

Les mots de passe, jetons, secrets, cookies et en-têtes d’autorisation sont masqués récursivement avant journalisation. Les mesures doivent utiliser des dimensions bornées; elles ne doivent jamais employer un identifiant de client ou de requête comme étiquette à forte cardinalité.
