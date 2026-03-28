import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface MedmeloAuthStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolClientId: string;
}

export class MedmeloAuthStack extends cdk.Stack {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: MedmeloAuthStackProps) {
    super(scope, id, props);

    // ✅ TAKE FROM PROPS (NOT HARDCODE)
    this.userPoolId = props.userPoolId;
    this.userPoolClientId = props.userPoolClientId;

    // ✅ IMPORT EXISTING USER POOL
    this.userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      this.userPoolId
    );

    // ─────────────────────────────────────────
    // OUTPUTS (OPTIONAL BUT OK)
    // ─────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClientId,
    });
  }
}