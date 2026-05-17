provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = var.tags
  }
}

# CloudFront ACM certificates must live in us-east-1, regardless of where
# the rest of the infrastructure is deployed.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = var.tags
  }
}
