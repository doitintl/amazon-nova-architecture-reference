import argparse
import asyncio
import json
import os
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Optional

import boto3
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from loguru import logger
from pipecat_ai_small_webrtc_prebuilt.frontend import SmallWebRTCPrebuiltUI

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.parallel_pipeline import ParallelPipeline

from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.aws_nova_sonic import AWSNovaSonicLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.network.small_webrtc import SmallWebRTCTransport
from pipecat.transports.network.webrtc_connection import IceServer, SmallWebRTCConnection
from pipecat.services.aws.stt import AWSTranscribeSTTService, Language
from pipecat.processors.transcript_processor import TranscriptProcessor

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


# Transcription callback to store conversations
class TranscriptHandler:
    def __init__(self):
        self.messages = []
        # Initialize DynamoDB client if table name is provided
        self.dynamodb_client = None
        dynamodb_table_name = os.getenv("DYNAMODB_TABLE_NAME")
        if dynamodb_table_name:
            self.dynamodb_client = boto3.resource(
                "dynamodb",
                region_name=os.getenv("AWS_REGION", "us-east-1")
            ).Table(dynamodb_table_name)
            logger.info(f"DynamoDB integration enabled with table: {dynamodb_table_name}")

    async def on_transcript_update(self, processor, frame):
        self.messages.extend(frame.messages)

        # Log new messages with timestamps
        for msg in frame.messages:
            timestamp = f"[{msg.timestamp}] " if msg.timestamp else datetime.now().isoformat()
            message = f"{msg.role}: {msg.content}"
            print(f"{timestamp}{message}")
            await self.store_conversation(message)

    # Function to store conversation in DynamoDB
    async def store_conversation(self, message):
        """Store conversation in DynamoDB."""
        if not self.dynamodb_client:
            logger.debug("DynamoDB integration not enabled, skipping storage")
            return

        try:
            timestamp = datetime.now().isoformat()
            item = {
                "conversation_id": timestamp,
                "conversation": message
            }
            self.dynamodb_client.put_item(Item=item)
            logger.debug(f"Stored conversation in DynamoDB: {timestamp}")
        except Exception as e:
            logger.error(f"Error storing conversation in DynamoDB: {e}")


# Example function for weather API integration
async def fetch_weather_from_api(params: FunctionCallParams):
    """Example function to fetch weather data."""
    temperature = 75 if params.arguments["format"] == "fahrenheit" else 24
    await params.result_callback(
        {
            "conditions": "nice",
            "temperature": temperature,
            "format": params.arguments["format"],
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
        }
    )


# Define weather function schema
weather_function = FunctionSchema(
    name="get_current_weather",
    description="Get the current weather",
    properties={
        "location": {
            "type": "string",
            "description": "The city and state, e.g. San Francisco, CA",
        },
        "format": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "The temperature unit to use. Infer this from the users location.",
        },
    },
    required=["location", "format"],
)

# Create tools schema
tools = ToolsSchema(standard_tools=[weather_function])

async def run_bot(webrtc_connection: SmallWebRTCConnection, args: argparse.Namespace):
    """Run the Nova Sonic bot with the given WebRTC connection."""
    logger.info("Starting Nova Sonic bot")
    
    # Generate a unique conversation ID
    conversation_id = str(uuid.uuid4())
    logger.info(f"New conversation started: {conversation_id}")
    
    # Initialize the SmallWebRTCTransport with the connection
    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_enabled=True,
            camera_in_enabled=False,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.8)),
        ),
    )

    # Specify initial system instruction
    system_instruction = (
        "You are a friendly assistant. The user and you will engage in a spoken dialog exchanging "
        "the transcripts of a natural real-time conversation. Keep your responses short, generally "
        "two or three sentences for chatty scenarios. "
        f"{AWSNovaSonicLLMService.AWAIT_TRIGGER_ASSISTANT_RESPONSE_INSTRUCTION}"
    )

    region = os.getenv("AWS_REGION", "us-east-1")
    voice_id = os.getenv("NOVA_SONIC_VOICE_ID", "tiffany")

    # Create the AWS Nova Sonic LLM service
    llm = AWSNovaSonicLLMService(
        secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        region=region,
        voice_id=voice_id,  # matthew, tiffany, amy
        send_transcription_frames=True
    )
    
    # Register function for function calls
    llm.register_function("get_current_weather", fetch_weather_from_api)

    # Set up context and context management
    context = OpenAILLMContext(
        messages=[
            {"role": "system", "content": f"{system_instruction}"},
            {
                "role": "user",
                "content": "Tell me a fun fact!",
            },
        ],
        tools=tools,
    )
    context_aggregator = llm.create_context_aggregator(context)

    # Initialize AWS Transcribe STT service
    # This is causing error now:
    # 2025-05-17 21:44:15.950 | DEBUG    | pipecat.services.aws.stt:_connect:212 - AWSTranscribeSTTService#1 Connecting to WebSocket with URL: wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?X-Amz-Algorith...
    # 2025-05-17 21:44:15.951 | ERROR    | pipecat.services.aws.stt:_connect:232 - AWSTranscribeSTTService#1 Failed to connect to AWS Transcribe: create_connection() got an unexpected keyword argument 'extra_headers'
    # stt_service = AWSTranscribeSTTService(
    #     secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    #     access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    #     region=region,
    #     sample_rate=16000,
    #     language=Language.EN
    # )
    
    # Create a callback handler for transcription events
    transcript = TranscriptProcessor()
    transcript_handler = TranscriptHandler()

    # Build the pipeline
    pipeline = Pipeline(
        [
            transport.input(),
            context_aggregator.user(),
            llm,
            ParallelPipeline(
            [
                transcript.user(),              # Captures user transcripts
                transcript.assistant(),         # Captures assistant transcripts
                transport.output(),
            ]),
            context_aggregator.assistant(),
        ]
    )
    
    # Note: We can't use event handlers for transcriptions because the services don't support them
    # Instead, we'll rely on the DynamoDB integration for storing conversations if needed

    # Configure the pipeline task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @transcript.event_handler("on_transcript_update")
    async def handle_transcript_update(processor, frame):
        await transcript_handler.on_transcript_update(processor, frame)
            
    # Handle client connection event
    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")
        # Kick off the conversation
        await task.queue_frames([context_aggregator.user().get_context_frame()])
        # Trigger the first assistant response
        await llm.trigger_assistant_response()

    # Handle client disconnection events
    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")

    @transport.event_handler("on_client_closed")
    async def on_client_closed(transport, client):
        logger.info("Client closed connection")
        await task.cancel()

    # Run the pipeline
    runner = PipelineRunner(handle_sigint=False)
    try:
        await runner.run(task)
    except Exception as e:
        logger.error(f"Error running pipeline: {e}")
        raise


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