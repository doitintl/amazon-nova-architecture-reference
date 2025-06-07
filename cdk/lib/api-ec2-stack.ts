import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import { Construct } from 'constructs';
import { DnsHelper } from './dns-config';

interface ApiEc2StackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  webappLoadBalancerDns?: string;
  dnsHelper?: DnsHelper;
  novaAwsRegion?: string; // AWS region for Nova Sonic
  dynamoDbTable: dynamodb.Table; // DynamoDB table for conversation history
}

export class ApiEc2Stack extends cdk.Stack {
  public readonly apiLoadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly table: dynamodb.Table;
  public readonly autoScalingGroup: autoscaling.AutoScalingGroup;
  public readonly novaAwsRegion: string; // AWS region for Nova Sonic

  constructor(scope: Construct, id: string, props: ApiEc2StackProps) {
    super(scope, id, props);

    // Use the provided DynamoDB table
    this.table = props.dynamoDbTable;

    this.novaAwsRegion = props.novaAwsRegion || 'us-east-1';

    // Create security group for the API
    const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic API',
      allowAllOutbound: true,
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
      ec2.Port.udpRange(10000, 65535),
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
    
    // Allow UDP traffic for WebRTC functionality
    apiSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udpRange(10000, 65535),
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

    // Create IAM role for EC2 instances
    const ec2Role = new iam.Role(this, 'ApiEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonTranscribeFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    // Grant permissions to the DynamoDB table
    this.table.grantReadWriteData(ec2Role);

    // Create user data script for Docker installation and container execution
    const userData = ec2.UserData.forLinux();
    
    // Determine the Docker image to use
    let ecrImageUrl: string;
    let ecrRepoUrl: string;
    
    // // Create a Docker image asset from the API Dockerfile
    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'ApiDockerImage', {
      directory: path.join(__dirname, '../../nova-sonic/api'),
      platform: ecr_assets.Platform.LINUX_ARM64,
    });

    // Get the ECR image URL from the asset
    ecrImageUrl = dockerImageAsset.imageUri;
    ecrRepoUrl = `${this.account}.dkr.ecr.${this.region}.amazonaws.com`;
    
    console.log(`Building Docker image from local Dockerfile: ${ecrImageUrl}`);
    
    userData.addCommands(
      '#!/bin/bash',
      'yum update -y',
      'yum install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${ecrRepoUrl}`,
      'mkdir -p /var/log/nova-sonic',
      'docker run -d --restart always --network=host \\',
      '  -v /var/log/nova-sonic:/var/log/nova-sonic \\',
      `  -e AWS_REGION=${this.region} \\`,
      `  -e DYNAMODB_TABLE_NAME=${this.table.tableName} \\`,
      '  -e STUN_SERVER=stun:stun.l.google.com:19302 \\',
      '  -e RESTAURANT_BOOKING_API_URL=https://lcp8gupvck.execute-api.us-east-1.amazonaws.com/demo \\',
      '  -e HOST=0.0.0.0 \\',
      '  -e PORT=8000 \\',
      '  -e LOG_LEVEL=INFO \\',
      '  -e LOG_FILE_PATH=/var/log/nova-sonic/api.log \\',
      '  -e NOVA_SONIC_VOICE_ID=tiffany \\',
      `  -e NOVA_AWS_REGION=${this.novaAwsRegion} \\`,
      '  -e NOVA_AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} \\',
      '  -e NOVA_AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY} \\',
      `  ${ecrImageUrl}`
    );

    // Create Auto Scaling Group
    this.autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'ApiASG', {
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.C7G, ec2.InstanceSize.XLARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      minCapacity: 1,
      maxCapacity: 3,
      desiredCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: apiSecurityGroup,
      role: ec2Role,
      userData: userData,
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: cdk.Duration.minutes(5),
      }),
    });

    // Add scaling policy
    this.autoScalingGroup.scaleOnCpuUtilization('ASGCpuScaling', {
      targetUtilizationPercent: 80,
      cooldown: cdk.Duration.seconds(300),
    });

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
        port: 'traffic-port',
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

    // Register the ASG with the target group
    httpTargetGroup.addTarget(this.autoScalingGroup);

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

    // No need to output the DynamoDB table name here as it's done in the DynamoDbStack
  }
}
