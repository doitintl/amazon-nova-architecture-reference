import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { WebappStack } from './webapp-stack';
import { ApiStack } from './api-stack';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the network stack
    const networkStack = new NetworkStack(scope, 'NovaSonicNetworkStack', {
      stackName: 'nova-sonic-network',
      ...props,
    });

    // Create the API stack
    const apiStack = new ApiStack(scope, 'NovaSonicApiStack', {
      stackName: 'nova-sonic-api',
      vpc: networkStack.vpc,
      ...props,
    });

    // Create the webapp stack with API endpoint
    const webappStack = new WebappStack(scope, 'NovaSonicWebappStack', {
      stackName: 'nova-sonic-webapp',
      vpc: networkStack.vpc,
      apiEndpoint: `http://${apiStack.apiLoadBalancer.loadBalancerDnsName}`,
      ...props,
    });

    // Create dependencies between stacks

    // Add dependencies
    webappStack.node.addDependency(apiStack);
    apiStack.node.addDependency(networkStack);
  }
}
