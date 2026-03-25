import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

export class MedmeloCdnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const mediaProd = s3.Bucket.fromBucketName(this, "MediaProdBucket", "medmelo-media-prod");
    const adminSpa = s3.Bucket.fromBucketName(this, "AdminSPABucket", "medmelo-admin-spa");

    const wafAcl = new wafv2.CfnWebACL(this, "MedmeloWafAcl", {
      name: "medmelo-waf-prod",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "medmelo-waf-prod", sampledRequestsEnabled: true },
      rules: [
        { name: "AWSManagedRulesCommonRuleSet", priority: 1, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "AWSManagedRulesCommonRuleSet", sampledRequestsEnabled: true } },
        { name: "AWSManagedRulesKnownBadInputsRuleSet", priority: 2, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "AWSManagedRulesKnownBadInputsRuleSet", sampledRequestsEnabled: true } },
        { name: "AWSManagedRulesSQLiRuleSet", priority: 3, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesSQLiRuleSet" } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "AWSManagedRulesSQLiRuleSet", sampledRequestsEnabled: true } },
        { name: "AWSManagedRulesAmazonIpReputationList", priority: 4, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesAmazonIpReputationList" } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "AWSManagedRulesAmazonIpReputationList", sampledRequestsEnabled: true } },
        { name: "ApiRateLimit", priority: 5, action: { block: {} }, statement: { rateBasedStatement: { limit: 1000, aggregateKeyType: "IP", scopeDownStatement: { byteMatchStatement: { searchString: "/api/", fieldToMatch: { uriPath: {} }, textTransformations: [{ priority: 0, type: "NONE" }], positionalConstraint: "STARTS_WITH" } } } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "ApiRateLimit", sampledRequestsEnabled: true } },
        { name: "BlockMissingUserAgent", priority: 6, action: { block: {} }, statement: { notStatement: { statement: { byteMatchStatement: { searchString: "Mozilla", fieldToMatch: { singleHeader: { Name: "User-Agent" } }, textTransformations: [{ priority: 0, type: "NONE" }], positionalConstraint: "CONTAINS" } } } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "BlockMissingUserAgent", sampledRequestsEnabled: true } },
        { name: "AWSManagedRulesLinuxRuleSet", priority: 7, overrideAction: { none: {} }, statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesLinuxRuleSet" } }, visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "AWSManagedRulesLinuxRuleSet", sampledRequestsEnabled: true } },
      ],
    });

    const mediaOac = new cloudfront.S3OriginAccessControl(this, "MediaOAC", { description: "OAC for medmelo-media-prod" });
    const adminOac = new cloudfront.S3OriginAccessControl(this, "AdminOAC", { description: "OAC for medmelo-admin-spa" });

    const apiOrigin = new origins.HttpOrigin("3x5r5y26yd.execute-api.ap-south-1.amazonaws.com", {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      httpsPort: 443,
    });

    // TTL=0 means caching is fully disabled.
    // CloudFront requires ALL behaviors to be none() in this case.
    // Headers, query strings, and cookies are all forwarded via OriginRequestPolicy instead.
    const apiCachePolicy = new cloudfront.CachePolicy(this, "ApiCachePolicy", {
      cachePolicyName: "medmelo-api-no-cache",
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(0),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingBrotli: false,
      enableAcceptEncodingGzip: false,
    });

    // All forwarding lives here: headers (incl. Authorization via .all()), query strings, no cookies.
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, "ApiOriginRequestPolicy", {
      originRequestPolicyName: "medmelo-api-forward",
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const mediaCachePolicy = new cloudfront.CachePolicy(this, "MediaCachePolicy", {
      cachePolicyName: "medmelo-media-24h",
      defaultTtl: cdk.Duration.hours(24),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(7),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const distribution = new cloudfront.Distribution(this, "MedmeloDistribution", {
      comment: "Medmelo production CDN",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: wafAcl.attrArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(adminSpa, { originAccessControl: adminOac }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: apiOriginRequestPolicy,
          compress: true,
        },
        "/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaProd, { originAccessControl: mediaOac }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: mediaCachePolicy,
          compress: true,
        },
        "/admin/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(adminSpa, { originAccessControl: adminOac }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
      ],
    });

    new cdk.CfnResource(this, "MediaBucketPolicy", {
      type: "AWS::S3::BucketPolicy",
      properties: {
        Bucket: "medmelo-media-prod",
        PolicyDocument: {
          Statement: [{
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::medmelo-media-prod/*",
            Condition: { StringEquals: { "AWS:SourceArn": `arn:aws:cloudfront::101374115637:distribution/${distribution.distributionId}` } },
          }],
        },
      },
    });

    new cdk.CfnResource(this, "AdminSpaBucketPolicy", {
      type: "AWS::S3::BucketPolicy",
      properties: {
        Bucket: "medmelo-admin-spa",
        PolicyDocument: {
          Statement: [{
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::medmelo-admin-spa/*",
            Condition: { StringEquals: { "AWS:SourceArn": `arn:aws:cloudfront::101374115637:distribution/${distribution.distributionId}` } },
          }],
        },
      },
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", { value: distribution.distributionDomainName, description: "CloudFront domain - point your DNS CNAME here" });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", { value: distribution.distributionId, description: "Use for CloudFront cache invalidations in CI/CD" });
    new cdk.CfnOutput(this, "WafAclArn", { value: wafAcl.attrArn, description: "WAF ACL ARN" });
  }
}
