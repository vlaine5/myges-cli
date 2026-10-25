# Academic Sync

Application personnelle de synchronisation d'agenda académique et de lecture du dossier
scolaire, multi-provider, avec UI web, persistance locale et export vers Google Calendar / ICS.

Stack unique :

- backend Express en TypeScript
- frontend React / Vite
- persistance SQLite + Prisma
- scheduler interne
- export ICS
- synchronisation Google Calendar
- architecture multi-provider (MyGES, myEfrei, Ensup/HyperPlanning)

## État réel du projet

Ce qui fonctionne aujourd'hui :

- **`myges` en live** : auth OAuth, test connexion, agenda, `studentCount`, sync dry-run, export ICS,
  et **dossier académique en lecture** — onglet **Mes cours** (`/me/{année}/courses`) et, pour les
  comptes étudiants, onglet **Notes** (`/me/{année}/grades`)
- `myefrei` via modèle multi-provider : UI, API, cache, stats, export ICS depuis le cache
- `ensup` / HyperPlanning via architecture provider : UI, ICS, stats, filtres, export ICS
- Google OAuth côté backend, calendrier sélectionnable par provider
- dashboard, agenda, sync, Google, settings, heures d'enseignement, **Mes cours**

Limites réelles :

- `myefrei` bloque le login automatisé username/password avec reCAPTCHA ; voie fiable = `session cookie`
  + `agendaEndpoint`, ou un flux ICS
- le dossier académique MyGES dépend du **rôle du compte** (voir ci-dessous)
- le code Google est validé côté statut / OAuth start uniquement

## MyGES — rôles et dossier académique

MyGES / Réseau GES expose **deux back-ends distincts** :

| | `api.kordis.fr` (API mobile, utilisée ici) | `myges.fr/teacher/*` (site web) |
|---|---|---|
| Auth | token OAuth Bearer | cookie de session (CAS) |
| Techno | REST JSON (`{ result }`) | JSF / PrimeFaces (ViewState) |
| Saisie de notes | non exposée | formulaire JSF |

Cette app parle à `api.kordis.fr`. Les droits dépendent du **rôle** :

| Endpoint | Enseignant | Étudiant |
|---|---|---|
| `GET /me/profile`, `GET /me/years` | ✅ | ✅ |
| `GET /me/{année}/courses` (**Mes cours**) | ✅ cours enseignés | ✅ cours suivis |
| `GET /me/{année}/grades` (**Notes**) | ❌ 418 | ✅ |
| `absences`, `projects`, `nextProjectSteps` | ❌ 418 | ✅ |

- **Mes cours** (`/courses`) : matière, classe/groupe, enseignant, effectif, coef, ECTS, et des
  indicateurs « Notes / Docs ». Lecture seule, marche pour tous les rôles.
- **Notes** (`/grades`) : bulletin par trimestre, moyennes pondérées, ECTS. Comptes étudiants
  uniquement ; l'onglet n'est pas dans la barre de navigation car il renvoie `418` pour un enseignant.

La saisie de notes côté enseignant n'existe que dans le site web JSF, pas dans l'API REST : aucun
import automatisé de notes n'est fourni. Cartographie complète de l'API dans
[`docs/myges-api-audit.md`](docs/myges-api-audit.md).

## Sécurité & confidentialité

- **Aucun secret dans le dépôt.** `.env*` (hors `.env.example`), `data/`, `*.db` et `logs/` sont
  dans `.gitignore`. Les identifiants et tokens ne sont jamais commités.
- **Chiffrement au repos.** Mots de passe providers, cookies de session et tokens Google sont
  chiffrés en base en **AES-256-GCM**, clé dérivée de `APP_SECRET` (`src/lib/crypto.ts`). `APP_SECRET`
  doit faire ≥ 16 caractères ; changez-le en production et ne réutilisez pas les valeurs d'exemple.
