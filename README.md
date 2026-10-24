# Academic Sync

Application personnelle de synchronisation d’agenda académique.

Le dépôt a été remis en état autour d’une seule stack:

- backend Express en TypeScript
- frontend React/Vite
- persistance SQLite + Prisma
- scheduler interne
- export ICS
- synchronisation Google Calendar
- architecture multi-provider

## État réel du projet

Ce qui fonctionne aujourd’hui:

- `myges` en live: auth, test connexion, récupération agenda, `studentCount`, sync dry-run, export ICS
- `myefrei` via modèle multi-provider, UI, API, cache, stats et export ICS depuis le cache
- `ensup` / HyperPlanning via architecture provider, UI, ICS, stats, filtres et export ICS
- Google OAuth côté backend avec calendrier sélectionnable par provider
- dashboard, agenda, sync, Google, settings, heures d’enseignement
- Docker monolithique simple

Limites réelles:

- `myefrei` bloque le login automatisé username/password avec reCAPTCHA
- pour `myefrei`, la voie fiable reste `session cookie` + `agendaEndpoint`, ou un flux ICS si disponible
- le code Google est testé côté statut/OAuth start; je n’ai pas forcé de déconnexion ni modifié de mapping Google live pendant la validation

## Architecture

Le cœur métier repose sur un modèle d’événement normalisé commun.

Principaux modules:

- `src/modules/providers`: providers académiques
- `src/modules/events`: normalisation, déduplication, filtres de présentation
- `src/modules/sync`: sync Google et sync ICS
- `src/modules/google`: OAuth et opérations Calendar
- `src/modules/export`: export ICS
- `src/modules/settings`: settings applicatifs
- `src/routes`: API HTTP
- `web/`: frontend React
- `prisma/`: schéma SQLite et migrations

## Providers

Providers actuellement câblés:

- `myges`
- `myefrei`
- `ensup`

Le provider actif est stocké dans `AppSettings.provider`, mais:

- les snapshots d’événements sont taggés par provider
- les jobs de sync sont taggés par provider
- les calendriers Google sélectionnés sont taggés par provider
- l’export ICS peut être demandé par provider

## Modèle normalisé

Champs principaux:

- `id = ${provider}:${sourceId}`
- `provider`
- `sourceId`
- `reservationId`
- `title`
- `subject`
- `startAt`
- `endAt`
- `teacher`
- `room`
- `campus`
- `promotion`
- `group`
- `classes`
- `modality`
- `studentCount`
- `disciplineName`
- `disciplineTeacher`
- `disciplineId`
- `rawPayload`
- `sourceHash`

La sync Google, l’API, l’export ICS et les stats ne dépendent pas directement de MyGES.

## `studentCount`

Source par provider:

- `myges`: `agenda[].discipline.nb_students`
- `myefrei`: premier champ numérique valide parmi `studentCount`, `nb_students`, `classSize`, `discipline.nb_students`, puis valeurs structurées éventuelles dans les détails si présentes
- `ensup`: `studentCount`, `nb_students`, `nbStudents`, `effectif`, `nbEleves` si présents, sinon `null`

Règle:

- si l’information n’existe pas, la valeur renvoyée reste `null`
- aucune valeur n’est inventée

## Groupes myEfrei

Les groupes sont récupérés de deux façons:

- depuis les champs natifs quand ils existent (`group`, `class`, `studentGroup`, `discipline.student_group_name`, `classes`)
- depuis les descriptions structurées du type `Groupe(s): B3-CS-FISA2`

Le parsing structuré supporte aussi:

- `Code module`
- `Enseignant(s)`
- `Modalité`
- `Activité`
- `Nombre d’élèves` si la donnée existe

Les groupes remontent dans:

- l’API `/api/events`
- la page Agenda
- la page Heures d’enseignement
- les descriptions Google
- l’export ICS

## Exclusion ENSUP / HyperPlanning

Les événements ENSUP non souhaités sont exclus à l’affichage, des stats, de l’export ICS et de la sync issue du modèle normalisé.

Logique actuelle:

