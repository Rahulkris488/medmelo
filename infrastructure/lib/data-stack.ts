import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as sqs from "aws-cdk-lib/aws-sqs";

export class MedmeloDataStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "MedmeloVPC", {
      vpcName: "medmelo-vpc",
    });

    // Aurora Serverless v2 � PostgreSQL 15
    const auroraSubnetGroup = new rds.SubnetGroup(this, "AuroraSubnetGroup", {
      description: "Subnet group for Aurora Serverless v2",
      vpc,
      vpcSubnets: {
        subnetFilters: [ec2.SubnetFilter.byIds([
          "subnet-0fb0b53412e15a072",
          "subnet-0bcfc328e35fb2cef",
          "subnet-0be5207186b5c2d19",
          "subnet-0b1e0be3d0fb6ffd6",
          "subnet-067428b4a6cea98d9",
          "subnet-059095141076e4b0f",
        ])],
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
        subnetFilters: [ec2.SubnetFilter.byIds([
          "subnet-0fb0b53412e15a072",
          "subnet-0bcfc328e35fb2cef",
          "subnet-0be5207186b5c2d19",
          "subnet-0b1e0be3d0fb6ffd6",
          "subnet-067428b4a6cea98d9",
          "subnet-059095141076e4b0f",
        ])],
      },
      securityGroups: [
        ec2.SecurityGroup.fromSecurityGroupId(this, "AuroraSG", "sg-0d42e13718f40d631"),
      ],
      subnetGroup: auroraSubnetGroup,
      defaultDatabaseName: "medmelo",
      storageEncrypted: true,
      backup: {
        retention: cdk.Duration.days(7),
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enableDataApi: true,
    });

    // Redis � encryption enabled
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Subnets for medmelo Redis",
      subnetIds: [
        "subnet-0bcfc328e35fb2cef",
        "subnet-0be5207186b5c2d19",
      ],
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

    // SQS Queues
    const examResultsDlq = new sqs.Queue(this, "ExamResultsDLQ", {
      queueName: "medmelo-exam-results-dlq",
    });

    new sqs.Queue(this, "ExamResultsQueue", {
      queueName: "medmelo-exam-results",
      deadLetterQueue: { queue: examResultsDlq, maxReceiveCount: 3 },
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const notificationsDlq = new sqs.Queue(this, "NotificationsDLQ", {
      queueName: "medmelo-notifications-dlq",
    });

    new sqs.Queue(this, "NotificationsQueue", {
      queueName: "medmelo-notifications",
      deadLetterQueue: { queue: notificationsDlq, maxReceiveCount: 3 },
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // Outputs
    new cdk.CfnOutput(this, "AuroraClusterEndpoint", {
      value: auroraCluster.clusterEndpoint.hostname,
      description: "Aurora cluster writer endpoint � use in RDS Proxy target",
    });

    new cdk.CfnOutput(this, "AuroraClusterIdentifier", {
      value: auroraCluster.clusterIdentifier,
      description: "Aurora cluster identifier",
    });
  }
}
