# Speech-to-Speech with Amazon Nova Sonic

This project demonstrates a speech-to-speech application using Amazon Bedrock Nova Sonic, enabling real-time voice conversations with an AI assistant through a web interface.

## Architecture Overview

The system consists of three main components:

1. **Web Application**: A frontend interface that allows users to interact with the AI assistant
2. **API Service**: A backend service that handles WebRTC connections and integrates with Amazon Bedrock
3. **CDK Infrastructure**: AWS CDK code for deploying the entire solution to AWS

### System Flow

```
                                  ┌─────────────────────┐
                                  │                     │
                                  │  Amazon Bedrock     │
                                  │  Nova Sonic         │
                                  │                     │
                                  └─────────┬───────────┘
                                            │
                                            │ AI Speech Generation
                                            ▼
┌─────────────┐    HTTP     ┌───────────────────────┐    WebRTC    ┌───────────────────┐
│             │             │                       │              │                   │
│  Web        │◄───────────►│  Web Application      │◄────────────►│  API Service      │
│  Browser    │    (ALB)    │  (ECS Fargate)        │    (NLB)     │  (ECS Fargate)    │
│             │             │                       │              │                   │
└─────────────┘             └───────────────────────┘              └─────────┬─────────┘
                                                                             │
                                                                             │
                                                                             ▼
                                                                    ┌─────────────────┐
                                                                    │                 │
                                                                    │  DynamoDB       │
                                                                    │  (Conversation  │
                                                                    │   History)      │
                                                                    │                 │
                                                                    └─────────────────┘
```

When a user accesses the application:

1. The web browser connects to the web application via an Application Load Balancer (ALB)
2. When the user clicks "Connect", the web application establishes a WebRTC connection to the API service via a Network Load Balancer (NLB)
3. The API service uses the pipecat library to connect to Amazon Bedrock Nova Sonic
4. Nova Sonic processes the user's speech and generates AI responses
5. The conversation flows bidirectionally through WebRTC, allowing real-time speech interaction
6. Conversation history is stored in DynamoDB for future reference

The system also integrates with Amazon Q Business Workshop via API Gateway for additional functionality.

## Components

### Web Application (`nova-sonic/webapp`)

The web application provides a user interface for interacting with the AI assistant. Key features include:

- WebRTC-based audio streaming
- Microphone and camera controls
- Voice visualization
- Real-time transcription display

The frontend is built using TypeScript and communicates with the API service using the pipecat WebRTC transport.

### API Service (`nova-sonic/api`)

The API service handles WebRTC connections and integrates with Amazon Bedrock Nova Sonic. Key features include:

- WebRTC signaling and connection management
- Integration with Amazon Bedrock Nova Sonic for speech-to-speech AI
- Voice activity detection (VAD)
- Conversation history storage in DynamoDB

The API is built using FastAPI and the pipecat library for WebRTC and AI integration.

### CDK Infrastructure (`cdk/`)

The AWS CDK code defines the infrastructure for deploying the application to AWS. Key components include:

- VPC and networking configuration
- ECS Fargate services for the web application and API
- Application Load Balancer for HTTP traffic
- Network Load Balancer for WebRTC UDP traffic
- DynamoDB table for conversation history
- IAM roles and security groups

## Getting Started

### Prerequisites

- AWS Account with appropriate permissions
- Node.js and npm installed
- AWS CDK installed
- Docker installed

### Deployment

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/speech-to-speech-amazon-nova-sonic.git
   cd speech-to-speech-amazon-nova-sonic
   ```

2. Install dependencies:
   ```
   cd cdk
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env` in both `nova-sonic/webapp` and `nova-sonic/api` directories
   - Update the values with your AWS credentials and configuration

4. Deploy the CDK stacks:
   ```
   cdk deploy --all
   ```

5. Access the application using the WebappLoadBalancerDNS output from the CDK deployment.

## Local Development

### Web Application

1. Navigate to the webapp directory:
   ```
   cd nova-sonic/webapp
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```

### API Service

1. Navigate to the API directory:
   ```
   cd nova-sonic/api
   ```

2. Create a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Start the API server:
   ```
   python app.py
   ```

## Configuration

### Web Application

The web application can be configured using environment variables in the `.env` file:

- `API_ENDPOINT`: URL of the API service

### API Service

The API service can be configured using environment variables in the `.env` file:

- `AWS_REGION`: AWS region for Bedrock and other services
- `NOVA_SONIC_VOICE_ID`: Voice ID for Nova Sonic (e.g., "tiffany", "matthew")
- `STUN_SERVER`: STUN server for WebRTC
- `TURN_SERVER`: TURN server for WebRTC (optional)
- `DYNAMODB_TABLE_NAME`: Name of the DynamoDB table for conversation history

## License

This project is licensed under the terms specified in the LICENSE file.