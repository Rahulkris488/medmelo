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
// ✅ CENTRALIZED ENV CONFIG
// ─────────────────────────────────────────────────────────────
const env = {
  account: '101374115637',
  region: 'ap-south-1',
};

// ─────────────────────────────────────────────────────────────
// ✅ NETWORKING (VPC + SG)
// ─────────────────────────────────────────────────────────────
const networkingStack = new MedmeloNetworkingStack(
  app,
  'MedmeloNetworkingStack',
  { env }
);

// ─────────────────────────────────────────────────────────────
// ✅ AUTH (Cognito)
// ─────────────────────────────────────────────────────────────
const authStack = new MedmeloAuthStack(app, 'MedmeloAuthStack', {
  env,

  userPoolId: 'ap-south-1_xo19c3jCI',
  userPoolClientId: '3r1fht3ht9g1cdv3n0f7g8rc1r',
});

// ─────────────────────────────────────────────────────────────
// ✅ DATA LAYER
// ─────────────────────────────────────────────────────────────
const dataStack = new MedmeloDataStack(app, 'MedmeloDataStack', {
  env,
});

// ─────────────────────────────────────────────────────────────
// ✅ STORAGE (S3)
// ─────────────────────────────────────────────────────────────
const storageStack = new MedmeloStorageStack(app, 'MedmeloStorageStack', {
  env,
});

// ─────────────────────────────────────────────────────────────
// ✅ API LAYER
// ─────────────────────────────────────────────────────────────
const apiStack = new MedmeloApiStack(app, 'MedmeloApiStack', {
  env,
  vpc: networkingStack.vpc,
  lambdaSecurityGroup: networkingStack.lambdaSecurityGroup,
  cognitoUserPoolId: authStack.userPoolId,
  cognitoClientId: authStack.userPoolClientId,
});

// ─────────────────────────────────────────────────────────────
// ✅ CDN (CloudFront — MUST be us-east-1)
// ─────────────────────────────────────────────────────────────
const cdnStack = new MedmeloCdnStack(app, 'MedmeloCdnStack', {
  env: {
    account: env.account,
    region: 'us-east-1',
  },

  apiId: apiStack.apiId, // ✅ FIXED: dynamic API connection
  crossRegionReferences: true,
});

// ─────────────────────────────────────────────────────────────
// ✅ OBSERVABILITY
// ─────────────────────────────────────────────────────────────
const observabilityStack = new MedmeloObservabilityStack(
  app,
  'MedmeloObservabilityStack',
  { 
    env,
    apiId: apiStack.apiId,
  }
);

// ─────────────────────────────────────────────────────────────
// ✅ DEPENDENCIES (VERY IMPORTANT)
// ─────────────────────────────────────────────────────────────

// API depends on core infra
apiStack.addDependency(networkingStack);
apiStack.addDependency(authStack);
apiStack.addDependency(dataStack);
apiStack.addDependency(storageStack);

// CDN depends on API
cdnStack.addDependency(apiStack);

// Observability depends on API
observabilityStack.addDependency(apiStack);