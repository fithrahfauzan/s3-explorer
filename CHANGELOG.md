# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the app image and the
Helm chart share a version.

## [1.1.0] - 2026-08-31

### Added
- **Static API tokens for external / programmatic access.** Any protected `/api`
  route now also accepts `Authorization: Bearer <token>` instead of a browser
  login session. Configured via `API_TOKEN_{N}_VALUE` /
  `API_TOKEN_{N}_RESTRICTED_MODE` (plus a no-index `API_TOKEN` fallback). Each
  token carries its own restricted-mode. Token comparison is constant-time with
  no early exit; tokens are never logged.
- `helm/README.md` — install/upgrade flow, ConfigMap vs Secret split, and
  managing secrets through a git-ignored `-f` value-override file instead of
  editing `values.yaml`; parameter table, IRSA and secret-rotation notes.

### Changed
- Auth is now resolved through a single `get_principal` dependency (session
  cookie tried first, then the bearer token); `require_auth` and
  `get_restricted_mode` both key off `settings.auth_configured()` (any login
  password **or** any API token).
- `README.md` — new Kubernetes/Helm section, reworked architecture diagram
  showing the external-API path and the auth layer, expanded Project Structure,
  clarified the `RESTRICTED_MODE` fallback wording.
- `.gitignore` ignores `*.secrets.yaml` / `*.secrets.yml`.

### Fixed
- A bearer-authenticated request no longer falls through to the global
  `RESTRICTED_MODE` default — it now honors the restricted-mode of the specific
  credential presented, matching how login profiles already behaved.

## [1.0.0] - baseline

### Added
- S3 Explorer web app: multi-bucket browsing with per-bucket scoped credentials
  (manual keys or boto3 default chain / IRSA), no global `s3:ListAllMyBuckets`.
- Direct presigned upload/download (bytes never transit the backend);
  drag-and-drop; "Get upload link" manual `PUT` flow with a ready-to-run `curl`.
- Restricted mode: delete disabled, browser upload disabled, manual upload link
  still available.
- Password login gate, then multi-profile login — each password with its own
  session `restricted_mode`, signed into an HMAC session cookie; login rate
  limiting.
- Region-specific S3 endpoint so presigned URLs work against opt-in regions.
- Helm chart for Kubernetes / OpenShift (Deployment, Service, ConfigMap, Secret,
  Route, HPA, ServiceAccount).

[1.1.0]: https://github.com/fithrahfauzan/s3-explorer/compare/4cc35a3...HEAD
