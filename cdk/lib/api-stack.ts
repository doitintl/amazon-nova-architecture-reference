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
import { Construct } from 'constructs';
import { hasSubscribers } from 'diagnostics_channel';

interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  webappLoadBalancerDns?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly service: ecs.Ec2Service;
  public readonly apiLoadBalancer: elbv2.ApplicationLoadBalancer;
  // public readonly webrtcLoadBalancer: elbv2.NetworkLoadBalancer;
  public readonly table: dynamodb.Table;
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Create DynamoDB table for conversation history
    this.table = new dynamodb.Table(this, 'NovaSonicConversations', {
      partitionKey: { name: 'conversation_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

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
    
    // Add capacity to the cluster with EC2 instances
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'ApiASG', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: apiSecurityGroup,
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: cdk.Duration.minutes(5),
      }),
    });
    
    // Add the Auto Scaling Group as capacity to the ECS cluster
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'ApiCapacityProvider', {
      autoScalingGroup,
      enableManagedTerminationProtection: false,
      machineImageType: ecs.MachineImageType.AMAZON_LINUX_2,
    });
    
    this.cluster.addAsgCapacityProvider(capacityProvider);
    
    // Grant permissions for EC2 instances to access ECR and other services
    autoScalingGroup.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    autoScalingGroup.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
    );
    autoScalingGroup.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
    );

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

    // Grant permissions to the DynamoDB table
    this.table.grantReadWriteData(taskRole);

    // Create a task definition for EC2
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'ApiTaskDef', {
      executionRole: executionRole,
      taskRole: taskRole,
      networkMode: ecs.NetworkMode.HOST,
    });

    // Add container to the task definition
    const container = taskDefinition.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromAsset('../nova-sonic/api', {
        platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
      }),
      memoryLimitMiB: 2048,
      cpu: 1024,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup: logGroup,
      }),
      environment: {
        'AWS_REGION': this.region,
        'DYNAMODB_TABLE_NAME': this.table.tableName,
        'STUN_SERVER': 'stun:stun.l.google.com:19302',
        'HOST': '0.0.0.0',
        'PORT': '8000',
        'LOG_LEVEL': 'INFO',
        'NOVA_SONIC_VOICE_ID': 'tiffany',
      },
      portMappings: [
        {
          containerPort: 8000,
          hostPort: 8000, // Dynamic port mapping for better host port utilization
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

    // Create security group for the WebRTC load balancer
    const webrtcLbSecurityGroup = new ec2.SecurityGroup(this, 'WebRTCLBSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic WebRTC Network Load Balancer',
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
    
    // Allow UDP traffic for WebRTC on the WebRTC load balancer
    webrtcLbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(3000, 4000),
      'Allow UDP traffic for WebRTC functionality on the load balancer'
    );

    // Allow traffic from the API load balancer to the service
    apiSecurityGroup.addIngressRule(
      apiLbSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow traffic from the API load balancer to the API'
    );

    // Allow traffic from the WebRTC load balancer to the service
    apiSecurityGroup.addIngressRule(
      webrtcLbSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow traffic from the WebRTC load balancer to the API'
    );
    
    // Allow UDP traffic for WebRTC functionality (ports 3000-4000)
    apiSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(3000, 4000),
      'Allow UDP traffic for WebRTC functionality'
    );

    // If we have a webapp load balancer, allow traffic from it to the API
    if (props.webappLoadBalancerDns) {
      apiSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(8000),
        'Allow traffic from the webapp to the API'
      );
    }

    // Create the Application Load Balancer for API traffic
    this.apiLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ApiLB', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: apiLbSecurityGroup,
      // Enable deletion protection in production
      deletionProtection: false,
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
        path: '/api/health',
        port: 'traffic-port',         // Use the traffic port for health checks (dynamic)
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        timeout: cdk.Duration.seconds(5),
      },
      // Enable stickiness for session persistence
      stickinessCookieDuration: cdk.Duration.days(1),
      // Deregistration delay (draining)
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Add HTTP listener to the ALB for API traffic
    const httpListener = this.apiLoadBalancer.addListener('ApiHttpListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.forward([httpTargetGroup]),
    });

    // Add HTTPS listener (commented out - would need a certificate)
    /*
    const certificate = elbv2.ListenerCertificate.fromArn('arn:aws:acm:region:account:certificate/certificate-id');
    
    const httpsListener = this.apiLoadBalancer.addListener('ApiHttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultAction: elbv2.ListenerAction.forward([httpTargetGroup]),
      // Enable HTTP to HTTPS redirection
      sslPolicy: elbv2.SslPolicy.RECOMMENDED,
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
        statusCode: 'HTTP_301',
      }),
    });
    */

    // // Create a separate Network Load Balancer for WebRTC UDP traffic
    // this.webrtcLoadBalancer = new elbv2.NetworkLoadBalancer(this, 'WebRtcLB', {
    //   vpc: props.vpc,
    //   internetFacing: true,
    //   crossZoneEnabled: true,
    // });

    // // Create UDP target group for WebRTC (ports 3000-4000)
    // const udpTargetGroup = new elbv2.NetworkTargetGroup(this, 'WebRtcUdpTargetGroup', {
    //   vpc: props.vpc,
    //   port: 3000, // Base port for UDP range
    //   protocol: elbv2.Protocol.UDP,
    //   targetType: elbv2.TargetType.INSTANCE,
    //   healthCheck: {
    //     protocol: elbv2.Protocol.TCP, // Health check must use TCP even for UDP target groups
    //     port: 'traffic-port',         // Use the traffic port for health checks (dynamic)
    //     interval: cdk.Duration.seconds(30),
    //     healthyThresholdCount: 2,
    //     unhealthyThresholdCount: 2,
    //   },
    // });

    // // Add multiple UDP listeners for WebRTC traffic to cover the range 3000-4000
    // // We'll create listeners at strategic points in the range
    // const udpPorts = [3000, 3250, 3500, 3750, 4000]; // Strategic ports across the range
    
    // udpPorts.forEach((port, index) => {
    //   this.webrtcLoadBalancer.addListener(`WebRtcUdpListener${index}`, {
    //     port: port,
    //     protocol: elbv2.Protocol.UDP,
    //     defaultAction: elbv2.NetworkListenerAction.forward([udpTargetGroup]),
    //   });
    // });
    
    // // Add a specific note about UDP port range support
    // new cdk.CfnOutput(this, 'WebRTCUdpPortRange', {
    //   value: '3000-4000',
    //   description: 'UDP port range supported for WebRTC',
    //   exportName: 'NovaSonicWebRTCUdpPortRange',
    // });

    // Create the EC2 service
    this.service = new ecs.Ec2Service(this, 'ApiService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 2,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
      circuitBreaker: { rollback: false },
    });

    // Register the service with the target groups
    httpTargetGroup.addTarget(this.service);
    // udpTargetGroup.addTarget(this.service);

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
    
    // Auto-scaling for the EC2 instances
    autoScalingGroup.scaleOnCpuUtilization('ASGCpuScaling', {
      targetUtilizationPercent: 80,
      cooldown: cdk.Duration.seconds(300),
    });

    // Output the API load balancer DNS name
    new cdk.CfnOutput(this, 'ApiLoadBalancerDNS', {
      value: this.apiLoadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the API load balancer',
      exportName: 'NovaSonicApiLBDNS',
    });

    // // Output the WebRTC load balancer DNS name
    // new cdk.CfnOutput(this, 'WebRtcLoadBalancerDNS', {
    //   value: this.webrtcLoadBalancer.loadBalancerDnsName,
    //   description: 'The DNS name of the WebRTC load balancer',
    //   exportName: 'NovaSonicWebRtcLBDNS',
    // });

    // Output the DynamoDB table name
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: this.table.tableName,
      description: 'The name of the DynamoDB table',
      exportName: 'NovaSonicDynamoDBTableName',
    });
  }
}