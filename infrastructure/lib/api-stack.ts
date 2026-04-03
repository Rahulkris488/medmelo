import * as cdk from 'aws-cdk-lib';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

interface MedmeloApiStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  redisEndpoint: string;
}

export class MedmeloApiStack extends cdk.Stack {
  public readonly apiId: string; // ✅ exported for CDN stack

  constructor(scope: Construct, id: string, props: MedmeloApiStackProps) {
    super(scope, id, props);

    const { vpc, lambdaSecurityGroup, cognitoUserPoolId, cognitoClientId, redisEndpoint } = props;

    // ─────────────────────────────────────────────────────────────
    // SQS
    // ─────────────────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'ExamDLQ', {
      queueName: `medmelo-exam-dlq-prod`,
    });

    const examQueue = new sqs.Queue(this, 'ExamQueue', {
      queueName: `medmelo-exam-prod`,
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    const asyncDlq = new sqs.Queue(this, 'LambdaDLQ');

    // ─────────────────────────────────────────────────────────────
    // COMMON LAMBDA CONFIG
    // ─────────────────────────────────────────────────────────────
    const common: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      tracing: lambda.Tracing.ACTIVE,
      onFailure: new destinations.SqsDestination(asyncDlq),
      bundling: {
        minify: true,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        NODE_ENV:        'production',
        EXAM_QUEUE_URL:  examQueue.queueUrl,
        REDIS_ENDPOINT:  redisEndpoint,
      },
    };

    // ─────────────────────────────────────────────────────────────
    // LAMBDA LOG GROUPS
    // ─────────────────────────────────────────────────────────────
    const coreLogGroup = new logs.LogGroup(this, 'CoreLogGroupLambda', {
      retention: logs.RetentionDays.THREE_MONTHS,
    });

    const examLogGroup = new logs.LogGroup(this, 'ExamLogGroupLambda', {
      retention: logs.RetentionDays.THREE_MONTHS,
    });

    const adminLogGroup = new logs.LogGroup(this, 'AdminLogGroupLambda', {
      retention: logs.RetentionDays.THREE_MONTHS,
    });

    const mediaLogGroup = new logs.LogGroup(this, 'MediaLogGroupLambda', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // ─────────────────────────────────────────────────────────────
    // LAMBDAS
    // ─────────────────────────────────────────────────────────────
    const coreFn = new lambdaNodejs.NodejsFunction(this, 'CoreFn', {
      ...common,
      functionName: `medmelo-core-prod`,
      entry: 'functions/core/index.ts',
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      logGroup: coreLogGroup,
    });

    const examFn = new lambdaNodejs.NodejsFunction(this, 'ExamFn', {
      ...common,
      functionName: `medmelo-exam-prod`,
      entry: 'functions/exam/index.ts',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 50, // ✅ CRITICAL
      logGroup: examLogGroup,
    });

    const adminFn = new lambdaNodejs.NodejsFunction(this, 'AdminFn', {
      ...common,
      functionName: `medmelo-admin-prod`,
      entry: 'functions/admin/index.ts',
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: adminLogGroup,
    });

    const mediaFn = new lambdaNodejs.NodejsFunction(this, 'MediaFn', {
      ...common,
      functionName: `medmelo-media-prod`,
      entry: 'functions/media/index.ts',
      handler: 'handler',
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      logGroup: mediaLogGroup,
    });

    // ─────────────────────────────────────────────────────────────
    // PERMISSIONS
    // ─────────────────────────────────────────────────────────────
    examQueue.grantSendMessages(examFn);

    [coreFn, examFn, adminFn, mediaFn].forEach(fn => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:medmelo/*`],
      }));
    });

    examFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/medmelo.com`],
    }));

    coreFn.addEventSource(new lambdaEventSources.SqsEventSource(examQueue, {
      batchSize: 5,
    }));

    // ─────────────────────────────────────────────────────────────
    // API GATEWAY
    // ─────────────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: 'medmelo-api',
      createDefaultStage: false,
    });

    // ✅ Export API ID for cross-stack use (CDN)
    this.apiId = api.apiId;

    const authorizer = new authorizers.HttpJwtAuthorizer(
      'Auth',
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoUserPoolId}`,
      {
        jwtAudience: [cognitoClientId],
      }
    );

    const stage = api.addStage('prod', {
      autoDeploy: true,
      throttle: { burstLimit: 10000, rateLimit: 5000 },
    });

    const cfnStage = stage.node.defaultChild as apigwv2.CfnStage;
    cfnStage.accessLogSettings = {
      destinationArn: logGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        status: '$context.status',
        routeKey: '$context.routeKey',
      }),
    };

    // ─────────────────────────────────────────────────────────────
    // ROUTES
    // ─────────────────────────────────────────────────────────────
    const routes = [
      { path: '/api/v1/core/{proxy+}', fn: coreFn },
      { path: '/api/v1/exam/{proxy+}', fn: examFn },
      { path: '/api/v1/admin/{proxy+}', fn: adminFn },
      { path: '/api/v1/media/{proxy+}', fn: mediaFn },
    ];

    routes.forEach(r => {
      api.addRoutes({
        path: r.path,
        methods: [apigwv2.HttpMethod.ANY],
        integration: new HttpLambdaIntegration(`${r.path}-int`, r.fn),
        authorizer,
      });
    });

    // ─────────────────────────────────────────────────────────────
    // OUTPUTS
    // ─────────────────────────────────────────────────────────────
new cdk.CfnOutput(this, 'ApiUrl', {
  value: `https://${api.apiId}.execute-api.${this.region}.amazonaws.com/prod`,
});

    new cdk.CfnOutput(this, 'ApiId', {
      value: api.apiId,
    });

    new cdk.CfnOutput(this, 'ExamQueueUrl', {
      value: examQueue.queueUrl,
    });
  }
}