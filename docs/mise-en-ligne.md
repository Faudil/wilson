# Mise en ligne : ce que vous devez faire à la main

Tout ce que le code ne peut pas faire à votre place pour lancer Wilson avec de vraies personnes, **dans l'ordre**. Chaque étape renvoie au guide détaillé quand il existe ([deploy.md](deploy.md), [whatsapp-setup.md](whatsapp-setup.md)).

**Commencez par l'étape 1 dès aujourd'hui** : la vérification de l'entreprise par Meta prend plusieurs jours, tout le reste peut avancer pendant ce temps.

| # | Étape | Durée | Attente externe |
|---|---|---|---|
| 1 | Comptes, 2FA, vérification Meta | 1 h | **2 à 10 jours** (Meta) |
| 2 | Serveur, pare-feu, SSH | 1 h | – |
| 3 | Domaine, HTTPS, reverse proxy | 30 min | propagation DNS |
| 4 | `.env` de production | 20 min | – |
| 5 | Secrets GitHub et premier déploiement | 20 min | – |
| 6 | Clés Anthropic et budgets | 15 min | – |
| 7 | WhatsApp : app, numéro de test, webhook | 1 h | – |
| 8 | WhatsApp : modèles de messages | 30 min | quelques heures (Meta) |
| 9 | WhatsApp : vrai numéro, profil, mode Live | 30 min | validation du nom affiché |
| 10 | Vérifications de sécurité finales | 30 min | – |

---

## 1. Comptes, double authentification, vérification Meta

1. **Gestionnaire de mots de passe** (Bitwarden, 1Password, KeePassXC…) : tout ce qui suit (jetons, clés, `MASTER_KEY`, PIN WhatsApp) y va, nulle part ailleurs.
2. **GitHub** : activez la double authentification (2FA) sur votre compte, de préférence avec une clé de sécurité ou une app TOTP.
   → <https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication>
3. **Facebook / Meta** : activez la 2FA sur le compte Facebook personnel qui administrera tout (Espace comptes → Mot de passe et sécurité).
   → <https://accountscenter.facebook.com/password_and_security>
4. **Portefeuille Meta Business** au nom de l'association (nom exact des statuts, adresse, site web, e-mail du domaine de l'association si possible).
   → <https://business.facebook.com/> puis *Créer un portefeuille*. Aide : <https://www.facebook.com/business/help/1710077379203657>
5. Dans ce portefeuille, **imposez la 2FA à tous les administrateurs** : Paramètres de l'entreprise → *Centre de sécurité* → *Authentification à deux facteurs* → « Tout le monde ».
   → <https://business.facebook.com/settings/security>
