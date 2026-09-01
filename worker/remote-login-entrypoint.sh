#!/bin/sh
set -eu

password=${PONISHA_REMOTE_LOGIN_PASSWORD:-}
case "$password" in
  ????????) ;;
  *)
    echo "PONISHA_REMOTE_LOGIN_PASSWORD must contain exactly 8 characters" >&2
    exit 1
    ;;
esac

ttl=${PONISHA_REMOTE_LOGIN_TTL_MINUTES:-30}
case "$ttl" in
  *[!0-9]*|'')
    echo "PONISHA_REMOTE_LOGIN_TTL_MINUTES must be a number" >&2
    exit 1
    ;;
esac
[ "$ttl" -ge 5 ] || ttl=5
[ "$ttl" -le 60 ] || ttl=60

display=:99
vnc_password=/data/auth/.ponisha-vnc-passwd

runuser -u pwuser -- x11vnc -storepasswd "$password" "$vnc_password" >/dev/null 2>&1
chmod 0600 "$vnc_password"
chown pwuser:pwuser "$vnc_password"

cleanup() {
  trap - EXIT INT TERM
  for pid in ${websockify_pid:-} ${vnc_pid:-} ${browser_pid:-} ${wm_pid:-} ${xvfb_pid:-}; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -f "$vnc_password"
}
trap cleanup EXIT INT TERM

runuser -u pwuser -- Xvfb "$display" -screen 0 1440x900x24 -nolisten tcp > /data/state/xvfb.log 2>&1 &
xvfb_pid=$!
sleep 1

runuser -u pwuser -- env DISPLAY="$display" fluxbox > /data/state/fluxbox.log 2>&1 &
wm_pid=$!
runuser -u pwuser -- env DISPLAY="$display" node /app/worker/scripts/remote-login.mjs > /data/state/remote-login.log 2>&1 &
browser_pid=$!
runuser -u pwuser -- x11vnc -display "$display" -forever -shared -localhost -rfbport 5900 \
  -rfbauth "$vnc_password" -o /data/state/x11vnc.log &
vnc_pid=$!
runuser -u pwuser -- websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 \
  > /data/state/websockify.log 2>&1 &
websockify_pid=$!

echo "Temporary Ponisha login desktop is available for ${ttl} minute(s)"
sleep "$((ttl * 60))"
