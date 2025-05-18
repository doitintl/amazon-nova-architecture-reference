from datetime import datetime
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams


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

# Function to register all functions with the LLM service
def register_functions(llm_service):
    """Register all functions with the LLM service."""
    llm_service.register_function("get_current_weather", fetch_weather_from_api)