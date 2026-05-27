FROM python:3.12-slim

ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_MAP_ID
ARG VITE_API_BASE_URL=""

ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_MAP_ID=$VITE_GOOGLE_MAPS_MAP_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY frontend/package*.json frontend/
RUN cd frontend && npm install

COPY . .

RUN cd frontend && npm run build

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]