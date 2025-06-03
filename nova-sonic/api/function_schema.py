from datetime import datetime
import json
import os
import requests
import sys
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

# Get the restaurant booking API URL from environment variables
RESTAURANT_BOOKING_API_URL = os.getenv("RESTAURANT_BOOKING_API_URL", "https://api.example.com/demo")


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

# Get current date and time
async def get_current_date_time(params: FunctionCallParams):
    await params.result_callback(
        {
            "now": datetime.now().strftime("%Y%m%d_%H%M%S")
        }
    )    

# restaurant booking API functions
async def create_restaurant_booking(params: FunctionCallParams):
    """Function to create a new restaurant booking."""
    try:
        # Extract booking details from params
        name = params.arguments["name"]
        date = params.arguments["date"]
        hour = params.arguments["hour"]
        num_guests = params.arguments["num_guests"]
        
        # Prepare request payload
        payload = {
            "name": name,
            "date": date,
            "hour": hour,
            "num_guests": num_guests
        }
        
        # Log request details
        request_url = f"{RESTAURANT_BOOKING_API_URL}/booking"
        logger.info(f"Creating restaurant booking for {name} - Request URL: {request_url}")
        logger.debug(f"Booking payload: {json.dumps(payload)}")
        
        try:
            # Make API request
            response = requests.post(
                request_url,
                json=payload,
                timeout=10  # Set a reasonable timeout
            )
            
            # Check if request was successful
            response.raise_for_status()
            
            try:
                # Parse response data
                booking_data = response.json()
                
                # Prepare response in the expected format
                result = {
                    "message": booking_data.get("message", f"Success! Your booking on {date} at {hour} by {name} for {num_guests} guests is confirmed. Your booking ID is {booking_data['booking_id']}."),
                    "booking_id": booking_data["booking_id"]
                }
                
                # Include any additional fields from the API response
                for key, value in booking_data.items():
                    if key not in result:
                        result[key] = value
                
                logger.info(f"Successfully created booking with ID: {booking_data['booking_id']}")
                await params.result_callback(result)
                
            except json.JSONDecodeError as e:
                # Handle JSON parsing errors
                error_message = f"Error parsing booking response: {str(e)}"
                logger.error(f"{error_message} - Response content: {response.text[:200]}")
                await params.result_callback({
                    "error": True,
                    "message": error_message,
                    "status": "failed",
                    "response_code": response.status_code
                })
                
        except requests.exceptions.ConnectionError as e:
            # Handle connection errors
            error_message = f"Connection error while creating restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "error_type": "connection_error"
            })
            
        except requests.exceptions.Timeout as e:
            # Handle timeout errors
            error_message = f"Timeout error while creating restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}, Timeout: 10s")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "error_type": "timeout"
            })
            
        except requests.exceptions.HTTPError as e:
            # Handle HTTP errors with response details
            status_code = e.response.status_code if hasattr(e, 'response') else "unknown"
            error_message = f"HTTP error while creating restaurant booking: {str(e)}"
            
            # Try to get error details from response
            error_details = {}
            try:
                if hasattr(e, 'response') and e.response.text:
                    error_details = e.response.json()
            except json.JSONDecodeError:
                error_details = {"raw_response": e.response.text[:200]} if hasattr(e, 'response') else {}
                
            logger.error(f"{error_message} - Status code: {status_code}, URL: {request_url}")
            logger.error(f"Error details: {json.dumps(error_details)}")
            
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "status_code": status_code,
                "error_details": error_details
            })
            
        except requests.exceptions.RequestException as e:
            # Handle other request errors
            error_message = f"Request error while creating restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "error_type": "request_error"
            })
            
    except KeyError as e:
        # Handle missing required arguments
        error_message = f"Missing required argument in create_restaurant_booking: {str(e)}"
        logger.error(error_message)
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "error_type": "invalid_arguments"
        })
        
    except Exception as e:
        # Handle any other unexpected errors
        error_message = f"Unexpected error creating restaurant booking: {str(e)}"
        logger.error(f"{error_message} - Exception type: {type(e).__name__}")
        
        # Return error response
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "error_type": "unexpected_error"
        })

