output "site_url" {
  description = "Public URL of the deployed site."
  value       = "https://${var.site_domain}/"
}

output "s3_bucket_name" {
  description = "Name of the private origin bucket. Use this for `aws s3 sync`."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Use this for `aws cloudfront create-invalidation`."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront-assigned domain (handy for debugging before DNS resolves)."
  value       = aws_cloudfront_distribution.site.domain_name
}
