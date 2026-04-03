import * as cdk from 'aws-cdk-lib';
import { MedmeloDataStack } from '../lib/data-stack';
import { MedmeloStorageStack } from '../lib/storage-stack';
import { MedmeloCdnStack } from '../lib/cdn-stack';
import { MedmeloApiStack } from '../lib/api-stack';
import { MedmeloObservabilityStack } from '../lib/observability-stack';
import { MedmeloNetworkingStack } from '../lib/networking-stack';
import { MedmeloAuthStack } from '../lib/auth-stack';

const app = new cdk.App();

// ─────────────────────────────────────────────────────────────
// CONFIG — all values live in cdk.json under "context"
// ─────────────────────────────────────────────────────────────
const ctx = {
  account:                 app.node.tryGetContext('account'),
  region:                  app.node.tryGetContext('region'),
  vpcName:                 app.node.tryGetContext('vpcName'),
  lambdaSgId:              app.node.tryGetContext('lambdaSgId'),
  cognitoUserPoolId:       app.node.tryGetContext('cognitoUserPoolId'),
  cognitoUserPoolClientId: app.node.tryGetContext('cognitoUserPoolClientId'),
  auroraSubnetIds:         app.node.tryGetContext('auroraSubnetIds') as string[],
  auroraSgId:              app.node.tryGetContext('auroraSgId'),
  redisSubnetIds:          app.node.tryGetContext('redisSubnetIds') as string[],
  redisSgId:               app.node.tryGetContext('redisSgId'),
  alertEmail:              app.node.tryGetContext('alertEmail'),
};

const env = { account: ctx.account, region: ctx.region };

// ─────────────────────────────────────────────────────────────
// NETWORKING (VPC + SG)
// ─────────────────────────────────────────────────────────────
const networkingStack = new MedmeloNetworkingStack(app, 'MedmeloNetworkingStack', {
  env,
  vpcName:              ctx.vpcName,
  lambdaSecurityGroupId: ctx.lambdaSgId,
});

// ─────────────────────────────────────────────────────────────
// AUTH (Cognito)
// ─────────────────────────────────────────────────────────────
const authStack = new MedmeloAuthStack(app, 'MedmeloAuthStack', {
  env,
  userPoolId:       ctx.cognitoUserPoolId,
  userPoolClientId: ctx.cognitoUserPoolClientId,
});

// ─────────────────────────────────────────────────────────────
// DATA LAYER
// ─────────────────────────────────────────────────────────────
const dataStack = new MedmeloDataStack(app, 'MedmeloDataStack', {
  env,
  auroraSubnetIds: ctx.auroraSubnetIds,
  auroraSgId:      ctx.auroraSgId,
  redisSubnetIds:  ctx.redisSubnetIds,
  redisSgId:       ctx.redisSgId,
});

// ─────────────────────────────────────────────────────────────
// STORAGE (S3)
// ─────────────────────────────────────────────────────────────
const storageStack = new MedmeloStorageStack(app, 'MedmeloStorageStack', { env });

// ─────────────────────────────────────────────────────────────
// API LAYER
// ─────────────────────────────────────────────────────────────
const apiStack = new MedmeloApiStack(app, 'MedmeloApiStack', {
  env,
  vpc:                  networkingStack.vpc,
  lambdaSecurityGroup:  networkingStack.lambdaSecurityGroup,
  cognitoUserPoolId:    authStack.userPoolId,
  cognitoClientId:      authStack.userPoolClientId,
  redisEndpoint:        dataStack.redisEndpoint,
});

// ─────────────────────────────────────────────────────────────
// CDN (CloudFront — MUST be us-east-1)
// ─────────────────────────────────────────────────────────────
const cdnStack = new MedmeloCdnStack(app, 'MedmeloCdnStack', {
  env: { account: ctx.account, region: 'us-east-1' },
  apiId: apiStack.apiId,
  crossRegionReferences: true,
});

// ─────────────────────────────────────────────────────────────
// OBSERVABILITY
// ─────────────────────────────────────────────────────────────
const observabilityStack = new MedmeloObservabilityStack(app, 'MedmeloObservabilityStack', {
  env,
  apiId:      apiStack.apiId,
  alertEmail: ctx.alertEmail,
});

// ─────────────────────────────────────────────────────────────
// DEPENDENCIES
// ─────────────────────────────────────────────────────────────
apiStack.addDependency(networkingStack);
apiStack.addDependency(authStack);
apiStack.addDependency(dataStack);
apiStack.addDependency(storageStack);

cdnStack.addDependency(apiStack);

observabilityStack.addDependency(apiStack);
