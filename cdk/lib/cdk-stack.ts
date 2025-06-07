import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { WebappStack } from './webapp-stack';
import { ApiStack } from './api-stack';
import { ApiEc2Stack } from './api-ec2-stack';
import { DynamoDbStack } from './dynamodb-stack';
import { DnsHelper, DnsConfig } from './dns-config';

/**
 * API deployment type
 */
export enum ApiDeploymentType {
  ECS = 'ecs',
  EC2_DIRECT = 'ec2-direct'
}

export interface CdkStackProps extends cdk.StackProps {
  /**
   * Optional DNS configuration
   */
  dnsConfig?: DnsConfig;
  
  /**
   * The deployment type for the API (ECS or EC2_DIRECT)
   * @default ApiDeploymentType.ECS
   */
  apiDeploymentType?: ApiDeploymentType;   
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CdkStackProps) {
    super(scope, id, props);

    // Set default deployment type if not provided
    const apiDeploymentType = props?.apiDeploymentType || ApiDeploymentType.ECS;

    // Create the network stack
    const networkStack = new NetworkStack(scope, 'NovaSonicNetworkStack', {
      stackName: 'nova-sonic-network',
      ...props,
    });

    // Create the DynamoDB stack
    const dynamoDbStack = new DynamoDbStack(scope, 'NovaSonicDynamoDbStack', {
      stackName: 'nova-sonic-dynamodb',
      ...props,
    });
    
    // Import the RestaurantBooking table if it exists
    let restaurantBookingTable: dynamodb.ITable | undefined;
    try {
      restaurantBookingTable = dynamodb.Table.fromTableName(
        this,
        'ImportedRestaurantBookingTable',
        'RestaurantBooking'
      );
    } catch (error) {
      console.log('RestaurantBooking table not found, continuing without it');
    }

    // Create DNS helper if DNS configuration is provided
    let dnsHelper: DnsHelper | undefined;
    if (props?.dnsConfig) {
      dnsHelper = new DnsHelper(this, props.dnsConfig);
    }

    // Create the API stack based on deployment type
    let apiLoadBalancer: cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer;
    let apiStack: ApiStack | undefined;
    let apiEc2Stack: ApiEc2Stack | undefined;
    
    if (apiDeploymentType === ApiDeploymentType.ECS) {
      // Create the ECS-based API stack
      apiStack = new ApiStack(scope, 'NovaSonicApiStack', {
        stackName: 'nova-sonic-api',
        vpc: networkStack.vpc,
        dnsHelper: dnsHelper,
        dynamoDbTable: dynamoDbStack.conversationTable,
        ...props,
      });
      
      apiLoadBalancer = apiStack.apiLoadBalancer;
    } else {
      // Create the EC2-based API stack
      apiEc2Stack = new ApiEc2Stack(scope, 'NovaSonicApiEc2Stack', {
        stackName: 'nova-sonic-api-ec2',
        vpc: networkStack.vpc,
        dnsHelper: dnsHelper,
        dynamoDbTable: dynamoDbStack.conversationTable,
        ...props,
      });
     
      apiLoadBalancer = apiEc2Stack.apiLoadBalancer;
    }

    // Determine API endpoint based on DNS configuration
    let apiEndpoint: string;
    if (dnsHelper) {
      apiEndpoint = `https://${dnsHelper.getApiDomainName()}`;
    } else {
      apiEndpoint = `http://${apiLoadBalancer.loadBalancerDnsName}`;
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
    webappStack.node.addDependency(networkStack);
    
    // The API stacks depend on both the network stack and the DynamoDB stack
    if (apiStack) {
      // For ECS deployment
      apiStack.addDependency(networkStack);
      apiStack.addDependency(dynamoDbStack);
      
      // The webapp stack depends on the API stack
      webappStack.node.addDependency(apiStack);
    } else if (apiEc2Stack) {
      // For EC2 direct deployment
      apiEc2Stack.addDependency(networkStack);
      apiEc2Stack.addDependency(dynamoDbStack);
      
      // The webapp stack depends on the API stack
      webappStack.node.addDependency(apiEc2Stack);
    }

  }
}
