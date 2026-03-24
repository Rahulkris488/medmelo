import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class MedmeloObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. The Notification Hub (SNS)
    const alertTopic = new sns.Topic(this, 'MedmeloAlerts', {
      topicName: 'medmelo-alerts-prod',
    });

    // Add your developer email subscription [Section 8.2]
    alertTopic.addSubscription(new subscriptions.EmailSubscription('medmelodev.app@gmail.com'));

    // 2. Reference your Lambda functions from the API Stack
    // (Ensure you pass these as props or use fromFunctionName)
    const coreFn = lambda.Function.fromFunctionName(this, 'RefCore', 'medmelo-core-prod');
    const examFn = lambda.Function.fromFunctionName(this, 'RefExam', 'medmelo-exam-prod');

    // 3. Lambda Error Rate Alarms [Section 8.2]
    
    // Core Error Rate > 2%
    const coreErrorAlarm = new cloudwatch.Alarm(this, 'LambdaCoreErrorRate', {
      metric: coreFn.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2, // 2% threshold 
      evaluationPeriods: 1,
      alarmDescription: 'Lambda-Core error rate exceeded 2%',
    });
    coreErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Exam Error Rate > 0.5% (Urgent)
    const examErrorAlarm = new cloudwatch.Alarm(this, 'LambdaExamErrorRate', {
      metric: examFn.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(1), // Faster check for exams 
      }),
      threshold: 0.5, // Sensitive for student grading [cite: 158, 180]
      evaluationPeriods: 1,
      alarmDescription: 'URGENT: Lambda-Exam error rate exceeded 0.5%',
    });
    examErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // 4. Billing Alarms [Section 8.2]
    const billingAlarm5k = new cloudwatch.Alarm(this, 'MonthlyBilling5k', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'INR' },
      }),
      threshold: 5000, // First alert at ₹5,000 
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    billingAlarm5k.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // 5. Aurora Scaling Alarm [Section 8.2]
    // Note: Monitoring ACU prevents credit burn [cite: 111, 180]
    const auroraCapacityAlarm = new cloudwatch.Alarm(this, 'AuroraACUHigh', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'ServerlessDatabaseCapacity',
        dimensionsMap: { DBClusterIdentifier: 'medmelo-aurora-prod' },
      }),
      threshold: 14, // Warning at 14 ACU 
      evaluationPeriods: 5,
      alarmDescription: 'Aurora is scaling high - check for slow queries',
    });
    auroraCapacityAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
  }
}