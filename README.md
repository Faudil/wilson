# Mon courrier — POC

Service WhatsApp pour les personnes accompagnées par l'association :

1. **Expliquer un courrier.** La personne envoie la photo d'un courrier officiel (préfecture, OFPRA, CAF, OFII…). Elle reçoit dans sa langue ce qu'est le courrier, ce qu'on attend d'elle, la date limite et à qui s'adresser. **Chaque réponse est relue et validée par un·e bénévole avant l'envoi.**
2. **Mes documents.** La personne garde ses papiers (attestation, récépissé, domiciliation…) dans un coffre chiffré. Elle reçoit un rappel WhatsApp 30 jours et 7 jours avant l'expiration.

Le service **ne donne jamais de conseil juridique** : il explique, oriente et rappelle. Chaque message se termine par les coordonnées de l'association.

Langues (28) : français, anglais, arabe, dari, pachto, ourdou, ukrainien, tigrinya, somali, amharique, russe, espagnol, portugais, turc, kurde (kurmandji et sorani), bengali, tamoul, géorgien, arménien, albanais, roumain, créole haïtien, wolof, pulaar, bambara, lingala, swahili.

3. **Poser une question (chatbot).** La personne peut écrire une question avec ses mots (menu 4, ou n'importe quel texte libre). Le robot répond dans sa langue à partir de la base de connaissances, sans conseil juridique, et oriente toujours vers l'association.

> Documentation technique : [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Installation (personne technique)

### Option A — sur un ordinateur, sans Docker (le plus simple pour tester)

Prérequis : [Bun](https://bun.sh) 1.4 ou plus récent (un seul outil : il installe les dépendances et fait tourner l'application ; Node.js n'est pas nécessaire). Fonctionne sous Windows, macOS et Linux.

```bash
bun install
bun local
```

Puis ouvrir http://localhost:5173 (compte `admin@example.org` / `change-me-please`) et l'onglet **Bac à sable**.

- Aucun service à installer : la base de données est embarquée (PGlite), les fichiers chiffrés sont dans `.data/`, les clés sont générées dans `.env.local` au premier lancement.
- Toujours arrêter avec Ctrl+C (la base est fermée proprement ; un seul lancement à la fois sur le même dossier). Pour repartir de zéro : arrêter (Ctrl+C) et supprimer `.data/` et `.env.local`.
- Pour la vraie IA : dans `.env.local`, mettre `LLM_MODE=anthropic` et `ANTHROPIC_API_KEY=…` (ou ajouter des clés depuis le back-office : Plus > Coûts de l'IA).
- Coûts : chaque appel à Claude est compté (tokens + prix estimé, sans aucun contenu). Les admins voient les totaux du jour et du mois, fixent un budget mensuel (alerte à 80 %, arrêt facultatif) et gèrent plusieurs clés API, chacune avec son propre budget.
- Mode réservé aux tests : les tâches en attente sont perdues si on arrête le programme.

### Option B — avec Docker (proche de la production)


Prérequis : Docker et Docker Compose.

```bash
cp .env.example .env
# Générer les deux clés secrètes (à garder précieusement, voir §4) :
sed -i "s#^MASTER_KEY=.*#MASTER_KEY=$(openssl rand -base64 32)#; s#^LOOKUP_KEY=.*#LOOKUP_KEY=$(openssl rand -base64 32)#" .env
# Renseigner ASSOCIATION_NAME, ASSOCIATION_CONTACT, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
docker compose up --build
```

- Back-office : http://localhost:8080 (compte admin = `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).
- Un compte « Bénévole Démo » est aussi créé hors production.

### Mode bac à sable (sans compte Meta, sans clé IA)

Par défaut, `WHATSAPP_MODE=sandbox` et `LLM_MODE=fake` :

- l'onglet **Bac à sable** du back-office simule un téléphone WhatsApp : écrivez « bonjour », choisissez une langue, envoyez une photo de courrier (exemples dans `samples/letters/*.png`) ;
- le courrier apparaît dans **Courriers à relire** ; validez-le et la réponse arrive dans le faux téléphone ;
- « Simuler les rappels » lance les rappels de documents comme si on était à une date donnée ;
- en `LLM_MODE=fake`, les 10 courriers d'exemple reçoivent une analyse préparée à l'avance ; toute autre photo reçoit une analyse générique.

### Passer en vrai

| Variable | Rôle |
|---|---|
| `LLM_MODE=anthropic`, `ANTHROPIC_API_KEY`, `LLM_MODEL` | Analyse réelle par Claude (modèle Opus par défaut). La clé du serveur est facultative si des clés sont ajoutées dans le back-office. |
| `LLM_FAST_MODEL` (optionnel) | Modèle plus rapide pour les petits appels dont dépend la réponse WhatsApp (intention, traduction). Vide = `LLM_MODEL` |
| `WHATSAPP_MODE=meta` + `WHATSAPP_*` | WhatsApp Cloud API (Meta). Webhook : `https://<domaine>/webhooks/whatsapp`. **Pas à pas complet (identifiants, webhook, modèles, vrai numéro) : [docs/whatsapp-setup.md](docs/whatsapp-setup.md)** |
| `WHATSAPP_TEMPLATE_EXPLANATION_READY`, `WHATSAPP_TEMPLATE_DOCUMENT_REMINDER` | Modèles de messages (catégorie « utility ») utilisés quand la personne n'a pas écrit depuis plus de 24 h (règle WhatsApp). Soumis à Meta dans les 16 langues qu'il accepte par `bun run --filter @wilson/api wa:setup templates` |
| `S3_*` | Stockage S3 hébergé en France/UE (Scaleway, OVH, Clever Cloud…) |

Le back-office doit être servi en **HTTPS** en production (le cookie de session est `Secure`).

**Déploiement automatique sur votre serveur** (tests puis déploiement SSH + Docker Compose à chaque push sur `main`, sauvegardes quotidiennes) : voir [docs/deploy.md](docs/deploy.md).

Développement sans Docker : `bun install`, une base Postgres, puis `bun run --filter @wilson/api dev` et `bun run --filter @wilson/backoffice dev`. Tests : `bun run test` (lance `bun test` dans chaque paquet ; Postgres requis sur `localhost:5432`, utilisateur `wilson`). Vérification des types : `bun run typecheck`.

*Derrière un proxy d'entreprise qui intercepte TLS* : `docker build --secret id=extra_ca,src=<ca.crt> -f docker/api.Dockerfile -t wilson-api .` (idem pour `backoffice`), puis `docker compose up --no-build`.

---

## 2. Utilisation par les bénévoles

Le back-office fonctionne sur téléphone.

- **Courriers** : la liste des courriers à relire, les plus urgents en premier. Ouvrez un courrier, regardez la photo, lisez l'explication **en français**, corrigez si besoin (texte, type, urgence, date limite), puis **Valider et envoyer** ou **Refuser**.
  - Si vous corrigez le français, la traduction est refaite automatiquement au moment de l'envoi.
  - Refuser : la personne reçoit « un·e bénévole va vous recontacter » ; rien de l'IA n'est envoyé.
  - Les encadrés jaunes signalent ce qu'il faut vérifier (date calculée, photo floue, OQTF…).
- **Personnes** : documents de chaque personne, dates d'expiration, rappels, changement de langue.
- **Échéances** : documents qui expirent dans les 60 prochains jours.
- **Test des langues** : vérifie que chaque écriture s'affiche correctement sur votre téléphone.


## 2b. Base de connaissances (« à qui s'adresser »)

Pour que les réponses orientent vers de **vraies adresses locales**, l'outil s'appuie sur des sources gratuites et réutilisables :

- **Fiches Service-Public.fr** (licence ouverte) : démarches titre de séjour, asile, CAF, AME, logement, impôts…
- **Annuaire de l'administration** (licence ouverte) : préfecture, CAF, CPAM, Point-justice, France services… du département choisi (`KNOWLEDGE_DEPARTMENTS`, par défaut `75`).
- **Vos propres notes** : fichiers dans `knowledge/association/` (voir le README de ce dossier). C'est le plus utile : vos permanences, horaires, partenaires.
- **Watizat** : désactivé. Leurs guides sont « tous droits réservés » : il faut **demander l'autorisation à Watizat**. Ensuite, déposer le PDF dans `knowledge/watizat/` et mettre `KNOWLEDGE_ENABLE=watizat`.

La mise à jour se fait automatiquement chaque semaine (et au premier démarrage), ou avec `bun knowledge:sync`, ou le bouton « Synchroniser » de l'écran **Connaissances** (admin). Cet écran permet aussi de tester la recherche. Dans chaque courrier à relire, l'encadré **Sources** montre sur quoi l'orientation s'appuie : vérifiez les adresses avant de valider.

La recherche se fait dans notre propre base, sans service extérieur : aucune donnée des personnes n'est envoyée nulle part pour cela.


## 2c. Chatbot (« Poser une question »)

- **Mode relecture (par défaut, `CHAT_MODE=review`)** : chaque réponse du robot est un brouillon. L'écran **Discussions** les montre ; le·la bénévole lit la version française, peut la corriger, puis **Approuver et envoyer** ou **Rejeter**. La personne reçoit d'abord « votre question est reçue, un bénévole vérifie la réponse ».
- **Mode instantané (`CHAT_MODE=auto`)** : les réponses partent tout de suite.
- **Dans les deux modes**, le robot ne répond pas sur le fond aux questions juridiques (recours, chances, « que dois-je faire ») ni aux demandes de parler à quelqu'un : la discussion passe en **« Personne demandée »**. En cas d'urgence (danger, santé, dormir dehors), il envoie un message fixe avec les numéros 115, 15, 17, 112, 119, 114 et prévient les bénévoles.
- Les bénévoles peuvent **répondre eux-mêmes en français** : le message est traduit automatiquement dans la langue de la personne. « Clore » termine une prise en charge.
- **Prendre une discussion** : le bouton **« Je prends la discussion »** (ou simplement répondre) fait passer la discussion « Avec un·e bénévole » : le robot ne répond plus, la personne reçoit « un bénévole va vous répondre personnellement » dans sa langue, et ses nouveaux messages attendent la·le bénévole (traduction française affichée). Seule exception : en cas d'urgence, le message fixe avec les numéros d'urgence part quand même. **« Rendre à l'assistant »** remet le robot en route. L'onglet **Les miennes** liste les discussions que vous suivez ; une autre personne peut « Prendre le relais ».

## 2d. Devenir bénévole (inscription en ligne)

- Sur la page de connexion, **« Devenir bénévole »** ouvre un formulaire : nom, e-mail, mot de passe, « comment souhaitez-vous aider ? » et un engagement de confidentialité (pas de conseil juridique).
- Le compte est créé **en attente** : impossible de se connecter tant qu'un·e admin ne l'a pas validé. L'admin voit les demandes dans **Plus → Bénévoles** (pastille sur l'accueil) et choisit le rôle :
  - **Répondant·e** (par défaut) : uniquement les discussions WhatsApp (lire, répondre, prendre une discussion). Ne voit ni les courriers, ni les photos, ni les documents.
  - **Bénévole** : tout le travail bénévole (courriers, documents, discussions).
  - **Administrateur·rice** : en plus, gestion des comptes et des sources.
- L'admin peut ensuite changer le rôle ou **désactiver** un compte (déconnexion immédiate ; ses discussions repassent « Personne demandée »). Une demande refusée est supprimée.
- **Association** : la personne indique son association. En tapant le nom, des suggestions viennent du registre officiel (API Recherche d'entreprises de l'État, associations du RNA, gratuite et sans clé). Si l'association n'est pas trouvée, le nom tapé est gardé tel quel. Dans **Bénévoles**, l'admin voit l'association avec son numéro RNA (pastille verte) ou la mention « Saisie libre ». `ASSOCIATION_SEARCH=off` désactive les suggestions.
- Pour fermer les inscriptions en ligne : `VOLUNTEER_SIGNUP=off`. Au-delà de `VOLUNTEER_SIGNUP_MAX_PENDING` demandes en attente (30 par défaut), les nouvelles sont refusées (anti-spam).
- Les messages vocaux ne sont pas pris en charge (il faudrait un service de transcription tiers) : le robot demande d'écrire.
- L'historique envoyé à l'IA ne contient que les derniers messages de la discussion (texte), jamais le numéro ni le nom.

---

## 2e. Suivi des personnes et compétences des bénévoles

- **Notes de suivi** : sur la page d'une personne, ou via l'icône « Suivi » d'une discussion. Les notes sont chiffrées comme le reste des données de la personne, et chaque lecture est enregistrée dans le journal d'accès. Chacun ne modifie que ses propres notes (les admins peuvent modérer).
- **Tâches avec rappel** (« rappeler après l'entretien OFPRA ») : pour soi, pour n'importe qui, ou confiées à un·e autre bénévole. À partir du jour choisi, elles apparaissent sur l'accueil et dans Plus > Tâches de suivi.
- **Compétences** (Plus > Compétences) : chacun indique ses langues et ce qu'il sait faire (juridique, asile, conduite, accompagnement…). Sur une discussion qui attend une personne, « Qui peut aider ? » propose les bénévoles qui parlent sa langue et ont les bonnes compétences.
- **Droits** : les répondant·e·s ne voient pas les notes par défaut (ils remplissent seulement leurs compétences) ; les bénévoles lisent et écrivent les notes, confient des tâches et voient l'annuaire ; seuls les admins modifient les notes des autres. Chaque droit (`notes.view`, `notes.write`, `notes.moderate`, `tasks.assign`, `skills.view`, `skills.edit_own`) peut être donné ou retiré à une personne précise.

## 3. RGPD — ce qui est stocké, combien de temps, qui y accède

| Donnée | Où | Protection | Durée |
|---|---|---|---|
| Numéro WhatsApp | Base de données | Chiffré ; seuls les 2 derniers chiffres sont visibles par les bénévoles | Jusqu'à suppression demandée |
| Langue, étape de conversation | Base de données | — | Idem |
| Messages échangés | Base de données | Chiffrés (clé propre à chaque personne) | Pas de suppression automatique pour l'instant (décision de l'association) |
| **Photo d'un courrier** | Stockage S3 | Chiffrée | **Supprimée après traitement** : dès que la personne répond « non » à « garder ce courrier ? », et au plus tard 48 h après l'envoi de l'explication. Conservée seulement si la personne choisit de la garder dans « Mes documents » |
| Analyse du courrier (texte) | Base de données | Chiffrée | Pas de suppression automatique pour l'instant |
| Documents (« Mes documents ») | Stockage S3 | Chiffrés | Jusqu'à ce que la personne les supprime ; ils sont alors **archivés 30 jours puis effacés définitivement** |
| Comptes bénévoles, journal des accès | Base de données | Mots de passe hachés (argon2id) | Durée de l'engagement ; une demande d'inscription refusée est supprimée |

- **Chiffrement** : chaque personne a sa propre clé, elle-même chiffrée par la clé maître (`MASTER_KEY`). Le fournisseur de stockage ne voit jamais les fichiers en clair. Quand une personne demande la suppression de ses données (menu 9), tout est archivé 30 jours, puis sa clé est détruite : ses données deviennent illisibles, puis sont effacées.
- **Hébergement** : base de données et stockage en UE (France visée).
- **Tiers** : uniquement **Meta** (transport WhatsApp) et le **fournisseur d'IA** (Anthropic par défaut). L'IA reçoit seulement l'image du courrier et la langue cible : ni nom de la personne, ni numéro, ni historique. Le fournisseur peut être changé (interface générique) pour un hébergement UE. Aucune statistique, aucun CDN, polices hébergées localement. Seule exception, sans donnée personnelle : les suggestions d'association du formulaire d'inscription bénévole interrogent l'annuaire public de l'État (recherche-entreprises.api.gouv.fr) avec le nom tapé, depuis notre serveur.
- **Accès** : bénévoles connectés au back-office. Les comptes « Bénévole » voient photos et documents ; les comptes « Répondant·e » (inscription en ligne, par défaut) ne voient que les discussions. **Chaque consultation est enregistrée** (qui, quoi, quand). Seuls les admins valident et gèrent les comptes.
- **Droits des personnes** : la personne peut supprimer un document ou toutes ses données depuis WhatsApp (menu 2 et menu 9).

---

## 4. Limites connues (POC)

- **Traductions** : seuls le français et l'anglais ont été rédigés avec soin. Les textes des 26 autres langues sont des **brouillons à faire relire par des locuteurs natifs**. Les dates en tigrinya/somali/amharique utilisent des noms de mois intégrés au code.
- **Langues de l'interface bénévole** : français, anglais, arabe.
- **IA** : l'explication peut se tromper (date calculée, type de courrier). C'est pour cela que chaque réponse est relue. Les réponses de l'IA n'ont pas encore été testées sur de vrais courriers ni avec le vrai modèle (exemples synthétiques uniquement).
- **WhatsApp** : les modèles de messages Meta (hors fenêtre de 24 h) doivent être créés et approuvés dans le compte Meta. Le bac à sable ignore cette règle.
- **Suppression** : une personne qui a demandé la suppression de ses données ne reçoit plus de réponse pendant les 30 jours d'archivage. La suppression d'un seul document depuis WhatsApp n'est pas encore disponible (possible depuis le back-office).
- **Ourdou** affiché en Naskh, pas en Nastaliq.
- **Sauvegardes** : non configurées. **Perdre `MASTER_KEY` = perdre toutes les données.** La conserver hors du serveur (coffre-fort de mots de passe de l'association).
- **Base de connaissances** : le téléchargement réel des fiches Service-Public et de l'annuaire n'a pas encore été testé (réseau bloqué pendant le développement) ; l'extraction de texte des PDF Watizat est approximative.
- **Pas encore audité** en sécurité ; ne pas utiliser avec de vraies personnes avant revue.
