from mcp import stdio_client, StdioServerParameters
from strands import Agent, tool
from strands.tools.mcp import MCPClient
from strands.models import BedrockModel
import boto3
import os
import json
import requests
import re
import logging
from config import Config

logger = logging.getLogger(__name__)

@tool
def weather(lat, lon: float) -> str:
    """Get weather information for a given lat and lon

    Args:
        lat: latitude of the location
        lon: logitude of the location
    """
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": str(lat),
        "longitude": str(lon),
        "current_weather": True
    }
    response = requests.get(url, params=params)
    return response.json()["current_weather"]

class StrandsAgent:

    def __init__(self):
        # Launch AWS Location Service MCP Server and create a client object
        env = {"FASTMCP_LOG_LEVEL": Config.FASTMCP_LOG_LEVEL}
        if Config.AWS_PROFILE:
            env["AWS_PROFILE"] = Config.AWS_PROFILE

        logger.info("Initializing Strands Agent with AWS Location Service MCP Server")
        self.aws_location_srv_client = MCPClient(lambda: stdio_client(
            StdioServerParameters(
                command="uvx",
                args=["awslabs.aws-location-mcp-server@latest"],
                env=env)
            ))
        self._server_context = self.aws_location_srv_client.__enter__()
        self.aws_location_srv_tools = self.aws_location_srv_client.list_tools_sync()
        logger.debug(f"AWS Location Service tools loaded: {len(self.aws_location_srv_tools)} tools available")

        session = boto3.Session(
            region_name=Config.AWS_DEFAULT_REGION,
        )
        # Specify Bedrock LLM for the Agent
        bedrock_model = BedrockModel(
            model_id=Config.STRANDS_MODEL_ID,
            boto_session=session
        )
        # Create a Strands Agent
        tools = self.aws_location_srv_tools
        tools.append(weather)
        self.agent = Agent(
            tools=tools, 
            model=bedrock_model,
            system_prompt="You are a chat agent tasked with answering location and weather-related questions. Please include your response within the <response></response> tag."
        )


    '''
    Send the input to the agent, allowing it to handle tool selection and invocation. 
    The response will be generated after the selected LLM performs reasoning. 
    This approach is suitable when you want to delegate tool selection logic to the agent, and have a generic toolUse definition in Sonic ToolUse.
    Note that the reasoning process may introduce latency, so it's recommended to use a lightweight model such as Nova Lite.
    Sample parameters: input="largest zoo in Seattle?"
    '''
    def query(self, input):
        logger.info(f"Querying Strands Agent with input: {input}")
        output = str(self.agent(input))
        
        # Extract response from tags
        if "<response>" in output and "</response>" in output:
            match = re.search(r"<response>(.*?)</response>", output, re.DOTALL)
            if match:
                output = match.group(1)
                logger.debug("Extracted response from <response> tags")
        elif "<answer>" in output and "</answer>" in output:
            match = re.search(r"<answer>(.*?)</answer>", output, re.DOTALL)
            if match:
                output = match.group(1)
                logger.debug("Extracted response from <answer> tags")
        
        logger.debug(f"Strands Agent response: {output[:100]}...")
        return output

    '''
    Invoke the tool directly and return the raw response without any reasoning.
    This approach is suitable when tool selection is managed within Sonic and the exact toolName is already known. 
    It offers lower query latency, as no additional reasoning is performed by the agent.
    Sample parameters: tool_name="search_places", input="largest zoo in Seattle"
    '''
    def call_tool(self, tool_name, input):
        logger.info(f"Calling tool '{tool_name}' with input: {input}")
        
        try:
            if isinstance(input, str):
                input = json.loads(input)
            if "query" in input:
                input = input.get("query")

            tool_func = getattr(self.agent.tool, tool_name)
            result = tool_func(query=input)
            logger.debug(f"Tool '{tool_name}' result: {result}")
            return result
        except Exception as e:
            logger.error(f"Error calling tool '{tool_name}': {e}")
            return f"Error calling tool '{tool_name}': {str(e)}"

    def close(self):
        """Clean up resources."""
        logger.info("Closing Strands Agent and cleaning up resources")
        try:
            # Cleanup the MCP server context
            self.aws_location_srv_client.__exit__(None, None, None)
            logger.debug("AWS Location Service MCP Server closed successfully")
        except Exception as e:
            logger.error(f"Error closing Strands Agent: {e}")