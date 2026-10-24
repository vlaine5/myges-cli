# Implementation Notes

## Stack retenue

Le projet a été stabilisé autour d’une stack unique Node/TypeScript:

- Express pour l’API
- React/Vite pour l’interface
- Prisma + SQLite pour la persistance
- scheduler applicatif interne

L’ancien mélange CLI historique n’est plus la voie principale.

## Providers

Abstraction centrale: `AcademicProvider`.

Contrat:

- `authenticate(input)`
- `testConnection(input?)`
- `getStatus()`
- `fetchEvents(range, options?)`

Providers branchés:

- `MyGesProvider`
- `MyEfreiProvider`
- `EnsupProvider`

## Événements normalisés

Tous les providers produisent `NormalizedEvent`.

Points importants:

- `id` est dérivé de `provider + sourceId`
- `sourceHash` pilote l’idempotence Google
- `classes`, `group`, `promotion`, `studentCount` et `discipline*` sont conservés

## Historique et persistance

Le stockage principal reste `EventSnapshot`.

Comportement voulu et conservé:

- les événements passés ne sont pas supprimés quand une source ne les renvoie plus ensuite
- les événements futurs supprimés d’un flux ICS sont retirés seulement pour le futur
- un même événement est mis à jour si son identifiant source reste stable

## Déduplication visible

Deux mécanismes sont utilisés:

1. déduplication stricte par `id`
2. collapse d’événements équivalents via `src/modules/events/presentation.ts`

Le collapse sert surtout à éliminer:

- une version pauvre puis une version enrichie d’une même séance
- des doublons visibles provenant de flux ICS ou imports successifs

Le meilleur candidat est choisi selon la richesse métier:

- enseignant
- salle
- groupes / classes
- matière
- `studentCount`

## myEfrei

### Auth

Le login automatisé username/password existe mais peut être bloqué par reCAPTCHA.

Fix appliqué sur les cookies:

- le cookie collé depuis le navigateur n’est plus décodé
- la valeur brute du header `Cookie` est conservée
- cela évite de casser des valeurs de type `myefrei.sid=s%3A...`

### Groupes et détails

Les descriptions structurées sont parsées dans `src/modules/events/structured-description.ts`.

Champs gérés:

- `Code module`
- `Enseignant(s)`
- `Groupe(s)`
- `Modalité`
- `Activité`
- `Nombre d’élèves`

Ces valeurs sont réutilisées:

- dans le provider `myefrei`
- dans la sync ICS
- dans l’API
- dans l’export ICS
- dans Google Calendar

## ENSUP / HyperPlanning

Le provider `ensup` supporte:

- ICS
- session cookie + agenda endpoint
- tentative login username/password si le portail le permet

Une règle d’exclusion dédiée masque les événements bruités ENSUP:

- `Férié`
- `Jour férié`
- `Vacances`

La règle est appliquée en lecture, en stats, en sync ICS et dans l’export ICS.

## Sync Google

La sync Google reste provider-agnostique.

Points clés:

- sélection d’agenda par provider
- mapping local `sourceEventId -> googleEventId`
- `create / update / delete / unchanged`
- `dry-run`
- historisation dans `SyncJob`

Le choix du provider est maintenant branché dans:

- l’API `/api/sync/run`
- l’API `/api/sync/dry-run`
- la page frontend `/sync`

## Export ICS

L’export ICS peut maintenant fonctionner:

- depuis un refresh live si demandé
- ou depuis le cache local, ce qui est important pour `myefrei` et `ensup`

L’API accepte:

- `provider`
- `start`
- `end`
- `save`
- `refresh`

## Heures d’enseignement

La page `/teaching` et l’API `/api/stats/teaching` agrègent:

- heures par classe / groupe
- nombre de séances
- effectif si disponible

Le filtre matière a été branché côté API et frontend via `subject`.

## Sécurité

Mesures appliquées:

- pas d’exposition des mots de passe ou cookies
- les URLs ICS secrètes ne sont plus renvoyées dans le statut provider
- les secrets restent chiffrés avec `APP_SECRET`

## Corrections apportées lors de l'audit final

