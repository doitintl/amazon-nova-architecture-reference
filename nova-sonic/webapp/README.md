# Nova Sonic Web Application

The Nova Sonic Web Application is the frontend component of the speech-to-speech system that provides a user interface for interacting with the Nova Sonic API.

## Purpose

This web application serves as the client-side interface for the Nova Sonic speech-to-speech service, enabling:

- Real-time voice conversations with an AI assistant
- WebRTC-based audio/video streaming
- Visual feedback for voice activity
- Device selection for microphone and camera
- Transcript display for both user and AI assistant

## WebRTC Connection Establishment

The application establishes WebRTC connections with the Nova Sonic API through the following process:

1. **Connection Initialization**: Creates a SmallWebRTCTransport instance to handle WebRTC communication
2. **Signaling**: Sends WebRTC offers to the API endpoint and processes answers
3. **Media Handling**: Manages audio and video streams, including device selection and muting
4. **ICE Negotiation**: Uses STUN servers for NAT traversal and connection establishment
5. **Real-time Communication**: Processes incoming and outgoing audio streams for the conversation

## Key Files and Their Functions

- **src/app.ts**: Main TypeScript application that implements the WebRTC client and UI interactions
- **src/voice-visualizer.ts**: Provides visual feedback for voice activity
- **src/style.css**: Styling for the web application
- **index.html**: Main HTML structure for the application
- **nginx.conf**: Nginx configuration for serving the application
- **Dockerfile**: Container definition for deployment
- **vite.config.js**: Configuration for the Vite build system

## Setup and Configuration

### Prerequisites

- Node.js 20+
- pnpm (preferred) or npm
- Docker (for containerized deployment)

### Local Development

1. Clone the repository
2. Create a `.env` file based on `.env.example`
3. Install dependencies:
   ```
   pnpm install
   ```
4. Start the development server:
   ```
   pnpm run dev
   ```

### Building for Production

```bash
pnpm run build
```

This will create optimized assets in the `dist` directory.

### Docker Deployment

Build and run the Docker container:

```bash
docker build -t nova-sonic-webapp .
docker run -p 80:80 -e API_ENDPOINT=http://your-api-endpoint nova-sonic-webapp
```

### AWS Deployment

The web application is designed to be deployed on AWS Fargate with the following infrastructure:
- Application Load Balancer for HTTP traffic
- Auto-scaling based on CPU utilization
- Integration with the Nova Sonic API service

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_ENDPOINT` | URL of the Nova Sonic API service | `http://localhost:8000` |

## User Interface Features

- **Connection Controls**: Connect/disconnect buttons for starting and ending conversations
- **Media Controls**: Microphone and camera toggle buttons
- **Device Selection**: Dropdown menus for selecting audio and video input devices
- **Transcript Display**: Real-time display of conversation transcripts
- **Visual Feedback**: Voice activity visualization
- **Self-View**: Optional camera preview when video is enabled

## Browser Compatibility

The application is compatible with modern browsers that support WebRTC:
- Chrome (recommended)
- Firefox
- Safari
- Edge

Note that some features may require specific browser permissions for accessing microphone and camera.