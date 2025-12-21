#!/bin/sh
set -e

# Execute the node server with all environment variables
exec node dist/index.js "$@"

