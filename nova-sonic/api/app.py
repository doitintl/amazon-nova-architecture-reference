import argparse
import asyncio
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict

import boto3
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from loguru import logger
from pipecat_ai_small_webrtc_prebuilt.frontend import SmallWebRTCPrebuiltUI
from pipecat.transports.network.webrtc_connection import IceServer, SmallWebRTCConnection

# Import our separated modules
from bot import run_bot

# Load environment variables
load_dotenv(override=True)

# Configure logging
log_level = os.getenv("LOG_LEVEL", "DEBUG")
logger.remove()
logger.add(sys.stderr, level=log_level)

# Create FastAPI app
app = FastAPI(
    title="Nova Sonic API",
    description="Backend API for the Nova Sonic speech-to-speech application",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store connections by pc_id
pcs_map: Dict[str, SmallWebRTCConnection] = {}

# Configure ICE servers for WebRTC
ice_servers = [
    IceServer(
        urls=os.getenv("STUN_SERVER", "stun:stun.l.google.com:19302"),
    )
]

# Add TURN server if configured
if os.getenv("TURN_SERVER"):
    ice_servers.append(
        IceServer(
            urls=os.getenv("TURN_SERVER"),
            username=os.getenv("TURN_USERNAME"),
            credential=os.getenv("TURN_PASSWORD"),
        )
    )

# Mount the frontend UI at /client
app.mount("/client", SmallWebRTCPrebuiltUI)


@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect root to client UI."""
    return RedirectResponse(url="/client/")


@app.post("/api/offer")
async def offer(request: Request, background_tasks: BackgroundTasks):
    """Handle WebRTC offer from client."""
    try:
        # Parse request body
        body = await request.json()
        pc_id = body.get("pc_id")

        if pc_id and pc_id in pcs_map:
            # Reuse existing connection
            pipecat_connection = pcs_map[pc_id]
            logger.info(f"Reusing existing connection for pc_id: {pc_id}")
            await pipecat_connection.renegotiate(
                sdp=body["sdp"], type=body["type"], restart_pc=body.get("restart_pc", False)
            )
        else:
            # Create new connection
            pipecat_connection = SmallWebRTCConnection(ice_servers)
            await pipecat_connection.initialize(sdp=body["sdp"], type=body["type"])

            @pipecat_connection.event_handler("closed")
            async def handle_disconnected(webrtc_connection: SmallWebRTCConnection):
                logger.info(f"Discarding peer connection for pc_id: {webrtc_connection.pc_id}")
                pcs_map.pop(webrtc_connection.pc_id, None)

            # Create args namespace for compatibility with run_bot
            args = argparse.Namespace()
            
            # Start the bot in a background task
            background_tasks.add_task(run_bot, pipecat_connection, args)

        # Get answer and update connection map
        answer = pipecat_connection.get_answer()
        pcs_map[answer["pc_id"]] = pipecat_connection

        return answer
    except Exception as e:
        logger.error(f"Error handling offer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/api/stats")
async def get_stats():
    """Get statistics about active connections."""
    return {
        "active_connections": len(pcs_map),
        "timestamp": datetime.now().isoformat(),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown events."""
    # Startup
    logger.info("Starting Nova Sonic API")
    
    # Create DynamoDB table if it doesn't exist
    dynamodb_table_name = os.getenv("DYNAMODB_TABLE_NAME")
    if dynamodb_table_name and os.getenv("DYNAMODB_ENDPOINT"):
        try:
            # Only attempt to create table when using local DynamoDB
            dynamodb = boto3.resource(
                "dynamodb",
                region_name=os.getenv("AWS_REGION", "us-east-1"),
                endpoint_url=os.getenv("DYNAMODB_ENDPOINT"),
            )
            
            # Check if table exists
            existing_tables = dynamodb.meta.client.list_tables()["TableNames"]
            
            if dynamodb_table_name not in existing_tables:
                logger.info(f"Creating DynamoDB table: {dynamodb_table_name}")
                table = dynamodb.create_table(
                    TableName=dynamodb_table_name,
                    KeySchema=[
                        {"AttributeName": "conversation_id", "KeyType": "HASH"},
                        {"AttributeName": "timestamp", "KeyType": "RANGE"},
                    ],
                    AttributeDefinitions=[
                        {"AttributeName": "conversation_id", "AttributeType": "S"},
                        {"AttributeName": "timestamp", "AttributeType": "S"},
                    ],
                    ProvisionedThroughput={"ReadCapacityUnits": 5, "WriteCapacityUnits": 5},
                )
                # Wait for table to be created
                table.meta.client.get_waiter("table_exists").wait(TableName=dynamodb_table_name)
                logger.info(f"DynamoDB table created: {dynamodb_table_name}")
        except Exception as e:
            logger.warning(f"Error creating DynamoDB table: {e}")
    
    yield  # Run app
    
    # Shutdown
    logger.info("Shutting down Nova Sonic API")
    coros = [pc.close() for pc in pcs_map.values()]
    await asyncio.gather(*coros)
    pcs_map.clear()


def main():
    """Run the application."""
    parser = argparse.ArgumentParser(description="Nova Sonic API")
    parser.add_argument(
        "--host", default=os.getenv("HOST", "localhost"), help="Host for HTTP server"
    )
    parser.add_argument(
        "--port", type=int, default=int(os.getenv("PORT", "8000")), help="Port for HTTP server"
    )
    parser.add_argument("--verbose", "-v", action="count", default=0)
    args = parser.parse_args()

    # Configure logging based on verbosity
    if args.verbose:
        logger.remove()
        logger.add(sys.stderr, level="TRACE")

    logger.info(f"Starting Nova Sonic API on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()