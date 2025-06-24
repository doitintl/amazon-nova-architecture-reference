import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { DnsHelper } from './dns-config';

interface WebappStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  apiEndpoint?: string;
  dnsHelper?: DnsHelper;
}

export class WebappStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: WebappStackProps) {
    super(scope, id, props);

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'WebappCluster', {
      vpc: props.vpc,
    });

    // Create a log group for the container
    const logGroup = new logs.LogGroup(this, 'WebappLogGroup', {
      logGroupName: '/ecs/nova-sonic-webapp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create a task execution role
    const executionRole = new iam.Role(this, 'WebappTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Create a task role with permissions to access AWS services
    const taskRole = new iam.Role(this, 'WebappTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Create a task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WebappTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole: executionRole,
      taskRole: taskRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },      
    });

    // Add container to the task definition
    const container = taskDefinition.addContainer('WebappContainer', {
      image: ecs.ContainerImage.fromAsset('../nova-sonic/vite-client',{
        platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'webapp',
        logGroup: logGroup,
      }),
      environment: {
        'SONIC_APP_API_ENDPOINT': props.apiEndpoint || 'http://localhost:8000', // Use provided API endpoint or default
      },
      portMappings: [
        {
          containerPort: 80,
          hostPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    // Create security group for the service
    const webappSecurityGroup = new ec2.SecurityGroup(this, 'WebappSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic Webapp',
      allowAllOutbound: true,
    });

    // Create security group for the load balancer
    const lbSecurityGroup = new ec2.SecurityGroup(this, 'WebappLBSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Nova Sonic Webapp Load Balancer',
      allowAllOutbound: true,
    });

    // Allow inbound traffic on port 80 and 443 to the load balancer
    lbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );
    lbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // Allow traffic from the load balancer to the service
    webappSecurityGroup.addIngressRule(
      lbSecurityGroup,
      ec2.Port.tcp(80),
      'Allow traffic from the load balancer to the webapp'
    );

    // Create the load balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'WebappLB', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup,
    });

    // Create a target group for the service
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'WebappTargetGroup', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
      },
    });

    // Add HTTP listener to the load balancer
    const httpListener = this.loadBalancer.addListener('WebappHttpListener', {
      port: 80,
      open: true,
    });

    // Add target group to the HTTP listener
    httpListener.addTargetGroups('WebappTargetGroup', {
      targetGroups: [targetGroup],
    });
    
    // Add HTTPS listener if DNS helper is provided
    if (props.dnsHelper) {
      // Get the certificate for the webapp
      const certificate = props.dnsHelper.getWebappCertificate();
      
      // Add HTTPS listener with the certificate
      const httpsListener = this.loadBalancer.addListener('WebappHttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED,
        open: true,
      });
      
      // Add target group to the HTTPS listener
      httpsListener.addTargetGroups('WebappHttpsTargetGroup', {
        targetGroups: [targetGroup],
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
      
      // Create DNS record for the webapp
      const dnsRecord = props.dnsHelper.createWebappDnsRecord(this.loadBalancer);
      
      // Output the webapp domain name
      new cdk.CfnOutput(this, 'WebappDomainName', {
        value: props.dnsHelper.getWebappDomainName(),
        description: 'The domain name of the webapp',
        exportName: 'NovaSonicWebappDomainName',
      });
    }

    // Create the Fargate service
    this.service = new ecs.FargateService(this, 'WebappService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [webappSecurityGroup],
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Add the service as a target to the target group
    this.service.attachToApplicationTargetGroup(targetGroup);

    // Auto-scaling configuration
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Output the load balancer DNS name
    new cdk.CfnOutput(this, 'WebappLoadBalancerDNS', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the webapp load balancer',
      exportName: 'NovaSonicWebappLBDNS',
    });
    
    // Output the load balancer URL
    new cdk.CfnOutput(this, 'WebappLoadBalancerUrl', {
      value: `http://${this.loadBalancer.loadBalancerDnsName}`,
      description: 'The URL of the webapp load balancer',
    });
  }
}