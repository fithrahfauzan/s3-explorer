# S3 Explorer — Helm Chart

Deploys the single-container fullstack image (`src/` FastAPI backend serving the
built `frontend/`) to Kubernetes / OpenShift.

- **Chart:** `s3-explorer` (`Chart.yaml` — `version` is the chart version,
  `appVersion` the default image tag)
- **Rendered objects:** `Deployment`, `Service`, optional `ConfigMap`,
  optional `Secret`, optional OpenShift `Route`(s), optional `HorizontalPodAutoscaler`,
  optional `ServiceAccount`
- **App config:** injected as environment variables via `envFrom` — a
  `ConfigMapRef` and/or a `SecretRef` (see below). The app reads the same env
  vars documented in the root `README.md` / `.env.example`.

---

## Install / Upgrade

`helm upgrade --install` is idempotent — same command for first install and every
change after.

```bash
helm upgrade --install s3-explorer ./helm \
  --namespace s3-explorer --create-namespace \
  -f ./s3-explorer.secrets.yaml
```

- The chart's own `values.yaml` is always applied first. Every `-f <file>` and
  `--set` you add is merged on top, last one wins.
- Uninstall: `helm uninstall s3-explorer -n s3-explorer`
- History / rollback: `helm history s3-explorer -n s3-explorer` /
  `helm rollback s3-explorer <REVISION> -n s3-explorer`

---

## Configuration split: ConfigMap vs Secret

| | ConfigMap (`configMap.data`) | Secret (`secret.data`) |
|---|---|---|
| For | non-sensitive settings | passwords, tokens, keys |
| Rendered when | `configMap.enabled: true` | `secret.enabled: true` |
| Examples | `BUCKET_*_ID/NAME/REGION/AUTH_TYPE`, `RESTRICTED_MODE`, `CORS_ORIGINS` | `AUTH_PROFILE_*_PASSWORD`, `API_TOKEN_*_VALUE`, `SESSION_SECRET`, `BUCKET_*_ACCESS_KEY` / `_SECRET_KEY` |

`configMap.data` values live in `values.yaml` and are fine to commit. **Secret
values must not go in `values.yaml`** — keep them in a separate override file
that is git-ignored (or a `--set`, or a secret manager). See below.

`secret.enabled` defaults to `false`, so nothing sensitive is mounted until you
opt in. The `Deployment` only adds the `secretRef` to `envFrom` when
`secret.enabled: true`. The ConfigMap is loaded first, the Secret second, so if
the same key appears in both, the Secret value wins.

---

## Secrets via a value-override file (not `values.yaml`)

Create `s3-explorer.secrets.yaml` **outside version control** (add it to
`.gitignore`):

```yaml
secret:
  enabled: true
  data:
    # Signs session cookies — set explicitly so sessions survive restarts and
    # validate across replicas. Generate: openssl rand -hex 32
    SESSION_SECRET: "REPLACE_ME"

    # Login profiles (browser)
    AUTH_PROFILE_1_PASSWORD: "REPLACE_ME_full_access"
    AUTH_PROFILE_1_RESTRICTED_MODE: "false"
    AUTH_PROFILE_2_PASSWORD: "REPLACE_ME_restricted"
    AUTH_PROFILE_2_RESTRICTED_MODE: "true"

    # Static API tokens (external clients — Authorization: Bearer <token>)
    # Generate: openssl rand -hex 32
    API_TOKEN_1_VALUE: "REPLACE_ME"
    API_TOKEN_1_RESTRICTED_MODE: "true"

    # Only for buckets with AUTH_TYPE=manual (IRSA buckets need none)
    # BUCKET_1_ACCESS_KEY: "REPLACE_ME"
    # BUCKET_1_SECRET_KEY: "REPLACE_ME"
```

Values are plain strings under `secret.data`; Kubernetes base64-encodes them
(`stringData`). Keys must be quoted strings — `"false"`, not `false`.

