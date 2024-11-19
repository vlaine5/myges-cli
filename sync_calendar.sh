#!/bin/sh

. /app/venv/bin/activate

echo "Tentative de connexion à MyGES..."

if [ -z "$MYGES_USERNAME" ] || [ -z "$MYGES_PASSWORD" ] || [ -z "$GOOGLE_CALENDAR_ID" ]; then
    echo "Erreur : Variables d'environnement manquantes"
    exit 1
fi

expect << EOF
spawn myges login
expect "Username:"
send "$MYGES_USERNAME\r"
expect "Password:"
send "$MYGES_PASSWORD\r"
expect eof
EOF

if myges agenda > /dev/null 2>&1; then
    echo "Connexion à MyGES réussie"
else
    echo "Échec de la connexion à MyGES"
    exit 1
fi

echo "Exécution du script Python..."
#python /app/explore_api.py
python /app/fetch_full_agenda.py

echo "Génération du fichier ICS terminée"

# Désactiver l'environnement virtuel
deactivate
