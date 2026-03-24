import * as cdk from 'aws-cdk-lib';
import { MedmeloDataStack } from '../lib/data-stack';
import { MedmeloStorageStack } from '../lib/storage-stack';
import { MedmeloApiStack } from '../lib/api-stack';
import { MedmeloObservabilityStack } from '../lib/observability-stack';
const app = new cdk.App();

new MedmeloDataStack(app, 'MedmeloDataStack', {
  env: {
    account: '101374115637',
    region: 'ap-south-1',
  },
});

new MedmeloStorageStack(app, 'MedmeloStorageStack', {
  env: {
    account: '101374115637',
    region: 'ap-south-1',
  },
});

new MedmeloApiStack(app, 'MedmeloApiStack', {
  env: {
    account: '101374115637',
    region: 'ap-south-1',
  },
});

new MedmeloObservabilityStack(app, 'MedmeloObservabilityStack', {
  env: {
    account: '101374115637',
    region: 'ap-south-1',
  },
});