6. **Lancez la vérification de l'entreprise** au même endroit (*Centre de sécurité → Démarrer la vérification*). Préparez : avis de situation SIREN (INSEE) ou récépissé RNA, une facture ou un document officiel avec l'adresse, un domaine web vérifiable (ou un numéro de téléphone fixe à l'adresse).
   → <https://www.facebook.com/business/help/2058515294227817>
7. **Une politique de confidentialité en ligne** (une page sur le site de l'association suffit) : Meta l'exige pour passer l'app en mode « Live » (étape 9). Elle doit citer Meta (transport des messages) et le fournisseur d'IA (Anthropic), comme décrit dans le [README §3](../README.md#3-rgpd--ce-qui-est-stocké-combien-de-temps-qui-y-accède).
8. **Un numéro de téléphone dédié** pour WhatsApp Business, qui n'est **pas** déjà sur WhatsApp (ligne fixe ou carte SIM neuve, capable de recevoir un SMS ou un appel).

## 2. Le serveur

Un serveur (VPS ou machine de l'association) **hébergé en France ou dans l'UE** (OVHcloud, Scaleway, Hetzner, Infomaniak…), Ubuntu ou Debian récent, 2 Go de RAM minimum, 4 Go conseillés.

1. **Docker** et le plugin `compose` : <https://docs.docker.com/engine/install/ubuntu/> (ou `/debian/`), plus `rsync`.
2. **Utilisateur de déploiement et dossier** : les commandes de [deploy.md §1](deploy.md#1-préparer-le-serveur-une-fois).
3. **Clé SSH réservée au déploiement** (`ssh-keygen -t ed25519 …`, même section). Votre clé personnelle reste différente.
4. **Durcir SSH** dans `/etc/ssh/sshd_config` puis `sudo systemctl restart ssh` (gardez une session ouverte pendant le test) :

   ```
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   AllowUsers deploy votre-utilisateur
   ```

5. **Pare-feu** (ufw) : n'ouvrir que SSH et le web.

   ```sh
   sudo ufw default deny incoming
   sudo ufw allow 22/tcp        # ou votre port SSH
   sudo ufw allow 80,443/tcp    # seulement si le reverse proxy tourne sur cette machine
   sudo ufw enable
   ```

   → <https://help.ubuntu.com/community/UFW>

   **Piège Docker** : un port publié par Docker passe *à côté* de ufw. Wilson ne publie aucun port (il est servi par nginx-proxy via son réseau Docker) ; vérifiez qu'aucun autre conteneur ne publie de port sensible.
6. **Contre les essais de mot de passe** : `sudo apt install fail2ban unattended-upgrades` (bannit les IP qui insistent, installe les mises à jour de sécurité automatiquement).
7. **Le port SSH doit être joignable par GitHub** (les runners sont sur Internet, avec des IP qui changent). Avec l'authentification par clé seule et fail2ban, c'est acceptable. Si vous préférez ne pas l'exposer : un runner *self-hosted* sur votre réseau (voir la fin de [deploy.md §2](deploy.md#2-créer-lenvironnement-et-les-secrets-github)).

## 3. Domaine, HTTPS et reverse proxy

1. Choisissez un sous-domaine (ex. `courrier.mon-asso.fr`) et créez un enregistrement DNS **A** (et AAAA si IPv6) vers l'IP publique du serveur ou du proxy.
2. **Reverse proxy avec HTTPS automatique** : nginx-proxy + acme-companion (<https://github.com/nginx-proxy/acme-companion>). Wilson s'y branche tout seul : le conteneur `backoffice` rejoint le réseau `PROXY_NETWORK` avec `VIRTUAL_HOST` / `LETSENCRYPT_HOST` = `PUBLIC_HOST` (voir [deploy.md](deploy.md#reverse-proxy-nginx-proxy--lets-encrypt)). Ajoutez `client_max_body_size 12m;` dans `vhost.d/<votre domaine>` de nginx-proxy (photos de courriers jusqu'à 12 Mo). Le back-office relaie lui-même `/rpc` et `/webhooks` vers l'API.
3. **Protection devant le site (anti-DDoS, filtrage)** : facultatif mais conseillé une fois public.
   - **Cloudflare** (gratuit) : <https://developers.cloudflare.com/fundamentals/setup/>. Mode SSL **Full (strict)**, nuage orange activé sur le sous-domaine. Contrepartie : Cloudflare est une société américaine et voit le trafic en clair (photos de courriers envoyées depuis le back-office, contenu des webhooks WhatsApp). À inscrire au registre RGPD.
   - **Alternatives européennes** : l'anti-DDoS inclus chez OVHcloud ou Scaleway (rien à faire), Bunny.net (Slovénie) ou Myra Security (Allemagne) si vous voulez un proxy filtrant.
   - Quel que soit le choix, **n'acceptez le trafic web que depuis le proxy** si vous en mettez un (règle ufw limitée à ses plages d'IP), sinon il est contourné en appelant l'IP directement.
4. Vérifiez : `https://courrier.mon-asso.fr` affiche un certificat valide (après le premier déploiement, étape 5).

## 4. Le fichier `.env` de production

Copiez [`.env.production.example`](../.env.production.example) sur le serveur, comme indiqué dans [deploy.md §1](deploy.md#1-préparer-le-serveur-une-fois), puis remplissez :

| Variable | Valeur |
|---|---|
| `MASTER_KEY`, `LOOKUP_KEY` | `openssl rand -base64 32` (deux fois, deux valeurs différentes). **Copie de `MASTER_KEY` dans le gestionnaire de mots de passe** : sans elle, toutes les données et sauvegardes sont illisibles |
| `POSTGRES_PASSWORD`, `S3_SECRET_KEY` | `openssl rand -hex 24` |
| `PUBLIC_HOST` | `courrier.mon-asso.fr` (sans `https://`) |
| `LETSENCRYPT_EMAIL` | adresse qui reçoit les alertes d'expiration Let's Encrypt |
| `PROXY_NETWORK` | réseau Docker de nginx-proxy (par défaut `internal_services_network`) |
| `ASSOCIATION_NAME`, `ASSOCIATION_CONTACT` | nom tel qu'il apparaîtra dans les messages WhatsApp, adresse et horaires de la permanence |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | votre compte admin du back-office |
| `WHATSAPP_MODE` | `sandbox` pour l'instant ; `meta` à l'étape 7 |
| `LLM_MODE` | `fake` pour l'instant ; `anthropic` à l'étape 6 |

Puis `chmod 600 /srv/wilson/.env`. Le déploiement refuse de démarrer s'il reste une valeur `CHANGE_ME`.

## 5. Secrets GitHub et premier déploiement

1. Dépôt GitHub → **Settings → Environments → New environment** → `production`.
   → <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment>
2. *Add environment secret* pour chacun :

   | Secret | Comment l'obtenir |
   |---|---|
   | `SSH_PRIVATE_KEY` | `cat wilson_deploy` sur votre poste : tout le fichier, lignes `-----BEGIN…` et `-----END…` comprises |
   | `SSH_KNOWN_HOSTS` | `ssh-keyscan -p 22 courrier.mon-asso.fr` (ou l'IP), lancé depuis votre poste |
   | `SSH_HOST` | nom ou IP du serveur, joignable depuis Internet |
   | `SSH_USER` | `deploy` |
   | `DEPLOY_PATH` | `/srv/wilson` |
   | `SSH_PORT` | seulement si SSH n'est pas sur 22 |

3. Dans le même écran : **Deployment branches → Selected branches → `main`**, et ajoutez-vous en **Required reviewers** si vous voulez approuver chaque mise en production.
4. Effacez `wilson_deploy` de votre poste une fois copié (ou rangez-le dans le gestionnaire de mots de passe).
5. **Protégez `main`** : Settings → Branches → règle sur `main` (pull request obligatoire, pas de force push).
6. **Premier déploiement** : *Actions → CI / Deploy → Run workflow* sur `main`. Le workflow vous dit quel secret manque, le cas échéant.
7. Connectez-vous sur `https://courrier.mon-asso.fr` avec `SEED_ADMIN_EMAIL`, et **changez le mot de passe tout de suite**.

## 6. Clés Anthropic et budgets

1. Créez un compte d'organisation sur la console Anthropic, activez la 2FA, ajoutez un moyen de paiement et achetez des crédits.
   → <https://console.anthropic.com/>
2. **Plafond côté Anthropic** (filet de sécurité indépendant de Wilson) : *Settings → Limits*, fixez une limite de dépense mensuelle.
3. Créez une clé API (*Settings → API keys*), nommée par exemple « wilson-prod ».
4. Deux façons de la donner à Wilson (vous pouvez combiner) :
   - **Dans le back-office** (conseillé) : *Plus → Coûts de l'IA → Clés API → Ajouter*, avec un budget mensuel par clé. La clé y est chiffrée. Utile pour avoir plusieurs clés (ex. une financée par un partenaire).
   - **Sur le serveur** : `ANTHROPIC_API_KEY=…` dans `.env`, sert de clé de secours.
5. Dans `.env` : `LLM_MODE=anthropic`, puis redéployez (Run workflow) ou `docker compose -f docker-compose.prod.yml up -d api` sur le serveur.
6. **Budget global** : *Plus → Coûts de l'IA → Budget mensuel*. Une alerte apparaît à 80 %. Cochez « Arrêter l'IA quand le budget est atteint » si vous ne voulez aucun dépassement : personne ne reste sans réponse, les questions passent aux bénévoles.
7. Testez une photo de courrier dans le bac à sable : l'analyse doit être réelle, et le coût apparaître dans *Coûts de l'IA*.

## 7. WhatsApp : application Meta, numéro de test, webhook

Détails et captures des menus : [whatsapp-setup.md §1 à §4](whatsapp-setup.md). En résumé :

1. **Créer l'app** sur <https://developers.facebook.com/apps>, cas d'usage WhatsApp, rattachée au portefeuille de l'association.
   Guide Meta : <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>
2. Page **WhatsApp → API Setup** : notez le *Phone number ID* et le *WhatsApp Business Account ID* ; ajoutez votre portable comme destinataire de test.
3. **Clé secrète de l'app** : *App settings → Basic → App secret*.
4. **Jeton de vérification** : `openssl rand -hex 24`, une valeur que vous inventez.
5. **Jeton permanent** via un utilisateur système (le jeton de la page *API Setup* expire en 24 h) : <https://business.facebook.com/settings> → Utilisateurs système → « wilson-api », rôle Admin → attribuer l'app et le compte WhatsApp → *Générer un jeton*, expiration **Jamais**, autorisations `whatsapp_business_messaging` et `whatsapp_business_management`.
   → <https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#system-user-access-tokens>
6. Dans le `.env` du serveur :

   ```dotenv
   WHATSAPP_MODE=meta
   WHATSAPP_PHONE_NUMBER_ID=…
   WHATSAPP_BUSINESS_ACCOUNT_ID=…
   WHATSAPP_ACCESS_TOKEN=…        # le jeton permanent
   WHATSAPP_APP_SECRET=…
   WHATSAPP_VERIFY_TOKEN=…
   ```

   Redémarrez l'API : `cd /srv/wilson && docker compose -f docker-compose.prod.yml up -d api`.
7. **Webhook** : app Meta → *WhatsApp → Configuration → Webhook → Modifier* :
   - URL de rappel : `https://courrier.mon-asso.fr/webhooks/whatsapp`
   - Jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`
   - *Vérifier et enregistrer*, puis **abonnez le champ `messages`**.
   → <https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks>
8. **L'outil `wa:setup` sur le serveur** (il lit le `.env` du conteneur et n'affiche aucun secret) :

   ```sh
   cd /srv/wilson
   alias wa='docker compose -f docker-compose.prod.yml exec api bun src/whatsapp/setupCli.ts'
   wa subscribe                  # abonne l'app au compte WhatsApp
   wa check                      # jeton, numéro, webhooks, modèles
   ```

9. **Test** : écrivez « Bonjour » au numéro de test depuis votre portable. Wilson doit répondre avec l'accueil et le menu.

## 8. WhatsApp : modèles de messages

Sans modèle approuvé, Wilson ne peut pas recontacter quelqu'un après 24 h (réponse prête, rappel de document, annonce). Détails : [whatsapp-setup.md §5](whatsapp-setup.md#5-les-modèles-de-messages-obligatoires-pour-les-rappels).

1. **Faites relire les traductions** de `apps/api/src/whatsapp/templates.ts` par des locuteur·rices (seuls fr et en sont relus). Un modèle approuvé ne se corrige plus.
2. Sur le serveur : `wa templates --dry-run` (relire), puis `wa templates` (soumettre).
3. Suivez avec `wa check` : PENDING → APPROVED, de quelques minutes à quelques heures. **Le français doit être approuvé** : c'est la langue de secours.
4. En cas de rejet, le motif est dans WhatsApp Manager → *Modèles de messages* : <https://business.facebook.com/wa/manage/message-templates/>
   Règles de Meta : <https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates>

## 9. WhatsApp : vrai numéro, photo de profil, mode Live

Une fois la vérification de l'entreprise (étape 1.6) acceptée. Détails : [whatsapp-setup.md §6](whatsapp-setup.md#6-passer-au-vrai-numéro-de-lassociation).

1. **Ajouter le numéro** : WhatsApp Manager → *Numéros de téléphone → Ajouter*. Le **nom affiché** doit correspondre au nom de l'association (règles : <https://www.facebook.com/business/help/757569725593362>). Code par SMS ou appel.
   → <https://business.facebook.com/wa/manage/phone-numbers/>
2. **Photo et profil** : sur le même écran, *Profil* → importez [`docs/brand/whatsapp-profile.png`](brand/whatsapp-profile.png) (640×640, le logo tient dans le cercle). Ajoutez une description courte, l'adresse, les horaires et le site.
3. Mettez le *Phone number ID* du nouveau numéro dans `WHATSAPP_PHONE_NUMBER_ID`, redémarrez l'API, puis enregistrez-le avec le **stockage des messages dans l'UE** :

   ```sh
   wa register --pin 123456 --region DE
   ```

   Choisissez un PIN à 6 chiffres et **notez-le** dans le gestionnaire de mots de passe (c'est la vérification en deux étapes du numéro). Stockage local : <https://developers.facebook.com/docs/whatsapp/cloud-api/overview/local-storage>
4. **Moyen de paiement** : WhatsApp Manager → Vue d'ensemble → *Ajouter un moyen de paiement* (les modèles hors 24 h coûtent quelques centimes ; grille : <https://developers.facebook.com/docs/whatsapp/pricing>).
5. **Mode Live** : en haut de l'app Meta, basculez de « Développement » à « Live » (demande l'URL de la politique de confidentialité, étape 1.7).
6. `wa check` doit afficher `platform=CLOUD_API`, `status=CONNECTED`, webhooks abonnés, modèles approuvés. Faites un dernier test depuis un portable qui n'a jamais écrit au numéro.

## 10. Vérifications de sécurité avant d'ouvrir au public

- [ ] 2FA active sur GitHub, Facebook, le portefeuille Meta (imposée à tous les admins) et la console Anthropic.
- [ ] Le jeton WhatsApp, la clé secrète de l'app, la clé Anthropic, `MASTER_KEY` et le PIN WhatsApp sont dans le gestionnaire de mots de passe, et nulle part dans Git, un e-mail ou une messagerie.
- [ ] `/srv/wilson/.env` est en `chmod 600`, propriétaire `deploy`.
- [ ] SSH : clé uniquement, pas de root, fail2ban actif (`sudo fail2ban-client status sshd`).
- [ ] Pare-feu actif (`sudo ufw status`) et le port 8080 **non** joignable depuis Internet (testez `curl http://<IP publique>:8080` depuis un autre réseau : il doit échouer).
- [ ] Les ports Postgres (5432) et S3 (9000) ne sont pas exposés (`docker compose -f docker-compose.prod.yml ps` : seul le back-office publie un port).
- [ ] HTTPS valide sur le domaine ; si un proxy filtrant est utilisé, le serveur n'accepte le web que depuis lui.
- [ ] Environnement GitHub `production` limité à `main`, branche `main` protégée.
- [ ] Mot de passe de l'admin initial changé ; chaque bénévole a son propre compte avec le bon rôle.
- [ ] Budget IA réglé dans le back-office **et** limite de dépense côté Anthropic.
- [ ] Sauvegardes : un dump existe (`docker compose -f docker-compose.prod.yml exec backup ls -l /backups`), une copie part régulièrement **dans l'UE** hors du serveur, et vous avez testé une restauration une fois.
- [ ] Registre des traitements RGPD et notice d'information à jour : Meta (WhatsApp), Anthropic, l'hébergeur, et le proxy si vous en utilisez un.
- [ ] Le README le rappelle : le POC **n'a pas encore été audité**. Prévoyez une revue de sécurité avant d'accueillir de vraies personnes.
