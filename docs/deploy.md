# Déploiement automatique sur votre serveur

> Première mise en ligne ? La liste de tout ce qu'il faut faire à la main, dans l'ordre (Meta, serveur, HTTPS, secrets, IA, sécurité), est dans [mise-en-ligne.md](mise-en-ligne.md).

Le workflow `.github/workflows/deploy.yml` :

1. **à chaque push et pull request** : lance `typecheck` et les tests (avec un Postgres 17 de test) ;
2. **à chaque push sur `main`** (ou à la main, onglet *Actions* > *CI / Deploy* > *Run workflow*) : si les tests passent, copie le code sur le serveur par SSH (rsync) puis lance `scripts/deploy/remote-deploy.sh`, qui :
   - vérifie le `.env` du serveur (présent, `chmod 600`, plus aucune valeur d'exemple) ;
   - construit les nouvelles images **pendant que l'ancienne version continue de tourner** (un build cassé ne coupe pas le site) ;
   - fait un dump Postgres dans le volume `backups` **avant** les migrations (10 derniers gardés) ;
   - redémarre la pile (`docker compose -f docker-compose.prod.yml up -d`), l'API applique les migrations au démarrage ;
   - attend que l'API (`/health`) et le back-office répondent, sinon affiche les logs et échoue.

Les secrets de l'application (clés de chiffrement, mots de passe, tokens WhatsApp, clé Anthropic) **restent uniquement sur le serveur**, dans `<DEPLOY_PATH>/.env`. GitHub ne connaît que l'accès SSH. Les données sont dans des volumes Docker nommés (`wilson-prod_pgdata`, `wilson-prod_s3data`, `wilson-prod_backups`) que le déploiement ne touche jamais. **Ne lancez jamais `docker compose down -v` sur le serveur** : cela les efface.

## 1. Préparer le serveur (une fois)

Prérequis : Docker avec le plugin `compose` (v2), `rsync`, et un utilisateur dédié membre du groupe `docker`.

```sh
sudo adduser --disabled-password deploy
sudo usermod -aG docker deploy
sudo mkdir -p /srv/wilson && sudo chown deploy: /srv/wilson
```

Créez une clé SSH **réservée au déploiement** (sur votre poste, sans phrase de passe) et autorisez-la sur le serveur :

```sh
ssh-keygen -t ed25519 -N "" -C "github-deploy-wilson" -f wilson_deploy
ssh-copy-id -i wilson_deploy.pub deploy@<serveur>
```

Créez la configuration de production à partir de [`.env.production.example`](../.env.production.example) :

```sh
scp .env.production.example deploy@<serveur>:/srv/wilson/.env
ssh deploy@<serveur> 'chmod 600 /srv/wilson/.env && nano /srv/wilson/.env'
```

Remplacez toutes les valeurs `CHANGE_ME` (`openssl rand -base64 32` pour `MASTER_KEY` / `LOOKUP_KEY`, `openssl rand -hex 24` pour les mots de passe), et mettez dans `PUBLIC_ORIGIN` l'adresse HTTPS publique. **Gardez une copie de `MASTER_KEY` hors du serveur** (gestionnaire de mots de passe) : sans elle les données sont illisibles, sauvegardes comprises.

### Reverse proxy

Seul le back-office est publié, sur `WILSON_BIND:WILSON_PORT` (par défaut `0.0.0.0:8080`). Faites pointer votre reverse proxy vers `http://<IP du serveur sur le LAN>:8080` et terminez le TLS sur le proxy. Le back-office relaie lui-même `/rpc` et `/webhooks` (WhatsApp) vers l'API, rien d'autre n'est exposé. Pour n'écouter que sur l'interface LAN, mettez son IP dans `WILSON_BIND`. Le proxy doit accepter des envois de 12 Mo (photos de courriers).

## 2. Créer l'environnement et les secrets GitHub

Dans le dépôt : *Settings* > *Environments* > *New environment* > nommez-le **`production`**, puis *Add environment secret* pour chacun :

| Secret | Valeur |
|---|---|
| `SSH_PRIVATE_KEY` | le contenu complet du fichier `wilson_deploy` (clé privée, lignes `-----BEGIN/END-----` comprises) |
| `SSH_KNOWN_HOSTS` | la sortie de `ssh-keyscan -p <port> <serveur>` lancée depuis un poste de confiance (épingle l'identité du serveur) |
| `SSH_HOST` | le nom ou l'IP du serveur, joignable depuis Internet |
| `SSH_USER` | `deploy` |
| `DEPLOY_PATH` | `/srv/wilson` (sans espace ni apostrophe) |
| `SSH_PORT` | *facultatif*, si SSH n'écoute pas sur 22 |

Conseil : dans l'environnement `production`, limitez *Deployment branches* à `main`, et ajoutez-vous en *Required reviewer* si vous voulez valider chaque déploiement.

Les runners GitHub sont sur Internet : le port SSH doit être joignable depuis l'extérieur (redirection de port sur la box, ou un hôte de rebond). Si vous ne voulez pas l'exposer, un runner *self-hosted* sur votre réseau local fonctionne avec le même workflow en remplaçant `runs-on: ubuntu-latest` du job `deploy` par `runs-on: self-hosted`.

## 3. Premier déploiement

Lancez *Actions* > *CI / Deploy* > *Run workflow* sur `main`. Le premier démarrage crée la base et le compte admin `SEED_ADMIN_EMAIL` ; changez son mot de passe après connexion.

## Sauvegardes et restauration

- `backup` fait un dump chaque jour à `BACKUP_HOUR` (gardé `BACKUP_KEEP_DAYS` jours) ; chaque déploiement en fait un aussi (`predeploy-*.dump`).
- Lister : `docker compose -f docker-compose.prod.yml exec backup ls -l /backups`
- Restaurer (arrête l'API le temps de la restauration) :

```sh
cd /srv/wilson
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec backup pg_restore --clean --if-exists -d wilson /backups/<fichier>.dump
docker compose -f docker-compose.prod.yml start api
```

Les dumps restent sur le même disque : copiez régulièrement le volume `wilson-prod_backups` ailleurs, **dans l'UE** (les données sont sensibles), et la `MASTER_KEY` séparément.

## Revenir à une version précédente

`git revert` du commit fautif puis push sur `main` : le workflow redéploie. Les migrations de base ne sont pas annulées automatiquement ; en cas de besoin, restaurez le dump `predeploy-*` pris juste avant.
