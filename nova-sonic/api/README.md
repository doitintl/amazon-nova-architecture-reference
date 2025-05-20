# Nova Sonic API

The Nova Sonic API is the backend component of the speech-to-speech application that powers real-time conversations using Amazon Bedrock Nova Sonic.

## Purpose

This API serves as the bridge between the web client and Amazon Bedrock Nova Sonic, enabling:

- Real-time speech-to-speech conversations via WebRTC
- Voice activity detection and processing
- Integration with Amazon Bedrock for LLM-powered responses
- Conversation history tracking with DynamoDB

## Integration with Amazon Bedrock Nova Sonic

The API integrates with Amazon Bedrock Nova Sonic through the following components:

1. **WebRTC Connection Handling**: Establishes and manages WebRTC connections for real-time audio streaming
2. **Voice Activity Detection**: Uses Silero VAD to detect when users are speaking
3. **LLM Integration**: Connects to Amazon Bedrock Nova Sonic for natural language processing
4. **Audio Processing Pipeline**: Manages the flow of audio data between the client and Bedrock

## Key Files and Their Functions

- **app.py**: Main FastAPI application that handles WebRTC connections, offers, and API endpoints
- **bot.py**: Implements the Nova Sonic bot with Bedrock integration and audio pipeline
- **function_schema.py**: Defines function schemas for LLM function calls
- **transcript_handler.py**: Processes and stores conversation transcripts
- **Dockerfile**: Container definition for deployment

## Setup and Configuration

### Prerequisites

- AWS Account with access to Bedrock Nova Sonic
- Python 3.13+
- Docker (for containerized deployment)

### Local Development

1. Clone the repository
2. Create a `.env` file based on `.env.example`
3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
4. Run the application:
   ```
   python app.py
   ```

### Docker Deployment

Build and run the Docker container:

```bash
docker build -t nova-sonic-api .
docker run -p 8000:8000 --env-file .env nova-sonic-api
```

### AWS Deployment

The API is designed to be deployed on AWS Fargate with the following infrastructure:
- Application Load Balancer for HTTP traffic
- Network Load Balancer for WebRTC UDP traffic
- DynamoDB table for conversation history
- IAM roles with appropriate permissions

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for Bedrock and other services | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key ID | - |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | - |
| `DYNAMODB_TABLE_NAME` | DynamoDB table for conversation history | - |
| `DYNAMODB_ENDPOINT` | Optional endpoint for local DynamoDB | - |
| `STUN_SERVER` | STUN server for WebRTC | `stun:stun.l.google.com:19302` |
| `TURN_SERVER` | Optional TURN server for WebRTC | - |
| `TURN_USERNAME` | Username for TURN server | - |
| `TURN_PASSWORD` | Password for TURN server | - |
| `NOVA_SONIC_VOICE_ID` | Voice ID for Nova Sonic (e.g., tiffany, matthew, amy) | `tiffany` |
| `HOST` | Host to bind the server to | `localhost` |
| `PORT` | Port to run the server on | `8000` |
| `LOG_LEVEL` | Logging level | `INFO` |

## API Endpoints

- `GET /`: Redirects to the client UI
- `GET /client/`: Serves the prebuilt client UI
- `POST /api/offer`: Handles WebRTC offers from clients
- `GET /api/health`: Health check endpoint
- `GET /api/stats`: Statistics about active connections