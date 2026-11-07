# Notes de l'association

Les fichiers `.md` de ce dossier alimentent la base de connaissances de « Mon courrier » : quand une lettre est analysée, ces notes sont proposées au bénévole (et à l'IA) pour dire **vers qui orienter** la personne.

## Comment ajouter une note

1. Copiez `exemple-permanences.md` et renommez-le (ex. `permanences-juridiques.md`).
2. En haut du fichier, entre les deux lignes `---`, renseignez (tout est facultatif) :
   - `title` : le titre de la note
   - `department` : le numéro de département concerné (`75`, `93`, `2A`…) ; laissez vide si la note vaut partout
   - `kind` : `contact` (adresse, permanence, téléphone) ou `guide` (explication). Par défaut : `guide`
   - `url` : un lien vers plus d'informations
3. Écrivez ensuite le contenu. **Chaque titre de niveau 2 (`## Titre`) devient un extrait indépendant** : une idée par section, avec les infos concrètes (lieu, jours, horaires, téléphone, ce qu'il faut apporter).
4. Enregistrez, puis lancez la synchronisation : `bun knowledge:sync association` (ou le bouton « Synchroniser » du back-office). Elle tourne aussi toute seule chaque lundi.

## Règles

- Uniquement des informations **publiques et professionnelles** : jamais de nom ni de coordonnées de personnes accompagnées, ni de numéro de téléphone personnel.
- Écrivez en français simple et à jour ; indiquez la date de vérification en haut de la note.
- Ce dossier n'est pas fait pour les guides d'autres associations (ex. Watizat) : voir `../watizat/`, désactivé tant que leur autorisation n'est pas obtenue.
