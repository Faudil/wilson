# Security: protecting Wilson against attacks and spam

Wilson helps exiled people. Some organised groups (far-right movements, for example) may try to shut it down,
flood it or infiltrate it. This page explains what the application does on its own, and what **you** must set up
on the server and on your accounts. Do the checklist in section 2 before announcing the WhatsApp number widely.

## 1. Threats, and what is already in the application

| Threat | Protection in the app | Settings |
|---|---|---|
| **Flood of WhatsApp messages** to drain the Claude budget or bury real people | Per-number limits: too fast → messages stored but not processed, one "slow down" notice; far too fast → number **held** until a volunteer releases or blocks it (Plus → Numéros en attente). During a wave, first messages from new numbers are held and people already helped keep being served. Blocked numbers are dropped before anything is stored and receive nothing. The monthly Claude budget hard stop (Plus → Coûts de l'IA) is the last barrier. | `WA_RATE_*`, `WA_FILES_PER_DAY`, `WA_FLOOD_*`, `WA_GLOBAL_*` |
| **Forged WhatsApp messages** | Every webhook call must carry Meta's signature (`X-Hub-Signature-256`, checked against `WHATSAPP_APP_SECRET`). In production the webhook is closed in sandbox mode. | `WHATSAPP_APP_SECRET` |
| **Fake volunteers / infiltration** | Self-signups start with no access until an admin approves them, and then only as *responder* (conversations, no letters, documents or notes). Honeypot field, 3 requests per IP per hour, 20 per day, 30 pending at most. With e-mail set up, the address must be confirmed before approval. | `VOLUNTEER_SIGNUP`, `SIGNUP_*`, `SMTP_URL` |
| **Fake web accounts** ("Mon espace", `/moi`) to flood the bot | Honeypot field, 20 sign-ups per IP per hour, 300 per day overall. A web account gets the same per-person flood guard and Claude budget as a WhatsApp number. `BENEFICIARY_SIGNUP=off` closes sign-up at once. | `BENEFICIARY_SIGNUP`, `WEB_SIGNUP_*` |
| **Guessing someone's recovery words** | 128⁶ word combinations; 10 wrong tries per IP in 15 min, and more than 300 wrong tries in an hour overall raises an alert. Only a keyed hash of the words is stored. A volunteer can **lock** an account at once (stolen phone) and give a one-time unlock code; this needs the `beneficiaries.recover` permission **and** an authenticator app. | `WEB_LOGIN_FAILURES_*` |
| **An insider reading many files** | A volunteer opening more than 60 different people in one hour raises an alert (or is suspended at once with `suspend`). Every view of a photo, file, conversation or note is in `access_log`. | `AUDIT_READS_PER_HOUR`, `AUDIT_BULK_READ_ACTION` |
| **Password guessing on an account** | 5 failures lock the e-mail for 15 min (then 30, 60…), 20 failures from one IP block it. Passwords hashed with argon2id. | `LOGIN_*` |
| **Admin account takeover** | Admin rights (volunteers, audit, costs, knowledge sync, moderation) need an authenticator app (TOTP). Without one, they are paused. A lost phone is reset by another admin, with an alert. | `ADMIN_2FA` |
| **Server seized, hacked or wiped** | Names, phone numbers, letters, documents and notes are encrypted per person in the database and storage; deleting a person destroys their key. Daily backups, with an **encrypted off-site copy** that the server itself cannot read. | `BACKUP_*` |

Alerts (floods, held numbers, locked accounts, new admins, unusual reads, failed backups) go to the server log, and
to a chat channel when `ALERT_WEBHOOK_URL` is set (Mattermost, Slack, Discord, Rocket.Chat, ntfy). They never contain
anything about the people we help. **Set this up**: an alert nobody reads protects nobody.

## 2. Checklist for the person running the server

### 2.1 Denial of service: put a shield in front, and stay in the EU

A DDoS fills your server's connection, and no setting in the application can stop it. You need a provider that
absorbs it upstream. Pick according to where the server is:

- **Server at OVHcloud, Scaleway or Hetzner**: their anti-DDoS is included and always on, in the EU, and sees no
  content. This is the simplest choice and often enough for a small association. Check it is enabled in the
  provider's console.
- **EU reverse-proxy shield** if you need more (web application firewall, bot filtering): Bunny.net Shield (Slovenia),
  Myra Security or Link11 (Germany). They decrypt traffic (they hold your TLS certificate), so sign a data processing
  agreement (DPA) with them.
- **Cloudflare** works well technically, but it is a US company: in proxy mode it decrypts every request, including
  the back-office pages showing people's files and the WhatsApp webhooks, and it is subject to US law (CLOUD Act).
  Keeping processing in the EU needs its *Data Localization Suite*, which is an Enterprise option. If you use it
  anyway: proxy mode, "Cache Level: Bypass" on `/rpc/*` and `/webhooks/*`, its DPA signed, and mention it in your
  privacy notice. Cloudflare's free plan is **not** compatible with an "EU only" commitment.

With a shield in front, set `TRUST_PROXY_HOPS=2` (shield + your reverse proxy) so rate limits see the real visitor
IP, and let only the shield's IP ranges reach your reverse proxy (firewall).

### 2.2 Server

- [ ] **SSH**: keys only. In `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`,
      `KbdInteractiveAuthentication no`, `AllowUsers <you> <deploy user>`. Use an ed25519 key with a passphrase.
      If you can, allow port 22 only from your own IP addresses or through a VPN (WireGuard, Tailscale).
- [ ] **Brute-force filter**: `fail2ban` or CrowdSec on SSH and on the reverse proxy.
- [ ] **Firewall** (ufw/nftables): deny everything incoming except 22 (restricted) and 80/443 on the reverse proxy.
      **Docker bypasses ufw for published ports**: Wilson publishes none (nginx-proxy reaches the back-office over
      its Docker network); make sure no other container publishes a sensitive port on a public interface.
- [ ] **Automatic security updates** (`unattended-upgrades` on Debian/Ubuntu) and a reboot when the kernel changes.
- [ ] **Full-disk encryption** (LUKS) if the provider allows it, with remote unlock (dropbear-initramfs). It protects
      the data when a disk is taken away while the server is off.
- [ ] `.env` readable by root only (`chmod 600`, done by the deploy script). `MASTER_KEY` also kept **offline** in a
      password manager (losing it = losing all data).

### 2.3 Reverse proxy (nginx, Caddy, Traefik…)

- [ ] HTTPS only: redirect HTTP to HTTPS, HSTS (`max-age=31536000`), TLS 1.2+ (Caddy does all this by default).
- [ ] **Overwrite** `X-Forwarded-For` with the visitor address instead of appending to it
      (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`), so it cannot be forged.
- [ ] Body size 12 MB (`client_max_body_size 12m;`), timeouts of 60 s.
- [ ] A second rate limit in front of the login, as a safety net:

      limit_req_zone $binary_remote_addr zone=wilson_auth:10m rate=10r/m;
      location ~ ^/rpc/auth/(login|signup) { limit_req zone=wilson_auth burst=5 nodelay; proxy_pass http://WILSON; }

- [ ] Access logs: no query strings or bodies, and kept 7 to 14 days at most (IP addresses are personal data).
- [ ] `server_tokens off;`.

### 2.4 Accounts around the application

- [ ] **Meta Business account**: two-factor authentication for every admin, as few admins as possible (2), business
      verification done, a *system user* token with only `whatsapp_business_messaging` and
      `whatsapp_business_management`, and a recovery e-mail that is not personal. Watch the number's *quality rating*
      in WhatsApp Manager: mass reports lower it. Keep a second number ready (verified, templates approved) in case the
      first one is restricted.
- [ ] **GitHub**: 2FA for everyone with access, branch protection on `main` (reviews required), the deploy SSH key only
      in a protected *environment* with required reviewers.
- [ ] **Domain registrar**: 2FA and *registrar lock* (a hijacked domain redirects everyone).
- [ ] **Hosting provider, Anthropic console, e-mail of the admin account**: 2FA everywhere.
- [ ] Every admin of the back-office turns on two-factor authentication (asked automatically on first login).

### 2.5 Volunteers

- [ ] Meet new volunteers (in person or video) before approving them, and approve them as *responder* first. Give
      *volunteer* rights (letters, documents, notes) only to people the association knows.
- [ ] Disable accounts as soon as someone leaves.
- [ ] Look at alerts about unusual reads and talk to the person. Use `AUDIT_BULK_READ_ACTION=suspend` if the
      association prefers to block first and ask afterwards.
- [ ] Give a web space unlock code only to the person themselves, face to face (or by video, with questions only they
      can answer). Someone calling "for a friend" is exactly how an account gets stolen.

### 2.6 Keep as little as possible

A leak or a seizure can only expose what is stored.

- Letter photos are deleted 48 h after the explanation (`PHOTO_TTL_HOURS`; lower it if you can).
- "Delete my data" (menu 9) destroys the person's key 30 days later (`ARCHIVE_RETENTION_DAYS`).
- Messages from blocked or held numbers are not stored.
- Keep server-side backups short (`BACKUP_KEEP_DAYS=14`) and expire off-site copies after 30 to 90 days with a
  lifecycle rule.
- Do not copy people's data out of Wilson (spreadsheets, personal phones, chat groups).
- Not done yet (follow-up): automatic deletion of people inactive for a long time. Decide a duration with the
  association (for example 2 years) so it can be added.

## 3. Encrypted off-site backups

The `backup` service dumps the database every night. When `BACKUP_S3_BUCKET` and `BACKUP_AGE_RECIPIENT` are set, it
also encrypts the dump with [age](https://age-encryption.org) and uploads it, plus the (already encrypted) document
files, to a bucket at **another provider** in the EU.

1. On **your own computer** (not the server): `age-keygen -o wilson-backup-key.txt`. It prints the public key
   (`age1…`). Store `wilson-backup-key.txt` offline: password manager plus a printed or USB copy in a safe place, held
   by two people. The server never sees it, so a hacked or seized server cannot read the off-site copies.
2. Create a bucket at another EU provider (Scaleway fr-par, OVH gra, Infomaniak…) with **object versioning** or
   **object lock**, and a lifecycle rule deleting objects after 30 to 90 days. Create an access key that can write
   but not delete, if the provider allows it: an attacker on the server then cannot erase the copies.
3. In the server's `.env`: `BACKUP_AGE_RECIPIENT=age1…`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
   `BACKUP_S3_REGION`, `BACKUP_S3_PROVIDER` (`Scaleway`, `OVHcloud`… or `Other`), `BACKUP_S3_ACCESS_KEY`,
   `BACKUP_S3_SECRET_KEY`. Deploy.
4. Test it now: `docker compose -f docker-compose.prod.yml run --rm -e BACKUP_NOW=1 backup`, then check the file
   appears in the bucket. A failed backup sends an alert.

**Restore** (on a new server, after a seizure or a wipe):

    # on your computer: download db/daily-YYYYMMDD.dump.age from the bucket, then
    age -d -i wilson-backup-key.txt -o wilson.dump daily-YYYYMMDD.dump.age
    # on the new server, with the same MASTER_KEY and LOOKUP_KEY in .env and the stack started:
    docker compose -f docker-compose.prod.yml cp wilson.dump backup:/backups/wilson.dump
    docker compose -f docker-compose.prod.yml exec backup pg_restore --clean --if-exists -d wilson /backups/wilson.dump
    # documents: copy the bucket's blobs/ folder back into the S3 storage (rclone copy …/blobs local:wilson)

Practise a restore every three months on a spare machine. A backup you never restored is a hope, not a backup.

## 4. When something happens

- **Flood on WhatsApp**: look at Plus → Numéros en attente and block the obvious spam. If real people are held
  during a wave, use "Libérer tous les nouveaux numéros" once it calms down. Lower the `WA_*` limits if needed, and
  check the Claude budget hard stop is on.
- **Suspicious volunteer account**: disable it in Bénévoles (all sessions end at once), read its `access_log`,
  reset its two-factor authentication if the phone was lost.
- **Server compromised**: take it offline, rotate every secret (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
  Anthropic keys, S3 and Postgres passwords, SSH keys), rebuild from scratch and restore from the off-site backup.
  If personal data may have leaked, the association must notify the CNIL within 72 hours
  (https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles).
- **WhatsApp number restricted by Meta**: switch to the backup number, then appeal in WhatsApp Manager.
