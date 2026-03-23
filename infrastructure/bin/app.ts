import * as cdk from 'aws-cdk-lib';
import { MedmeloDataStack } from '../lib/data-stack';

const app = new cdk.App();

new MedmeloDataStack(app, 'MedmeloDataStack', {
  env: {
    account: '101374115637',
    region: 'ap-south-1',
  },
});