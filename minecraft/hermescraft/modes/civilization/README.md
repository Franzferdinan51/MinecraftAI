# Civilization mode configuration

This is the complete upstream seven-character cast, wired to the same
controller schema and the fleet's switchable `ornith-1.5-9b` model:
Marcus, Sarah, Jin, Dave, Lisa, Tommy, and Elena. Each gets an isolated
Hermes profile and body port `:3021`–`:3027`.

The configuration is **not active by default**. Landfolk remains the live
personal-world mode. To activate Civilization safely, first provision seven
separate bot bodies and Hermes profiles, apply the same 26.2 fixture canary,
then run the controller with this file:

```bash
minecraft/minion-controller/start.sh minecraft/hermescraft/modes/civilization/config.json
```

Do not point it at the active Landfolk ports. The WebUI catalog marks this
mode `profile-ready` until those seven isolated bodies are provisioned.
The upstream social behavior is in `../civilization/SOUL-civilization.md`
and the adapted character references are beside it.
