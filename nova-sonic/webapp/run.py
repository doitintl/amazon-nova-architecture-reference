#
# Copyright (c) 2024–2025, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

import argparse
import os
import sys
import httpx
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import RedirectResponse
from loguru import logger
from pipecat_ai_small_webrtc_prebuilt.frontend import SmallWebRTCPrebuiltUI

from pipecat.transports.network.webrtc_connection import IceServer, SmallWebRTCConnection

# Load environment variables
load_dotenv(override=True)

app = FastAPI()

# Store connections by pc_id
pcs_map = {}

# Get API endpoint from environment variables
API_ENDPOINT = os.getenv("API_ENDPOINT", "http://localhost:8000")
logger.info(f"Using backend API endpoint: {API_ENDPOINT}")

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

# Mount the frontend at /
app.mount("/client", SmallWebRTCPrebuiltUI)


@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/client/")


@app.post("/api/offer")
@app.post("/api/offer/connect")
async def offer(request: dict, background_tasks: BackgroundTasks):
    """
    Forward WebRTC offer to the backend API and return the answer.
    This acts as a proxy to the backend's WebRTC signaling endpoint.
    """
    try:
        endpoint = f"{API_ENDPOINT}/api/offer"
        logger.info(f"Forwarding WebRTC offer to backend at {endpoint}")
        
        with httpx.Client() as client:
            response = client.post(endpoint, json=request)
        
        if response.status_code == 200:
            answer = response.json()
            logger.info(f"Received WebRTC answer from backend for pc_id: {answer.get('pc_id')}")
            return answer
        else:
            logger.error(f"Backend API returned error: {response.status_code} - {response.text}")
            return {"error": f"Backend API error: {response.status_code}"}
    except Exception as e:
        logger.error(f"Error forwarding offer to backend: {e}")
        return {"error": str(e)}


@app.get("/api/health")
async def health_check():
    """Check the health of both frontend and backend."""
    frontend_status = "ok"
    backend_status = "unknown"
    
    try:
        # Check backend health
        with httpx.Client(timeout=5.0) as client:
            response = client.get(f"{API_ENDPOINT}/api/health")
        if response.status_code == 200:
            backend_status = "ok"
        else:
            backend_status = f"error: {response.status_code}"
    except Exception as e:
        backend_status = f"error: {str(e)}"
    
    return {
        "frontend": frontend_status,
        "backend": backend_status,
        "backend_url": API_ENDPOINT
    }

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Nova Sonic WebRTC Frontend")
    logger.info(f"Connected to backend API at: {API_ENDPOINT}")
    
    yield  # Run app
    
    # Shutdown
    logger.info("Shutting down Nova Sonic WebRTC Frontend")
    import asyncio
    coros = [pc.close() for pc in pcs_map.values()]
    await asyncio.gather(*coros)
    pcs_map.clear()


def main():
    parser = argparse.ArgumentParser(description="Nova Sonic WebRTC Frontend")
    parser.add_argument(
        "--host", default="localhost", help="Host for HTTP server (default: localhost)"
    )
    parser.add_argument(
        "--port", type=int, default=7860, help="Port for HTTP server (default: 7860)"
    )
    parser.add_argument("--verbose", "-v", action="count", default=0)
    args = parser.parse_args()

    logger.remove(0)
    if args.verbose:
        logger.add(sys.stderr, level="TRACE")
    else:
        logger.add(sys.stderr, level="DEBUG")

    logger.info(f"Starting Nova Sonic WebRTC Frontend on {args.host}:{args.port}")
    logger.info(f"Connected to backend API at: {API_ENDPOINT}")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()