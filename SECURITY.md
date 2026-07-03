# Security Policy

## Scope

This repository is part of MADSuite. The active `main` branch is the supported branch unless project documentation says otherwise.

## Contact

For security concerns, contact the project maintainer privately instead of publishing sensitive details in a public issue.

Include the affected repository, file or route, reproduction steps, expected impact, and logs with private values removed.

## Secrets

Never commit real `.env` files, API keys, database credentials, JWT secrets, payment secrets, customer data, production logs, or private project notes.

If a private value is committed by mistake, rotate it.

## Privacy

MADSuite is a management and non-medical cognitive assistance product.

Features involving cognitive, behavioral, or activity signals must be reviewed against `bleeband/SYSTEME_MAD` before release.

Default exclusions: camera, microphone, permanent screen capture, raw keylogging, biometrics, emotion reading, medical inference, external profiling, comparison between users, and normality scoring.

## Source of truth

```text
bleeband/SYSTEME_MAD
```
