import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface MedmeloObservabilityStackProps extends cdk.StackProps {
    apiId: string;
}

export class MedmeloObservabilityStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: MedmeloObservabilityStackProps) {
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

        // 2. LOG GROUPS (Removed — managed by ApiStack)
        // ─────────────────────────────────────────────────────────────

        // ─────────────────────────────────────────────────────────────
        // 3. LAMBDA REFERENCES
        // ─────────────────────────────────────────────────────────────
        const coreFn = lambda.Function.fromFunctionName(this, 'RefCore', 'medmelo-core-prod');
        const examFn = lambda.Function.fromFunctionName(this, 'RefExam', 'medmelo-exam-prod');

        // ─────────────────────────────────────────────────────────────
        // 4. ALL 7 CLOUDWATCH ALARMS — Section 8.2
        // ─────────────────────────────────────────────────────────────

        // Alarm 1 — Lambda Core error rate > 2%
       const coreErrorRate = new cloudwatch.MathExpression({
  expression: "IF(invocations > 0, errors / invocations, 0)",
  usingMetrics: {
    errors: coreFn.metricErrors({
      period: cdk.Duration.minutes(5),
    }),
    invocations: coreFn.metricInvocations({
      period: cdk.Duration.minutes(5),
    }),
  },
  period: cdk.Duration.minutes(5),
});

        const coreErrorAlarm = new cloudwatch.Alarm(this, 'LambdaCoreErrorRate', {
            alarmName: 'LambdaCoreErrorRate',
            metric: coreErrorRate,
            threshold: 0.02, // 2%
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        });
        coreErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

        // Alarm 2 — Lambda Exam error rate > 0.5% (URGENT)
        const examErrorRate = new cloudwatch.MathExpression({
  expression: "IF(invocations > 0, errors / invocations, 0)",
  usingMetrics: {
    errors: examFn.metricErrors({
      period: cdk.Duration.minutes(1),
    }),
    invocations: examFn.metricInvocations({
      period: cdk.Duration.minutes(1),
    }),
  },
  period: cdk.Duration.minutes(1),
});

     const examAlarm = new cloudwatch.Alarm(this, 'LambdaExamErrorRate', {
  alarmName: 'LambdaExamErrorRate',
  metric: examErrorRate,
  threshold: 0.005,
  evaluationPeriods: 1,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});

examAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
        // Alarm 3 — API Gateway 5xx rate > 1%
        const apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'APIGateway5xxRate', {
            alarmName: 'APIGateway5xxRate',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: '5XXError',
                dimensionsMap: {    
                    ApiId: props.apiId,
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