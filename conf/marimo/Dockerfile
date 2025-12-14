FROM ghcr.io/marimo-team/marimo:latest-sql

USER root

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# We override the CMD to match our preferred port (2718) instead of the default 8080.
CMD ["marimo", "edit", "--host", "0.0.0.0", "--port", "2718", "--no-token"]
