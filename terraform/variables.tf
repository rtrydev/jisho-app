variable "aws_region" {
  description = "Region for the S3 bucket and other regional resources. The CloudFront ACM certificate is always created in us-east-1."
  type        = string
  default     = "eu-central-1"
}

variable "aws_profile" {
  description = "Named AWS profile to authenticate with (e.g. an SSO profile from ~/.aws/config). When null, the default credential chain is used — set AWS_PROFILE in the environment instead."
  type        = string
  default     = null
}

variable "base_domain" {
  description = "Route53-hosted apex domain (without a trailing dot)."
  type        = string
  default     = "rtrydev.com"
}

variable "site_domain" {
  description = "Fully qualified domain the application is served from."
  type        = string
  default     = "jisho.rtrydev.com"
}

variable "bucket_name" {
  description = "Name for the private origin bucket. Defaults to the site domain, which is globally unique enough for this project."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to every taggable resource."
  type        = map(string)
  default = {
    Project = "jisho-app"
    Stack   = "jisho"
  }
}
