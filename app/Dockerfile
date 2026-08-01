FROM python:3.12-slim

WORKDIR /app

# Install postgresql-client for pg_isready used in entrypoint.sh.
# Placed before pip install for better layer caching (this layer rarely changes).
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps

COPY . .

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
