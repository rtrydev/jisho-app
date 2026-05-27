resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${replace(var.site_domain, ".", "-")}-oac"
  description                       = "OAC for ${var.site_domain}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name    = "${replace(var.site_domain, ".", "-")}-headers"
  comment = "Security headers for ${var.site_domain}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "same-origin"
      override        = true
    }

    # CSP is permissive about inline scripts/styles because Next.js's
    # static export inlines bootstrap scripts and Tailwind/Next emit
    # inline <style> tags — there is no nonce in a pre-rendered build to
    # tighten this. Everything that *can* be locked down (object-src,
    # base-uri, frame-ancestors, connect/img/font sources) is.
    #
    # `'wasm-unsafe-eval'` is required for the handwriting recognizer
    # (onnxruntime-web) to call `WebAssembly.instantiate()`. It only
    # grants WASM compilation — narrower than `'unsafe-eval'`, which
    # would also enable `eval()` on JS strings.
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        # `next/font/google` downloads woff2 files at build time and
        # serves them from the Next.js bundle (same origin), so no
        # third-party font hosts are needed here.
        "font-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ])
      override = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
      override = true
    }

    items {
      header   = "Cross-Origin-Opener-Policy"
      value    = "same-origin"
      override = true
    }

    items {
      header   = "Cross-Origin-Resource-Policy"
      value    = "same-origin"
      override = true
    }
  }
}

resource "aws_cloudfront_function" "rewrite_uri" {
  name    = "${replace(var.site_domain, ".", "-")}-rewrite-uri"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory-style URIs to /index.html for Next.js static export"
  publish = true
  code    = file("${path.module}/cloudfront-functions/rewrite-uri.js")
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "jisho-app (${var.site_domain})"
  default_root_object = "index.html"

  aliases = [var.site_domain]

  # PriceClass_100 keeps the distribution in the cheapest tier
  # (North America + Europe edge locations).
  price_class = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.site.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.site.id}"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]
    compress        = true

    # AWS managed cache policy: "CachingOptimized".
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite_uri.arn
    }
  }

  # S3 returns 403 (not 404) for missing keys when accessed via OAC. Map
  # both to the Next.js 404 page emitted by `next build`.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
