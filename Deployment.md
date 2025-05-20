# Deployment Guide for Speech-to-Speech with Amazon Nova Sonic

This document provides detailed instructions for deploying the Speech-to-Speech application with Amazon Nova Sonic using AWS Cloud Development Kit (CDK).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [CDK Stack Overview](#cdk-stack-overview)
4. [Deployment Steps](#deployment-steps)
5. [Verification](#verification)
6. [Troubleshooting](#troubleshooting)
7. [Cleanup](#cleanup)

## Prerequisites

Before deploying the application, ensure you have the following:

### AWS Account Setup

- An active AWS account with administrative permissions
- AWS CLI installed and configured with appropriate credentials
- Sufficient quotas for the following services:
  - Amazon ECS Fargate
  - Amazon DynamoDB
  - Elastic Load Balancing (Application and Network Load Balancers)
  - Amazon Bedrock with access to Nova Sonic models

### Required Tools

- **Node.js** (v14.x or later) and npm
- **AWS CDK** (v2.x) installed globally: `npm install -g aws-cdk`
- **Docker** (latest version) for building container images
- **Git** for cloning the repository
- **TypeScript** (v4.x or later): `npm install -g typescript`

### IAM Permissions

The deployment user or role should have the following permissions:

- `AmazonECR-FullAccess`
- `AmazonECS-FullAccess`
- `AmazonDynamoDBFullAccess`
- `AmazonVPCFullAccess`
- `AmazonBedrockFullAccess`
- `CloudFormationFullAccess`
- `IAMFullAccess`

Alternatively, you can use `AdministratorAccess` for simplicity, but this is not recommended for production environments.

## Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/speech-to-speech-amazon-nova-sonic.git
   cd speech-to-speech-amazon-nova-sonic
   ```

2. Configure environment variables:

   a. For the API service, create a `.env` file in the `nova-sonic/api` directory:
   ```bash
   cd nova-sonic/api
   cp .env.example .env
   ```
   
   Edit the `.env` file with the following values:
   ```
   AWS_REGION=us-east-1  # Or your preferred region
   NOVA_SONIC_VOICE_ID=tiffany  # Or your preferred voice ID
   STUN_SERVER=stun:stun.l.google.com:19302
   HOST=0.0.0.0
   PORT=8000
   LOG_LEVEL=INFO
   ```

   b. For the web application, create a `.env` file in the `nova-sonic/webapp` directory:
   ```bash
   cd ../webapp
   cp .env.example .env
   ```
   
   The API endpoint will be automatically configured during deployment, but you can set other environment variables as needed.

3. Install CDK dependencies:
   ```bash
   cd ../../cdk
   npm install
   ```

4. Bootstrap the CDK environment (if not already done):
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```
   Replace `ACCOUNT-NUMBER` with your AWS account number and `REGION` with your preferred AWS region.

## CDK Stack Overview

The application is deployed using three main CDK stacks:

### 1. Network Stack (`network-stack.ts`)

This stack creates the networking infrastructure:
- A VPC with public and private subnets across 2 availability zones
- NAT Gateway for outbound connectivity from private subnets
- Security groups and network ACLs

Key components:
- VPC with CIDR block (default)
- 2 public subnets with /24 CIDR blocks
- 2 private subnets with /24 CIDR blocks
- 1 NAT Gateway for cost optimization

### 2. API Stack (`api-stack.ts`)

This stack deploys the backend API service:
- ECS Fargate service running the API container
- Application Load Balancer (ALB) for HTTP/HTTPS traffic
- Network Load Balancer (NLB) for WebRTC UDP traffic
- DynamoDB table for conversation history
- IAM roles and security groups

Key components:
- ECS Fargate task with 2 vCPU and 4GB memory (ARM64 architecture)
- Application Load Balancer with HTTP listener on port 80
- Network Load Balancer with UDP listeners for ports 3000-4000
- DynamoDB table with partition key `conversation_id` and sort key `timestamp`
- Auto-scaling configuration based on CPU utilization

### 3. Web Application Stack (`webapp-stack.ts`)

This stack deploys the frontend web application:
- ECS Fargate service running the web application container
- Application Load Balancer for HTTP/HTTPS traffic
- IAM roles and security groups

Key components:
- ECS Fargate task with 1 vCPU and 2GB memory (ARM64 architecture)
- Application Load Balancer with HTTP listener on port 80
- Auto-scaling configuration with min=2, max=10 instances
- Integration with the API service via environment variables

## Deployment Steps

Follow these steps to deploy the application:

### 1. Synthesize the CDK app

First, synthesize the CDK app to ensure there are no errors:

```bash
cd cdk
cdk synth
```

This command generates the CloudFormation templates that will be used for deployment.

### 2. Deploy the Network Stack

Deploy the network stack first:

```bash
cdk deploy NovaSonicNetworkStack
```

This will create the VPC and networking infrastructure. Note the outputs, especially the VPC ID.

### 3. Deploy the API Stack

Deploy the API stack next:

```bash
cdk deploy NovaSonicApiStack
```

This will:
- Build the API Docker image
- Push it to Amazon ECR
- Create the ECS task definition and service
- Set up the load balancers
- Create the DynamoDB table

Note the outputs, especially the API load balancer DNS name.

### 4. Deploy the Web Application Stack

Finally, deploy the web application stack:

```bash
cdk deploy NovaSonicWebappStack
```

This will:
- Build the web application Docker image
- Push it to Amazon ECR
- Create the ECS task definition and service
- Set up the load balancer
- Configure the web application to connect to the API service

### 5. Deploy All Stacks at Once (Alternative)

Alternatively, you can deploy all stacks at once:

```bash
cdk deploy --all
```

This will deploy the stacks in the correct order based on their dependencies.

## Verification

After deployment, verify that the application is working correctly:

1. Access the web application using the WebappLoadBalancerDNS output from the CDK deployment:
   ```
   http://<WebappLoadBalancerDNS>
   ```

2. Check that the ECS services are running:
   ```bash
   aws ecs list-services --cluster ApiCluster
   aws ecs list-services --cluster WebappCluster
   ```

3. Verify that the DynamoDB table was created:
   ```bash
   aws dynamodb describe-table --table-name NovaSonicConversations
   ```

4. Test the API health endpoint:
   ```bash
   curl http://<ApiLoadBalancerDNS>/api/health
   ```

## Troubleshooting

Here are some common issues and their solutions:

### Deployment Failures

1. **CDK Bootstrap Error**:
   - Error: "The CDK is not bootstrapped in this environment"
   - Solution: Run `cdk bootstrap aws://ACCOUNT-NUMBER/REGION`

2. **Docker Build Failure**:
   - Error: "Failed to build Docker image"
   - Solution: 
     - Ensure Docker is running
     - Check that the Dockerfile paths are correct
     - Verify you have sufficient permissions to build and push images

3. **IAM Permission Issues**:
   - Error: "User is not authorized to perform action on resource"
   - Solution: Ensure the deployment user has the necessary IAM permissions

### Runtime Issues

1. **Web Application Cannot Connect to API**:
   - Check that the API endpoint environment variable is correctly set
   - Verify that the security groups allow traffic between the web application and API
   - Check the API service logs for connection errors

2. **WebRTC Connection Failures**:
   - Ensure the UDP ports (3000-4000) are open in the security groups
   - Verify that the STUN server is correctly configured
   - Check browser console for WebRTC connection errors

3. **Nova Sonic Integration Issues**:
   - Verify that the AWS region has Nova Sonic available
   - Check that the IAM role has the necessary Bedrock permissions
   - Look for errors in the API service logs related to Bedrock

### Logging and Debugging

To view logs for troubleshooting:

1. **API Service Logs**:
   ```bash
   aws logs get-log-events --log-group-name /ecs/nova-sonic-api --log-stream-name <log-stream-name>
   ```

2. **Web Application Logs**:
   ```bash
   aws logs get-log-events --log-group-name /ecs/nova-sonic-webapp --log-stream-name <log-stream-name>
   ```

3. **ECS Service Events**:
   ```bash
   aws ecs describe-services --cluster ApiCluster --services ApiService
   ```

## Cleanup

To avoid incurring charges, delete the resources when they are no longer needed:

1. Delete the stacks in reverse order:
   ```bash
   cdk destroy NovaSonicWebappStack
   cdk destroy NovaSonicApiStack
   cdk destroy NovaSonicNetworkStack
   ```

2. Or delete all stacks at once:
   ```bash
   cdk destroy --all
   ```

3. Manually check for any resources that might not have been deleted:
   - ECR repositories
   - CloudWatch log groups
   - S3 buckets for ALB access logs

## Additional Configuration

### Custom Domain and HTTPS

To use a custom domain and HTTPS:

1. Register a domain in Amazon Route 53 or use an existing domain
2. Create an SSL certificate in AWS Certificate Manager
3. Uncomment and update the HTTPS listener configuration in `api-stack.ts` and `webapp-stack.ts`
4. Create Route 53 records pointing to the load balancers

### Scaling Configuration

To adjust the scaling configuration:

1. Modify the `desiredCount`, `minCapacity`, and `maxCapacity` parameters in the stack files
2. Adjust the CPU and memory allocations in the task definitions
3. Update the auto-scaling rules based on your expected load

### Cost Optimization

To optimize costs:

1. Reduce the number of NAT Gateways (already optimized to 1)
2. Use Spot instances for the ECS tasks (requires additional configuration)
3. Adjust the auto-scaling parameters to scale down during low-usage periods
4. Consider using AWS Savings Plans for Fargate