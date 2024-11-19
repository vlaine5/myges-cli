# Build stage
FROM node:18-alpine AS builder

# Installation des dépendances de build
RUN apk add --no-cache python3 py3-pip git

# Création du répertoire de travail
WORKDIR /build

# Installation et sauvegarde de myges avec npm pack
RUN npm install -g myges && \
    cd /usr/local/lib/node_modules && \
    npm pack myges && \
    mv myges-*.tgz /build/myges.tgz

# Runtime stage
FROM node:18-alpine

# Installation des dépendances nécessaires
RUN apk add --no-cache \
    python3 \
    py3-pip \
    tzdata \
    dcron \
    tini \
    expect

# Configuration du timezone
ENV TZ=Europe/Paris

# Création des répertoires
WORKDIR /app
RUN mkdir -p /app/data

# Installation des dépendances Python
RUN python3 -m venv /app/venv && \
    . /app/venv/bin/activate && \
    pip install --no-cache-dir icalendar pytz

# Copie des fichiers
COPY --from=builder /build/myges.tgz /app/
COPY fetch_full_agenda.py /app/
COPY sync_calendar.sh /app/
COPY entrypoint.sh /app/
COPY crontab /etc/crontabs/root

# Installation de myges depuis le package
RUN npm install -g /app/myges.tgz && \
    rm /app/myges.tgz

# Permissions
RUN chmod +x /app/sync_calendar.sh /app/entrypoint.sh

# Configuration de l'entrée
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/entrypoint.sh"]
