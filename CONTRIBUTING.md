# Contributing

Sigenergy TC is currently an invitation-only Alpha. Discuss changes in an issue before substantial implementation. Do not submit credentials or raw native account/journal data. Use synthetic fixtures with neutral identities and preserve third-party notices.

Use Python3.14 and Node24. Install `requirements-dev.txt`; run `python -m pytest -q`, `ruff check custom_components tests tools`, and `npm test`. Official Hassfest and HACS checks must pass without ignores. Do not run tests against a real plant by default.

Maintain closed write allowlists, immutable plant binding, finite limits, admin checks, durable write-ahead recovery and owner priority. Never add arbitrary endpoint/register services or blind retries. Cover failure-after-acceptance, restart, owner supersession and invalid telemetry for control changes. Keep source availability independent.

Preserve accepted dashboard styling; test phone/tablet/desktop widths and all scene variants. Update behavior documentation, capability matrix, changelog and relevant screenshots together with each change. Pull requests should describe the user-visible result and actual validation. Software tests are not physical acceptance.
