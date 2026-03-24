import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class MedmeloStorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Media Production Bucket (The main content store)
    const mediaProd = new s3.Bucket(this, 'MediaProdBucket', {
      bucketName: 'medmelo-media-prod',
      versioned: true, // Safety against accidental deletion
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Secure defaults
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{
        id: 'ArchiveOldMedia',
        enabled: true,
        transitions: [{
          storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
          transitionAfter: cdk.Duration.days(90), // Save cost on old files
        }],
      }],
    });

    // 2. Uploads Staging Bucket (Temporary storage)
    new s3.Bucket(this, 'UploadsStagingBucket', {
      bucketName: 'medmelo-uploads-staging',
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, 
      autoDeleteObjects: true,
      lifecycleRules: [{
        id: 'AutoDeleteAfter24Hours',
        expiration: cdk.Duration.days(1), // Auto-wipe temp data
      }],
    });

    // 3. Admin SPA Bucket (Hosts the Admin Dashboard)
    new s3.Bucket(this, 'AdminSPABucket', {
      bucketName: 'medmelo-admin-spa',
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}