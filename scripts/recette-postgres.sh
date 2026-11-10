#!/usr/bin/env bash
# Recette SQL sur une base PostgreSQL JETABLE : applique toutes les migrations puis rejoue le jeu d'essai flotte.
# Usage : PGHOST=... PGPORT=5432 PGUSER=postgres ./scripts/recette-postgres.sh [nom_base]   (la base est créée puis détruite)
set -euo pipefail
DB="${1:-recette_mp}"; cd "$(dirname "$0")/.."
psql -d postgres -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in $(ls migrations/*.sql | sort); do psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "ECHEC migration $f"; exit 1; }; done
echo "OK : $(ls migrations/*.sql | wc -l) migrations appliquées"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/recette_fleet_seed.sql && echo "OK : jeu d'essai flotte chargé"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/recette_tanks_seed.sql && echo "OK : jeu d'essai cuves chargé"
psql -d "$DB" -At -c "SELECT count(*) FROM fleet_card_events WHERE kind='use'" | sed 's/^/prises carte : /'
psql -d postgres -qc "DROP DATABASE $DB"
