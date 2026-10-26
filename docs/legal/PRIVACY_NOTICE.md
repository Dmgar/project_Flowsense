# FlowSense Privacy Notice

**Version:** 2026-10-24  
**Effective date:** October 24, 2026  
**Status:** U.S.-focused baseline for operator review. The legal entity, privacy contact, production hosting, and log-retention schedule have not been configured. The deployment operator must complete those details before production use.

## 1. Who operates this service

FlowSense is software for mobility operations. This repository does not identify the legal entity that operates a particular deployment. That deployment operator determines the purposes and means of processing and is responsible for answering privacy requests and providing a working privacy contact. Ask the organization that provided access to this instance for that contact.

## 2. Information processed

Depending on how the operator configures the service, FlowSense processes:

- Camera names, stream addresses, and map coordinates entered when an operator connects a source. Do not include credentials in a URL.
- Case status, responsible team, review notes, source references, frame references, and timestamps needed to maintain an operational review history.
- Camera frames and derived object-class detections. A frame can incidentally show people or vehicle plates. FlowSense does not promise that faces or plates are blurred or that a person cannot be identified in source video.
- Timestamped camera observations and short MP4 evidence clips linked to camera sessions and detected tracks. When a camera-analysis session runs, evidence recording is enabled by default in this repository. The default cleanup setting targets eligible, unreviewed clips after 24 hours and the default video quota is 6 GB. Cleanup runs with recording/pruning operations, protects clips for active cameras and operator-reviewed tracks, and is not a guaranteed maximum-retention period. Deployments can change these settings and storage locations.
- A self-reported operator name or staff identifier and the two explicit policy choices submitted from camera-connection and case-review forms. The acceptance ledger stores the submission time, form, policy version and SHA-256 digest, and receipt ID. There is no account login or identity verification in this deployment; a self-reported identifier is not proof of civil identity.
- Browser preferences such as theme, selected time range, map layers, and saved camera or corridor references in `localStorage` on that browser. The app does not use browser cookies for analytics, advertising, or login.
- Network and request metadata handled by the deployment host, reverse proxy, browser, and third-party services. Actual server log fields, access, location, and retention depend on the operator’s hosting configuration and are not established by this repository.

## 3. Purposes and sharing

The operator uses this information to display map and video sources, analyze visible traffic objects, save and review mobility cases, maintain operator-submitted policy acceptance evidence, troubleshoot the service, and protect system security. The browser requests map tiles from OpenStreetMap and OpenTopoMap and requests video from the selected source provider, including Caltrans where configured. Those providers receive the network requests needed to deliver their content and apply their own terms and privacy practices. The deployment may also expose requests to its hosting and infrastructure providers. This repository contains no advertising or analytics integration.

The browser keeps limited preferences in `localStorage`; those are not browser cookies. Saved cases, connected-camera configuration, video-health records, observations, and policy acceptance evidence are stored by the backend in configured SQLite storage; video clips are kept in the configured evidence directory. The repository has no general expiry for saved cases, observations, or acceptance events, and does not establish production backup, deletion-request, or access-control procedures. The operator must set and publish those controls and verify actual runtime settings.

## 4. Choices and requests

You can clear browser-local preferences through your browser’s site-data controls. For requests to access, correct, delete, or otherwise exercise privacy rights over server-side records, contact the deployment operator. A contact channel is not configured in this build. Rights and response deadlines depend on the operator, the data, and applicable law; this notice does not promise that a particular law covers every deployment.

## 5. California and other U.S. privacy laws

California’s CCPA/CPRA applies only to entities and processing that meet statutory scope and thresholds. This software does not establish whether its operator is a covered business, service provider, or contractor. If applicable, the operator must provide the required notices, rights, response process, contract terms, and opt-out mechanisms. Other state privacy statutes may apply depending on the operator, users, and processing. The operator must assess its actual business and data flows before deployment.

## 6. Children

This professional mobility-operations workspace is not designed or directed to children under 13. The operator must follow COPPA if it later directs a service to children or obtains actual knowledge that it collects personal information from children under 13.

## 7. Security and updates

The operator is responsible for deployment security, access controls, backups, incident response, data minimization, and deletion. The notice must be updated when actual data practices or the responsible legal entity change. This repository cannot confirm production infrastructure settings.

## 8. Privacy contact

No legal entity, privacy email, postal address, or request portal is configured in this deployment. The organization providing access must publish a monitored privacy contact before production use.
