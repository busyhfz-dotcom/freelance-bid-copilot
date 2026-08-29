#!/bin/sh
set -eu

# Railway mounts persistent volumes after the image is built, so the mount
# inherits root ownership instead of the ownership prepared in the image.
mkdir -p /data/auth /data/state
chown -R pwuser:pwuser /data

exec runuser -u pwuser -- "$@"
