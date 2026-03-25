import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class MedmeloObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────
    // 1. SNS ALERT TOPIC
    // ─────────────────────────────────────────────────────────────
    const alertTopic = new sns.Topic(this, 'MedmeloAlerts', {
      topicName: 'medmelo-alerts-prod',
    });

    alertTopic.addSubscription(
      new subscriptions.EmailSubscription('medmelodev.app@gmail.com')
    );

    // ─────────────────────────────────────────────────────────────
    // 2. CLOUDWATCH LOG GROUPS — Section 8.1
    // ─────────────────────────────────────────────────────────────
    new logs.LogGroup(this, 'CoreLogGroup', {
      logGroupName: '/aws/lambda/medmelo-core-prod',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new logs.LogGroup(this, 'ExamLogGroup', {
      logGroupName: '/aws/lambda/medmelo-exam-prod',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new logs.LogGroup(this, 'AdminLogGroup', {
      logGroupName: '/aws/lambda/medmelo-admin-prod',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new logs.LogGroup(this, 'MediaLogGroup', {
      logGroupName: '/aws/lambda/medmelo-media-prod',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─────────────────────────────────────────────────────────────
    // 3. LAMBDA REFERENCES
    // ─────────────────────────────────────────────────────────────
    const coreFn = lambda.Function.fromFunctionName(this, 'RefCore', 'medmelo-core-prod');
    const examFn = lambda.Function.fromFunctionName(this, 'RefExam', 'medmelo-exam-prod');

    // ─────────────────────────────────────────────────────────────
    // 4. ALL 7 CLOUDWATCH ALARMS — Section 8.2
    // ─────────────────────────────────────────────────────────────

    // Alarm 1 — Lambda Core error rate > 2%
    const coreErrorAlarm = new cloudwatch.Alarm(this, 'LambdaCoreErrorRate', {
      alarmName: 'LambdaCoreErrorRate',
      metric: coreFn.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Lambda-Core error rate exceeded 2%',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    coreErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 2 — Lambda Exam error rate > 0.5% (URGENT)
    const examErrorAlarm = new cloudwatch.Alarm(this, 'LambdaExamErrorRate', {
      alarmName: 'LambdaExamErrorRate',
      metric: examFn.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'URGENT: Lambda-Exam error rate exceeded 0.5% — student grading affected',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    examErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 3 — API Gateway 5xx rate > 1%
    const apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'APIGateway5xxRate', {
      alarmName: 'APIGateway5xxRate',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: {
          ApiId: '3x5r5y26yd', // medmelo-api-prod ID from console
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'API Gateway 5XX error rate exceeded 1%',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiGateway5xxAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 4 — Aurora ACU high > 14 for 5 min
    const auroraCapacityAlarm = new cloudwatch.Alarm(this, 'AuroraACUHigh', {
      alarmName: 'AuroraACUHigh',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'ServerlessDatabaseCapacity',
        dimensionsMap: { DBClusterIdentifier: 'medmelo-aurora-prod' },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 14,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Aurora scaling high — check for slow queries or unexpected load',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    auroraCapacityAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 5 — Redis cache miss rate > 15% for 10 min
    const redisCacheMissAlarm = new cloudwatch.Alarm(this, 'RedisCacheMissHigh', {
      alarmName: 'RedisCacheMissHigh',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'CacheMisses',
        statistic: 'Sum',
        period: cdk.Duration.minutes(10),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Redis cache miss rate high — investigate cold cache or TTL issues',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    redisCacheMissAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 6 — DynamoDB throttled requests > 0
    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoDBThrottles', {
      alarmName: 'DynamoDBThrottles',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ThrottledRequests',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'DynamoDB throttling detected — check on-demand capacity',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dynamoThrottleAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Alarm 7 — Monthly billing > ₹5,000 and ₹15,000
    const billingAlarm5k = new cloudwatch.Alarm(this, 'MonthlyBilling5k', {
      alarmName: 'MonthlyBillingAlert5k',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: cdk.Duration.hours(6),
      }),
      threshold: 60, // ~₹5,000
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Monthly AWS spend exceeded ₹5,000 — review Cost Explorer',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    billingAlarm5k.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    const billingAlarm15k = new cloudwatch.Alarm(this, 'MonthlyBilling15k', {
      alarmName: 'MonthlyBillingAlert15k',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: cdk.Duration.hours(6),
      }),
      threshold: 180, // ~₹15,000
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Monthly AWS spend exceeded ₹15,000 — urgent cost review',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    billingAlarm15k.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // ─────────────────────────────────────────────────────────────
    // 5. STACK OUTPUTS
    // ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS topic ARN for all Medmelo alerts',
    });
  }
}