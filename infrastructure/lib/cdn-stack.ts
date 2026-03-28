import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface MedmeloCdnStackProps extends cdk.StackProps {
  apiId: string;
}

export class MedmeloCdnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MedmeloCdnStackProps) {
    super(scope, id, props);

    // ✅ IMPORT BUCKETS WITH REGION (CRITICAL FIX)
    const adminSpa = s3.Bucket.fromBucketAttributes(this, "AdminSpa", {
      bucketName: "medmelo-admin-spa",
      region: "ap-south-1",
    });

    const mediaProd = s3.Bucket.fromBucketAttributes(this, "MediaProd", {
      bucketName: "medmelo-media-prod",
      region: "ap-south-1",
    });

    // ✅ S3 ORIGINS (STABLE + CORRECT)
    const adminOrigin = new origins.S3Origin(adminSpa);
    const mediaOrigin = new origins.S3Origin(mediaProd);

    // ✅ API ORIGIN
    const apiDomain = `${props.apiId}.execute-api.ap-south-1.amazonaws.com`;
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // ✅ WAF
    const wafAcl = new wafv2.CfnWebACL(this, "MedmeloWafAcl", {
      name: "medmelo-waf-prod",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "medmelo-waf-prod",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "CommonRules",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ✅ API CACHE (NO CACHE)
    const apiCachePolicy = new cloudfront.CachePolicy(this, "ApiCache", {
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(0),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      "ApiOriginRequest",
      {
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
        queryStringBehavior:
          cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      }
    );

    // ✅ MEDIA CACHE
    const mediaCachePolicy = new cloudfront.CachePolicy(this, "MediaCache", {
      defaultTtl: cdk.Duration.hours(24),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(7),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    // ✅ DISTRIBUTION
    const distribution = new cloudfront.Distribution(
      this,
      "MedmeloDistribution",
      {
        comment: "Medmelo Production CDN",
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        webAclId: wafAcl.attrArn,

        // 🔥 DEFAULT (SPA)
        defaultBehavior: {
          origin: adminOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },

        additionalBehaviors: {
          "/api/*": {
            origin: apiOrigin,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiCachePolicy,
            originRequestPolicy: apiOriginRequestPolicy,
          },

          "/media/*": {
            origin: mediaOrigin,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: mediaCachePolicy,
          },
        },

        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      }
    );

    // ✅ OUTPUT
    new cdk.CfnOutput(this, "CloudFrontURL", {
      value: distribution.distributionDomainName,
    });
  }
}