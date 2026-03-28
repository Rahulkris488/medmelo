import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class MedmeloNetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly lambdaSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 👇 IMPORT EXISTING VPC
    this.vpc = ec2.Vpc.fromLookup(this, 'ImportedVPC', {
      vpcName: 'medmelo-vpc',
    });

    // 👇 IMPORT EXISTING SG
    this.lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedLambdaSG',
      'sg-093bbec0230c606db'
    );
  }
}
