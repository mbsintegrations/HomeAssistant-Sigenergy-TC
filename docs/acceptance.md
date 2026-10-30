# Release validation

The validation workflow runs synthetic backend/frontend tests and official Hassfest/HACS checks. See the [live checks](https://github.com/mbsintegrations/Sigenergy-TC/actions/workflows/validate.yml), [alpha test guide](alpha-testing.md), and [capability matrix](compatibility.md).

Backend tests exercise transport errors, rate limits, partial acceptance/lost responses, restart recovery, immutable identities, owner priority, SOC/power bounds, expiry, export restrictions, DST/overnight scheduling, conflict detection and competing TC writers. Frontend tests exercise cards, charts, navigation, data normalization, availability, forms and control bindings. Browser examples check desktop, tablet and phone rendering without horizontal overflow or JavaScript errors.

HA Test validation keeps plant writes locked and checks native setup, service registration, module resources, independently running read sources and the optional notification blueprint. No software test or isolated readback proves real-world plant control. Physical command acceptance remains pending invited owner testing.
