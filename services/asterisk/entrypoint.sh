#!/bin/sh
set -eu

: "${ASTERISK_SIP_BIND_PORT:=5062}"
: "${LIPIVOICE_DB_PATH:=/app/data/lipivoice.sqlite}"

load_from_db() {
  [ -f "$LIPIVOICE_DB_PATH" ] || return 0

  settings_json="$(sqlite3 "$LIPIVOICE_DB_PATH" "SELECT data FROM settings WHERE id = 'workspace_settings' LIMIT 1;" 2>/dev/null || true)"
  secret_json="$(sqlite3 "$LIPIVOICE_DB_PATH" "SELECT data FROM secrets WHERE id = 'sip_trunk_password' LIMIT 1;" 2>/dev/null || true)"

  [ -n "${NTC_SIP_SERVER:-}" ] || export NTC_SIP_SERVER="$(printf '%s' "$settings_json" | jq -r '.sipTrunk.sipServer // empty')"
  [ -n "${NTC_OUTBOUND_PROXY:-}" ] || export NTC_OUTBOUND_PROXY="$(printf '%s' "$settings_json" | jq -r '.sipTrunk.outboundProxy // empty')"
  [ -n "${NTC_SIP_USERNAME:-}" ] || export NTC_SIP_USERNAME="$(printf '%s' "$settings_json" | jq -r '.sipTrunk.username // empty')"
  [ -n "${NTC_SIP_AUTH_USERNAME:-}" ] || export NTC_SIP_AUTH_USERNAME="$(printf '%s' "$settings_json" | jq -r '.sipTrunk.authUsername // empty')"
  [ -n "${NTC_FROM_NUMBER:-}" ] || export NTC_FROM_NUMBER="$(printf '%s' "$settings_json" | jq -r '.sipTrunk.fromNumber // empty')"
  [ -n "${NTC_SIP_PASSWORD:-}" ] || export NTC_SIP_PASSWORD="$(printf '%s' "$secret_json" | jq -r '.value // empty')"
}

load_from_db

: "${NTC_SIP_SERVER:=ims.ntc.net.np}"
: "${NTC_OUTBOUND_PROXY:=202.70.74.178:5060}"

required_vars="NTC_SIP_USERNAME NTC_SIP_AUTH_USERNAME NTC_SIP_PASSWORD NTC_FROM_NUMBER"
for var_name in $required_vars; do
  eval "var_value=\${$var_name:-}"
  if [ -z "$var_value" ]; then
    echo "Missing required environment variable: $var_name" >&2
    echo "Set SIP trunk details in the LipiVoice admin panel, save the SIP password, then restart this service." >&2
    exit 1
  fi
done

envsubst < /etc/asterisk/pjsip.conf.template > /etc/asterisk/pjsip.conf

exec "$@"
