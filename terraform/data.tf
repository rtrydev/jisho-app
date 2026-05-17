data "aws_route53_zone" "base" {
  name         = var.base_domain
  private_zone = false
}
