locals {
  bucket_name = coalesce(var.bucket_name, var.site_domain)
}
