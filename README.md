# Lab starter

## Project Overview

This Lab Starter comes with the following:
- **Windmill**: Workflow automation and scheduling.
- **OpenWebUI**: A user-friendly frontend for interacting with local LLMs.
- **Baserow**: No-code database for structured data collaboration.
- **Crawl4AI**: Automated web crawling tailored for AI data ingestion.
- **Watchtower**: Automatically updates running containers with the latest images.
- **ComfyUI (optional)**: Node-based UI for generative AI workflows.
- **Ollama (optional)**: Lightweight LLM runtime for local model serving.

## Dependencies

Check the [shell.nix](./shell.nix) file.

## Setup

```sh
cp conf/searxng/settings.yml.example conf/searxng/settings.yml
cp conf/searxng/uwsgi.ini.example conf/searxng/uwsgi.ini
cp conf/comfyui/download-models.txt.example conf/comfyui/download-models.txt

cp -r env.example env
```

***The environment files can contain sensitive information such as API keys 
and passwords. Do not check them into source control.

3. Add a unique SEARXNG_SEARCH value to your `env/searxng` file

```sh
docker compose up
```

This will provide the following services:
- **openwebui**: http://localhost:6600
- **baserow**: http://localhost:6601
- **windmill**: http://localhost:6602
- **crawl4ai playground**: http://localhost:6603

Go to each and set an appropriate login/password
