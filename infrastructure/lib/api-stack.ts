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

export class MedmeloApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────
    // 1. NETWORKING REFERENCE
    // ─────────────────────────────────────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, 'MedmeloVPC', {
      vpcName: 'medmelo-vpc',
    });

    const lambdaSG = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'LambdaSG',
      'sg-093bbec0230c606db'
    );

    // ─────────────────────────────────────────────────────────────
    // 2. SQS INFRASTRUCTURE
    // ─────────────────────────────────────────────────────────────
    const examResultsDlq = new sqs.Queue(this, 'ExamResultsDLQ', {
      queueName: 'medmelo-exam-results-dlq-prod',
    });

    const examResultsQueue = new sqs.Queue(this, 'ExamResultsQueue', {
      queueName: 'medmelo-exam-results-prod',
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: examResultsDlq,
        maxReceiveCount: 3,
      },
    });

    const lambdaAsyncDlq = new sqs.Queue(this, 'LambdaAsyncDLQ');

    // ─────────────────────────────────────────────────────────────
    // 3. SHARED LAMBDA CONFIGURATION
    // NodejsFunction auto-compiles TypeScript via esbuild —
    // no manual tsc / webpack step needed.
    // ─────────────────────────────────────────────────────────────
    const sharedProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSG],
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      onFailure: new destinations.SqsDestination(lambdaAsyncDlq),
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node20',
        // Exclude aws-sdk — already available in the Lambda runtime
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        NODE_ENV: 'production',
        EXAM_QUEUE_URL: examResultsQueue.queueUrl,
      },
    };

    // ─────────────────────────────────────────────────────────────
    // 4. LAMBDA FUNCTIONS
    // `entry` points to your .ts source file.
    // `handler` is the exported function name inside that file.
    // CDK + esbuild compiles + zips it automatically on cdk deploy.
    // ─────────────────────────────────────────────────────────────
    const coreFn = new lambdaNodejs.NodejsFunction(this, 'LambdaCore', {
      ...sharedProps,
      functionName: 'medmelo-core-prod',
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      entry: 'functions/core/index.ts',   // FIX: was '../functions/core/index.ts'
      handler: 'handler',
    });

    const examFn = new lambdaNodejs.NodejsFunction(this, 'LambdaExam', {
      ...sharedProps,
      functionName: 'medmelo-exam-prod',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      entry: 'functions/exam/index.ts',   // FIX: was '../functions/exam/index.ts'
      handler: 'handler',
    });

    const adminFn = new lambdaNodejs.NodejsFunction(this, 'LambdaAdmin', {
      ...sharedProps,
      functionName: 'medmelo-admin-prod',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      entry: 'functions/admin/index.ts',  // FIX: was '../functions/admin/index.ts'
      handler: 'handler',
    });

    const mediaFn = new lambdaNodejs.NodejsFunction(this, 'LambdaMedia', {
      ...sharedProps,
      functionName: 'medmelo-media-prod',
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      entry: 'functions/media/index.ts',  // FIX: was '../functions/media/index.ts'
      handler: 'handler',
    });

    // ─────────────────────────────────────────────────────────────
    // 5. IAM PERMISSIONS
    // ─────────────────────────────────────────────────────────────

    // Allow examFn to enqueue exam results
    examResultsQueue.grantSendMessages(examFn);

    // Grant all lambdas read access to their Secrets Manager secrets
    const secretsToGrant = [
      'aurora/credentials',
      'redis/auth',
      'cognito/config',
      'google/oauth',
      'ses/config',
    ];

    [coreFn, examFn, adminFn, mediaFn].forEach((fn) => {
      secretsToGrant.forEach((path) => {
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:medmelo/${path}-*`,
            ],
          })
        );
      });
    });

    // Allow examFn to send emails via SES
    examFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
        resources: [
          `arn:aws:ses:${this.region}:${this.account}:identity/medmelo.com`,
        ],
      })
    );

    // ─────────────────────────────────────────────────────────────
    // 6. SQS → LAMBDA EVENT SOURCE
    // coreFn consumes exam results off the queue in batches of 5
    // ─────────────────────────────────────────────────────────────
    coreFn.addEventSource(
      new lambdaEventSources.SqsEventSource(examResultsQueue, {
        batchSize: 5,
      })
    );

    // ─────────────────────────────────────────────────────────────
    // 7. API GATEWAY
    // ─────────────────────────────────────────────────────────────
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // API Gateway must be allowed to write to the log group
    accessLogGroup.grantWrite(
      new iam.ServicePrincipal('apigateway.amazonaws.com')
    );

    const httpApi = new apigwv2.HttpApi(this, 'MedmeloHttpApi', {
      apiName: 'medmelo-api-prod',
      createDefaultStage: false,
    });

    // JWT Authorizer backed by Cognito User Pool
    const authorizer = new authorizers.HttpJwtAuthorizer(
      'CognitoAuth',
      `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_xo19c3jCI`,
      {
        jwtAudience: ['3r1fht3ht9g1cdv3n0f7g8rc1r'],
      }
    );

    // Add the prod stage (throttle only — logging configured via CfnStage below)
    const prodStage = httpApi.addStage('prod', {
      stageName: 'prod',
      autoDeploy: true,
      throttle: {
        burstLimit: 10000,
        rateLimit: 5000,
      },
    });

    // FIX: HttpStageOptions doesn't expose accessLogSettings directly.
    // Drop to L1 CfnStage — AWS requires BOTH destinationArn + format together.
    const cfnStage = prodStage.node.defaultChild as apigwv2.CfnStage;
    cfnStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId:        '$context.requestId',
        ip:               '$context.identity.sourceIp',
        requestTime:      '$context.requestTime',
        httpMethod:       '$context.httpMethod',
        routeKey:         '$context.routeKey',
        status:           '$context.status',
        protocol:         '$context.protocol',
        responseLength:   '$context.responseLength',
        integrationError: '$context.integrationErrorMessage',
      }),
    };

    // ─────────────────────────────────────────────────────────────
    // 8. ROUTES
    // ─────────────────────────────────────────────────────────────
    httpApi.addRoutes({
      path: '/api/v1/exam/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ExamInteg', examFn),
      authorizer,
    });

    httpApi.addRoutes({
      path: '/api/v1/core/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('CoreInteg', coreFn),
      authorizer,
    });

    httpApi.addRoutes({
      path: '/api/v1/admin/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('AdminInteg', adminFn),
      authorizer,
    });

    httpApi.addRoutes({
      path: '/api/v1/media/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('MediaInteg', mediaFn),
      authorizer,
    });

    // ─────────────────────────────────────────────────────────────
    // 9. STACK OUTPUTS
    // ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `${httpApi.url}prod`,
      description: 'Medmelo HTTP API URL',
    });

    new cdk.CfnOutput(this, 'ExamQueueUrl', {
      value: examResultsQueue.queueUrl,
      description: 'Exam Results SQS Queue URL',
    });
  }
}