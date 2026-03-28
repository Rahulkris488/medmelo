import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from 'constructs';

export class MedmeloDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "MedmeloVPC", {
      vpcName: "medmelo-vpc",
    });

    // Reference existing secret — no CDK auto-generated secret
    const auroraSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AuroraSecret",
      "medmelo/aurora/credentials"
    );

    const auroraSubnetGroup = new rds.SubnetGroup(this, "AuroraSubnetGroup", {
      description: "Subnet group for Aurora Serverless v2",
      vpc,
      vpcSubnets: {
        subnetFilters: [
          ec2.SubnetFilter.byIds([
            "subnet-0fb0b53412e15a072",
            "subnet-0bcfc328e35fb2cef",
            "subnet-0be5207186b5c2d19",
            "subnet-0b1e0be3d0fb6ffd6",
            "subnet-067428b4a6cea98d9",
            "subnet-059095141076e4b0f",
          ]),
        ],
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const auroraCluster = new rds.DatabaseCluster(this, "AuroraCluster", {
      clusterIdentifier: "medmelo-aurora-prod",
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_8,
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 16,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      vpc,
      vpcSubnets: {
        subnetFilters: [
          ec2.SubnetFilter.byIds([
            "subnet-0fb0b53412e15a072",
            "subnet-0bcfc328e35fb2cef",
            "subnet-0be5207186b5c2d19",
            "subnet-0b1e0be3d0fb6ffd6",
            "subnet-067428b4a6cea98d9",
            "subnet-059095141076e4b0f",
          ]),
        ],
      },
      securityGroups: [
        ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "AuroraSG",
          "sg-0d42e13718f40d631"
        ),
      ],
      subnetGroup: auroraSubnetGroup,
      credentials: rds.Credentials.fromSecret(auroraSecret),
      defaultDatabaseName: "medmelo",
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enableDataApi: true,
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Subnets for medmelo Redis",
      subnetIds: ["subnet-0bcfc328e35fb2cef", "subnet-0be5207186b5c2d19"],
      cacheSubnetGroupName: "medmelo-redis-subnet-group",
    });

    new elasticache.CfnReplicationGroup(this, "MedmeloRedisProd", {
      replicationGroupDescription: "Medmelo Redis prod",
      replicationGroupId: "medmelo-redis-prod",
      cacheNodeType: "cache.t4g.micro",
      engine: "redis",
      engineVersion: "7.1",
      numCacheClusters: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: ["sg-09a387465a0b34e88"],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      transitEncryptionMode: "required",
      autoMinorVersionUpgrade: true,
      multiAzEnabled: false,
      automaticFailoverEnabled: false,
    });

    const examSessions = new dynamodb.Table(this, "ExamSessions", {
      tableName: "ExamSessions",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "examId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const flashcardProgress = new dynamodb.Table(this, "FlashcardProgress", {
      tableName: "FlashcardProgress",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "cardId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userActivity = new dynamodb.Table(this, "UserActivity", {
      tableName: "UserActivity",
      partitionKey: { name: "userId",           type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "timestampEventId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const oneLinerProgress = new dynamodb.Table(this, "OneLinerProgress", {
      tableName: "OneLinerProgress",
      partitionKey: { name: "userId",     type: dynamodb.AttributeType.STRING },
      sortKey:      { name: "oneLinerId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "AuroraClusterEndpoint", {
      value: auroraCluster.clusterEndpoint.hostname,
      description: "Aurora writer endpoint",
    });
    new cdk.CfnOutput(this, "ExamSessionsTableName",      { value: examSessions.tableName });
    new cdk.CfnOutput(this, "FlashcardProgressTableName", { value: flashcardProgress.tableName });
    new cdk.CfnOutput(this, "UserActivityTableName",      { value: userActivity.tableName });
    new cdk.CfnOutput(this, "OneLinerProgressTableName",  { value: oneLinerProgress.tableName });
  }
}