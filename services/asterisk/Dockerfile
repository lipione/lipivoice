FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends asterisk gettext-base ca-certificates jq sqlite3 \
  && rm -rf /var/lib/apt/lists/*

COPY services/asterisk/pjsip.conf.template /etc/asterisk/pjsip.conf.template
COPY services/asterisk/extensions.conf /etc/asterisk/extensions.conf
COPY services/asterisk/entrypoint.sh /usr/local/bin/lipivoice-asterisk-entrypoint

RUN chmod +x /usr/local/bin/lipivoice-asterisk-entrypoint

ENTRYPOINT ["/usr/local/bin/lipivoice-asterisk-entrypoint"]
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
