import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { WebappStack } from './webapp-stack';
import { ApiStack } from './api-stack';
import { DnsHelper, DnsConfig } from './dns-config';

export interface CdkStackProps extends cdk.StackProps {
  /**
   * Optional DNS configuration
   */
  dnsConfig?: DnsConfig;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CdkStackProps) {
    super(scope, id, props);

    // Create the network stack
    const networkStack = new NetworkStack(scope, 'NovaSonicNetworkStack', {
      stackName: 'nova-sonic-network',
      ...props,
    });

    // Create DNS helper if DNS configuration is provided
    let dnsHelper: DnsHelper | undefined;
    if (props?.dnsConfig) {
      dnsHelper = new DnsHelper(this, props.dnsConfig);
    }

    // Create the API stack
    const apiStack = new ApiStack(scope, 'NovaSonicApiStack', {
      stackName: 'nova-sonic-api',
      vpc: networkStack.vpc,
      dnsHelper: dnsHelper,
      ...props,
    });

    // Determine API endpoint based on DNS configuration
    let apiEndpoint: string;
    if (dnsHelper) {
      apiEndpoint = `https://${dnsHelper.getApiDomainName()}`;
    } else {
      apiEndpoint = `http://${apiStack.apiLoadBalancer.loadBalancerDnsName}`;
    }

    // Create the webapp stack with API endpoint
    const webappStack = new WebappStack(scope, 'NovaSonicWebappStack', {
      stackName: 'nova-sonic-webapp',
      vpc: networkStack.vpc,
      apiEndpoint: apiEndpoint,
      dnsHelper: dnsHelper,
      ...props,
    });

    // Create dependencies between stacks

    // Add dependencies
    webappStack.node.addDependency(apiStack);
    apiStack.node.addDependency(networkStack);
  }
}