### CI/CD GitHub Actions
Les workflows `.github/workflows/` étaient critiquement obsolètes (Node 12-16, référence à `dist/cli.js` qui n'existe plus):
- `lint.yml`: mis à jour vers Node 20, `actions/checkout@v4`, `actions/setup-node@v4` avec cache npm
- `test.yml`: mis à jour vers Node 18/20/22, OS ubuntu/macos, `npm test` au lieu de l'ancien CLI
- `release.yml`: remplacé la publication npm par un build/push Docker sur ghcr.io

### ProviderPage: sauvegarde agendaEndpoint sans re-authentification
Il était impossible de sauvegarder uniquement l'`agendaEndpoint` sur la page Provider sans re-fournir un session cookie ou des credentials. L'endpoint `login` exigeait des credentials.

Fix: quand seul `agendaEndpoint` est renseigné (sans `sessionCookie` ni `password`), le frontend utilise maintenant `PATCH /api/providers/:provider/config` au lieu de `POST /api/providers/:provider/login`.

### AgendaPage: provider par défaut depuis les settings
La page Agenda utilisait toujours `myges` comme provider par défaut quel que soit le provider actif configuré. Elle charge maintenant le provider actif depuis `/api/settings` au montage.

## Import manuel ICS

L'application permet d'importer manuellement des fichiers ou URLs ICS indépendamment des agendas configurés.

### Comment importer

**Fichier .ics upload** :
1. Frontend lit le fichier avec `File.text()` (FileReader API)
2. Envoie le contenu brut en JSON : `POST /api/imports/ics/file` avec `{ content, provider, name, filename }`
3. Le backend parse, normalise, déduplique et insère les événements
4. Un enregistrement `IcsImport` est créé pour traçabilité

**URL ICS** :
1. `POST /api/imports/ics/url` avec `{ icsUrl, provider, name }`
2. Backend fetch l'URL, puis pipeline identique
3. Le réimport est disponible via `POST /api/imports/:id/reimport`

### Détection automatique du provider

Avant import, le contenu ICS est analysé par `src/lib/ics-provider-detector.ts` :
- **Signaux lus** : PRODID, X-WR-CALNAME, X-WR-CALDESC, CATEGORIES du premier VEVENT, ORGANIZER, URL
- **Providers détectables** : myges (markers "ges"), myefrei (markers "efrei"), ensup (markers "hyperplanning")
- **Score de confiance** : high (≥10 pts, margin ≥5) / medium (≥5 pts, margin ≥3) / low / none
- Si détection incertaine ou absente → provider retourné = `generic`, confidence = `none`
- Le provider détecté est proposé en pré-sélection, mais l'utilisateur peut le changer manuellement

**Détection disponible séparément** : `POST /api/imports/detect` avec `{ content }` → sans import.

### Choix manuel du provider

L'utilisateur peut choisir parmi : myges, myefrei, ensup, generic (Autre/Inconnu).
Le provider choisi est stocké dans `IcsImport.provider` et utilisé comme `EventSnapshot.provider`.
Il ne peut jamais être perdu après import.

### Déduplication

Stratégie (purement additive — aucun événement existant n'est jamais supprimé) :

1. **ID stable** : `provider:sha256(UID)` — déterministe per UID + provider
2. **Même ID, même hash** → doublon exact → skipped, compté dans `duplicateCount`
3. **Même ID, hash différent** → contenu changé → upsert → compté dans `updatedCount`
4. **Nouvel ID** → création → compté dans `createdCount`
5. **Déduplication intra-batch** : `collapseEquivalentEvents()` appliqué avant upsert
6. Les événements CANCELLED sont ignorés (non supprimés de la base)

Le réimport d'un ICS identique retourne `created=0, updated=0, duplicates=N`.

### Modèle de données

Table `IcsImport` (SQLite) :
- `sourceType` : `manual_upload` | `manual_url`
- `provider` : provider final retenu
- `detectedProvider` + `detectionConfidence` : résultat de la détection automatique
- `fetchedCount`, `createdCount`, `updatedCount`, `duplicateCount`, `skippedCount`
- `icsUrl` (si URL), `originalFilename` (si upload)
- `lastReimportAt` (null si jamais réimporté)

Suppression d'un import (`DELETE /api/imports/:id`) : supprime la traçabilité, pas les événements.

### Intégration calendrier

Les événements importés avec provider `generic` apparaissent dans le calendrier visuel (couleur orange).
Le filtre provider du calendrier inclut maintenant "Autre / Inconnu" (generic).

### Limites connues

- Récurrences RRULE non supportées (chaque VEVENT traité individuellement)
- Import purement additif : les événements supprimés d'un ICS ré-importé ne sont pas retirés
- Limite JSON body : 5 MB pour les imports de fichiers
- La détection provider ne fonctionne que pour myges / myefrei / ensup ; tout autre source → generic

## Validation réellement faite

Validation effectuée pendant la remise en état:

- `npm run lint` — 0 warnings
- `npm test` — 16/16 tests
- `npm run build` — TypeScript + Vite propre
- `npm start`
- tests live des routes API:
  - `GET /api/health`
  - `GET /api/providers/status`
  - `POST /api/providers/myges/test` → OK, profil retourné
  - `POST /api/providers/myefrei/test` → échec reCAPTCHA attendu
  - `GET /api/events?provider=myefrei` → 4 événements avec teacher/group/modality
  - `GET /api/events?provider=myges` → 10 événements avec studentCount/campus
  - `GET /api/stats/teaching` → 236h, 75 events, 8 classes
  - `GET /api/stats/teaching?subject=...` → filtre fonctionnel
  - `GET /api/export/ics?provider=myges` → VCALENDAR valide
  - `GET /api/export/ics?provider=myefrei` → VCALENDAR valide avec groupes dans description
  - `POST /api/sync/dry-run?provider=myges` → SUCCESS, 16 fetched, 16 deduped
  - `GET /api/google/status` → configured + connected + hasRefreshToken
  - `GET /api/diagnostics` → version, uptime, cachedEvents
