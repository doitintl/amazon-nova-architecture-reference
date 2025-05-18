import os
import boto3
from datetime import datetime
from loguru import logger


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