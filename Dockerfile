FROM python:3.12-slim

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

EXPOSE 8080

CMD bash -c "cd frontend && npm run build && cd .. && uvicorn main:app --host 0.0.0.0 --port 8080"