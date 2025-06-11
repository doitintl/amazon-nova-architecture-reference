# Deployment Guide for Nova Sonic

This document provides detailed instructions for deploying the Nova Sonic speech-to-speech application with Amazon Bedrock.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Deployment Steps](#deployment-steps)
   - [Main CDK Stack](#main-cdk-stack)
   - [API Deployment Options](#api-deployment-options)
   - [Hotel Booking Setup](#hotel-booking-setup)
   - [AppSync Events API](#appsync-events-api)
4. [Verification Steps](#verification-steps)
5. [Troubleshooting](#troubleshooting)
6. [Cleanup Instructions](#cleanup-instructions)

## Prerequisites

Before deploying the application, ensure you have the following:

### AWS Account Setup

- An active AWS account with administrative permissions
- AWS CLI installed and configured with appropriate credentials
- Sufficient quotas for the following services:
  - Amazon ECS Fargate
  - Amazon EC2 (if using EC2-based deployment)
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

## Deployment Steps

### Main CDK Stack

1. **Configure HTTPS (Optional but Recommended)**

   For WebRTC to work properly with microphone access from browsers, HTTPS is required. To configure HTTPS:

   a. Create a `dns-config.json` file in the `cdk` directory:
   ```bash
   cd cdk
   cp dns-config.json.example dns-config.json  # If example exists, otherwise create it
   ```

   b. Edit the file with your domain and certificate information:
   ```json
   {
     "domainName": "example.com",
     "webappSubdomain": "app",
     "apiSubdomain": "api",
     "webappCertificateArn": "arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID_FOR_WEBAPP",
     "apiCertificateArn": "arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID_FOR_API"
   }
   ```

2. **Synthesize the CDK app**

   Synthesize the CDK app to ensure there are no errors:

   ```bash
   cd cdk
   cdk synth
   ```

   This command generates the CloudFormation templates that will be used for deployment.

3. **Deploy the Network Stack**

   Deploy the network stack first:

   ```bash
   cdk deploy NovaSonicNetworkStack
   ```

   This will create the VPC and networking infrastructure. Note the outputs, especially the VPC ID.

4. **Deploy All Core Stacks at Once (Alternative)**

   Alternatively, you can deploy all core stacks (excluding AppSync Events) at once:

   ```bash
   cdk deploy --all
   ```

   This will deploy the network, API, and webapp stacks in the correct order based on their dependencies.

### API Deployment Options

The Nova Sonic infrastructure supports two deployment options for the API:

#### ECS-based API Deployment

This is the default deployment option that uses Amazon ECS (Elastic Container Service).

1. **Deploy the API and Web Application Stacks**:

   ```bash
   cdk deploy NovaSonicApiStack NovaSonicWebappStack
   ```

   This will:
   - Build the API and web application Docker images
   - Push them to Amazon ECR
   - Create the ECS task definitions and services
   - Set up the load balancers with HTTP/HTTPS support
   - Create the DynamoDB tables
   - Create Route53 DNS records (if HTTPS is configured)
   - Configure the web application to connect to the API service

   You can also specify the compute type for ECS (EC2 or Fargate):

   ```bash
   cdk deploy --context apiDeploymentType=ecs --context apiComputeType=fargate
   ```

   Or for EC2-based ECS:

   ```bash
   cdk deploy --context apiDeploymentType=ecs --context apiComputeType=ec2
   ```

#### EC2-based API Deployment

As an alternative, you can deploy the API container directly on EC2 instances using Docker.

1. **Deploy with EC2-based API (Direct Docker)**:

   **Using Local Dockerfile (Recommended)**:

   ```bash
   cd cdk
   cdk deploy --context apiDeploymentType=ec2-direct
   ```

   You can also deploy just the API stack:

   ```bash
   cd cdk
   cdk deploy NovaSonicApiEc2Stack --context apiDeploymentType=ec2-direct
   ```

   **Using Pre-built ECR Image**:

   a. Create an ECR repository (if not already created):
   ```bash
   aws ecr create-repository --repository-name nova-sonic-api --region us-east-1
   ```

   b. Build and push the API image to ECR:
   ```bash
   cd nova-sonic/api
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
   docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest .
   docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest
   ```

   c. Deploy with the ECR image URL:
   ```bash
   cd ../../cdk
   cdk deploy --context apiDeploymentType=ec2-direct --context apiEcrImageUrl=<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nova-sonic-api:latest
   ```

2. **Environment Variables**:

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

### Hotel Booking Setup

The hotel booking functionality is integrated with the main API service. To set up the hotel booking feature:

1. **Deploy the DynamoDB table**:

   The DynamoDB table for hotel bookings is automatically created as part of the main CDK stack deployment.

2. **Configure the API service**:

   Ensure that the API service has the necessary environment variables for the hotel booking feature:

   ```
   ENABLE_HOTEL_BOOKING=true
   HOTEL_BOOKING_TABLE_NAME=RestaurantBookings
   ```

   These variables are automatically set during deployment.

3. **Test the hotel booking API**:

   After deployment, you can test the hotel booking API using the following endpoint:

   ```
   https://<apiSubdomain>.<domainName>/api/bookings
   ```

   Or if not using HTTPS:

   ```
   http://<ApiLoadBalancerDNS>/api/bookings
   ```

### AppSync Events API

The AppSync Events API provides real-time publish/subscribe functionality for change data capture from DynamoDB tables.

1. **Deploy the AppSync Events API stack**:

   The AppSync Events API is deployed separately using a dedicated deployment script:

   ```bash
   cd cdk
   npm install
   npx cdk deploy --app "npx ts-node bin/deploy-appsync.ts"
   ```

   This will deploy:
   - The DynamoDB tables with streams enabled
   - The AppSync Events API
   - The Lambda function that processes DynamoDB streams

2. **Note the outputs**:

   After deployment, note the following outputs:
   - `NovaSonicAppSyncEventsStack.EventsAPIURL`: The URL of the AppSync Events API
   - `NovaSonicAppSyncEventsStack.EventsAPIKey`: The API key for the AppSync Events API

3. **Client Integration**:

   a. Include the AWS Amplify library:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/aws-amplify@6.0.0/dist/aws-amplify.min.js"></script>
   ```

   b. Include the AppSync Events client:
   ```html
   <script src="js/appsync-events-client.js"></script>
   ```

   c. Initialize the client:
   ```javascript
   // Get AppSync API details from environment variables or configuration
   const apiUrl = 'https://abcdefghij.appsync-api.us-east-1.amazonaws.com';
   const apiKey = 'da2-abcdefghijklmnopqrstuvwxyz';
   
   // Initialize the AppSync Events client
   initializeAppSyncEventsClient(apiUrl, apiKey);
   ```

   d. Subscribe to channels:
   ```javascript
   // Subscribe to the 'restaurant-booking' channel
   const bookingSubscription = await subscribeToChannel('restaurant-booking', (message) => {
     console.log('New booking event:', message);
     // Update UI with new booking information
   });
   
   // Subscribe to the 'conversations' channel
   const conversationSubscription = await subscribeToChannel('conversations', (message) => {
     console.log('New conversation event:', message);
     // Update UI with new conversation information
   });
   ```

4. **Available Channels**:

   The AppSync Events API provides the following channels:
   - **restaurant-booking**: Events related to restaurant bookings
   - **conversations**: Events related to conversation transcripts

## Verification Steps

After deployment, verify that the application is working correctly:

1. **Access the web application**:
   - If using HTTPS with a custom domain:
     ```
     https://<webappSubdomain>.<domainName>
     ```
     Example: `https://app.example.com`
   
   - If using the default configuration:
     ```
     http://<WebappLoadBalancerDNS>
     ```

2. **Verify that HTTPS is working correctly** (if configured):
   - The browser should show a secure connection (lock icon)
   - HTTP requests should automatically redirect to HTTPS
   - Microphone access should work properly (requires HTTPS)

3. **Check that the ECS services are running**:
   ```bash
   aws ecs list-services --cluster ApiCluster
   aws ecs list-services --cluster WebappCluster
   ```

4. **Verify that the DynamoDB tables were created**:
   ```bash
   aws dynamodb describe-table --table-name NovaSonicConversations
   aws dynamodb describe-table --table-name RestaurantBookings
   ```

5. **Test the API health endpoint**:
   ```bash
   curl http://<ApiLoadBalancerDNS>/api/health
   ```

6. **Test the AppSync Events API**:
   - Use the demo application at `http://localhost:7860/appsync-events-demo.html`
   - Enter the API URL and API Key from the deployment outputs
   - Click "Connect" to subscribe to the channels
   - Observe real-time updates when data changes in the DynamoDB tables

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
   - If using HTTPS, ensure the certificates are valid and properly configured

2. **WebRTC Connection Failures**:
   - Ensure the UDP ports (3000-4000) are open in the security groups
   - Verify that the STUN server is correctly configured
   - Check browser console for WebRTC connection errors
   - Ensure you're using HTTPS if accessing from a browser (required for microphone access)

3. **Nova Sonic Integration Issues**:
   - Verify that the AWS region has Nova Sonic available
   - Check that the IAM role has the necessary Bedrock permissions
   - Look for errors in the API service logs related to Bedrock

4. **AppSync Events API Issues**:
   - Verify that the API URL and API key are correct
   - Check that the API key has not expired
   - Ensure that the client has internet connectivity
   - Check that the Lambda function is properly configured to process DynamoDB streams
   - Verify that DynamoDB streams are enabled on the tables

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

4. **Lambda Function Logs**:
   ```bash
   aws logs get-log-events --log-group-name /aws/lambda/nova-sonic-dynamodb-streams-processor --log-stream-name <log-stream-name>
   ```

5. **AppSync Logs**:
   AppSync logs can be viewed in the AWS Console under AppSync > Your API > Settings > Logging

## Cleanup Instructions

To avoid incurring charges, delete the resources when they are no longer needed:

1. **Delete the AppSync Events API stack**:
   ```bash
   cd cdk
   npx cdk destroy --app "npx ts-node bin/deploy-appsync.ts"
   ```

2. **Delete the main stacks in reverse order**:
   ```bash
   cdk destroy NovaSonicWebappStack
   cdk destroy NovaSonicApiStack
   cdk destroy NovaSonicNetworkStack
   ```

3. **Or delete all stacks at once**:
   ```bash
   cdk destroy --all
   ```

4. **Manually check for any resources that might not have been deleted**:
   - ECR repositories
   - CloudWatch log groups
   - S3 buckets for ALB access logs

5. **Clean up local resources**:
   ```bash
   docker system prune -a  # Remove unused Docker images and containers
   ```
