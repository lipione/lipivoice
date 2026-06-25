# LipiVoice Asterisk SIP Gateway

This gateway is for SIP providers that require softphone-style registration. The NT Easy manual fits that shape, so Asterisk registers to NTC and LiveKit SIP talks to Asterisk locally.

## NT Easy values

- `NTC_SIP_SERVER=ims.ntc.net.np`
- `NTC_OUTBOUND_PROXY=202.70.74.178:5060`
- `NTC_SIP_USERNAME=+97760400011`
- `NTC_SIP_AUTH_USERNAME=+97760400011@ims.ntc.net.np`
- `NTC_FROM_NUMBER=+97760400011`
- `NTC_SIP_PASSWORD=<current-password>_Ntc1`

Use the real assigned phone number instead of the example number.

## Activation

The SIP stack is inactive by default. Start it only with the SIP override:

```sh
docker compose -f docker-compose.remote.yml -f docker-compose.sip.yml --profile sip up -d sip-redis livekit livekit-sip asterisk
```

The override enables Redis for LiveKit, starts LiveKit SIP, and starts Asterisk on UDP port `5062`. LiveKit SIP listens on UDP `5060`, so Asterisk intentionally does not bind that port.

## Call Path

```text
LipiVoice app -> LiveKit room -> LiveKit SIP -> Asterisk:5062 -> NTC IMS
```

Create the LiveKit outbound trunk to point at the local Asterisk gateway after the services are running. The admin panel stores SIP routing details and the password separately, but the Asterisk container still needs `NTC_SIP_PASSWORD` in the runtime environment when this profile is enabled.