async def get_restaurant_booking(params: FunctionCallParams):
    """Function to retrieve restaurant booking details."""
    try:
        # Get booking ID from params
        booking_id = params.arguments["booking_id"]
        
        # Log request details
        request_url = f"{RESTAURANT_BOOKING_API_URL}/booking/{booking_id}"
        logger.info(f"Retrieving restaurant booking with ID: {booking_id} - Request URL: {request_url}")
        
        try:
            # Make API request to get booking details
            response = requests.get(
                request_url,
                timeout=10  # Set a reasonable timeout
            )
            
            # Check if request was successful
            response.raise_for_status()
            
            try:
                # Parse response data
                booking_data = response.json()
                logger.info(f"Successfully retrieved booking data for ID: {booking_id}")
                
                # Return the booking data
                await params.result_callback(booking_data)
                
            except json.JSONDecodeError as e:
                # Handle JSON parsing errors
                error_message = f"Error parsing booking response: {str(e)}"
                logger.error(f"{error_message} - Response content: {response.text[:200]}")
                await params.result_callback({
                    "error": True,
                    "message": error_message,
                    "status": "failed",
                    "booking_id": booking_id,
                    "response_code": response.status_code
                })
                
        except requests.exceptions.ConnectionError as e:
            # Handle connection errors
            error_message = f"Connection error while retrieving restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "connection_error"
            })
            
        except requests.exceptions.Timeout as e:
            # Handle timeout errors
            error_message = f"Timeout error while retrieving restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}, Timeout: 10s")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "timeout"
            })
            
        except requests.exceptions.HTTPError as e:
            # Handle HTTP errors with response details
            status_code = e.response.status_code if hasattr(e, 'response') else "unknown"
            error_message = f"HTTP error while retrieving restaurant booking: {str(e)}"
            
            # Try to get error details from response
            error_details = {}
            try:
                if hasattr(e, 'response') and e.response.text:
                    error_details = e.response.json()
            except json.JSONDecodeError:
                error_details = {"raw_response": e.response.text[:200]} if hasattr(e, 'response') else {}
                
            logger.error(f"{error_message} - Status code: {status_code}, URL: {request_url}")
            logger.error(f"Error details: {json.dumps(error_details)}")
            
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "status_code": status_code,
                "error_details": error_details
            })
            
        except requests.exceptions.RequestException as e:
            # Handle other request errors
            error_message = f"Request error while retrieving restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "request_error"
            })
            
    except KeyError as e:
        # Handle missing required arguments
        error_message = f"Missing required argument in get_restaurant_booking: {str(e)}"
        logger.error(error_message)
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "error_type": "invalid_arguments"
        })
        
    except Exception as e:
        # Handle any other unexpected errors
        error_message = f"Unexpected error retrieving restaurant booking: {str(e)}"
        logger.error(f"{error_message} - Exception type: {type(e).__name__}")
        
        # Return error response with booking ID if available
        booking_id = params.arguments.get("booking_id", "unknown")
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "booking_id": booking_id,
            "error_type": "unexpected_error"
        })

