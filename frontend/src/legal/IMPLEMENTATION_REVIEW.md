# U.S. Legal and Data-Handling Implementation Review

**Reviewed:** October 24, 2026  
**Scope:** Repository-visible FlowSense frontend and backend behavior. This is an engineering inventory, not a legal opinion or certification of compliance.

## Observed product scope

- No signup, account, login, checkout, subscription, or payment collection flow was found. The reviewed forms connect a camera source and submit a human case review; they are operator workflows, not consumer purchase forms.
- The app persists view preferences in `localStorage`; no cookie-writing code, analytics SDK, ad pixel, or consent-management platform was found. A consent banner is not currently justified for first-party cookies because none were observed. Production proxies and third-party responses still need deployment-level inspection.
- The backend writes connected-camera configuration, mobility cases, camera-health state, observations, and acceptance evidence to SQLite. Camera analysis can also save short MP4 evidence clips. Repository defaults enable recording, cap video at 6 GB, and use automatic cleanup with a 24-hour age threshold for eligible clips; cleanup runs after recording operations or an explicit prune call and protects active-camera and operator-reviewed evidence. It is not a guaranteed maximum-retention period. Deployments may override settings and storage paths; saved cases, observations, and acceptance events have no automatic expiry in the inspected code. Production logs, access controls, backups, and deletion procedures remain operator decisions.
- The forms now require two independent choices, with adjacent links to the Terms of Service and Privacy Notice. On submission, the backend appends an event to SQLite with a server UTC timestamp, receipt UUID, form type, user-entered operator reference, explicit acceptance/acknowledgment, exact document version, and SHA-256 digest of each checked-in policy. The event omits IP address and browser fingerprint.
- The operator reference is self-reported. This product has no authenticated user account, verified employee identity, or cryptographic link between a named person and a browser session. The ledger makes the submitted choices and policy text traceable; it does not prove who was at the keyboard or prevent a privileged host administrator from changing the SQLite file. Production needs authenticated principal IDs, restricted append-only audit access, backups, and retention controls before relying on it as strong evidence.
- The event table blocks ordinary SQL `UPDATE` and `DELETE` operations with SQLite triggers. A privileged file/schema administrator can still bypass that protection. No public API is provided to read the operator references; authorized deployment staff can inspect `policy_acceptance_events` in the configured `mobility_cases_{CITY_PROFILE}.sqlite3` database. Restrict database access and export evidence under the operator’s own access controls.

Authorized deployment staff can retrieve the evidence rows from that SQLite database with:

```sql
SELECT receipt_id, accepted_at, form_type, operator_reference,
       terms_accepted, terms_version, terms_sha256,
       privacy_acknowledged, privacy_version, privacy_sha256,
       capture_method, actor_identity_strength
FROM policy_acceptance_events
ORDER BY accepted_at, receipt_id;
```

## Source, image, and data rights

