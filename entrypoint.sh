#!/bin/sh
set -e

# Exécutez votre script de synchronisation immédiatement
/app/sync_calendar.sh

# Démarrez crond en arrière-plan
crond -f -d 8 &

# Gardez le conteneur en vie
tail -f /dev/null
