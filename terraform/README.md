# Terraform — jisho-app

Provisions the AWS hosting stack for `jisho.rtrydev.com`:

- Private S3 bucket (no public access, no versioning, no replication).
- CloudFront distribution in front of it via Origin Access Control (S3 stays private; only CloudFront can read it).
- ACM certificate in `us-east-1` for the site domain, DNS-validated against the existing `rtrydev.com` Route 53 zone.
- Route 53 A/AAAA alias records pointing the site domain at the distribution.
- CloudFront Function that rewrites directory-style URIs (`/foo/` or `/foo`) to `/foo/index.html`, matching the layout `next build` produces with `output: "export"` + `trailingSlash: true`.

Free-tier-friendly choices:

- CloudFront `PriceClass_100` (cheapest edge footprint).
- S3 standard storage, no versioning / replication / lifecycle.
- Single ACM certificate (free).

## Prerequisites

- AWS credentials with permission to manage S3, CloudFront, ACM, IAM (for the bucket policy), and Route 53 records in the `rtrydev.com` zone.
- The `rtrydev.com` public hosted zone must already exist in the target account (looked up via `data "aws_route53_zone"`).
- Terraform `>= 1.6` and the AWS CLI v2.

## Apply

Easiest path — `scripts/deploy.sh` (described below) runs `terraform apply` for you using the AWS CLI's currently-resolved credentials, then builds and uploads the site in one go.

If you want to apply terraform on its own:

```bash
cd terraform
terraform init
terraform apply
```

Outputs include the S3 bucket name and CloudFront distribution ID.

## Variables

| Name | Default | Purpose |
|---|---|---|
| `aws_region` | `eu-central-1` | Region for the S3 bucket. ACM is always created in `us-east-1`. |
| `aws_profile` | `null` | Named AWS profile. Leave null when `deploy.sh` exports credentials into the env. |
| `base_domain` | `rtrydev.com` | Apex domain whose Route 53 zone hosts the records. |
| `site_domain` | `jisho.rtrydev.com` | FQDN the app is served from. |
| `bucket_name` | `null` → site domain | Override only if you need a different S3 bucket name. |
| `tags` | `{Project, Stack}` | Default tags applied to every resource. |

## Deploying the site

```bash
./scripts/deploy.sh           # interactive terraform apply
./scripts/deploy.sh --yes     # auto-approve terraform apply
```

What the script does:

1. `aws sts get-caller-identity` — fails fast with a useful message if your session is missing or expired.
2. `aws configure export-credentials --format env` and `eval` the result, so terraform sees the *exact same* identity the CLI just confirmed (sidesteps the AWS-provider-doesn't-pick-up-the-CLI-profile problem).
3. `terraform init` + `terraform apply` — converges the stack.
4. `next build` — emits the static export to `out/`. `postinstall` (`scripts/sync-kuromoji-dict.mjs`) has already copied the kuromoji IPADIC into `public/dict/`, and the JMdict + grammar artifacts live under `public/data/`, so the entire client bundle is on disk before `next build` copies `public/` into `out/`.
5. `aws s3 sync out/ s3://<bucket>` with split cache headers (`immutable` for fingerprinted assets, short TTL for HTML/JSON).
6. `aws cloudfront create-invalidation --paths '/*'` — makes the deploy visible immediately.

Requires AWS CLI v2 (for `aws configure export-credentials`).
