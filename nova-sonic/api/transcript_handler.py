import os
import boto3
from datetime import datetime
from loguru import logger


class TranscriptHandler:
    def __init__(self, transport=None):
        self.messages = []
        # Store the transport if provided
        self.transport = transport
        
        # Initialize DynamoDB client if table name is provided
        self.dynamodb_client = None
        dynamodb_table_name = os.getenv("DYNAMODB_TABLE_NAME")
        if dynamodb_table_name:
            self.dynamodb_client = boto3.resource(
                "dynamodb",
                region_name=os.getenv("AWS_REGION", "us-east-1")
            ).Table(dynamodb_table_name)
            logger.info(f"DynamoDB integration enabled with table: {dynamodb_table_name}")
        
        # Schedule a test transcript message to be sent after initialization
        self.send_test_transcript = True

    async def on_transcript_update(self, processor, frame):
        self.messages.extend(frame.messages)
        
        # Log new messages with timestamps
        for msg in frame.messages:
            timestamp = f"[{msg.timestamp}] " if msg.timestamp else datetime.now().isoformat()
            message = f"{msg.role}: {msg.content}"
            print(f"{timestamp}{message}")
            
            # Store conversation in DynamoDB if configured
            await self.store_conversation(message)
            
            # Send transcript to frontend via server message
            await self.send_transcript_to_frontend(processor, {
                "timestamp": timestamp,
                "role": msg.role,
                "content": msg.content
            })
        
        # Send a test transcript message if this is the first update
        if hasattr(self, 'send_test_transcript') and self.send_test_transcript:
            logger.debug("[TRANSCRIPT DEBUG] Sending test transcript message")
            self.send_test_transcript = False
            
            # Send a test message after a short delay
            import asyncio
            await asyncio.sleep(2)
            
            test_timestamp = datetime.now().isoformat()
            await self.send_transcript_to_frontend(processor, {
                "timestamp": test_timestamp,
                "role": "system",
                "content": "This is a test transcript message to verify the transcript display functionality."
            })

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

    async def send_transcript_to_frontend(self, processor, transcript_data):
        """Send transcript data to the frontend via server message."""
        try:
            logger.debug(f"[TRANSCRIPT DEBUG] Attempting to send transcript to frontend: {transcript_data}")
            
            # Use the transport provided in the constructor if available
            transport = self.transport
            
            # If no transport was provided in constructor, try to find it
            if not transport:
                # Check if processor is a TranscriptProcessor factory
                if hasattr(processor, "_user_processor") and hasattr(processor, "_assistant_processor"):
                    # Try to find transport in user processor's parent pipeline
                    if processor._user_processor and hasattr(processor._user_processor, "parent"):
                        parent = processor._user_processor.parent
                        if hasattr(parent, "_processors"):
                            for p in parent._processors:
                                if hasattr(p, "send_message") and hasattr(p, "webrtc_connection"):
                                    transport = p
                                    logger.debug(f"[TRANSCRIPT DEBUG] Found transport in user processor's parent: {p.__class__.__name__}")
                                    break
                
                # If we still don't have a transport, try to find it in the bot module
                if not transport:
                    try:
                        # Import the bot module and get the transport from the current run_bot function frame
                        import inspect
                        import sys
                        
                        # First check if we can find the transport in any module named 'bot'
                        for module_name, module in sys.modules.items():
                            if "bot" in module_name:
                                if hasattr(module, "transport") and hasattr(module.transport, "send_message"):
                                    transport = module.transport
                                    logger.debug(f"[TRANSCRIPT DEBUG] Found transport in module {module_name}")
                                    break
                        
                        # If not found, try to find it in the current call stack
                        if not transport:
                            for frame_info in inspect.stack():
                                frame = frame_info.frame
                                if 'transport' in frame.f_locals and hasattr(frame.f_locals['transport'], 'send_message'):
                                    transport = frame.f_locals['transport']
                                    logger.debug("[TRANSCRIPT DEBUG] Found transport in call stack")
                                    break
                    except Exception as e:
                        logger.warning(f"[TRANSCRIPT DEBUG] Error while trying to find transport: {e}")
            
            if not transport:
                logger.warning("[TRANSCRIPT DEBUG] No suitable transport found")
                return
                    
            # Prepare the message
            message_data = {
                "type": "server-message",
                "data": {
                    "message_type": "transcript",
                    "transcript": transcript_data
                }
            }
            logger.debug(f"[TRANSCRIPT DEBUG] Sending message structure: {message_data}")
            
            # Import the TransportMessageFrame class
            from pipecat.frames.frames import TransportMessageFrame
            
            # Create a proper TransportMessageFrame with the message data
            message_frame = TransportMessageFrame(message=message_data)
            
            # Send a server message with the transcript data
            # Use the output transport's send_message method if available
            if hasattr(transport, 'output') and callable(transport.output):
                # Get the output transport and use its send_message method
                output_transport = transport.output()
                print(dir(transport))
                print(dir(output_transport))
                if hasattr(transport, 'send_message'):
                    print("Transport has send_message method")

                if hasattr(transport, 'send_app_message'):
                    print("Transport has send_message method")

                if hasattr(output_transport, 'send_app_message'):
                    print("Output transport has send_app_message method")

                if hasattr(output_transport, 'send_message'):
                    await output_transport.send_message(message_frame)
                    logger.debug(f"[TRANSCRIPT DEBUG] Successfully sent transcript to frontend via output transport: {transcript_data}")
                # If send_message is not available, try using send_image as a fallback
                elif hasattr(transport, 'send_image'):
                    logger.debug(f"[TRANSCRIPT DEBUG] Using send_image as fallback for sending transcript")
                    await transport.send_image(message_data)  # send_image likely expects raw data, not a frame
                    logger.debug(f"[TRANSCRIPT DEBUG] Successfully sent transcript to frontend via send_image: {transcript_data}")
            # Direct send_message on transport (for backward compatibility)
            elif hasattr(transport, 'send_message'):
                await transport.send_message(message_frame)
                logger.debug(f"[TRANSCRIPT DEBUG] Successfully sent transcript to frontend via direct send_message: {transcript_data}")
            else:
                logger.error(f"[TRANSCRIPT DEBUG] No suitable method found to send transcript to frontend")
        except Exception as e:
            logger.error(f"[TRANSCRIPT DEBUG] Error sending transcript to frontend: {e}")
            import traceback
            logger.error(f"[TRANSCRIPT DEBUG] Traceback: {traceback.format_exc()}")
            
    def set_transport(self, transport):
        """Set the transport to use for sending messages to the frontend."""
        self.transport = transport
        logger.debug(f"[TRANSCRIPT DEBUG] Transport set: {transport.__class__.__name__}")
        
    async def send_test_transcript_message(self, processor):
        """Send a direct test transcript message to verify functionality."""
        logger.debug("[TRANSCRIPT DEBUG] Sending direct test transcript message")
        
        test_timestamp = datetime.now().isoformat()
        test_messages = [
            {
                "timestamp": test_timestamp,
                "role": "system",
                "content": "Direct test transcript message #1: This is a test of the transcript system."
            },
            {
                "timestamp": test_timestamp,
                "role": "user",
                "content": "Direct test transcript message #2: Hello, can you hear me?"
            },
            {
                "timestamp": test_timestamp,
                "role": "assistant",
                "content": "Direct test transcript message #3: Yes, I can hear you clearly!"
            }
        ]
        
        # Send each test message with a small delay between them
        import asyncio
        for msg in test_messages:
            await self.send_transcript_to_frontend(processor, msg)
            await asyncio.sleep(1)  # Small delay between messages