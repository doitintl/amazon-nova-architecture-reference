FROM public.ecr.aws/docker/library/python:3.13-slim-bullseye

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libssl-dev \
    libffi-dev \
    python3-dev \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install boto3 "pipecat[aws-nova-sonic,webrtc]" \
    "fastapi[standard]" \
    loguru pipecat-ai av aiortc pipecat_ai_small_webrtc_prebuilt onnxruntime aws_sdk_bedrock_runtime \
    opencv-python requests

    # Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

# Expose the port
EXPOSE 8000

# Run the application
CMD ["python", "app.py", "--host", "0.0.0.0", "--port", "8000"]