- provider `ensup`
- mots-clés de type `Férié`, `Jour férié`, `Vacances`
- absence de métadonnées pédagogiques réelles (pas d’enseignant, pas de classes, pas de groupe, pas de promotion)

Cette logique est centralisée dans `src/modules/events/presentation.ts`.

## Déduplication

Deux niveaux de déduplication sont appliqués:

1. déduplication stricte par identifiant normalisé `id`
2. collapse des doublons équivalents visibles, pour éviter les doubles séances importées avec une version pauvre puis une version enrichie

Le collapse “équivalent” compare notamment:

- provider
- début / fin
- titre / matière
- salle
- enseignant
- groupes / classes

La version la plus riche est gardée.

Conséquences:

- les vues API/UI/stats n’affichent plus les doublons évidents
- l’export ICS depuis le cache n’exporte plus les doublons visibles
- la sync ICS supprime aussi les doublons futurs équivalents qui disparaissent du flux

## Heures d’enseignement

La page `/teaching` agrège les heures par classe / groupe sur une période donnée.

Elle supporte:

- filtre période
- filtre provider
- filtre matière
- total heures
- nombre de séances
- étudiant(s) par classe quand la donnée existe

L’historique est conservé en base locale:

- les événements passés ne sont pas supprimés quand ils disparaissent ensuite de certains flux
- les futures disparitions dans un flux ICS entraînent seulement la suppression des événements futurs correspondants

## Google Calendar

Fonctions disponibles dans l’UI `/google`:

- voir le statut OAuth
- connecter / reconnecter
- déconnecter
- voir les calendriers disponibles
- sélectionner un calendrier par provider
- créer un calendrier et le sélectionner pour un provider

Configuration:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URL`

Le mapping est provider-aware:

- `myges` peut cibler un agenda Google
- `myefrei` peut en cibler un autre
- `ensup` peut en cibler un autre

## myEfrei

Modes supportés:

- `username/password`
- `session cookie`
- `session cookie + agendaEndpoint`
- ICS si un flux est disponible

État réel:

- le login automatisé username/password est bloqué ici par reCAPTCHA
- le cookie collé depuis le navigateur est désormais utilisé brut, sans décodage destructif
- le test de session vérifie la présence minimale de `myefrei.sid=...`
- l’URL `agendaEndpoint` doit être la vraie requête JSON/XHR de l’agenda

Pour trouver `agendaEndpoint`:

1. se connecter à myEfrei dans le navigateur
2. ouvrir DevTools > Network
3. filtrer `Fetch/XHR`
4. recharger la page agenda
5. copier la `Request URL` de la requête qui renvoie le JSON des cours

## ENSUP / HyperPlanning

Le provider `ensup` cible `https://extranet-hp-sqy.ensup.eu`.

Modes supportés:

- ICS
- session cookie + agenda endpoint
- tentative username/password côté HyperPlanning quand le portail l’accepte

Variables supportées:

- `ENSUP_USERNAME`
- `ENSUP_PASSWORD`
- `ENSUP_SESSION_COOKIE`
- `ENSUP_AGENDA_ENDPOINT`
- `ENSUP_ICS_URL`

## API

Routes principales:

- `GET /api/health`
- `GET /api/diagnostics`
- `GET /api/dashboard`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/providers/status`
- `GET /api/providers/:provider/status`
- `POST /api/providers/:provider/login`
- `POST /api/providers/:provider/connect`
- `POST /api/providers/:provider/test`
- `PATCH /api/providers/:provider/config`
- `GET /api/events?provider=&start=&end=&refresh=`
- `GET /api/events/:id`
- `POST /api/sync/run`
- `POST /api/sync/dry-run`
- `GET /api/sync/history?provider=`
- `GET /api/export/ics?provider=&start=&end=&save=&refresh=`
- `GET /api/export/ics/latest`
- `POST /api/ics/sync`
- `GET /api/stats/teaching?provider=&start=&end=&subject=`
- `GET /api/google/status`
- `GET /api/google/config`
- `PUT /api/google/config`
- `POST /api/google/oauth/start`
- `GET /api/google/oauth/callback`
- `POST /api/google/disconnect`
- `GET /api/google/calendars`
- `POST /api/google/calendars`
- `PUT /api/google/calendar`

## Frontend

Pages utiles:

- `/` dashboard
- `/provider` ou `/providers`
- `/google`
- `/agenda` ou `/events`
- `/sync`
- `/teaching`
- `/settings`

Ce qui est branché:

- appels API réels
- états loading/error
- sélection du provider actif
- test connexion providers
- choix du provider dans la sync manuelle
- filtre matière dans les heures d’enseignement
- export ICS par provider

## Lancement local

Prérequis:

- Node.js 20 recommandé
- npm

Installation:

```bash
cp .env.example .env
npm install
npm run build
npm start
```

UI production:

- `http://localhost:3000`

