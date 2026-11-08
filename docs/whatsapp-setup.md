# Brancher Wilson sur un vrai numéro WhatsApp

Ce guide fait passer Wilson du **bac à sable** (`WHATSAPP_MODE=sandbox`) à un **vrai numéro WhatsApp Business** via la *WhatsApp Cloud API* de Meta. Comptez une heure pour le numéro de test, puis quelques jours pour le vrai numéro (vérification de l'entreprise et du nom affiché par Meta).

Tout ce qui touche à Meta se fait dans deux interfaces :

- **Meta for Developers** — <https://developers.facebook.com/apps> (l'application, les webhooks, le numéro de test) ;
- **Meta Business Suite / Paramètres de l'entreprise** — <https://business.facebook.com/settings> (utilisateurs système, jetons, vérification, moyens de paiement) et **WhatsApp Manager** (numéros, modèles de messages).

L'outil `wa:setup` fait le reste depuis le terminal (il lit `.env`, n'affiche jamais de secret) :

```bash
bun run --filter @wilson/api wa:setup check                 # tout vérifier (jeton, numéro, webhooks, modèles)
bun run --filter @wilson/api wa:setup templates --dry-run   # voir les modèles qui seront soumis
bun run --filter @wilson/api wa:setup templates             # soumettre les modèles manquants à Meta
bun run --filter @wilson/api wa:setup subscribe             # abonner l'application aux webhooks du compte
bun run --filter @wilson/api wa:setup register --pin 123456 --region DE   # enregistrer un vrai numéro
bun run --filter @wilson/api wa:setup send-test 33612345678 # envoyer le message « hello_world » de Meta
```

---

## 0. Ce qu'il faut avant de commencer

| Quoi | Pourquoi |
|---|---|
| Un compte Facebook personnel d'un·e responsable de l'association | Pour créer le portefeuille Business et l'application |
| Un **portefeuille Meta Business** au nom de l'association (SIREN ou RNA, adresse, site web) | Propriétaire du compte WhatsApp ; la vérification lève les limites d'envoi |
| Un **numéro de téléphone** qui n'est utilisé ni sur WhatsApp ni sur WhatsApp Business (ligne fixe ou mobile dédiée, qui peut recevoir un SMS ou un appel) | Le numéro que les personnes accompagnées enregistreront. Un numéro déjà sur WhatsApp doit d'abord être supprimé de l'application |
| Wilson déployé sur une **URL publique en HTTPS**, hébergée en France / UE | Meta appelle `https://<domaine>/webhooks/whatsapp`. Pour un essai depuis un ordinateur : `cloudflared tunnel --url http://localhost:3000` donne une URL HTTPS temporaire |
| Une **politique de confidentialité** en ligne (URL) | Exigée par Meta pour passer l'application en mode « Live » |
| Un **moyen de paiement** (avant la mise en production) | Depuis le 1er octobre 2026, Meta facture aussi les réponses dans les 24 h (« messages de service », environ 0,03 $ en France), au-delà de **1 000 gratuits par mois et par numéro**. Sans moyen de paiement enregistré, Meta **n'envoie plus** ces réponses. Les modèles envoyés après 24 h sont facturés à chaque envoi |

---

## 1. Créer l'application Meta et obtenir le numéro de test

1. Sur <https://developers.facebook.com/apps>, **Créer une app** → cas d'usage **« Se connecter avec les clients via WhatsApp »** (ou type « Entreprise »), et rattachez-la au portefeuille Business de l'association.
2. Dans l'app, ouvrez **WhatsApp → Configuration de l'API** (*API Setup*). Meta fournit automatiquement :
   - un **numéro de test** (gratuit, n'envoie qu'à 5 numéros que vous déclarez) ;
   - un **jeton temporaire** (valable 24 h, parfait pour un premier essai) ;
   - le **Phone number ID** et le **WhatsApp Business Account ID** (WABA ID), affichés sur cette page.
3. Sous **« À »** (*To*), ajoutez votre propre numéro de portable comme destinataire de test et validez le code reçu.

Notez :

