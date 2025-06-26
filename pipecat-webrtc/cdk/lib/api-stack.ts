import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { DnsHelper } from './dns-config';

interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  webappLoadBalancerDns?: string;
  dnsHelper?: DnsHelper;
  /**
   * DynamoDB table for conversation history
   */
  novaAwsRegion?: string;
  /**
   * URL for the restaurant booking API
   */
  restaurantBookingApiUrl: string;
}

export class ApiStack extends cdk.Stack {
  public readonly service: ecs.BaseService;
  public readonly apiLoadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly table: dynamodb.Table;
  public readonly cluster: ecs.Cluster;
  public readonly novaAwsRegion: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Use the provided DynamoDB table
    this.novaAwsRegion = props.novaAwsRegion || 'us-east-1';

    // Create ECS Cluster
    this.cluster = new ecs.Cluster(this, 'ApiCluster', {
      vpc: props.vpc,
    });
    
    // Create security group for the service
    const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic API',
      allowAllOutbound: true,
    });
    
    // Variables for later use
    let capacityProvider: ecs.AsgCapacityProvider | undefined;
    let autoScalingGroup: autoscaling.AutoScalingGroup | undefined;

    // For Fargate, add Fargate capacity provider
    this.cluster.addCapacity('DefaultFargateCapacity', {
      maxCapacity: 10,
      minCapacity: 1,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.C7I, ec2.InstanceSize.XLARGE),
    });

    // Create a log group for the container
    const logGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: '/ecs/nova-sonic-api',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create a task execution role
    const executionRole = new iam.Role(this, 'ApiTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create a task role with permissions to access AWS services
    const taskRole = new iam.Role(this, 'ApiTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add permissions for AWS services used by the API
    taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonTranscribeFullAccess'));
    taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'));

    // Create a task definition based on compute type
    let taskDefinition: ecs.TaskDefinition;
    let container: ecs.ContainerDefinition;

    // // Create a task definition for Fargate
    // taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
    //   executionRole: executionRole,
    //   taskRole: taskRole,
    //   cpu: 2048, // 2 vCPU
    //   memoryLimitMiB: 4096, // 4 GB
    // });
    // Create a task definition for Fargate
    taskDefinition = new ecs.Ec2TaskDefinition(this, 'ApiTaskDef', {
      executionRole: executionRole,
      taskRole: taskRole,
      networkMode: ecs.NetworkMode.HOST
    });
    
    // Add container to the Fargate task definition
    container = taskDefinition.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromAsset('../websocket/python-server', {
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      }),
      memoryLimitMiB: 512,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup: logGroup,
      }),
      environment: {
        'AWS_REGION': this.region,
        'HOST': '0.0.0.0',
        'WS_PORT': '8000',
        'HEALTH_PORT': '8080',
        'LOG_LEVEL': 'INFO',
        'NOVA_AWS_REGION': this.novaAwsRegion,
        'AWS_ACCESS_KEY_ID': '#{AWS_ACCESS_KEY_ID}',
        'AWS_SECRET_ACCESS_KEY': '#{AWS_SECRET_ACCESS_KEY}',
        'LOG_FILE': '/tmp/nova-sonic.log'
      },
      portMappings: [
        {
          containerPort: 8000,
          protocol: ecs.Protocol.TCP,
        },
        {
          containerPort: 8080,
          protocol: ecs.Protocol.TCP,
        }

      ],
    });

    // Create security group for the API load balancer
    const apiLbSecurityGroup = new ec2.SecurityGroup(this, 'ApiLBSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic API Application Load Balancer',
      allowAllOutbound: true,
    });

    // Allow inbound traffic on port 80 and 443 to the API load balancer
    apiLbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );
    apiLbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );
  

    // Allow traffic from the API load balancer to the service
    apiSecurityGroup.addIngressRule(
      apiLbSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow traffic from the API load balancer to the API'
    );
    apiSecurityGroup.addIngressRule(
      apiLbSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow health from the API load balancer to the API'
    );


    // Create the Application Load Balancer for API traffic
    this.apiLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ApiLB', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: apiLbSecurityGroup,
      // Enable deletion protection in production
      deletionProtection: false,
      idleTimeout: cdk.Duration.seconds(3600),// Increased from 30s to 60s for WebSocket connections
    });
    
    // Create S3 bucket for ALB access logs
    const accessLogsBucket = new s3.Bucket(this, 'ALBAccessLogs', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });
    
    // Enable access logging on the ALB
    this.apiLoadBalancer.logAccessLogs(accessLogsBucket, 'api-alb-logs');

    // Create a HTTP target group for the API service
    const httpTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiHttpTargetGroup', {
      vpc: props.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/health',
        port: '8080',                 // Health check now runs on the same port as WebSocket
        interval: cdk.Duration.seconds(30),  // Reduced from 30s to 15s for faster health detection
        healthyHttpCodes: '200',
        healthyThresholdCount: 3,     // Increased from 2 to 3 for more stability
        unhealthyThresholdCount: 3,   // Increased from 2 to 3 to avoid false negatives
        timeout: cdk.Duration.seconds(10),  // Increased from 5s to 10s to allow more time for response
      },
      // Enable stickiness for session persistence
      stickinessCookieDuration: cdk.Duration.days(1),
      // Deregistration delay (draining) - increased to allow WebSocket connections to complete
      deregistrationDelay: cdk.Duration.seconds(120),
    });

    // Add HTTP listener to the ALB for API traffic
    const httpListener = this.apiLoadBalancer.addListener('ApiHttpListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.forward([httpTargetGroup]),
    });

    // Add HTTPS listener if DNS helper is provided
    if (props.dnsHelper) {
      // Get the certificate for the API
      const certificate = props.dnsHelper.getApiCertificate();
      
      // Add HTTPS listener with the certificate
      const httpsListener = this.apiLoadBalancer.addListener('ApiHttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [certificate],
        defaultAction: elbv2.ListenerAction.forward([httpTargetGroup]),
        sslPolicy: elbv2.SslPolicy.RECOMMENDED,
        open: true,
      });
      
      // Redirect HTTP to HTTPS
      httpListener.addAction('HttpToHttpsRedirect', {
        priority: 1,
        conditions: [
          elbv2.ListenerCondition.pathPatterns(['/*']),
        ],
        action: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          host: '#{host}',
          path: '/#{path}',
          query: '#{query}',
        }),
      });
      
      // Create DNS record for the API
      const dnsRecord = props.dnsHelper.createApiDnsRecord(this.apiLoadBalancer);
      
      // Output the API domain name
      new cdk.CfnOutput(this, 'ApiDomainName', {
        value: props.dnsHelper.getApiDomainName(),
        description: 'The domain name of the API',
        exportName: 'NovaSonicApiDomainName',
      });
    }

    // // Create the Fargate service
    // this.service = new ecs.FargateService(this, 'ApiService', {
    //   cluster: this.cluster,
    //   taskDefinition,
    //   desiredCount: 2,
    //   securityGroups: [apiSecurityGroup],
    //   vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    //   assignPublicIp: true,
    //   circuitBreaker: { rollback: true },  // Enable rollback for circuit breaker
    //   healthCheckGracePeriod: cdk.Duration.seconds(120),  // Add grace period for health checks
    // });

    // Create the Ec2 service
    this.service = new ecs.Ec2Service(this, 'ApiService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1,
      // securityGroups: [apiSecurityGroup],
      // vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // assignPublicIp: true,
      circuitBreaker: { rollback: true },  // Enable rollback for circuit breaker
      healthCheckGracePeriod: cdk.Duration.seconds(120),  // Add grace period for health checks
    });

    // Register the service with the target groups
    httpTargetGroup.addTarget(this.service);

    // Auto-scaling configuration for the service
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 6,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    
    // Output the API load balancer DNS name
    new cdk.CfnOutput(this, 'ApiLoadBalancerDNS', {
      value: this.apiLoadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the API load balancer',
      exportName: 'NovaSonicApiLBDNS',
    });
    
    // Output the API load balancer URL
    new cdk.CfnOutput(this, 'ApiLoadBalancerUrl', {
      value: `http://${this.apiLoadBalancer.loadBalancerDnsName}`,
      description: 'The URL of the API load balancer',
    });
  }
}