import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class MedmeloDataStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Reference existing VPC from Section 3
    const vpc = ec2.Vpc.fromLookup(this, 'MedmeloVPC', {
      vpcName: 'medmelo-vpc'
    });

    // 2. Redis
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnets for Redis',
      subnetIds: [
        'subnet-0bcfc328e35fb2cef',
        'subnet-0be5207186b5c2d19',
      ],
    });

    new elasticache.CfnCacheCluster(this, 'MedmeloRedis', {
      cacheNodeType: 'cache.t4g.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: ['sg-09a387465a0b34e88'],
    });

    // 3. SQS Queues
    const examResultsDlq = new sqs.Queue(this, 'ExamResultsDLQ', {
      queueName: 'medmelo-exam-results-dlq',
    });

    new sqs.Queue(this, 'ExamResultsQueue', {
      queueName: 'medmelo-exam-results',
      deadLetterQueue: { queue: examResultsDlq, maxReceiveCount: 3 },
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const notificationsDlq = new sqs.Queue(this, 'NotificationsDLQ', {
      queueName: 'medmelo-notifications-dlq',
    });

    new sqs.Queue(this, 'NotificationsQueue', {
      queueName: 'medmelo-notifications',
      deadLetterQueue: { queue: notificationsDlq, maxReceiveCount: 3 },
      visibilityTimeout: cdk.Duration.seconds(30),
    });
  }
}