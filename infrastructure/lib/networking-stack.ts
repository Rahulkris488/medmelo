import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface MedmeloNetworkingStackProps extends cdk.StackProps {
  vpcName: string;
  lambdaSecurityGroupId: string;
}

export class MedmeloNetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly lambdaSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: MedmeloNetworkingStackProps) {
    super(scope, id, props);

    this.vpc = ec2.Vpc.fromLookup(this, 'ImportedVPC', {
      vpcName: props.vpcName,
    });

    this.lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedLambdaSG',
      props.lambdaSecurityGroupId
    );
  }
}