async def delete_restaurant_booking(params: FunctionCallParams):
    """Function to delete (cancel) a restaurant booking."""
    try:
        # Get booking ID from params
        booking_id = params.arguments["booking_id"]
        
        # Get optional cancellation reason if provided
        cancellation_reason = params.arguments.get("cancellation_reason", "")
        
        # Prepare request payload
        payload = {
            "booking_id": booking_id
        }
        
        # Add cancellation reason if provided
        if cancellation_reason:
            payload["cancellation_reason"] = cancellation_reason
        
        # Log request details
        request_url = f"{RESTAURANT_BOOKING_API_URL}/booking/{booking_id}"
        logger.info(f"Canceling restaurant booking with ID: {booking_id} - Request URL: {request_url}")
        logger.debug(f"Cancellation payload: {json.dumps(payload)}")
        
        try:
            # Make API request to cancel the booking
            response = requests.delete(
                request_url,
                json=payload,
                timeout=10  # Set a reasonable timeout
            )
            
            # Check if request was successful
            response.raise_for_status()
            
            try:
                # Parse response data
                cancellation_data = response.json()
                
                # Prepare response in the expected format
                result = {
                    "message": cancellation_data.get("message", f"Booking with ID {booking_id} deleted successfully"),
                    "booking_id": booking_id
                }
                
                # Include cancellation details from the API response
                if "cancellation_details" in cancellation_data:
                    result["cancellation_details"] = cancellation_data["cancellation_details"]
                
                # Include any additional fields from the API response
                for key, value in cancellation_data.items():
                    if key not in result and key != "cancellation_details":
                        result[key] = value
                
                logger.info(f"Successfully canceled booking with ID: {booking_id}")
                await params.result_callback(result)
                
            except json.JSONDecodeError as e:
                # Handle JSON parsing errors
                error_message = f"Error parsing cancellation response: {str(e)}"
                logger.error(f"{error_message} - Response content: {response.text[:200]}")
                await params.result_callback({
                    "error": True,
                    "message": error_message,
                    "status": "failed",
                    "booking_id": booking_id,
                    "response_code": response.status_code
                })
                
        except requests.exceptions.ConnectionError as e:
            # Handle connection errors
            error_message = f"Connection error while canceling restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "connection_error"
            })
            
        except requests.exceptions.Timeout as e:
            # Handle timeout errors
            error_message = f"Timeout error while canceling restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}, Timeout: 10s")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "timeout"
            })
            
        except requests.exceptions.HTTPError as e:
            # Handle HTTP errors with response details
            status_code = e.response.status_code if hasattr(e, 'response') else "unknown"
            error_message = f"HTTP error while canceling restaurant booking: {str(e)}"
            
            # Try to get error details from response
            error_details = {}
            try:
                if hasattr(e, 'response') and e.response.text:
                    error_details = e.response.json()
            except json.JSONDecodeError:
                error_details = {"raw_response": e.response.text[:200]} if hasattr(e, 'response') else {}
                
            logger.error(f"{error_message} - Status code: {status_code}, URL: {request_url}")
            logger.error(f"Error details: {json.dumps(error_details)}")
            
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "status_code": status_code,
                "error_details": error_details
            })
            
        except requests.exceptions.RequestException as e:
            # Handle other request errors
            error_message = f"Request error while canceling restaurant booking: {str(e)}"
            logger.error(f"{error_message} - URL: {request_url}")
            await params.result_callback({
                "error": True,
                "message": error_message,
                "status": "failed",
                "booking_id": booking_id,
                "error_type": "request_error"
            })
            
    except KeyError as e:
        # Handle missing required arguments
        error_message = f"Missing required argument in delete_restaurant_booking: {str(e)}"
        logger.error(error_message)
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "error_type": "invalid_arguments"
        })
        
    except Exception as e:
        # Handle any other unexpected errors
        error_message = f"Unexpected error canceling restaurant booking: {str(e)}"
        logger.error(f"{error_message} - Exception type: {type(e).__name__}")
        
        # Return error response with booking ID if available
        booking_id = params.arguments.get("booking_id", "unknown")
        await params.result_callback({
            "error": True,
            "message": error_message,
            "status": "failed",
            "booking_id": booking_id,
            "error_type": "unexpected_error"
        })

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

# now
get_current_date_time_functionschema = FunctionSchema(
    name="get_current_date_time",
    description="Get current date and time",
    properties={},
    required=[],
)
# Define restaurant booking function schemas
create_booking_function = FunctionSchema(
    name="create_restaurant_booking",
    description="Create a new restaurant table reservation with guest details",
    properties={
        "name": {
            "type": "string",
            "description": "Name to identify your reservation",
        },
        "date": {
            "type": "string",
            "format": "date",
            "description": "The date of the booking, in the format of YYYYMMDD"
        },
        "hour": {
            "type": "string",
            "description": "The hour of the booking (HH:MM)",
            "pattern": "^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$",
        },
        "num_guests": {
            "type": "integer",
            "description": "The number of guests for the booking",
            "minimum": 1,
            "maximum": 20,
        },
    },
    required=["name", "date", "hour", "num_guests"],
)

get_booking_function = FunctionSchema(
    name="get_restaurant_booking",
    description="Retrieve details of a specific restaurant booking",
    properties={
        "booking_id": {
            "type": "string",
            "description": "The ID of the booking to retrieve",
        },
    },
    required=["booking_id"],
)

delete_booking_function = FunctionSchema(
    name="delete_restaurant_booking",
    description="Cancel an existing restaurant booking",
    properties={
        "booking_id": {
            "type": "string",
            "description": "The ID of the booking to cancel",
        },
        "cancellation_reason": {
            "type": "string",
            "description": "Reason for cancellation (optional)",
            "optional": True,
        },
    },
    required=["booking_id"],
)

# Create tools schema
tools = ToolsSchema(standard_tools=[
    weather_function,
    create_booking_function,
    get_booking_function,
    delete_booking_function,
    get_current_date_time_functionschema
])

# Function to register all functions with the LLM service
def register_functions(llm_service):
    """Register all functions with the LLM service."""
    llm_service.register_function("get_current_weather", fetch_weather_from_api)
    llm_service.register_function("create_restaurant_booking", create_restaurant_booking)
    llm_service.register_function("get_restaurant_booking", get_restaurant_booking)
    llm_service.register_function("delete_restaurant_booking", delete_restaurant_booking)
    llm_service.register_function("get_current_date_time_functionschema", get_current_date_time)