API:

- `http://localhost:3000/api`

## Développement

```bash
npm run dev
```

Cela lance:

- backend watch
- frontend Vite

URLs:

- UI Vite: `http://localhost:5173`
- proxy API Vite: `/api`

## Docker

```bash
cp .env.example .env
docker-compose up --build -d
```

Accès:

- UI/API: `http://localhost:3000`

Persistance:

- `./data:/app/data`

## Variables d’environnement

Variables principales:

- `NODE_ENV`
- `HOST`
- `PORT`
- `APP_BASE_URL`
- `APP_SECRET`
- `DATABASE_URL`
- `APP_DATA_DIR`
- `LOG_LEVEL`
- `ACADEMIC_PROVIDER`

MyGES:

- `MYGES_USERNAME`
- `MYGES_PASSWORD`

myEfrei:

- `MYEFREI_USERNAME`
- `MYEFREI_PASSWORD`
- `MYEFREI_SESSION_COOKIE`
- `MYEFREI_AGENDA_ENDPOINT`

Ensup:

- `ENSUP_USERNAME`
- `ENSUP_PASSWORD`
- `ENSUP_SESSION_COOKIE`
- `ENSUP_AGENDA_ENDPOINT`
- `ENSUP_ICS_URL`

Google:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URL`
- `GOOGLE_OAUTH_SCOPES`
- `GOOGLE_DEFAULT_CALENDAR_ID`

Sync:

- `SYNC_ENABLED`
- `SYNC_LOOKBACK_DAYS`
- `SYNC_FUTURE_DAYS`
- `SYNC_FREQUENCY_MINUTES`
- `SYNC_RUN_ON_STARTUP`
- `GOOGLE_SYNC_ENABLED`
- `SAVE_LAST_ICS`
- `STORE_RAW_PAYLOAD`
- `TIMEZONE`

## Tests

Commandes:

```bash
npm run lint
npm test
npm run build
```

Tests utiles présents:

- mapping MyGES
- mapping myEfrei
- parsing descriptions structurées
- exclusion ENSUP
- déduplication visible
- provider registry
- plan de sync idempotent

## Troubleshooting

`MYEFREI_SESSION_EXPIRED`

- le cookie est syntaxiquement accepté mais refusé par le portail
- reconnecte-toi dans le navigateur et recopie le header `Cookie`

`MYEFREI_ENDPOINT_NOT_CONFIGURED`

- le provider myEfrei n’a pas d’`agendaEndpoint`
- configure l’URL XHR JSON de l’agenda, ou utilise le flux ICS si tu travailles depuis le cache

`GOOGLE_NOT_CONFIGURED`

- configure Google OAuth dans `.env` ou dans l’interface `/google`

`EADDRINUSE`

- un autre service écoute déjà sur le port demandé
- en local, lance par exemple `PORT=3001 APP_BASE_URL=http://localhost:3001 npm start`

Base SQLite dupliquée (`prisma/data/app.db`)

- la base réelle de l'application vit à `./data/app.db` (voir `DATABASE_URL` dans `.env`), résolue par rapport à la racine du dépôt
- ne lance jamais `npx prisma studio` / `npx prisma migrate dev` sans `DATABASE_URL` explicitement défini en absolu: Prisma résout un chemin relatif dans `schema.prisma` par rapport au dossier `prisma/`, pas à la racine, ce qui recrée une base fantôme sous `prisma/data/`
- si ce fichier réapparaît, il peut être supprimé sans risque (il n'est jamais lu par l'application)
