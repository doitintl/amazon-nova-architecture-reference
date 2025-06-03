# EC2-based API Deployment

This document explains how to deploy the Nova Sonic API using EC2 instances directly running Docker containers, as an alternative to the existing ECS-based deployment.

> **New Feature**: The deployment now supports building the Docker image directly from the local Dockerfile using CDK's DockerImageAsset, eliminating the need to manually build and push the image to ECR.

## Deployment Options

The Nova Sonic infrastructure now supports two deployment options for the API:

1. **ECS-based deployment (default)**: Deploys the API container using Amazon ECS (Elastic Container Service)
2. **EC2-direct deployment**: Deploys the API container directly on EC2 instances using Docker

## Deployment Options for Docker Image

You have two options for deploying the Docker image:

### Option 1: Build from Local Dockerfile (Recommended)

With this option, CDK will automatically build the Docker image from the local Dockerfile and push it to ECR during deployment. This is the simplest approach and requires no manual steps.

```bash
cd cdk
cdk deploy --context apiDeploymentType=ec2-direct
```

### Option 2: Use Pre-built ECR Image

If you prefer to build and push the image manually:

1. Create an ECR repository (if not already created)
2. Build and push the API image to ECR
3. Deploy with the ECR image URL

```bash
# Create ECR repository (if not already created)
aws ecr create-repository --repository-name nova-sonic-api --region us-east-1

# Build and push the API image to ECR
cd nova-sonic/api
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest .
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest

# Deploy with the ECR image URL
cd ../../cdk
cdk deploy --context apiDeploymentType=ec2-direct --context apiEcrImageUrl=<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest
```

## Deployment Commands

### Deploy with EC2-based API (Direct Docker)

#### Using Local Dockerfile (Recommended)

```bash
cd cdk
cdk deploy --context apiDeploymentType=ec2-direct
```

You can also deploy just the API stack:

```bash
cd cdk
cdk deploy NovaSonicApiEc2Stack --context apiDeploymentType=ec2-direct
```

#### Using Pre-built ECR Image

```bash
cd cdk
cdk deploy --context apiDeploymentType=ec2-direct --context apiEcrImageUrl=<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest
```

#### Disabling Local Dockerfile Build

If you want to disable the local Dockerfile build but don't have a pre-built ECR image:

```bash
cd cdk
cdk deploy --context apiDeploymentType=ec2-direct --context useLocalDockerfile=false
```

This will use a default ECR image URL based on your account and region, but you'll need to ensure the repository and image exist.

### Deploy with ECS-based API (Default)

```bash
cd cdk
cdk deploy --context apiDeploymentType=ecs --context apiComputeType=ec2
```

You can also specify the compute type for ECS (EC2 or Fargate):

```bash
cd cdk
cdk deploy --context apiDeploymentType=ecs --context apiComputeType=fargate
```

## Environment Variables

You can also set environment variables instead of using context variables:

```bash
export API_DEPLOYMENT_TYPE=ec2-direct
# Optional: Specify ECR image URL if not using local Dockerfile
export API_ECR_IMAGE_URL=<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest
# Optional: Disable local Dockerfile build
export USE_LOCAL_DOCKERFILE=false
cd cdk
cdk deploy
```

## Architecture Comparison

### EC2-based Deployment (Direct Docker)

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Application │     │      Auto     │     │  EC2 Instance │
│ Load Balancer │────▶│ Scaling Group │────▶│ with Docker   │
└───────────────┘     └───────────────┘     └───────────────┘
                                                    │
                                                    ▼
                                           ┌───────────────┐
                                           │   DynamoDB    │
                                           └───────────────┘
```

- **Pros**:
  - Simpler architecture with fewer AWS services
  - Direct control over the Docker runtime
  - Potentially lower costs for certain workloads
  - Easier to debug and troubleshoot

- **Cons**:
  - Manual container management
  - Less integrated with AWS container ecosystem
  - Requires more custom configuration for scaling and monitoring

### ECS-based Deployment

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Application │     │      ECS      │     │  EC2 Instance │
│ Load Balancer │────▶│    Service    │────▶│  or Fargate   │
└───────────────┘     └───────────────┘     └───────────────┘
                                                    │
                                                    ▼
                                           ┌───────────────┐
                                           │   DynamoDB    │
                                           └───────────────┘
```

- **Pros**:
  - Managed container orchestration
  - Better integration with AWS ecosystem
  - More sophisticated deployment options
  - Built-in monitoring and logging

- **Cons**:
  - More complex architecture
  - Potentially higher costs for certain workloads
  - Additional abstraction layer

## Implementation Details

The EC2-based deployment:

1. Creates an Auto Scaling Group with t4g.xlarge instances
2. Installs Docker on each instance using user data script
3. Pulls and runs the API container with the specified environment variables
4. Sets up a health check script that monitors the API and restarts Docker if needed
5. Uses the same load balancer and security group configuration as the ECS-based deployment

## Troubleshooting

If you encounter issues with the EC2-based deployment:

1. Check the EC2 instance logs in CloudWatch
2. SSH into the EC2 instance and check Docker logs:
   ```bash
   docker ps
   docker logs <container_id>
   ```
3. Verify that the ECR repository exists and the image is available
4. Check the health check script at `/opt/health-check.sh` on the EC2 instance

## Switching Between Deployment Types

You can switch between deployment types by redeploying with the appropriate context variables. The CDK will handle the transition, but be aware that there may be a brief period of downtime during the transition.