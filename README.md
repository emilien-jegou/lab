# Local lab

Subject to change -- fork it 👍

## Project Overview

This Lab Starter comes with the following:
- **OpenWebUI**: A user-friendly frontend for interacting with local LLMs.
- **Baserow**: No-code database for structured data collaboration.
- **Crawl4AI**: Automated web crawling tailored for AI data ingestion.
- **Watchtower**: Automatically updates running containers with the latest images.

## Dependencies

Check the [shell.nix](./shell.nix) file.

## Setup

1. Copy over the config files
```sh
cp conf/searxng/settings.yml.example conf/searxng/settings.yml
cp conf/searxng/uwsgi.ini.example conf/searxng/uwsgi.ini

cp -r env.example env
```

***The environment files can contain sensitive information such as API keys 
and passwords. Do not check them into source control.***

2. Modify your secrets, e.g.:
*   **`env/secrets.env`**:
    *   `WEBUI_SECRET_KEY`
*   **`env/minio.env`**:
    *   `MINIO_ROOT_USER` & `MINIO_ROOT_PASSWORD`
*   **`env/searxng.env`**:
    *   `SEARXNG_SECRET`
*   **`env/db.env`**:
    *   `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
*   **`env/crawl4ai.env`**: Choose a provider and give it an api key
...

3. Launch it
```sh
podman-compose up # Or docker-compose up
```

This setup will provide expose the following web endpoint:
*   **Open WebUI**: **http://localhost:6600**
*   **NocoDB**: **http://localhost:6601**
*   **Minio Console**: **http://localhost:6602**
*   **Crawl4AI Playground**: **http://localhost:6603**
*   **Searxng**: **http://localhost:6604**

You can check others expose ports in the compose file (e.g. 9000 for minio)