- **Logs sans fuite.** Les en-têtes de requête ne sont jamais journalisés (ils porteraient les cookies
  d'autres apps sur la même IP), et seuls des champs d'erreur sûrs sont loggés pour ne pas exposer de
  bearer token (`src/app.ts`, `src/lib/logger.ts`).
- **Lecture seule MyGES.** L'app ne fait que des `GET` sur le compte MyGES ; rien n'est modifié côté
  établissement.
- L'image Docker ne contient ni `.env` ni `data/` (voir `.dockerignore`).

## Architecture

Cœur métier : un modèle d'événement normalisé commun.

Modules principaux :

- `src/modules/providers` : providers académiques (auth + lecture)
- `src/modules/courses` : agrégation « Mes cours » (lecture seule)
- `src/modules/grades` : agrégation bulletin / notes (comptes étudiants)
- `src/modules/events` : normalisation, déduplication, filtres de présentation
- `src/modules/sync` : sync Google et sync ICS
- `src/modules/google` : OAuth et opérations Calendar
- `src/modules/export` : export ICS
- `src/modules/reconciliation` : réconciliation inter-provider
- `src/modules/settings` : settings applicatifs
- `src/routes` : API HTTP
- `web/` : frontend React
- `prisma/` : schéma SQLite et migrations

## Providers

Providers câblés : `myges`, `myefrei`, `ensup`.

Le provider actif est stocké dans `AppSettings.provider`. Par ailleurs, les capacités de dossier
académique (`listYears` / `fetchCourses` / `fetchGrades`) sont optionnelles : seul MyGES les implémente,
et les services « Mes cours » / « Notes » basculent automatiquement vers le provider MyGES même si le
provider actif (pour le calendrier) est myEfrei ou Ensup.

Le reste du modèle est tagué par provider :

- les snapshots d'événements sont tagués par provider
- les jobs de sync sont tagués par provider
- les calendriers Google sélectionnés sont tagués par provider
- l'export ICS peut être demandé par provider

## Modèle normalisé

Champs principaux : `id = ${provider}:${sourceId}`, `provider`, `sourceId`, `reservationId`, `title`,
`subject`, `startAt`, `endAt`, `teacher`, `room`, `campus`, `promotion`, `group`, `classes`, `modality`,
`studentCount`, `disciplineName`, `disciplineTeacher`, `disciplineId`, `rawPayload`, `sourceHash`.

La sync Google, l'API, l'export ICS et les stats ne dépendent pas directement de MyGES.

### `studentCount`

- `myges` : `agenda[].discipline.nb_students`
- `myefrei` : premier champ numérique valide parmi `studentCount`, `nb_students`, `classSize`,
  `discipline.nb_students`
- `ensup` : `studentCount`, `nb_students`, `nbStudents`, `effectif`, `nbEleves` si présents, sinon `null`

Règle : si l'information n'existe pas, la valeur reste `null` — aucune valeur n'est inventée.

## Déduplication & réconciliation

Deux niveaux de déduplication :

1. stricte, par identifiant normalisé `id`
2. collapse des doublons visibles équivalents (même provider), la version la plus riche est gardée

Au-delà (inter-provider), un modèle à trois niveaux relie les sources à un événement canonique :

```
EventSnapshot (par provider)  →  GlobalEvent (canonique)  →  EventMapping (Google)
```

- liaison automatique uniquement sur preuve forte (identifiant partagé vérifié, ou répétition d'une
  correspondance déjà confirmée) — sinon simple suggestion à valider sur `/matches`
- toute décision (auto-lien, confirmation, rejet, déliaison) est tracée dans `EventMatch`
- Google ne reçoit qu'un événement par `GlobalEvent`

Chaque sync journalise ses changements (`SyncJobEventChange`), consultables et annulables depuis
`/sync/:jobId`.

## Heures d'enseignement

La page `/teaching` agrège les heures par classe / groupe sur une période : filtres période / provider
/ matière, total heures, nombre de séances, effectif par classe quand la donnée existe. L'historique
local est conservé (les événements passés ne sont pas supprimés quand ils disparaissent d'un flux).

## Google Calendar

UI `/google` : statut OAuth, connecter / reconnecter / déconnecter, lister les calendriers, en
sélectionner ou en créer un **par provider**.

Configuration : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL`.

## myEfrei & Ensup

- **myEfrei** : `username/password` (bloqué par reCAPTCHA), `session cookie`, `session cookie +
  agendaEndpoint`, ou ICS. Pour `agendaEndpoint` : DevTools › Network › Fetch/XHR › recharger l'agenda
  › copier la `Request URL` du JSON des cours.
- **Ensup / HyperPlanning** (`https://extranet-hp-sqy.ensup.eu`) : ICS, `session cookie + agendaEndpoint`,
  ou username/password quand le portail l'accepte. Variables : `ENSUP_USERNAME`, `ENSUP_PASSWORD`,
  `ENSUP_SESSION_COOKIE`, `ENSUP_AGENDA_ENDPOINT`, `ENSUP_ICS_URL`.

## API

Santé / système : `GET /api/health`, `GET /api/diagnostics`, `GET /api/dashboard`,
`GET /api/settings`, `PUT /api/settings`.

Providers : `GET /api/providers/status`, `GET /api/providers/:provider/status`,
`POST /api/providers/:provider/login`, `POST /api/providers/:provider/connect`,
`POST /api/providers/:provider/test`, `PATCH /api/providers/:provider/config`.

Dossier académique MyGES (lecture seule) :

- `GET /api/courses/years` — années disponibles
- `GET /api/courses?year=YYYY` — cours (Mes cours), défaut = année la plus récente
- `GET /api/grades/years` — années disponibles (comptes étudiants)
- `GET /api/grades?year=YYYY` — bulletin (comptes étudiants)

Événements / réconciliation / sync : `GET /api/events`, `GET /api/events/:id`,
`GET /api/global-events`, `GET /api/global-events/:id`, `GET /api/reconciliation/suggestions`,
`POST /api/reconciliation/suggestions/:matchId/confirm|reject`,
`POST /api/reconciliation/links/:globalEventId/unlink`, `POST /api/sync/run`, `POST /api/sync/dry-run`,
`GET /api/sync/history`, `GET /api/sync/jobs/:jobId/changes`,
`POST /api/sync/jobs/:jobId/changes/:changeId/rollback`, `POST /api/sync/jobs/:jobId/rollback`.

Export / ICS / stats : `GET /api/export/ics`, `GET /api/export/ics/latest`, `POST /api/ics/sync`,
`GET /api/stats/teaching`.

Google : `GET /api/google/status`, `GET /api/google/config`, `PUT /api/google/config`,
`POST /api/google/oauth/start`, `GET /api/google/oauth/callback`, `POST /api/google/disconnect`,
`GET /api/google/calendars`, `POST /api/google/calendars`, `PUT /api/google/calendar`.

## Frontend

Pages : `/` (accueil), `/agenda` (ou `/events`), **`/courses` (Mes cours)**, `/matches`, `/provider`,
`/google`, `/sync`, `/sync/:jobId`, `/teaching`, `/effectifs`, `/settings`. La page `/grades` (Notes,
comptes étudiants) existe mais n'est pas dans la barre de navigation.

Branché : appels API réels, états loading/error, sélection du provider actif, test connexion,
choix du provider dans la sync manuelle, filtres, export ICS par provider.

## Lancement local

Prérequis : Node.js 20 recommandé, npm.

```bash
cp .env.example .env     # puis renseigner au minimum APP_SECRET (≥ 16 caractères)
npm install
npm run build
npm start
```

- UI/API : `http://localhost:3000` (API sous `/api`)

Développement (backend watch + Vite) :

```bash
npm run dev
```

- UI Vite : `http://localhost:5173`, proxy API : `/api`

## Docker

```bash
cp .env.example .env
docker-compose up --build -d
```

- UI/API : `http://localhost:3000` (port externe configurable via `MYGES_PORT`)
- persistance : `./data:/app/data`

Image publiée : `vlaine/myges-cli:latest`.

## Variables d'environnement

Deux catégories à ne pas confondre :

1. **Infra, toujours lues** — nécessaires au fonctionnement, relues à chaque démarrage.
2. **Identifiants (providers + Google OAuth), optionnelles** — ne servent qu'à pré-remplir la base au
   **tout premier** démarrage, si elle est vide. Une fois des identifiants enregistrés (via l'env ou
   via `/provider` / `/google`), **c'est l'interface qui fait foi** : ces variables ne sont plus relues.

Infra (requis) : `NODE_ENV`, `HOST`, `PORT`, `APP_BASE_URL`, `APP_SECRET`, `DATABASE_URL`,
`APP_DATA_DIR`, `LOG_LEVEL`, `GOOGLE_OAUTH_SCOPES` (relue à chaque OAuth, jamais stockée).

Paramètres de sync (seed unique dans `AppSettings`, modifiables via `/settings`) : `ACADEMIC_PROVIDER`,
`SYNC_ENABLED`, `SYNC_LOOKBACK_DAYS`, `SYNC_FUTURE_DAYS`, `SYNC_FREQUENCY_MINUTES`,
`SYNC_RUN_ON_STARTUP`, `GOOGLE_SYNC_ENABLED`, `SAVE_LAST_ICS`, `STORE_RAW_PAYLOAD`, `TIMEZONE`.

Identifiants providers (optionnel, bootstrap unique — configurables ensuite via `/provider`) :

- MyGES : `MYGES_USERNAME`, `MYGES_PASSWORD`
- myEfrei : `MYEFREI_USERNAME`, `MYEFREI_PASSWORD`, `MYEFREI_SESSION_COOKIE`, `MYEFREI_AGENDA_ENDPOINT`
- Ensup : `ENSUP_USERNAME`, `ENSUP_PASSWORD`, `ENSUP_SESSION_COOKIE`, `ENSUP_AGENDA_ENDPOINT`, `ENSUP_ICS_URL`

Google OAuth (optionnel, bootstrap unique — configurable via `/google`) : `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL`, `GOOGLE_DEFAULT_CALENDAR_ID`.

> Ne commitez jamais un `.env` rempli : il est ignoré par git à dessein.

## Tests & qualité

```bash
npm run lint
npm test
npm run build
```

Couverture utile : mapping MyGES / myEfrei, agrégation « Mes cours » et bulletin, parsing des
descriptions structurées, exclusion ENSUP, déduplication, provider registry, plan de sync idempotent.

## Scripts

- `npm run sync:once` — une passe de sync
- `npm run export:ics` — export ICS
- `node scripts/myges-api-probe.mjs` — sonde l'API MyGES en **lecture seule** (GET) et écrit un dump
  **rédacté** dans `data/exports/` ; nécessite un `MYGES_PASSWORD` valide dans `.env`

## Troubleshooting

- `MYGES_NOT_CONFIGURED` : connecte-toi via `/provider` → MyGES (ou renseigne `MYGES_*` sur une base vierge).
- `GRADES_NOT_SUPPORTED` / réponse `418` sur les notes : compte au rôle enseignant → utilise **Mes cours**.
- `MYEFREI_SESSION_EXPIRED` : cookie refusé par le portail, recopie le header `Cookie` depuis le navigateur.
- `MYEFREI_ENDPOINT_NOT_CONFIGURED` : configure l'URL XHR JSON de l'agenda, ou passe par ICS.
- `GOOGLE_NOT_CONFIGURED` : configure Google OAuth dans `.env` ou `/google`.
- `EADDRINUSE` : port occupé, ex. `PORT=3001 APP_BASE_URL=http://localhost:3001 npm start`.
- Base SQLite fantôme sous `prisma/data/app.db` : la base réelle vit à `./data/app.db`
  (`DATABASE_URL`). Ne lance pas `prisma studio` / `migrate dev` sans `DATABASE_URL` absolu ; un
  fichier réapparu sous `prisma/data/` peut être supprimé sans risque.