| Sur la page *API Setup* | Variable `.env` |
|---|---|
| Phone number ID | `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp Business Account ID | `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| Jeton temporaire (pour l'essai) | `WHATSAPP_ACCESS_TOKEN` |

4. **Clé secrète de l'app** : *Paramètres de l'app → Général* (*App settings → Basic*) → **Clé secrète** → Afficher. C'est `WHATSAPP_APP_SECRET` : Wilson s'en sert pour vérifier que chaque webhook vient bien de Meta (en-tête `X-Hub-Signature-256`). Un webhook mal signé est refusé (401).
5. **Jeton de vérification** : une chaîne au hasard que vous choisissez, par exemple `openssl rand -hex 24`. C'est `WHATSAPP_VERIFY_TOKEN`.

## 2. Un jeton permanent (avant la mise en production)

Le jeton temporaire expire au bout de 24 h. Pour la production, créez un **utilisateur système** :

1. <https://business.facebook.com/settings> → **Utilisateurs → Utilisateurs système** → **Ajouter** → nom « wilson-api », rôle **Admin**.
2. **Attribuer des éléments** : l'**application** (contrôle total) et le **compte WhatsApp** (contrôle total).
3. **Générer un jeton** → choisir l'application → expiration **Jamais** → autorisations **`whatsapp_business_messaging`**, **`whatsapp_business_management`** et **`business_management`** (les trois que demande le guide Meta).
4. Copiez-le dans `WHATSAPP_ACCESS_TOKEN` (gestionnaire de secrets de l'hébergeur, jamais dans Git). S'il fuit : régénérez-le au même endroit, l'ancien est révoqué.

## 3. Configurer `.env`

```dotenv
WHATSAPP_MODE=meta
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_APP_SECRET=0123abcd...
WHATSAPP_VERIFY_TOKEN=la-chaine-choisie
# WHATSAPP_GRAPH_VERSION=v23.0   # à monter quand Meta annonce la fin d'une version
ASSOCIATION_NAME=Association Wilson   # apparaît dans les modèles de messages
```

En mode `meta`, l'API refuse de démarrer s'il manque une des quatre premières variables (le WABA ID ne sert qu'à `wa:setup`). L'onglet **Bac à sable** du back-office disparaît : les vrais messages arrivent dans les mêmes écrans (courriers à relire, conversations).

Vérifiez tout de suite :

```bash
bun run --filter @wilson/api wa:setup check
```

## 4. Brancher le webhook

1. Déployez / redémarrez l'API avec ce `.env`, puis vérifiez que `https://<domaine>/health` répond.
2. Dans l'app Meta : **WhatsApp → Configuration** → **Webhook** → **Modifier** :
   - URL de rappel : `https://<domaine>/webhooks/whatsapp`
   - Jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`
   - **Vérifier et enregistrer**. Meta envoie un `GET` ; Wilson renvoie le *challenge* seulement si le jeton correspond (sinon 403).
3. Toujours dans **Webhook fields**, **abonnez-vous au champ `messages`** (il porte aussi les accusés de réception : envoyé, distribué, lu, échec).
4. Abonnez l'application au compte WhatsApp :

```bash
bun run --filter @wilson/api wa:setup subscribe
```

5. **Test** : envoyez « Bonjour » depuis votre portable (déclaré à l'étape 1) au numéro de test. Wilson répond avec l'accueil et le menu, et le message passe en « lu ». Ou dans l'autre sens : `wa:setup send-test 336XXXXXXXX`, puis répondez au message reçu.

## 5. Les modèles de messages (obligatoires pour les rappels)

WhatsApp n'autorise un message libre que **dans les 24 h** qui suivent le dernier message de la personne. Au-delà, seul un **modèle approuvé par Meta** peut être envoyé. Wilson en utilise trois : deux de catégorie *Utility*, un de catégorie *Marketing* (les annonces) :

| Modèle | Quand | Texte (fr) |
|---|---|---|
| `explanation_ready` (+ bouton « Recevoir ») | Une explication de courrier relue, ou une réponse à une question, est prête mais la personne n'a pas écrit depuis plus de 24 h | « Bonjour, c'est {association}. Nous avons une réponse à votre demande. Appuyez sur « Recevoir » ou répondez à ce message pour la lire. » |
| `document_reminder` | Rappel J-30 / J-7 d'un document qui expire | « Rappel de {association} : votre document « {{1}} » expire le {{2}}. Pensez à le renouveler à temps. Répondez à ce message si vous avez besoin d'aide. » |
| `announcement` (+ boutons « Lire » / « Arrêter »), catégorie **Marketing** | Une annonce validée (Plus → Annonces) pour une personne inscrite aux annonces (menu 6) qui n'a pas écrit depuis plus de 24 h | « Bonjour, c'est {association}. Nous avons une nouvelle annonce pour vous (permanence, atelier, distribution…). Appuyez sur « Lire » pour la recevoir, ou sur « Arrêter » pour ne plus recevoir d'annonces. » |

**Annonces et coût.** Une annonce n'est pas liée à une demande de la personne : Meta la classe en *Marketing*, payée à chaque envoi (environ 0,086 $ en France, à vérifier sur la grille tarifaire de Meta ; réglage `WHATSAPP_PRICE_MARKETING_USD`, utilisé pour l'estimation affichée avant validation). Dans les 24 h, l'annonce part en message libre, gratuit. Seules les personnes qui ont dit oui au menu 6 la reçoivent ; « STOP » ou le bouton « Arrêter » les désinscrit tout de suite. Meta peut limiter les envois marketing si trop de gens bloquent le numéro : gardez les annonces rares et utiles.

Quand la personne appuie sur « Recevoir » (ou écrit n'importe quoi), la fenêtre de 24 h se rouvre et Wilson envoie le vrai message, dans sa langue.

Les textes sont dans `apps/api/src/whatsapp/templates.ts`, en **16 langues** (toutes celles que Meta accepte parmi les nôtres) : fr, en, ar, fa (dari), ur, uk, ru, es, pt, tr, bn, ta, ka, sq, ro, sw. Pour les langues que Meta ne gère pas, Wilson envoie ce court avis dans la langue la plus probable : pachto → dari ; tigrigna, amharique, somali → anglais ; les autres (kurde, arménien, créole, wolof, peul, bambara, lingala) → français. Seul l'avis est concerné : la réponse elle-même arrive ensuite dans la langue de la personne.

> **Avant de soumettre** : les traductions autres que fr/en sont des brouillons machine. Faites-les relire par un·e locuteur·rice, corrigez `templates.ts`, puis soumettez. Une fois approuvé, un modèle ne se corrige plus : il faut le supprimer dans WhatsApp Manager et le soumettre à nouveau (ou changer son nom via `WHATSAPP_TEMPLATE_*`).

```bash
bun run --filter @wilson/api wa:setup templates --dry-run   # relire ce qui part
bun run --filter @wilson/api wa:setup templates             # soumettre (le français en premier)
bun run --filter @wilson/api wa:setup check                 # suivre : PENDING → APPROVED (de quelques minutes à quelques heures)
```

Le **français doit être approuvé** : c'est le secours de toutes les langues (si un modèle n'est pas encore approuvé dans une langue, Wilson renvoie la version française). Si Meta rejette un modèle ou le reclasse en « Marketing », le motif apparaît dans WhatsApp Manager → Modèles de messages.

## 6. Passer au vrai numéro de l'association

1. **Vérification de l'entreprise** : Paramètres de l'entreprise → **Centre de sécurité** → *Démarrer la vérification* (justificatif SIREN/RNA ou statuts, adresse, domaine du site). Sans elle, le numéro est limité à un petit nombre de nouvelles personnes contactées par jour à l'initiative de l'association.
2. **Ajouter le numéro** : WhatsApp Manager → **Numéros de téléphone → Ajouter** → **nom affiché** (doit correspondre au nom de l'association ; Meta le valide) → code de vérification par SMS ou appel.
3. **L'enregistrer sur la Cloud API**, avec le stockage local dans l'UE :

   ```bash
   # mettez d'abord le Phone number ID du nouveau numéro dans WHATSAPP_PHONE_NUMBER_ID
   bun run --filter @wilson/api wa:setup register --pin 123456 --region DE
   ```

   Le PIN à 6 chiffres est celui de la vérification en deux étapes du numéro (il est créé s'il n'existe pas encore : notez-le). `--region DE` active le **stockage local** de la Cloud API : Meta garde les messages au repos dans l'UE (Allemagne). Vérifiez dans la documentation Meta (*Cloud API local storage*) que l'option est disponible pour votre numéro ; sans elle, les données transitent et sont stockées temporairement par Meta hors UE.
4. **Moyen de paiement** : WhatsApp Manager → Vue d'ensemble → *Ajouter un moyen de paiement*. **Obligatoire** : sans lui, Meta bloque les modèles (rappels, réponses prêtes après 24 h) et, depuis octobre 2026, au-delà des 1 000 messages gratuits du mois, les réponses ordinaires aussi.
5. **Passer l'application en mode Live** (en haut de l'app Meta ; demande l'URL de la politique de confidentialité). En mode développement, seuls les numéros de test reçoivent des messages.
6. Redémarrez l'API, puis `wa:setup check` : `platform=CLOUD_API`, `status=CONNECTED`, webhooks abonnés, modèles approuvés.
7. Les modèles sont rattachés au **compte WhatsApp** (WABA), pas au numéro : si le vrai numéro est dans le même compte que le numéro de test, rien à refaire.

## 7. Ce que Wilson fait côté WhatsApp

- **Messages reçus** : texte, photo, PDF, boutons des modèles. Les messages vocaux, vidéos, autocollants et types inconnus reçoivent une réponse polie (« je ne peux pas lire ce type de message »). Un type inconnu n'empêche jamais de traiter les autres messages du même webhook.
- **Photos et PDF** : téléchargés immédiatement chez Meta (leur lien expire en quelques minutes), chiffrés avec la clé de la personne, puis analysés. Limite 12 Mo.
- **Doublons** : Meta renvoie parfois le même webhook ; chaque message n'est traité qu'une fois (identifiant `wamid`).
- **Réponse** toujours `200` à Meta pour un webhook bien signé, même incompris, pour éviter des renvois sans fin ; le traitement se fait ensuite.
- **Envoi** : tout passe par la file `wa.send` (3 essais espacés). Un texte de plus de 4 096 caractères part en plusieurs messages.
- **Fenêtre de 24 h** : calculée à partir du dernier message reçu ; si Meta répond quand même « fenêtre fermée » (erreur 131047), Wilson bascule sur le modèle au lieu de réessayer en boucle.
- **Accusés de lecture** : chaque message reçu est marqué « lu » (deux coches bleues), pour que la personne sache que sa demande est arrivée pendant que la réponse est relue.
- **Plusieurs numéros sur la même app** : les événements d'un autre numéro que `WHATSAPP_PHONE_NUMBER_ID` sont ignorés.
- **Personnes sans numéro visible (noms d'utilisateur WhatsApp)** : depuis 2026, WhatsApp peut masquer le numéro d'une personne qui utilise un nom d'utilisateur et n'a pas écrit à l'association depuis 30 jours. Le webhook ne contient alors que son identifiant WhatsApp propre à l'entreprise (*BSUID*, ex. `FR.1349…`). Wilson la reconnaît par cet identifiant, lui répond via le champ `recipient` de la Cloud API, et passe au numéro dès qu'il redevient visible. Le contact d'un binôme (numéro de téléphone) n'est pas disponible tant que le numéro est masqué.
- **Changement de numéro** : quand WhatsApp signale qu'une personne a changé de numéro (message système `user_changed_number`), Wilson rattache le nouveau numéro au même dossier (courriers, documents, rappels), sans rien lui envoyer. Si le nouveau numéro a déjà un dossier, rien n'est fusionné.
- **Rien d'autre ne change** : relecture par un·e bénévole avant tout envoi de courrier expliqué, pas de conseil juridique, renvoi vers l'association en pied de message.

## 8. Dépannage

| Symptôme / code | Cause probable | Que faire |
|---|---|---|
| « Vérifier et enregistrer » échoue | URL injoignable, pas en HTTPS, ou jeton différent de `WHATSAPP_VERIFY_TOKEN` | Tester `https://<domaine>/health` ; recopier le jeton |
| Aucun message reçu, rien dans les logs | App non abonnée ou champ `messages` non coché ; app en mode développement avec un numéro non déclaré | `wa:setup subscribe` ; cocher `messages` ; déclarer le numéro de test ou passer en Live |
| Logs `401` sur `/webhooks/whatsapp` | `WHATSAPP_APP_SECRET` faux (ou d'une autre app) | Recopier la clé secrète de l'app |
| `code 190` | Jeton expiré ou révoqué (le jeton temporaire dure 24 h) | Jeton d'utilisateur système (§2) |
| `code 131030` | Numéro de test : destinataire non déclaré | L'ajouter dans *API Setup → To* |
| `code 131047` | Plus de 24 h depuis le dernier message de la personne | Normal : Wilson envoie le modèle. Vérifier qu'il est approuvé |
| `code 132001` | Modèle inexistant ou pas encore approuvé dans cette langue | `wa:setup check`, puis `wa:setup templates` |
| `code 133010` | Numéro pas enregistré sur la Cloud API | `wa:setup register --pin …` |
| `code 131026` dans les logs « delivery failed » | Destinataire injoignable (pas de WhatsApp, version trop ancienne, numéro bloqué) | Rien à faire côté Wilson ; contacter la personne autrement |
| `code 131056` / `130429` | Trop de messages trop vite vers un même numéro / limite de débit | La file réessaie automatiquement |

Les logs n'affichent jamais le jeton, le numéro de la personne ni le contenu des messages : seulement les codes d'erreur Meta.

## 9. RGPD

- Meta (WhatsApp) agit comme **sous-traitant** pour le transport des messages : à mentionner dans le registre des traitements et la notice d'information donnée aux personnes, avec le lien vers les conditions WhatsApp Business.
- Wilson ne conserve chez lui (hébergement UE) que ce qui est décrit dans le README §3, chiffré par personne. Les photos sont téléchargées chez Meta puis supprimées de Wilson après `PHOTO_TTL_HOURS`.
- Activer le **stockage local UE** de la Cloud API (§6.3) quand il est disponible.
- Le jeton d'accès et la clé secrète de l'app sont des secrets au même titre que `MASTER_KEY`.
