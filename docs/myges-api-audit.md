# Audit de l'API MyGES (Kordis) — surface exploitable hors calendrier

> Date : 2026-10-24 · Portée : **lecture seule**, aucune modification effectuée sur le compte MyGES.
> Méthode : reverse de l'auth + inventaire des endpoints à partir du code du projet
> (`src/modules/providers/myges.provider.ts`) et du client open-source faisant autorité
> `quantumsheep/myges-cli` (fichier `src/ges-api.ts`), croisé avec le package npm `myges@4.7.1`
> (code identique). Tentative de probe live effectuée (voir §1).

---

## 0. Mise à jour 2026-10-25 — compte **enseignant** (lu en live)

Connexion live réussie (`302`, token `bearer`, ~48 h) avec le mot de passe corrigé (celui du `.env`
différait d'une majuscule). Le compte a le rôle **enseignant** ; les droits dépendent du rôle :

| Endpoint | Compte enseignant |
|---|---|
| `GET /me/profile` | ✅ 200 — `civility, firstname, name, email, years, u_id, uid, is_temp…` |
| `GET /me/years` | ✅ 200 — `[2026, 2025, 2024, 2023, 2022, 2021, 2007]` |
| `GET /me/{year}/courses` | ✅ 200 — cours **enseignés** : `name, teacher, coef, ects, nb_students, student_group_name, rc_id, has_grades, has_documents, syllabus_id, trimester…` |
| `GET /me/{year}/grades` | ❌ **418** « Cette ressource n'est pas utilisable par ce rôle utilisateur » |
| `GET /me/{year}/absences` | ❌ 418 |
| `GET /me/{year}/projects` | ❌ 418 |
| `GET /me/nextProjectSteps` | ❌ 418 |

⇒ Les sections ci-dessous sur notes/absences/projets s'appliquent aux **comptes étudiants** seulement.
L'annonce « identifiant Skolae » de la page CAS vise aussi les étudiants ; l'ancien identifiant reste valide pour les enseignants.

### Deux back-ends distincts (important)

| | `api.kordis.fr` (API mobile OAuth) | `myges.fr/teacher/*` (site web) |
|---|---|---|
| Auth | Token Bearer (utilisé par cette app) | Cookie de session (login CAS) |
| Techno | REST JSON (`{ result }`) | **JSF / PrimeFaces** (postbacks + `javax.faces.ViewState`) |
| Saisie de notes | ❌ absente pour le rôle enseignant | ✅ `/teacher/student-evaluation` |

**Saisie de notes (prof) = JSF, pas une API REST.** Le formulaire `contactsForm` poste sur
`/teacher/student-evaluation` avec le ViewState et des IDs auto-générés
(`contactsForm:studentEvalWidget:matiereEvalTable:0:j_idt265`) qui changent à chaque déploiement.
Colonnes de la grille : Semestre, Matière, Formation, Session, Étudiants, **Notes de contrôle continu,
Exam, Validées, En attente de validation**, Com., Nom, Prénom, Ajouter. Les notes saisies restent
**« en attente de validation administration »**. ⇒ un import CSV→notes n'est possible que par
**automatisation de navigateur** (fragile), pas par un POST JSON stable. Non implémenté (lecture seule).

Menu enseignant (`Pédagogie`) : Informations annuelles `/teacher/annual-information`, Supports de cours
`/teacher/courses-files`, Syllabus `/teacher/syllabus-list`, **Saisie des notes** `/teacher/student-evaluation`,
Projets `/common/project-list`, TP `/common/practical-list`, Trombinoscope étudiants
`/teacher/student-directory`, Trombinoscope intervenants `/teacher/teacher-directory`,
Plannings `/teacher/planning-calendar`.

**Implémenté dans l'app (lecture seule) :** onglet **Mes cours** (`GET /me/{year}/courses`), qui marche
pour le rôle enseignant. L'onglet Notes reste en code (route `/grades`) pour les comptes étudiants mais
n'est plus dans la barre de navigation.

---

## 1. Statut d'accès au moment de l'audit (2026-10-24)

L'API est **joignable** (TLS, CORS ouvert `*`, backend Tomcat derrière Kordis) mais les
identifiants ne permettent **pas** de s'authentifier actuellement :

| Source d'identifiants | Résultat |
|---|---|
| `.env` (`MYGES_USERNAME` / `MYGES_PASSWORD`, plaintext) | **401 Unauthorized** (mot de passe périmé — cohérent avec « je les changerai plus tard ») |
| `data/app.db` → `AcademicProviderCredential.passwordEncrypted` | **Non déchiffrable** (l'`APP_SECRET` courant ne correspond plus à celui ayant chiffré la base) |
| `data/app.db` → `accessToken` stocké | **Expiré** (expiration ≈ avril 2026) |

> Je n'ai **pas** insisté sur l'endpoint d'auth pour éviter un verrouillage du compte.
> Le username en base == celui du `.env` (6 car.), donc c'est bien **le mot de passe** qui est à renouveler.
> Dès que tu mets à jour `MYGES_PASSWORD`, le script §8 cartographie tout en live en < 10 s.

La cartographie ci-dessous ne dépend pas de l'accès live : elle vient du code source du client
officiel (mêmes `base URL`, flux d'auth et endpoints que ceux déjà câblés dans ce projet, ce qui
la valide par recoupement — `/me/profile` et `/me/agenda` sont identiques des deux côtés).

---

## 2. Authentification (flux complet)

- **Autorisation** : `GET https://authentication.kordis.fr/oauth/authorize?response_type=token&client_id=skolae-app`
  - En-tête `Authorization: Basic base64(username:password)`
  - OAuth 2.0 **implicit grant**. La réponse est une **redirection 302** dont l'en-tête `Location`
    pointe vers `comreseaugesskolae://...#access_token=...&token_type=...&expires_in=...&scope=...&uid=...`
    (schéma d'URL de l'app mobile Skolae). On **ne suit pas** la redirection (`redirect: manual`) ;
    on parse le **fragment** de `Location`.
  - 401 + `WWW-Authenticate: Basic realm` = identifiants rejetés.
- **Appels API** : `Authorization: <token_type> <access_token>` (généralement `Bearer`).
  - `uid` renvoyé = identifiant numérique de l'utilisateur (sert à repérer « mon » groupe projet).
  - `expires_in` ≈ durée de vie du token ; à rafraîchir en rejouant l'autorisation.
- **Base API** : `https://api.kordis.fr`
- **Enveloppe de réponse** : tout le JSON utile est dans `{ "result": ... }` — il faut lire `.result`.

Réf. projet : `src/modules/providers/myges.provider.ts:23-26` (URLs), `:60-74` (login), `:81-106` (requête + enveloppe).

---

## 3. Inventaire complet des endpoints

Légende accès : 🟢 lecture (GET, sans effet) · 🔴 écriture (POST/DELETE — **hors périmètre read-only, ne pas appeler**).

| # | Accès | Méthode & chemin | Fonctionnalité | Renvoie |
|---|---|---|---|---|
| 1 | 🟢 | `GET /me/years` | Années académiques inscrites | liste d'années (`"2024"`, `"2025"`…) — **clé de toutes les routes `{year}`** |
| 2 | 🟢 | `GET /me/profile` | Profil complet de l'étudiant | identité, `uid`, promo/classe, campus, cursus |
| 3 | 🟢 | `GET /me/agenda?start=<ms>&end=<ms>` | Agenda (bornes en epoch ms) | cours : salles **géolocalisées**, prof, discipline, effectif, modalité, émargement |
| 4 | 🟢 | `GET /me/{year}/absences` | Absences & retards de l'année | liste d'absences (justifiées/non, dates, cours) |
| 5 | 🟢 | `GET /me/{year}/grades` | **Notes / bulletins** de l'année | notes par matière, coef, ECTS, trimestre |
| 6 | 🟢 | `GET /me/{year}/courses` | Matières/cours suivis l'année | disciplines, profs, coef, ECTS, groupes |
| 7 | 🟢 | `GET /me/{year}/projects` | Projets de l'année | liste de projets (id, nom, cours) |
| 8 | 🟢 | `GET /me/projects/{id}` | Détail d'un projet | groupes, membres, étapes, fichiers, consignes, logs |
| 9 | 🟢 | `GET /me/nextProjectSteps` | Prochaines échéances projets (toutes années) | étapes à venir : type, date limite, projet, cours |
| 10 | 🟢 | `GET /me/projectGroups/{projectGroupId}/messages` | Messagerie de groupe projet (lecture) | messages (auteur, date, contenu) |
| 11 | 🔴 | `POST /me/courses/{rcId}/projects/{projectId}/groups/{groupId}` | **Rejoindre** un groupe de projet | — *(écriture, exclu)* |
| 12 | 🔴 | `DELETE /me/courses/{rcId}/projects/{projectId}/groups/{groupId}` | **Quitter** un groupe de projet | — *(écriture, exclu)* |
| 13 | 🔴 | `POST /me/projectGroups/{projectGroupId}/messages` | **Envoyer** un message de groupe | — *(écriture, exclu)* |
| 14 | 🟢/🔴 | `request <method> <url>` (passe-partout) | Appel brut vers **n'importe quel** chemin `api.kordis.fr` | selon endpoint |

Réf. endpoints : `quantumsheep/myges-cli` `src/ges-api.ts` (méthodes `getYears`/`getProfile`/`getAgenda`/`getAbsences`/`getGrades`/`getCourses`/`getProjects`/`getProject`/`getNextProjectSteps`/`getProjectGroupMessages` + join/quit/send).
Le passe-partout `request` (`src/commands/request.ts`) prouve que **toute** route Kordis est atteignable avec le même bearer — utile pour sonder les endpoints non documentés (§7).

Ce projet n'exploite aujourd'hui que **#2 et #3** (`testConnection` → `/me/profile`, `fetchEvents` → `/me/agenda`). **Tout le reste (#1, #4–#10) est inexploité et disponible en lecture.**

---

## 4. Données exploitables, domaine par domaine (hors calendrier)

### 4.1 Profil — `GET /me/profile`
Identité et rattachement scolaire + le `uid` (indispensable pour les features projet). Permet une
page « mon compte » sans ressaisie, et sert de source d'identité pour la réconciliation multi-provider
déjà présente dans le projet.

### 4.2 Notes / bulletins — `GET /me/{year}/grades`  ⭐ fort potentiel
Notes par matière avec **coefficient, ECTS, trimestre**. Exploitation :
- calcul de **moyennes pondérées** (par matière / trimestre / année) et de **total ECTS validés** ;
- **relevé de notes** exportable (PDF/CSV) ;
- **alerte « nouvelle note »** par diff entre deux syncs ;
- historique pluriannuel (boucler sur `/me/years`).

### 4.3 Absences — `GET /me/{year}/absences`  ⭐
Absences/retards justifiés ou non. Exploitation : compteur d'absences, **alerte seuil** (risque
d'exclusion/rattrapage), corrélation avec l'agenda (quel cours manqué).

### 4.4 Cours / maquette — `GET /me/{year}/courses`
Disciplines suivies, profs, coef, ECTS, groupes. Exploitation : **maquette pédagogique** de l'année,
jointure avec notes (matières notées vs non), et avec l'agenda (`discipline.rc_id`).

### 4.5 Projets — `GET /me/{year}/projects`, `GET /me/projects/{id}`, `GET /me/nextProjectSteps`  ⭐
Objet projet très riche (cf. `interfaces/project.interface.ts`) : **étapes avec dates limites**,
**fichiers déposés** (`psf_file`, taille, hash, type), consignes complètes (objectifs, outils,
durée de soutenance, min/max par groupe), **groupes + membres** (nom, promo, option, classe, `u_id`),
**journal d'actions** du groupe, commentaires enseignant. Exploitation :
- **échéancier projets** unifié (via `/me/nextProjectSteps`) → rappels/notifications, et même des
  **events calendrier** « deadline projet » (extension naturelle du calendrier existant) ;
- vue « mon groupe / mes coéquipiers » ;
- suivi des **livrables** (fichiers attendus vs déposés).

### 4.6 Messagerie de groupe — `GET /me/projectGroups/{id}/messages` (lecture)
Fil de discussion par groupe de projet : archivage/lecture consolidée. *(L'envoi #13 est une écriture, exclue.)*

### 4.7 Agenda — rappel des champs riches **au-delà des heures de cours**
`/me/agenda` renvoie bien plus qu'un créneau (cf. `interfaces/agenda.interface.ts`) :
- **salles géolocalisées** : `room.name`, `floor`, `campus`, **`latitude`/`longitude`**, `color` → carte/itinéraire ;
- **discipline** : prof (`teacher` + `teacher_id`), `coef`, `ects`, **`nb_students`** (déjà utilisé comme `studentCount`), `student_group_name`, `trimester`, flags **`has_documents`/`has_grades`/`syllabus_id`** ;
- `modality`, `prestation_type`, `type`, `state`, **`is_electronic_signature`** (émargement électronique).
→ Même sans nouvel endpoint, l'agenda permet : carte des salles, charge par prof/promo, détection
des cours à émargement, et repérage des cours **ayant des documents/notes** (les flags pointent vers §7).

---

## 5. Idées de features concrètes à brancher sur l'existant

| Feature | Endpoint(s) | Effort |
|---|---|---|
| Page **Notes & moyennes** (par trimestre/année, ECTS, alertes nouvelles notes) | #1 + #5 | moyen |
| **Suivi d'absences** + alerte seuil | #1 + #4 | faible |
| **Échéancier projets** → notifications + events calendrier « deadline » | #9, #7, #8 | moyen |
| **Maquette pédagogique** de l'année (cours/coef/ECTS) | #1 + #6 | faible |
| **Carte des salles** (lat/long déjà dans l'agenda) | #3 | faible |
| **Profil** sans ressaisie + identité pour réconciliation | #2 | faible |
| Archivage **messagerie de groupe** (lecture) | #10 | faible |

Point d'ancrage dans le code : ajouter des méthodes au `MyGesProvider` sur le modèle de
`fetchEvents`/`testConnection` (même `requestWithCredentials`, même refresh de token) —
`src/modules/providers/myges.provider.ts:220-231`.

---

## 6. Écriture = hors périmètre (ne pas appeler)

Endpoints **#11, #12, #13** modifient le compte (rejoindre/quitter un groupe, poster un message).
Ils sont documentés ici pour exhaustivité mais **n'ont pas été appelés** et ne doivent pas l'être
tant que l'audit est en lecture seule.

---

## 7. Endpoints plausibles NON confirmés (à sonder dès que les creds sont à jour)

Le modèle de données **révèle des ressources** probablement servies par d'autres routes, non câblées
dans le client open-source. **Hypothèses à vérifier** (GET only) via le script §8 :

- **Documents de cours** — suggéré par `discipline.has_documents` / `syllabus_id`.
  Candidats : `/me/{year}/{rc_id}/documents`, `/me/courses/{rc_id}/documents`, `/me/{year}/syllabus/{syllabus_id}`.
- **Notes par cours** — suggéré par `discipline.has_grades`. Candidat : `/me/courses/{rc_id}/grades`.
- **Trombinoscope / classe** — l'app Skolae l'expose. Candidats : `/me/{year}/trombi`, `/me/classes`, `/me/{year}/students`.
- **Actualités / infos école**. Candidats : `/me/news`, `/me/actualites`.
- **Téléchargement de fichier projet** — `ProjectFile.psf_file` est un nom de fichier ; endpoint de download probable `/me/projectGroups/{pgr_id}/files/{psf_id}` ou similaire.

> Ce sont des **pistes déduites des formes de données**, pas des endpoints vérifiés. À confirmer live.

---

## 8. Script de probe live (prêt à l'emploi, GET only)

Dès que `MYGES_PASSWORD` est à jour dans `.env`, lancer :

```bash
node scripts/myges-api-probe.mjs
```

Le script (voir `scripts/myges-api-probe.mjs`) : (1) s'authentifie, (2) lit `/me/years` et `/me/profile`,
(3) sonde en **GET uniquement** les endpoints confirmés #1–#10 pour chaque année, (4) teste les
candidats §7 et reporte `200 / 404 / 403`, (5) écrit un dump redacté dans `data/exports/`.
Aucune route d'écriture n'est appelée.

---

## 9. Références

- Code projet — provider : `src/modules/providers/myges.provider.ts`
- Client API faisant autorité : https://github.com/quantumsheep/myges-cli/blob/master/src/ges-api.ts
- Interfaces de données : `.../src/interfaces/agenda.interface.ts`, `.../src/interfaces/project.interface.ts`
- Package npm (code identique) : https://www.npmjs.com/package/myges (v4.7.1)
- Auth : `https://authentication.kordis.fr/oauth/authorize?response_type=token&client_id=skolae-app`
- Base API : `https://api.kordis.fr` (enveloppe `{ result }`)
