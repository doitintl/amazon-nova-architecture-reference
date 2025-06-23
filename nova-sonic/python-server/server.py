import asyncio
import websockets
import json
import logging
import http.server
import threading
import os
from http import HTTPStatus
from s2s_session_manager import S2sSessionManager
from integration.strands_agent import StrandsAgent
from config import Config

# Configure logging
Config.configure_logging()
logger = logging.getLogger(__name__)

MCP_CLIENT = None
STRANDS_AGENT = None

class HealthCheckHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        client_ip = self.client_address[0]
        logger.info(
            f"Health check request received from {client_ip} for path: {self.path}"
        )

        if self.path == "/health" or self.path == "/":
            logger.info(f"Responding with 200 OK to health check from {client_ip}")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = json.dumps({"status": "healthy"})
            self.wfile.write(response.encode("utf-8"))
            logger.info(f"Health check response sent: {response}")
        else:
            logger.info(
                f"Responding with 404 Not Found to request for {self.path} from {client_ip}"
            )
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()

    def log_message(self, format, *args):
        # Override to use our logger instead
        pass


def start_health_check_server(health_host, health_port):
    """Start the HTTP health check server on port 80."""
    try:
        # Create the server with a socket timeout to prevent hanging
        httpd = http.server.HTTPServer((health_host, health_port), HealthCheckHandler)
        httpd.timeout = 5  # 5 second timeout

        logger.info(f"Starting health check server on {health_host}:{health_port}")

        # Run the server in a separate thread
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = (
            True  # This ensures the thread will exit when the main program exits
        )
        thread.start()

        # Verify the server is running
        logger.info(
            f"Health check server started at http://{health_host}:{health_port}/health"
        )
        logger.info(f"Health check thread is alive: {thread.is_alive()}")

        # Try to make a local request to verify the server is responding
        try:
            import urllib.request

            with urllib.request.urlopen(
                f"http://localhost:{health_port}/health", timeout=2
            ) as response:
                logger.info(
                    f"Local health check test: {response.status} - {response.read().decode('utf-8')}"
                )
        except Exception as e:
            logger.warning(f"Local health check test failed: {e}")

    except Exception as e:
        logger.error(f"Failed to start health check server: {e}", exc_info=True)


async def websocket_handler(websocket):
    stream_manager = None
    logger.debug("WebSocket connection established")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                if 'body' in data:
                    data = json.loads(data["body"])
                if 'event' in data:
                    if stream_manager == None:

                        """Handle WebSocket connections from the frontend."""
                        # Create a new stream manager for this connection
                        stream_manager = S2sSessionManager(
                            model_id=Config.NOVA_SONIC_MODEL_ID,
                            region=Config.AWS_DEFAULT_REGION,
                            mcp_client=MCP_CLIENT,
                            strands_agent=STRANDS_AGENT
                        )
                        
                        # Initialize the Bedrock stream
                        await stream_manager.initialize_stream()
                        
                        # Start a task to forward responses from Bedrock to the WebSocket
                        forward_task = asyncio.create_task(forward_responses(websocket, stream_manager))

                        event_type = list(data['event'].keys())[0]
                        if event_type == "audioInput":
                            logger.debug(message[0:180])
                        else:
                            logger.debug(message)
                            
                    if event_type:
                        logger.info(f"Received event: {event_type}")
                        logger.info(f"Event data: {data['event']}")
                        # Store prompt name and content names if provided
                        if event_type == 'promptStart':
                            stream_manager.prompt_name = data['event']['promptStart']['promptName']
                        elif event_type == 'contentStart' and data['event']['contentStart'].get('type') == 'AUDIO':
                            stream_manager.audio_content_name = data['event']['contentStart']['contentName']
                        
                        # Handle audio input separately
                        if event_type == 'audioInput':
                            # Extract audio data
                            prompt_name = data['event']['audioInput']['promptName']
                            content_name = data['event']['audioInput']['contentName']
                            audio_base64 = data['event']['audioInput']['content']
                            
                            # Add to the audio queue
                            stream_manager.add_audio_chunk(prompt_name, content_name, audio_base64)
                        else:
                            # Send other events directly to Bedrock
                            await stream_manager.send_raw_event(data)
            except json.JSONDecodeError:
                print("Invalid JSON received from WebSocket")
            except Exception as e:
                print(f"Error processing WebSocket message: {e}")
                import traceback
                traceback.print_exc()
    except websockets.exceptions.ConnectionClosed:
        print("WebSocket connection closed")
    finally:
        # Clean up
        await stream_manager.close()
        forward_task.cancel()
        if websocket:
            websocket.close()
        if MCP_CLIENT:
            MCP_CLIENT.cleanup()


async def forward_responses(websocket, stream_manager):
    """Forward responses from Bedrock to the WebSocket."""
    try:
        while True:
            # Get next response from the output queue
            response = await stream_manager.output_queue.get()
            
            # Send to WebSocket
            try:
                event = json.dumps(response)
                await websocket.send(event)
            except websockets.exceptions.ConnectionClosed:
                break
    except asyncio.CancelledError:
        # Task was cancelled
        pass
    except Exception as e:
        print(f"Error forwarding responses: {e}")
        # Close connection
        websocket.close()
        stream_manager.close()


async def main():
    errors = Config.validate()
    if errors:
        for error in errors:
            logger.error(error)
        exit(1)

    """Main function to run the WebSocket server."""
    host = Config.HOST
    port = Config.WS_PORT
    health_port = Config.HEALTH_PORT
    
    if health_port:
        try:
            start_health_check_server(host, health_port)
        except Exception as ex:
            logger.error(f"Failed to start health check endpoint: {ex}")
    
    # Init Strands Agent
    if Config.ENABLE_STRANDS_AGENT:
        logger.info("Strands agent enabled")
        try:
            global STRANDS_AGENT
            STRANDS_AGENT = StrandsAgent()
        except Exception as ex:
            logger.error(f"Failed to start Strands agent: {ex}")

    try:
        # Start WebSocket server
        async with websockets.serve(websocket_handler, host, port):
            logger.info(f"WebSocket server started at host:{host}, port:{port}")
            
            # Keep the server running forever
            await asyncio.Future()
    except Exception as ex:
        logger.error(f"Failed to start websocket service: {ex}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.exception(f"Server error: {e}")
    finally:
        if MCP_CLIENT:
            MCP_CLIENT.cleanup()