Apply on install and **every** upgrade:

```bash
helm upgrade --install s3-explorer ./helm \
  -n s3-explorer --create-namespace \
  -f ./s3-explorer.secrets.yaml
```

If you drop `-f ./s3-explorer.secrets.yaml` on a later upgrade, the chart falls
back to `values.yaml` (`secret.enabled: false`) and the Secret is deleted — every
`/api` route then requires no credential, or the app loses its manual bucket
keys. Always pass the file, or wire it into your deploy pipeline.

### One-off overrides with `--set`

For CI or a quick change without a file (careful — the value lands in shell
history and `helm history`):

```bash
helm upgrade --install s3-explorer ./helm -n s3-explorer \
  --set secret.enabled=true \
  --set-string secret.data.API_TOKEN_1_VALUE="$API_TOKEN" \
  --set-string secret.data.API_TOKEN_1_RESTRICTED_MODE="true"
```

### Better: a secret manager

For anything beyond a small deployment, don't hand secrets to Helm at all — set
`secret.enabled: false` and use [External Secrets Operator], Sealed Secrets, or
`helm-secrets` + SOPS, then reference that Secret. (Referencing an
externally-managed Secret needs a small template tweak — not wired in yet.)

[External Secrets Operator]: https://external-secrets.io/

---

## Rotating a secret

Edit the value in `s3-explorer.secrets.yaml`, then re-run the same
`helm upgrade --install …` command. The Secret is updated; restart pods to pick
it up (env vars are read at process start):

```bash
kubectl rollout restart deployment/s3-explorer -n s3-explorer
```

Rotating `SESSION_SECRET` invalidates all existing browser sessions (everyone is
logged out). Rotating an `API_TOKEN_*_VALUE` immediately breaks callers using the
old token.

---

## Common parameters

| Key | Default | Notes |
|---|---|---|
| `image.repository` | `docker.io/ffauzan/s3-explorer` | |
| `image.tag` | `latest` | falls back to `Chart.appVersion` if unset |
| `image.pullPolicy` | `Always` | |
| `replicaCount` | `1` | ignored when `autoscaling.enabled` |
| `configMap.enabled` / `configMap.data` | `true` / bucket + `RESTRICTED_MODE` | non-secret env |
| `secret.enabled` / `secret.data` | `false` / `{}` | secret env — supply via override file |
| `serviceAccount.create` | `false` | |
| `serviceAccount.name` | `""` | set to an existing SA |
| `serviceAccount.annotations` | `{}` | `eks.amazonaws.com/role-arn: …` for IRSA |
| `service.type` | `ClusterIP` | |
| `route.enabled` / `route.routes` | `true` / one edge-TLS route | OpenShift only |
| `autoscaling.enabled` | `false` | |
| `resources` | `{}` | set requests/limits for production |

Full list with descriptions: `helm/values.yaml`. Schema-validated on every
render by `helm/values.schema.json` — an unknown top-level key fails the install.

---

## IRSA / pod identity (buckets with `AUTH_TYPE=irsa`)

The app uses boto3's default credential chain, so give the pod an identity
instead of access keys:

```yaml
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<acct>:role/<role>
```

The IAM role needs `s3:ListBucket` + `s3:GetObject` (+ `s3:PutObject` /
`s3:DeleteObject` for uploads/deletes) scoped to the configured buckets only —
no `s3:ListAllMyBuckets`.

---

## OpenShift Route

`route.enabled: true` renders one `Route` per entry in `route.routes`. Leave
`host: ""` to let OpenShift generate one; default is `edge` TLS with HTTP→HTTPS
redirect. On plain Kubernetes set `route.enabled: false` and use an Ingress
(not included in this chart).

---

## Render / debug

```bash
helm template s3-explorer ./helm -f ./s3-explorer.secrets.yaml   # see final YAML
helm lint ./helm
helm get manifest s3-explorer -n s3-explorer                     # what's deployed
```
