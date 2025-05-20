# Nova Sonic CDK Infrastructure

This project contains the AWS CDK infrastructure code for deploying the Nova Sonic speech-to-speech application.

## Architecture

The infrastructure consists of the following components:

1. **Network Stack**
   - VPC with public and private subnets across 2 availability zones
   - NAT Gateway for outbound internet access from private subnets

2. **API Stack**
   - ECS Fargate service for the Nova Sonic API
   - Application Load Balancer for distributing traffic
   - DynamoDB table for storing conversation history
   - IAM roles with permissions for AWS services (Transcribe, Bedrock, DynamoDB)
   - Auto-scaling configuration based on CPU utilization

3. **Webapp Stack**
   - ECS Fargate service for the Nova Sonic WebRTC frontend
   - Application Load Balancer for distributing traffic
   - Auto-scaling configuration based on CPU utilization

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 14.x or later
- AWS CDK v2 installed (`npm install -g aws-cdk`)

## Deployment

1. **Install dependencies**

```bash
npm install
```

2. **Bootstrap your AWS environment** (if you haven't already)

```bash
cdk bootstrap
```

3. **Synthesize CloudFormation templates**

```bash
cdk synth
```

4. **Deploy the stacks**

```bash
cdk deploy --all
```

Or deploy individual stacks:

```bash
cdk deploy NovaSonicNetworkStack
cdk deploy NovaSonicApiStack
cdk deploy NovaSonicWebappStack
```

## Useful CDK Commands

* `npm run build`   compile TypeScript to JS
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## Security Considerations

- The infrastructure includes security groups that restrict traffic between components
- IAM roles follow the principle of least privilege
- Containers run in private subnets with outbound internet access through NAT Gateway
- Load balancers are the only components exposed to the internet

## Cost Optimization

- Auto-scaling is configured to scale based on CPU utilization
- NAT Gateway is shared across availability zones to reduce costs
- DynamoDB is configured with on-demand capacity to optimize costs based on usage

## Customization

You can customize the deployment by modifying the following environment variables:

- `AWS_REGION`: The AWS region to deploy to (default: us-east-1)
- `AWS_ACCOUNT_ID`: Your AWS account ID

## Cleanup

To remove all resources created by the CDK:

```bash
cdk destroy --all