- The twelve FlowSense PNG logo variants under `frontend/public/brand/` were SHA-256 compared with the same-named files supplied by the requester and match byte-for-byte. This verifies file provenance, not copyright or trademark ownership. No assignment, license, or creator permission record was supplied. Confirm rights and retain written authorization before public or commercial use; see [the asset inventory](../BRANDING.md).
- OpenStreetMap data is made available under ODbL and the map currently displays attribution. The standard tile server is a separate best-effort service with its own usage policy; commercial deployments should confirm capacity, attribution, caching, and identifying request requirements or use a contracted tile provider. [OSM copyright](https://www.openstreetmap.org/copyright) · [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
- OpenTopoMap’s published terms state that its map tiles/style use CC-BY-SA and require visible attribution; the terrain layer displays `OpenStreetMap · SRTM | OpenTopoMap (CC-BY-SA)`. Preserve that credit, confirm current tile-service usage/capacity terms, and review share-alike duties before redistributing rendered maps. The repository does not contain a project-specific permission or a saved copy of the provider’s current terms. [OpenTopoMap terms](https://opentopomap.org/about)
- Caltrans’ public camera directory links to conditions of use and says video/stills are not retained or archived by Caltrans. Its conditions state that third-party material may need separate permission. Caltrans Traffic Operations Program Policy 97-1 describes a subscription agreement for direct access and commercial traffic-information or entrepreneurial uses. Publicly reachable URLs therefore do not establish FlowSense’s rights to reproduce, retain, analyze, or commercialize feeds. Obtain confirmation/authorization for the actual use and feed. [Caltrans camera directory](https://cwwp2.dot.ca.gov/vm/streamlist.htm) · [Conditions of use](https://dot.ca.gov/conditions-of-use) · [Policy TOPP 97-1](https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/memos-letters/97-1-topd-a11y.pdf)
- No other bundled photographic or illustration assets were identified in the product UI; map tiles and live video are externally served sources, not project-owned image files.

## U.S. legal areas for operator counsel

- FTC Act and sector laws can govern deceptive privacy promises and reasonable data safeguards. The FTC’s business guidance recommends inventorying information, collecting only what is needed, securing it, and disposing of it when no longer needed. [FTC data-security guidance](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
- California CCPA/CPRA applicability depends on the operator’s status, thresholds, and processing; the product repository cannot determine coverage. If applicable, the operator needs accurate collection/use notices, rights workflows, vendor contracts, security and retention procedures, and any relevant sale/share opt-out and preference-signal controls. [CPPA current laws and thresholds](https://cppa.ca.gov/regulations/)
- COPPA is conditional on a child-directed service or actual knowledge of personal-information collection from a child under 13. This professional operations UI is not designed for children; reassess if the product or audience changes. [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- ROSCA and state auto-renewal laws need review if online subscriptions are added; ROSCA requires clear material terms before billing information, express informed consent before charges, and a simple way to stop recurring charges. The FTC merchandise rule covers promised shipment and delayed-order refunds; it does not create a universal five-business-day cancellation right for U.S. software. [FTC ROSCA guidance](https://www.ftc.gov/business-guidance/blog/2020/09/10-million-abcmouse-settlement-avoiding-auto-renewal-traps) · [FTC merchandise rule](https://www.ftc.gov/legal-library/browse/rules/mail-internet-or-telephone-order-merchandise-rule)
- State privacy, breach-notification, biometric, surveillance, consumer-protection, accessibility, and contract rules can depend on users, customer type, deployment, and processing. Counsel must scope the actual markets and data.

## Launch blockers

1. Identify the legal operator/seller, business address, privacy/billing contacts, governing terms, and any customer-specific data-processing roles.
2. Get written authorization for the actual Caltrans feeds used; verify OpenTopoMap tile-service terms and share-alike duties; preserve logo ownership/license evidence.
3. Define the real hosting, authentication, access controls, encryption, log/clip/case retention, deletion, backups, and incident-response procedures; make notices match those facts.
4. Replace self-reported operator identifiers with authenticated identity claims if acceptance events must prove a specific individual accepted. Restrict and protect audit exports and define retention.
5. Re-scan the deployed site, including cookies and third-party response headers, and scope state privacy and subscription laws before enabling analytics or payments.

## Primary sources consulted

- [CPPA laws and current monetary thresholds](https://cppa.ca.gov/regulations/)
- [FTC data-security guide](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [FTC Mail, Internet, or Telephone Order Merchandise Rule](https://www.ftc.gov/legal-library/browse/rules/mail-internet-or-telephone-order-merchandise-rule)
- [FTC ROSCA subscription guidance](https://www.ftc.gov/business-guidance/blog/2020/09/10-million-abcmouse-settlement-avoiding-auto-renewal-traps)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [OpenTopoMap terms and attribution](https://opentopomap.org/about)
- [Caltrans Conditions of Use](https://dot.ca.gov/conditions-of-use)
- [Caltrans camera feed directory and use notice](https://cwwp2.dot.ca.gov/vm/streamlist.htm)
- [Caltrans Traffic Operations Program Policy 97-1](https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/memos-letters/97-1-topd-a11y.pdf)
