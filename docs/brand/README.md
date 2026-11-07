# Identité visuelle : Solidarité Migrants Wilson

L'app reprend le logo de l'association : un anneau orange et vert avec une poignée de main.

## Couleurs

| Rôle | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| Vert du logo | `#14450a` | `#3f8f2c` | logo, bandeau d'accueil |
| Vert principal | `#1d5c12` | `#8fd27a` | boutons, onglet actif, liens |
| Orange du logo | `#ff7300` | `#ff8a2b` | décor, bordures, contour de focus (`#d95f00` en clair) |
| Orange texte | `#9a4300` | `#ffb070` | texte sur fond orange pâle |
| Urgence | `#d0341f` | `#ff7a66` | reste rouge, pour ne jamais se confondre avec l'orange de la marque |

Le texte respecte le contraste WCAG AA (4,5:1). L'orange pur (2,7:1 sur blanc) ne sert jamais pour du texte.

## Typographie

- **Montserrat 700** (proche de la police du logo) pour les titres, les boutons et le nom de l'app. Une seule graisse, soit 19 Ko pour le latin. Les autres alphabets passent à leur police Noto.
- **Noto Sans** pour le texte courant, comme avant (toutes les écritures).

## Fichiers

- `apps/backoffice/src/brand/mark.svg` : l'anneau seul, sans texte (favicon, barre du haut). 2,5 Ko.
- `apps/backoffice/src/brand/logo.svg` : logo complet, qui s'adapte au mode sombre (écran de connexion). 8 Ko, 3,7 Ko gzip.
- `apps/backoffice/src/brand/icon-*.png`, `apple-touch-icon.png`, `manifest.webmanifest` : icônes de l'écran d'accueil (Android, iPhone).
- `docs/brand/whatsapp-profile.png` (640×640) : photo de profil du numéro WhatsApp Business. Le logo tient dans le cercle de recadrage. À mettre dans le gestionnaire WhatsApp de Meta : *Numéros de téléphone › Profil*.
- `docs/brand/logo.svg`, `docs/brand/logo-1024.png` : logo aux couleurs d'origine, pour l'impression ou les affiches.

Les SVG ont été vectorisés à partir du fichier JPEG du logo (potrace). L'anneau de `mark.svg` a été complété là où le texte le coupait.

## Légèreté

Pas d'image dans les écrans (le bandeau d'accueil et son anneau sont en CSS), pas de flou d'arrière-plan (coûteux sur les téléphones d'entrée de gamme), une seule police ajoutée.
